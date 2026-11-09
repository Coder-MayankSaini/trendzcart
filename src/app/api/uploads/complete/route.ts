import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
    verifyObject,
    getPublicAssetUrl,
    validateFileType,
    MAX_FILE_SIZE_BYTES,
} from "@/lib/storage/r2";

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

        // 1. Verify Authentication
        const authHeader = req.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json(
                { error: "Unauthorized: Missing or malformed Authorization header" },
                { status: 401, headers }
            );
        }

        const idToken = authHeader.slice(7).trim();
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

        // 2. Parse Body
        let body: any;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json(
                { error: "Invalid JSON request body" },
                { status: 400, headers }
            );
        }

        const { sessionId, key } = body || {};

        if (!key || typeof key !== "string") {
            return NextResponse.json(
                { error: "Missing or invalid storage key" },
                { status: 400, headers }
            );
        }

        // 3. Verify Session Ownership if sessionId is provided
        let sessionDoc: any = null;
        if (sessionId && typeof sessionId === "string") {
            const sessionRef = adminDb.collection("uploadSessions").doc(sessionId);
            const snap = await sessionRef.get();
            if (snap.exists) {
                sessionDoc = snap.data();
                if (sessionDoc.ownerUid !== callerUid) {
                    return NextResponse.json(
                        { error: "Forbidden: Upload session belongs to a different user" },
                        { status: 403, headers }
                    );
                }
                if (sessionDoc.key !== key) {
                    return NextResponse.json(
                        { error: "Invalid key: Storage key does not match authorization session" },
                        { status: 400, headers }
                    );
                }
            }
        }

        // 4. Verify Object in Storage
        const verification = await verifyObject(key);
        if (!verification.exists) {
            return NextResponse.json(
                { error: `File not found in storage at key '${key}'` },
                { status: 404, headers }
            );
        }

        // 5. Server-side validation of stored object
        if (verification.contentType && !validateFileType(verification.contentType)) {
            return NextResponse.json(
                { error: `Uploaded file has unsupported content type '${verification.contentType}'` },
                { status: 400, headers }
            );
        }

        if (verification.size > MAX_FILE_SIZE_BYTES) {
            return NextResponse.json(
                { error: `Uploaded file exceeds size limit of 10MB (size: ${verification.size} bytes)` },
                { status: 400, headers }
            );
        }

        // 6. Update session status
        if (sessionId) {
            await adminDb.collection("uploadSessions").doc(sessionId).set(
                {
                    status: "completed",
                    actualSize: verification.size,
                    actualContentType: verification.contentType,
                    completedAt: Date.now(),
                },
                { merge: true }
            );
        }

        const publicUrl = getPublicAssetUrl(key);

        return NextResponse.json(
            {
                success: true,
                key,
                publicUrl,
                size: verification.size,
                contentType: verification.contentType,
            },
            { status: 200, headers }
        );
    } catch (err: any) {
        console.error("[Upload Complete Error]:", err);
        return NextResponse.json(
            { error: err.message || "Internal server error confirming upload" },
            { status: 500, headers }
        );
    }
}
