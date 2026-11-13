import { NextRequest, NextResponse } from "next/server";
import { getR2Client, getR2BucketName, _mockStorage } from "@/lib/storage/r2";
import { GetObjectCommand } from "@aws-sdk/client-s3";

export const dynamic = "force-dynamic";

// Safe SVG fallback for missing or unavailable legacy images (no-cache to avoid poisoning CDN/browser)
const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400" fill="none">
  <rect width="400" height="400" fill="#f1f5f9"/>
  <path d="M160 160C160 148.954 168.954 140 180 140H220C231.046 140 240 148.954 240 160V240C240 251.046 231.046 260 220 260H180C168.954 260 160 251.046 160 240V160Z" fill="#cbd5e1"/>
  <circle cx="185" cy="175" r="15" fill="#94a3b8"/>
  <path d="M160 230L190 195L215 220L230 205L240 215V240H160V230Z" fill="#94a3b8"/>
  <text x="200" y="290" text-anchor="middle" fill="#64748b" font-family="system-ui, sans-serif" font-size="14" font-weight="500">Bazaarvilla Image</text>
</svg>`;

function createFallbackResponse(key = "") {
    return new NextResponse(FALLBACK_SVG, {
        status: 200,
        headers: {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "X-Bazaarvilla-Media-Status": "fallback",
            "X-Bazaarvilla-Media-Key": key,
        },
    });
}

interface RouteParams {
    params: Promise<{ key: string | string[] }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
    try {
        const resolvedParams = await params;
        const rawKey = Array.isArray(resolvedParams.key)
            ? resolvedParams.key.join("/")
            : resolvedParams.key;

        if (!rawKey) {
            return createFallbackResponse();
        }

        const cleanKey = decodeURIComponent(rawKey).trim().replace(/^\/+/, "");

        // Only allow public namespaces (products, categories, reviews)
        // Customizations are strictly private and accessible only via /api/media/download
        if (
            !cleanKey.startsWith("products/") &&
            !cleanKey.startsWith("categories/") &&
            !cleanKey.startsWith("reviews/")
        ) {
            return new NextResponse("Forbidden namespace", { status: 403 });
        }

        const client = getR2Client();

        if (!client) {
            // Check mock storage (for local development and integration tests)
            const mock = _mockStorage.get(cleanKey);
            if (mock && mock.data) {
                return new NextResponse(new Uint8Array(mock.data), {
                    status: 200,
                    headers: {
                        "Content-Type": mock.contentType || "image/jpeg",
                        "Cache-Control": "public, max-age=31536000, immutable",
                        "X-Bazaarvilla-Media-Status": "hit",
                        "X-Bazaarvilla-Media-Key": cleanKey,
                    },
                });
            }
            return createFallbackResponse(cleanKey);
        }

        const command = new GetObjectCommand({
            Bucket: getR2BucketName(),
            Key: cleanKey,
        });

        const s3Response = await client.send(command);
        const byteArray = await s3Response.Body?.transformToByteArray();

        if (!byteArray || byteArray.length === 0) {
            return createFallbackResponse(cleanKey);
        }

        return new NextResponse(new Uint8Array(byteArray), {
            status: 200,
            headers: {
                "Content-Type": s3Response.ContentType || "image/jpeg",
                "Cache-Control": "public, max-age=31536000, immutable",
                "X-Bazaarvilla-Media-Status": "hit",
                "X-Bazaarvilla-Media-Key": cleanKey,
            },
        });
    } catch {
        return createFallbackResponse();
    }
}
