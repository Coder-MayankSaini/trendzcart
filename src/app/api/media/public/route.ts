import { NextRequest, NextResponse } from "next/server";
import { getR2Client, getR2BucketName, _mockStorage } from "@/lib/storage/r2";
import { GetObjectCommand } from "@aws-sdk/client-s3";

// Safe SVG fallback for missing or unavailable legacy images
const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400" fill="none">
  <rect width="400" height="400" fill="#f1f5f9"/>
  <path d="M160 160C160 148.954 168.954 140 180 140H220C231.046 140 240 148.954 240 160V240C240 251.046 231.046 260 220 260H180C168.954 260 160 251.046 160 240V160Z" fill="#cbd5e1"/>
  <circle cx="185" cy="175" r="15" fill="#94a3b8"/>
  <path d="M160 230L190 195L215 220L230 205L240 215V240H160V230Z" fill="#94a3b8"/>
  <text x="200" y="290" text-anchor="middle" fill="#64748b" font-family="system-ui, sans-serif" font-size="14" font-weight="500">Bazaarvilla Image</text>
</svg>`;

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const key = searchParams.get("key");

        if (!key) {
            return new NextResponse(FALLBACK_SVG, {
                status: 200,
                headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" },
            });
        }

        // Only allow public namespaces
        const cleanKey = key.trim();
        if (
            !cleanKey.startsWith("products/") &&
            !cleanKey.startsWith("categories/") &&
            !cleanKey.startsWith("reviews/")
        ) {
            return new NextResponse("Forbidden namespace", { status: 403 });
        }

        const client = getR2Client();

        if (!client) {
            // Check mock storage
            const mock = _mockStorage.get(cleanKey);
            if (mock && mock.data) {
                return new NextResponse(new Uint8Array(mock.data), {
                    status: 200,
                    headers: {
                        "Content-Type": mock.contentType || "image/jpeg",
                        "Cache-Control": "public, max-age=31536000, immutable",
                    },
                });
            }
            return new NextResponse(FALLBACK_SVG, {
                status: 200,
                headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" },
            });
        }

        const command = new GetObjectCommand({
            Bucket: getR2BucketName(),
            Key: cleanKey,
        });

        const s3Response = await client.send(command);
        const byteArray = await s3Response.Body?.transformToByteArray();

        if (!byteArray) {
            return new NextResponse(FALLBACK_SVG, {
                status: 200,
                headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" },
            });
        }

        return new NextResponse(new Uint8Array(byteArray), {
            status: 200,
            headers: {
                "Content-Type": s3Response.ContentType || "image/jpeg",
                "Cache-Control": "public, max-age=31536000, immutable",
            },
        });
    } catch {
        return new NextResponse(FALLBACK_SVG, {
            status: 200,
            headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" },
        });
    }
}
