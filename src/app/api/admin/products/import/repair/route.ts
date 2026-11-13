import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/auth/adminAuth";
import { auditCatalogMedia, executeMediaRepair } from "@/lib/products/import/mediaRepair";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    try {
        const authResult = await verifyAdminRequest(req);
        if (!authResult.isAdmin) {
            return NextResponse.json(
                { error: authResult.error || "Unauthorized admin access required" },
                { status: 401 }
            );
        }

        const { auditEntries, affectedProducts } = await auditCatalogMedia();

        return NextResponse.json({
            success: true,
            totalAudited: auditEntries.length,
            healthyCount: auditEntries.length - affectedProducts.length,
            affectedCount: affectedProducts.length,
            affectedProducts,
        });
    } catch (err: any) {
        console.error("[API Media Repair Audit Error]:", err);
        return NextResponse.json(
            { error: `Media audit failed: ${err.message || "Unknown error"}` },
            { status: 500 }
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        const authResult = await verifyAdminRequest(req);
        if (!authResult.isAdmin) {
            return NextResponse.json(
                { error: authResult.error || "Unauthorized admin access required" },
                { status: 401 }
            );
        }

        const body = await req.json().catch(() => ({}));
        const dryRun = body.dryRun !== false; // Defaults to dry-run (safe)
        const confirmed = Boolean(body.confirmed);
        const productIds: string[] | undefined = Array.isArray(body.productIds) ? body.productIds : undefined;
        const referenceCsvText: string | undefined = typeof body.csvText === "string" ? body.csvText : undefined;

        if (!dryRun && !confirmed) {
            return NextResponse.json(
                { error: "Explicit administrator confirmation (confirmed: true) is required to apply production media repairs." },
                { status: 400 }
            );
        }

        const report = await executeMediaRepair({
            dryRun,
            productIds,
            referenceCsvText,
            confirmed,
        });

        return NextResponse.json({
            success: true,
            ...report,
        });
    } catch (err: any) {
        console.error("[API Media Repair Commit Error]:", err);
        return NextResponse.json(
            { error: `Media repair execution failed: ${err.message || "Unknown error"}` },
            { status: 400 }
        );
    }
}
