import { NextRequest, NextResponse } from "next/server";
import { BAZAARVILLA_TEMPLATES } from "@/lib/products/import/templates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const type = (searchParams.get("type") || "standard") as "standard" | "variants" | "personalized";

    const template = BAZAARVILLA_TEMPLATES[type] || BAZAARVILLA_TEMPLATES.standard;

    // Check if client requested JSON metadata
    if (searchParams.get("format") === "json") {
        return NextResponse.json({
            success: true,
            template,
            allTemplates: Object.values(BAZAARVILLA_TEMPLATES).map((t) => ({
                id: t.id,
                name: t.name,
                filename: t.filename,
                description: t.description,
                minimumColumns: t.minimumColumns,
            })),
        });
    }

    // Return downloadable CSV file
    return new NextResponse(template.csvContent, {
        status: 200,
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${template.filename}"`,
            "Cache-Control": "public, max-age=3600",
        },
    });
}
