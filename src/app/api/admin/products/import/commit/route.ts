import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/auth/adminAuth";
import { adminDb } from "@/lib/firebase/admin";
import { executeBatchImport } from "@/lib/products/import/serverImportEngine";
import type { ImportMode, ProductImportPreview } from "@/lib/products/import/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    try {
        // 1. Authenticated administrator authorization
        const authResult = await verifyAdminRequest(req);
        if (!authResult.isAdmin) {
            return NextResponse.json(
                { error: authResult.error || "Unauthorized admin access required" },
                { status: 401 }
            );
        }

        const body = await req.json().catch(() => ({}));
        const {
            batchId,
            previews,
            importMode = "create_and_update",
            sourceFileName = "import.csv",
            fileChecksum = "",
            totalRows = 0,
            formatDetected = "custom",
        } = body as {
            batchId?: string;
            previews?: ProductImportPreview[];
            importMode?: ImportMode;
            sourceFileName?: string;
            fileChecksum?: string;
            totalRows?: number;
            formatDetected?: any;
        };

        if (!batchId || typeof batchId !== "string") {
            return NextResponse.json(
                { error: "Valid batchId identifier is required for import commit." },
                { status: 400 }
            );
        }

        if (!Array.isArray(previews) || previews.length === 0) {
            return NextResponse.json(
                { error: "No confirmed product previews provided to import." },
                { status: 400 }
            );
        }

        if (!adminDb) {
            return NextResponse.json(
                { error: "Cloud Firestore database service unavailable." },
                { status: 500 }
            );
        }

        // 2. Idempotency Guard:
        // Check if an import batch with this ID has already been executed or completed
        const existingBatchSnap = await adminDb.collection("productImportBatches").doc(batchId).get();
        if (existingBatchSnap.exists) {
            const data = existingBatchSnap.data();
            if (data?.status === "completed") {
                return NextResponse.json({
                    success: true,
                    isIdempotentReplay: true,
                    batchRecord: data,
                });
            }
        }

        // 3. Server-side Execution
        const completedRecord = await executeBatchImport({
            batchId,
            adminUid: authResult.uid || "admin",
            adminEmail: authResult.email,
            sourceFileName,
            fileChecksum,
            importMode,
            formatDetected,
            totalRows: totalRows || previews.length,
            previews,
        });

        return NextResponse.json({
            success: true,
            batchRecord: completedRecord,
        });
    } catch (err: any) {
        console.error("[API Product Import Commit Error]:", err);
        return NextResponse.json(
            { error: `Batch import commit failed: ${err.message || "Unknown error"}` },
            { status: 500 }
        );
    }
}
