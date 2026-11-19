import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

const NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
};

export async function GET(req: NextRequest) {
    const headers = new Headers(NO_CACHE_HEADERS);

    try {
        const { searchParams } = new URL(req.url);
        const productId = searchParams.get("productId")?.trim();

        if (!productId) {
            return NextResponse.json(
                { eligible: false, error: "Missing productId query parameter" },
                { status: 400, headers }
            );
        }

        const authHeader = req.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ eligible: false }, { status: 200, headers });
        }

        const idToken = authHeader.slice(7).trim();
        if (!idToken || !adminAuth || !adminDb) {
            return NextResponse.json({ eligible: false }, { status: 200, headers });
        }

        let decoded;
        try {
            decoded = await adminAuth.verifyIdToken(idToken, true);
        } catch {
            return NextResponse.json({ eligible: false }, { status: 200, headers });
        }

        const uid = decoded.uid;
        const snapshot = await adminDb
            .collection("orders")
            .where("userId", "==", uid)
            .where("orderStatus", "==", "Delivered")
            .get();

        let eligible = false;
        for (const doc of snapshot.docs) {
            const data = doc.data();
            if (
                Array.isArray(data.items) &&
                data.items.some(
                    (item: any) =>
                        item && (item.id === productId || item.productId === productId)
                )
            ) {
                eligible = true;
                break;
            }
        }

        return NextResponse.json({ eligible }, { status: 200, headers });
    } catch (error) {
        console.error("[Review Eligibility Error]:", error);
        return NextResponse.json({ eligible: false }, { status: 500, headers });
    }
}
