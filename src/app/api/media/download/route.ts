import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import { isCustomClaimAdmin } from "@/lib/auth/adminAuth";
import { generateDownloadUrl, verifyObject, _mockStorage } from "@/lib/storage/r2";

const NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
};

export async function GET(req: NextRequest) {
    const headers = new Headers(NO_CACHE_HEADERS);

    try {
        const { searchParams } = new URL(req.url);
        const key = searchParams.get("key");

        if (!key) {
            return NextResponse.json({ error: "Missing storage key" }, { status: 400, headers });
        }

        const cleanKey = key.trim();

        // Check authentication
        let authHeader = req.headers.get("authorization");
        let token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

        // If not in Authorization header, check ?token= query parameter (useful for <a> tags or <img> tags)
        if (!token) {
            token = searchParams.get("token");
        }

        if (!token) {
            return NextResponse.json(
                { error: "Unauthorized: Missing authentication token for private media access" },
                { status: 401, headers }
            );
        }

        if (!adminAuth) {
            return NextResponse.json(
                { error: "Authentication service unavailable" },
                { status: 500, headers }
            );
        }

        let decodedToken;
        try {
            decodedToken = await adminAuth.verifyIdToken(token, true);
        } catch {
            return NextResponse.json(
                { error: "Unauthorized: Invalid or expired token" },
                { status: 401, headers }
            );
        }

        const callerUid = decodedToken.uid;
        const isAdmin = isCustomClaimAdmin(decodedToken);

        // Check authorization:
        // Admin can access any file.
        // If customization, caller must be owner.
        if (cleanKey.startsWith("customizations/")) {
            const parts = cleanKey.split("/");
            const fileOwnerUid = parts[1];

            if (!isAdmin && fileOwnerUid !== callerUid) {
                return NextResponse.json(
                    { error: "Forbidden: You do not have permission to access this customer image" },
                    { status: 403, headers }
                );
            }
        }

        // Verify object exists
        const verification = await verifyObject(cleanKey);
        if (!verification.exists) {
            return NextResponse.json(
                { error: "Object not found in storage" },
                { status: 404, headers }
            );
        }

        // Generate time-limited presigned download URL
        const downloadUrl = await generateDownloadUrl(cleanKey, 1800); // 30 minutes

        // If downloadUrl is different from current path, redirect to it
        if (!downloadUrl.startsWith("/api/media/download")) {
            return NextResponse.redirect(downloadUrl, 307);
        }

        // In mock mode, return mock buffer
        const mock = _mockStorage.get(cleanKey);
        if (mock?.data) {
            return new NextResponse(new Uint8Array(mock.data), {
                status: 200,
                headers: {
                    "Content-Type": mock.contentType || "image/jpeg",
                    "Content-Disposition": `inline; filename="${cleanKey.split("/").pop()}"`,
                    ...NO_CACHE_HEADERS,
                },
            });
        }

        return NextResponse.json(
            { downloadUrl, key: cleanKey, expiresInSeconds: 1800 },
            { status: 200, headers }
        );
    } catch (err: any) {
        console.error("[Media Download Error]:", err);
        return NextResponse.json(
            { error: err.message || "Failed to process download request" },
            { status: 500, headers }
        );
    }
}
