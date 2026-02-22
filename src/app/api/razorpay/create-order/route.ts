import { NextRequest, NextResponse } from "next/server";
import Razorpay from "razorpay";

export async function POST(req: NextRequest) {
    try {
        const razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID as string,
            key_secret: process.env.RAZORPAY_KEY_SECRET as string,
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
