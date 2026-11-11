import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/auth/adminAuth";
import { executeBatchImport } from "@/lib/products/import/serverImportEngine";
import type { ImportConfirmationOptions } from "@/lib/products/import/types";

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
            fileChecksum,
            confirmations,
            chunkSize,
        } = body as {
            batchId?: string;
            fileChecksum?: string;
            confirmations?: ImportConfirmationOptions;
            chunkSize?: number;
        };

        if (!batchId || typeof batchId !== "string" || !batchId.trim()) {
            return NextResponse.json(
                { error: "Valid batchId identifier is required for import commit." },
                { status: 400 }
            );
        }

        if (!fileChecksum || typeof fileChecksum !== "string" || !fileChecksum.trim()) {
            return NextResponse.json(
                { error: "Valid fileChecksum is required to verify preview integrity before commit." },
                { status: 400 }
            );
        }

        if (!confirmations || typeof confirmations !== "object") {
            return NextResponse.json(
                { error: "Administrator confirmation options are required." },
                { status: 400 }
            );
        }

        // 2. Server-side Execution & Integrity Check
        // The server loads authoritative preview data from productImportBatches/{batchId},
        // validates admin identity, checksum, and explicit confirmation flags,
        // and processes products in bounded, resumable chunks.
        const chunkResult = await executeBatchImport({
            batchId: batchId.trim(),
            adminUid: authResult.uid || "admin",
            adminEmail: authResult.email,
            fileChecksum: fileChecksum.trim(),
            confirmations,
            chunkSize: typeof chunkSize === "number" ? chunkSize : undefined,
        });

        return NextResponse.json(chunkResult);
    } catch (err: any) {
        console.error("[API Product Import Commit Error]:", err);
        return NextResponse.json(
            { error: `Batch import commit failed: ${err.message || "Unknown error"}` },
            { status: 400 }
        );
    }
}
