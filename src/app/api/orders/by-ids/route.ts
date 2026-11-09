import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
    verifyFirebaseAuthorization,
    verifyGuestAccessToken,
    projectCustomerOrder,
    type CustomerOrderDTO,
} from "@/lib/orders/orderAuth";
import {
    checkRateLimit,
    getClientIp,
    applyRateLimitHeaders,
} from "@/lib/security/rateLimiter";

const MAX_ORDERS_PER_REQUEST = 20;
const MAX_PAYLOAD_BYTES = 32 * 1024; // 32 KB
const MAX_ID_LENGTH = 128;

const NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
};

interface OrderQueryItem {
    id: string;
    token?: string;
    email?: string;
    phone?: string;
}

export async function POST(req: NextRequest) {
    const headers = new Headers(NO_CACHE_HEADERS);

    try {
        if (!adminDb) {
            return NextResponse.json(
                { error: "Order service is currently unavailable" },
                { status: 500, headers }
            );
        }
        const db = adminDb;

        // 1. Content-Type Validation
        const contentType = req.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("application/json")) {
            return NextResponse.json(
                { error: "Unsupported Media Type. Expected Content-Type: application/json" },
                { status: 415, headers }
            );
        }

        // 2. Request Size Validation (Header check)
        const contentLength = req.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
            return NextResponse.json(
                { error: "Payload Too Large. Maximum allowed request size is 32 KB" },
                { status: 413, headers }
            );
        }

        // 3. Distributed Rate Limiting (by Client IP)
        const clientIp = getClientIp(req);
        const rateLimitResult = await checkRateLimit(db, {
            key: `ip:${clientIp}:orders_read`,
            limit: 30, // 30 requests per minute
            windowMs: 60 * 1000,
        });

        applyRateLimitHeaders(headers, rateLimitResult);

        if (!rateLimitResult.allowed) {
            return NextResponse.json(
                { error: "Too many requests. Please try again later." },
                { status: 429, headers }
            );
        }

        // 4. Safe JSON Body Parsing
        let body: any;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json(
                { error: "Malformed JSON payload" },
                { status: 400, headers }
            );
        }

        // 5. Authentication Precedence (Firebase ID Token)
        const authHeader = req.headers.get("authorization");
        const authResult = await verifyFirebaseAuthorization(authHeader);

        // Fail-closed: if an authorization header was present but token was invalid/expired
        if (authResult.error) {
            return NextResponse.json(
                { error: authResult.error },
                { status: 401, headers }
            );
        }

        // 6. Request Input Parsing and Validation
        const queryItems: OrderQueryItem[] = [];

        // Format A: { orders: [ { id: "...", token: "..." } ] }
        if (body?.orders !== undefined) {
            if (!Array.isArray(body.orders)) {
                return NextResponse.json(
                    { error: "Invalid 'orders' parameter: expected an array" },
                    { status: 400, headers }
                );
            }
            if (body.orders.length > MAX_ORDERS_PER_REQUEST) {
                return NextResponse.json(
                    { error: `Batch size exceeds maximum limit of ${MAX_ORDERS_PER_REQUEST} orders` },
                    { status: 400, headers }
                );
            }

            for (const item of body.orders) {
                if (!item || typeof item !== "object" || typeof item.id !== "string") {
                    return NextResponse.json(
                        { error: "Invalid order item structure: each item must contain a string 'id'" },
                        { status: 400, headers }
                    );
                }
                const trimmedId = item.id.trim();
                if (!trimmedId || trimmedId.length > MAX_ID_LENGTH) {
                    return NextResponse.json(
                        { error: `Invalid order ID length (must be 1-${MAX_ID_LENGTH} characters)` },
                        { status: 400, headers }
                    );
                }
                queryItems.push({
                    id: trimmedId,
                    token: typeof item.token === "string" ? item.token.trim() : undefined,
                    email: typeof item.email === "string" ? item.email.trim().toLowerCase() : undefined,
                    phone: typeof item.phone === "string" ? item.phone.trim() : undefined,
                });
            }
        }
        // Format B: { ids: ["..."], tokens?: { [id]: "..." }, emails?: { [id]: "..." }, phones?: { [id]: "..." } }
        else if (body?.ids !== undefined) {
            if (!Array.isArray(body.ids)) {
                return NextResponse.json(
                    { error: "Invalid 'ids' parameter: expected an array" },
                    { status: 400, headers }
                );
            }
            if (body.ids.length > MAX_ORDERS_PER_REQUEST) {
                return NextResponse.json(
                    { error: `Batch size exceeds maximum limit of ${MAX_ORDERS_PER_REQUEST} orders` },
                    { status: 400, headers }
                );
            }

            const tokensMap = body.tokens && typeof body.tokens === "object" ? body.tokens : {};
            const emailsMap = body.emails && typeof body.emails === "object" ? body.emails : {};
            const phonesMap = body.phones && typeof body.phones === "object" ? body.phones : {};

            for (const id of body.ids) {
                if (typeof id !== "string") {
                    return NextResponse.json(
                        { error: "Invalid ID in array: must be a string" },
                        { status: 400, headers }
                    );
                }
                const trimmedId = id.trim();
                if (!trimmedId || trimmedId.length > MAX_ID_LENGTH) {
                    return NextResponse.json(
                        { error: `Invalid order ID length (must be 1-${MAX_ID_LENGTH} characters)` },
                        { status: 400, headers }
                    );
                }
                queryItems.push({
                    id: trimmedId,
                    token: typeof tokensMap[trimmedId] === "string" ? tokensMap[trimmedId].trim() : undefined,
                    email: typeof emailsMap[trimmedId] === "string" ? emailsMap[trimmedId].trim().toLowerCase() : undefined,
                    phone: typeof phonesMap[trimmedId] === "string" ? phonesMap[trimmedId].trim() : undefined,
                });
            }
        }

        // 7. Authorization Execution & Order Retrieval
        const results: CustomerOrderDTO[] = [];

        // PATH 1: Authenticated Registered User
        if (authResult.user) {
            const verifiedUid = authResult.user.uid;

            // If explicit order IDs were requested, fetch and verify ownership of each
            if (queryItems.length > 0) {
                const snapshots = await Promise.all(
                    queryItems.map((item) => db.collection("orders").doc(item.id).get())
                );

                for (const snap of snapshots) {
                    if (!snap.exists) continue; // Nonexistent: silently omit to prevent existence enumeration
                    const data = snap.data();
                    // Ownership check: verifiedUid must match order owner
                    if (data?.userId === verifiedUid) {
                        results.push(projectCustomerOrder({ id: snap.id, ...data }));
                    } else if (
                        !data?.userId &&
                        authResult.user.email &&
                        data?.shippingAddress?.email &&
                        data.shippingAddress.email.toLowerCase() === authResult.user.email.toLowerCase()
                    ) {
                        // Legitimate continuity link for legacy order matching verified email
                        results.push(
                            projectCustomerOrder({
                                id: snap.id,
                                createdAt: data?.createdAt,
                                updatedAt: data?.updatedAt,
                                orderStatus: "Verification Required",
                                paymentStatus: data?.paymentStatus,
                                paymentMethod: data?.paymentMethod,
                                requiresVerification: true,
                            })
                        );
                    }
                    // If userId does not match, silently omit
                }
            } else {
                // If no specific IDs passed, retrieve recent orders belonging to verified UID
                const querySnap = await db
                    .collection("orders")
                    .where("userId", "==", verifiedUid)
                    .orderBy("createdAt", "desc")
                    .limit(MAX_ORDERS_PER_REQUEST)
                    .get();

                for (const doc of querySnap.docs) {
                    results.push(projectCustomerOrder({ id: doc.id, ...doc.data() }));
                }
            }
        }
        // PATH 2: Guest Customer with Access Tokens
        else {
            if (queryItems.length === 0) {
                return NextResponse.json({ orders: [] }, { headers });
            }

            const snapshots = await Promise.all(
                queryItems.map((item) => db.collection("orders").doc(item.id).get())
            );

            for (let i = 0; i < snapshots.length; i++) {
                const snap = snapshots[i];
                const queryItem = queryItems[i];

                if (!snap.exists) {
                    // Nonexistent order: omit to prevent enumeration
                    continue;
                }

                const data = snap.data();

                // If the order belongs to a registered customer account, guests cannot access it
                if (data?.userId) {
                    continue;
                }

                // If order has a modern guest access token hash
                if (data?.guestAccessTokenHash) {
                    if (queryItem.token && verifyGuestAccessToken(queryItem.token, data.guestAccessTokenHash)) {
                        results.push(projectCustomerOrder({ id: snap.id, ...data }));
                    } else {
                        // Unauthorized: invalid or missing guest token
                        continue;
                    }
                } else {
                    // Legacy guest order without access token hash (TASK J / TASK C)
                    // Require verifiable continuity proof (matching email, phone, or token)
                    // Unverified callers are silently omitted to prevent order existence enumeration
                    const orderEmail = typeof data?.shippingAddress?.email === "string" ? data.shippingAddress.email.trim().toLowerCase() : "";
                    const orderPhone = typeof data?.shippingAddress?.phone === "string" ? data.shippingAddress.phone.replace(/\D/g, "") : "";

                    const cleanQueryPhone = queryItem.phone ? queryItem.phone.replace(/\D/g, "") : "";
                    const queryToken = queryItem.token ? queryItem.token.trim().toLowerCase() : "";

                    const hasEmailContinuity = Boolean(queryItem.email && orderEmail && queryItem.email === orderEmail);
                    const hasPhoneContinuity = Boolean(cleanQueryPhone && orderPhone && cleanQueryPhone.length >= 4 && orderPhone.endsWith(cleanQueryPhone));
                    const hasTokenContinuity = Boolean(
                        queryToken && (
                            (orderEmail && queryToken === orderEmail) ||
                            (orderPhone && queryToken.replace(/\D/g, "").length >= 4 && orderPhone.endsWith(queryToken.replace(/\D/g, "")))
                        )
                    );

                    if (hasEmailContinuity || hasPhoneContinuity || hasTokenContinuity) {
                        // Legitimate continuity verified: return restricted placeholder without leaking financial totals or PII
                        results.push(
                            projectCustomerOrder({
                                id: snap.id,
                                createdAt: data?.createdAt,
                                updatedAt: data?.updatedAt,
                                orderStatus: "Verification Required",
                                paymentStatus: data?.paymentStatus,
                                paymentMethod: data?.paymentMethod,
                                requiresVerification: true,
                            })
                        );
                    } else {
                        // Unverified caller: silently omit to prevent order existence disclosure
                        continue;
                    }
                }
            }
        }

        // Sort descending by creation date
        results.sort(
            (a, b) =>
                new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        );

        return NextResponse.json({ orders: results }, { headers });
    } catch (error) {
        console.error("[Order Retrieval Error] Internal failure:", error);
        return NextResponse.json(
            { error: "An unexpected error occurred while retrieving orders" },
            { status: 500, headers }
        );
    }
}

export async function GET() {
    return NextResponse.json(
        { error: "Method Not Allowed. Use POST." },
        { status: 405, headers: { Allow: "POST", ...NO_CACHE_HEADERS } }
    );
}

export async function PUT() {
    return NextResponse.json(
        { error: "Method Not Allowed. Use POST." },
        { status: 405, headers: { Allow: "POST", ...NO_CACHE_HEADERS } }
    );
}

export async function DELETE() {
    return NextResponse.json(
        { error: "Method Not Allowed. Use POST." },
        { status: 405, headers: { Allow: "POST", ...NO_CACHE_HEADERS } }
    );
}
