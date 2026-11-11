import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/auth/adminAuth";
import { formatSafeCsvRow } from "@/lib/products/import/sanitizer";
import type { ImportValidationError, ImportValidationWarning } from "@/lib/products/import/types";

export const dynamic = "force-dynamic";

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
        const errors: ImportValidationError[] = Array.isArray(body.errors) ? body.errors : [];
        const warnings: ImportValidationWarning[] = Array.isArray(body.warnings) ? body.warnings : [];

        const csvLines: string[] = [];

        // CSV Header
        csvLines.push(
            formatSafeCsvRow([
                "Row Number",
                "Product Handle",
                "Field",
                "Provided Value",
                "Message",
                "Suggested Correction",
                "Severity",
            ])
        );

        // Errors (Fatal or non-fatal)
        for (const e of errors) {
            csvLines.push(
                formatSafeCsvRow([
                    e.rowNumber,
                    e.handle || "N/A",
                    e.field,
                    e.providedValue || "—",
                    e.message,
                    e.suggestedCorrection || "Review and correct value",
                    e.fatal ? "FATAL_ERROR" : "ERROR",
                ])
            );
        }

        // Warnings
        for (const w of warnings) {
            csvLines.push(
                formatSafeCsvRow([
                    w.rowNumber,
                    w.handle || "N/A",
                    w.field,
                    w.providedValue || "—",
                    w.message,
                    "Information only",
                    "WARNING",
                ])
            );
        }

        const csvContent = csvLines.join("\r\n");
        const filename = `bazaarvilla-import-errors-${Date.now()}.csv`;

        return new NextResponse(csvContent, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
                "Cache-Control": "no-store",
            },
        });
    } catch (err: any) {
        console.error("[API Product Import Error Report Error]:", err);
        return NextResponse.json(
            { error: `Failed to generate error report: ${err.message || "Unknown error"}` },
            { status: 500 }
        );
    }
}
