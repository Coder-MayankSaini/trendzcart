import { NextRequest, NextResponse } from "next/server";
import Razorpay from "razorpay";

const getServerEnv = (key: string): string | undefined => process.env[key];

export async function POST(req: NextRequest) {
    try {
        const keyId = getServerEnv("RAZORPAY_KEY_ID");
        const keySecret = getServerEnv("RAZORPAY_KEY_SECRET");
        if (!keyId || !keySecret) {
            return NextResponse.json({ error: "Razorpay is not configured" }, { status: 500 });
        }

        const razorpay = new Razorpay({
            key_id: keyId,
            key_secret: keySecret,
        });

        const { amount, currency = "INR", receipt } = await req.json();

        if (!amount) {
            return NextResponse.json({ error: "Amount is required" }, { status: 400 });
        }

        const options = {
            amount: amount * 100, // Razorpay amount is in paise
            currency,
            receipt,
            payment_capture: 1, // Auto-capture the payment
        };

        const order = await razorpay.orders.create(options);

        return NextResponse.json({
            id: order.id,
            currency: order.currency,
            amount: order.amount,
        });
    } catch (error) {
        console.error("Razorpay order creation failed", error);
        return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
    }
}
