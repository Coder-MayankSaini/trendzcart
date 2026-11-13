import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/auth/adminAuth";
import { convertShopifyToBazaarvillaCsv } from "@/lib/products/import/converter";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    try {
        // 1. Authenticated administrator verification
        const authResult = await verifyAdminRequest(req);
        if (!authResult.isAdmin) {
            return NextResponse.json(
                { error: authResult.error || "Unauthorized admin access required" },
                { status: 401 }
            );
        }

        const body = await req.json().catch(() => ({}));
        const csvText = typeof body.csvText === "string" ? body.csvText : "";

        if (!csvText || !csvText.trim()) {
            return NextResponse.json(
                { error: "CSV text is required for conversion" },
                { status: 400 }
            );
        }

        const result = convertShopifyToBazaarvillaCsv(csvText);

        if (!result.success) {
            return NextResponse.json(
                { error: result.error || "Failed to convert CSV format" },
                { status: 400 }
            );
        }

        return NextResponse.json(result);
    } catch (err: any) {
        console.error("[API Convert CSV Error]:", err);
        return NextResponse.json(
            { error: `CSV conversion failed: ${err.message || "Unknown error"}` },
            { status: 500 }
        );
    }
}
