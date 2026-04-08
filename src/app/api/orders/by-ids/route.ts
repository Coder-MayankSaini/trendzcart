import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";

const MAX_IDS = 25;

const toIsoDate = (value: any): string | null => {
    if (!value) return null;
    if (typeof value?.toDate === "function") {
        return value.toDate().toISOString();
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export async function POST(req: NextRequest) {
    try {
        if (!adminDb) {
            return NextResponse.json({ error: "Order service is not configured" }, { status: 500 });
        }
        const db = adminDb;

        const body = await req.json();
        const ids = Array.isArray(body?.ids)
            ? body.ids.filter((id: unknown) => typeof id === "string" && id.trim().length > 0).slice(0, MAX_IDS)
            : [];

        if (!ids.length) {
            return NextResponse.json({ orders: [] });
        }

        const snapshots = await Promise.all(ids.map((id: string) => db.collection("orders").doc(id).get()));
        const orders = snapshots
            .filter((snap) => snap.exists)
            .map((snap) => {
                const data = snap.data() as any;
                return {
                    id: snap.id,
                    ...data,
                    createdAt: toIsoDate(data?.createdAt),
                    updatedAt: toIsoDate(data?.updatedAt),
                };
            })
            .sort((a: any, b: any) => (new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));

        return NextResponse.json({ orders });
    } catch (error) {
        console.error("Failed to fetch guest orders", error);
        return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
    }
}
