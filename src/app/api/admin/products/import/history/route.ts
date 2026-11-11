import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/auth/adminAuth";
import { adminDb } from "@/lib/firebase/admin";

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

        if (!adminDb) {
            return NextResponse.json(
                { error: "Cloud Firestore database service unavailable." },
                { status: 500 }
            );
        }

        const snap = await adminDb
            .collection("productImportBatches")
            .orderBy("createdAt", "desc")
            .limit(50)
            .get();

        const batches = snap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        return NextResponse.json({
            success: true,
            batches,
        });
    } catch (err: any) {
        console.error("[API Product Import History Error]:", err);
        return NextResponse.json(
            { error: `Failed to retrieve import history: ${err.message || "Unknown error"}` },
            { status: 500 }
        );
    }
}
