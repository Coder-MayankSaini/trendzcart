import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimiter";
import {
    generateUploadUrl,
    validateFileType,
    validateFileSize,
    MAX_FILE_SIZE_BYTES,
    ALLOWED_IMAGE_MIME_TYPES,
} from "@/lib/storage/r2";
import { isCustomClaimAdmin } from "@/lib/auth/adminAuth";
import { v4 as uuidv4 } from "uuid";

const NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
};

export async function POST(req: NextRequest) {
    const headers = new Headers(NO_CACHE_HEADERS);

    try {
        if (!adminAuth || !adminDb) {
            return NextResponse.json(
                { error: "Firebase Admin services unavailable" },
                { status: 500, headers }
            );
        }

        // 1. Verify Authentication (Supports anonymous guest and registered users)
        const authHeader = req.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json(
                { error: "Unauthorized: Missing or malformed Authorization header" },
                { status: 401, headers }
            );
        }

        const idToken = authHeader.slice(7).trim();
        if (!idToken) {
            return NextResponse.json(
                { error: "Unauthorized: Empty bearer token" },
                { status: 401, headers }
            );
        }

        let decodedToken;
        try {
            decodedToken = await adminAuth.verifyIdToken(idToken, true);
        } catch {
            return NextResponse.json(
                { error: "Unauthorized: Invalid or revoked ID token" },
                { status: 401, headers }
            );
        }

        const callerUid = decodedToken.uid;
        if (!callerUid) {
            return NextResponse.json(
                { error: "Unauthorized: Missing UID in token" },
                { status: 401, headers }
            );
        }

        // 2. Rate Limiting per UID
        const clientIp = getClientIp(req);
        const rateLimitKey = `upload_auth_${callerUid}_${clientIp}`;
        const rateLimitResult = await checkRateLimit(adminDb, {
            key: rateLimitKey,
            limit: 20, // 20 authorization requests per minute
            windowMs: 60 * 1000,
        });

        if (!rateLimitResult.allowed) {
            return NextResponse.json(
                { error: "Rate limit exceeded. Too many upload requests." },
                {
                    status: 429,
                    headers: {
                        ...NO_CACHE_HEADERS,
                        "Retry-After": String(rateLimitResult.retryAfterSeconds),
                    },
                }
            );
        }

        // 3. Parse and Validate Request Payload
        let body: any;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json(
                { error: "Invalid JSON request body" },
                { status: 400, headers }
            );
        }

        const { folder, contentType, sizeBytes, originalName, subId } = body || {};

        if (!folder || typeof folder !== "string") {
            return NextResponse.json(
                { error: "Missing or invalid folder" },
                { status: 400, headers }
            );
        }

        const cleanFolder = folder.toLowerCase().trim();
        const allowedFolders = ["customizations", "products", "categories", "reviews"];
        if (!allowedFolders.includes(cleanFolder)) {
            return NextResponse.json(
                { error: `Forbidden folder '${folder}'. Permitted folders: ${allowedFolders.join(", ")}` },
                { status: 400, headers }
            );
        }

        // Role-based folder permissions
        const isAdmin = isCustomClaimAdmin(decodedToken);

        if ((cleanFolder === "products" || cleanFolder === "categories") && !isAdmin) {
            return NextResponse.json(
                { error: "Forbidden: Administrator permissions required for catalog asset uploads" },
                { status: 403, headers }
            );
        }

        // 4. Validate Content Type
        if (!contentType || typeof contentType !== "string" || !validateFileType(contentType)) {
            return NextResponse.json(
                {
                    error: `Unsupported content type '${contentType}'. Only JPEG, PNG, and WebP are accepted.`,
                    allowedTypes: ALLOWED_IMAGE_MIME_TYPES,
                },
                { status: 400, headers }
            );
        }

        // 5. Validate File Size
        if (sizeBytes !== undefined) {
            if (typeof sizeBytes !== "number" || !validateFileSize(sizeBytes)) {
                return NextResponse.json(
                    { error: `File size exceeds maximum permitted limit of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB` },
                    { status: 400, headers }
                );
            }
        }

        // 6. Generate Signed R2 PUT URL
        const uploadResult = await generateUploadUrl({
            folder: cleanFolder,
            ownerUid: callerUid,
            subId: typeof subId === "string" ? subId.trim() : undefined,
            contentType,
            sizeBytes,
            originalName: typeof originalName === "string" ? originalName.slice(0, 100) : undefined,
            expiresInSeconds: 900, // 15 mins
            ifNoneMatch: false, // unique keys generated via uuid, avoid signature mismatch
        });

        // 7. Store Upload Intent Session in Firestore
        const sessionId = uuidv4();
        await adminDb.collection("uploadSessions").doc(sessionId).set({
            sessionId,
            ownerUid: callerUid,
            folder: cleanFolder,
            key: uploadResult.key,
            contentType,
            sizeBytes: sizeBytes || null,
            status: "pending",
            createdAt: Date.now(),
            expiresAt: uploadResult.expiresAt,
        });

        return NextResponse.json(
            {
                success: true,
                sessionId,
                uploadUrl: uploadResult.uploadUrl,
                key: uploadResult.key,
                publicUrl: uploadResult.publicUrl,
                expiresAt: uploadResult.expiresAt,
                headers: uploadResult.headers,
            },
            { status: 200, headers }
        );
    } catch (err: any) {
        console.error("[Upload Authorize Error]:", err);
        return NextResponse.json(
            { error: err.message || "Internal server error authorizing upload" },
            { status: 500, headers }
        );
    }
}
