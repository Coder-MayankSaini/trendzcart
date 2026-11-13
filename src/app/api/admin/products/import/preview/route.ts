import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import crypto from "crypto";
import { verifyAdminRequest } from "@/lib/auth/adminAuth";
import { resolveColumnMapping } from "@/lib/products/import/mapping";
import { groupCsvRows } from "@/lib/products/import/grouping";
import { generateDryRunPreview } from "@/lib/products/import/serverImportEngine";
import type { ImportMode, RawCsvRow, CategoryAssignmentOptions } from "@/lib/products/import/types";

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
        const mode: ImportMode = body.mode || "create_and_update";
        const categoryAssignment: CategoryAssignmentOptions | undefined = body.categoryAssignment;

        if (!csvText || !csvText.trim()) {
            return NextResponse.json(
                { error: "CSV text is required and cannot be empty" },
                { status: 400 }
            );
        }

        // Compute SHA-256 checksum of source CSV
        const fileChecksum = crypto.createHash("sha256").update(csvText).digest("hex");

        // 2. Parse CSV using PapaParse (RFC 4180 compliant, handles BOM, multiline cells, quotes)
        const parseResult = Papa.parse<RawCsvRow>(csvText, {
            header: true,
            skipEmptyLines: "greedy",
            transformHeader: (header: string) => header.trim(),
        });

        if (parseResult.errors && parseResult.errors.length > 0) {
            // Check for fatal parse errors
            const fatalError = parseResult.errors.find(
                (e) => e.type === "Delimiter" || e.code === "UndetectableDelimiter"
            );
            if (fatalError) {
                return NextResponse.json(
                    { error: `CSV Parsing Error: ${fatalError.message}` },
                    { status: 400 }
                );
            }
        }

        const rawRows = parseResult.data || [];
        const rawHeaders = parseResult.meta.fields || [];

        if (rawRows.length === 0 || rawHeaders.length === 0) {
            return NextResponse.json(
                { error: "The provided CSV file contains no data rows or valid headers." },
                { status: 400 }
            );
        }

        // 3. Resolve Column Mapping & Format Detection
        const mappingResult = resolveColumnMapping(rawHeaders, rawRows[0]);

        if (mappingResult.missingRequiredHeaders.length > 0) {
            return NextResponse.json(
                {
                    error: `Missing required CSV column headers: ${mappingResult.missingRequiredHeaders.join(
                        ", "
                    )}. Please verify column names against standard templates.`,
                    missingHeaders: mappingResult.missingRequiredHeaders,
                    mappingResult,
                },
                { status: 400 }
            );
        }

        // 4. Group rows by handle and extract variant matrices
        const { groups, fileErrors, fileWarnings } = groupCsvRows(rawRows);

        const clientBatchId = typeof body.batchId === "string" && body.batchId.trim() ? body.batchId.trim() : crypto.randomUUID();
        const sourceFileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : "import.csv";

        // 5. Generate Dry-Run Preview against Cloud Firestore (ZERO catalog mutations)
        // Durably persists authoritative session record in productImportBatches/{batchId}
        const { previewSummary, batchId } = await generateDryRunPreview({
            batchId: clientBatchId,
            adminUid: authResult.uid || "admin",
            adminEmail: authResult.email,
            sourceFileName,
            fileChecksum,
            groups,
            totalRows: rawRows.length,
            unsupportedHeaders: mappingResult.unsupportedHeaders,
            detectedFormat: mappingResult.formatDetected,
            mode,
            categoryAssignment,
        });

        return NextResponse.json({
            success: true,
            batchId,
            fileChecksum,
            mappingResult,
            previewSummary,
            fileErrors,
            fileWarnings,
        });
    } catch (err: any) {
        console.error("[API Product Import Preview Error]:", err);
        return NextResponse.json(
            { error: `Failed to process CSV preview: ${err.message || "Unknown error"}` },
            { status: 500 }
        );
    }
}
