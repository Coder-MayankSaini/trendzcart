import { NextRequest, NextResponse } from "next/server";
import { _mockStorage } from "@/lib/storage/r2";

export async function PUT(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const key = searchParams.get("key");
        const expires = searchParams.get("expires");

        if (!key) {
            return new NextResponse("Missing key parameter", { status: 400 });
        }

        if (expires && Number(expires) < Date.now()) {
            return new NextResponse("Presigned URL expired", { status: 403 });
        }

        const buffer = Buffer.from(await req.arrayBuffer());
        const contentType = req.headers.get("content-type") || "image/jpeg";

        _mockStorage.set(key, {
            key,
            contentType,
            size: buffer.length,
            metadata: {},
            data: buffer,
            createdAt: Date.now(),
            etag: `mock-${Date.now()}-${buffer.length}`,
        });

        return new NextResponse(null, {
            status: 200,
            headers: {
                ETag: `mock-${Date.now()}`,
            },
        });
    } catch (err: any) {
        return new NextResponse(err.message, { status: 500 });
    }
}
