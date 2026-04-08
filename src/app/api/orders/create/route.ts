import { NextRequest, NextResponse } from "next/server";
import * as admin from "firebase-admin";
import { adminDb } from "@/lib/firebase/admin";

interface CreateOrderBody {
    id: string;
    userId: string | null;
    items: any[];
    subtotal: number;
    discount: number;
    couponDiscount: number;
    total: number;
    couponCode: string | null;
    paymentMethod: "RAZORPAY" | "COD";
    paymentStatus: string;
    orderStatus: string;
    razorpayOrderId?: string | null;
    shippingAddress: {
        fullName: string;
        email: string;
        addressLine1: string;
        city: string;
        state: string;
        pincode: string;
        phone: string;
    };
}

export async function POST(req: NextRequest) {
    try {
        if (!adminDb) {
            return NextResponse.json({ error: "Order service is not configured" }, { status: 500 });
        }

        const body = (await req.json()) as CreateOrderBody;
        if (!body?.id || !Array.isArray(body.items) || body.items.length === 0 || !body.shippingAddress?.email) {
            return NextResponse.json({ error: "Invalid order payload" }, { status: 400 });
        }

        const now = new Date();
        const orderRef = adminDb.collection("orders").doc(body.id);
        await orderRef.set({
            id: body.id,
            userId: body.userId || null,
            items: body.items,
            subtotal: body.subtotal,
            discount: body.discount,
            couponDiscount: body.couponDiscount,
            total: body.total,
            couponCode: body.couponCode || null,
            paymentMethod: body.paymentMethod,
            paymentStatus: body.paymentStatus,
            orderStatus: body.orderStatus,
            razorpayOrderId: body.razorpayOrderId || null,
            shippingAddress: body.shippingAddress,
            createdAt: now,
            updatedAt: now,
        });

        if (body.couponCode && body.paymentStatus !== "FAILED") {
            await adminDb.collection("coupons").doc(body.couponCode.toUpperCase()).set(
                { timesUsed: admin.firestore.FieldValue.increment(1) },
                { merge: true }
            );
        }

        return NextResponse.json({ success: true, id: body.id });
    } catch (error) {
        console.error("Order creation failed", error);
        return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
    }
}
