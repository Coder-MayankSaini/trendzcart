import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const getServerEnv = (key: string): string | undefined => process.env[key];

export async function POST(req: NextRequest) {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();
        const keySecret = getServerEnv("RAZORPAY_KEY_SECRET");
        if (!keySecret) {
            return NextResponse.json({ success: false, message: "Razorpay is not configured" }, { status: 500 });
        }

        const sign = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac("sha256", keySecret)
            .update(sign.toString())
            .digest("hex");

        if (expectedSignature === razorpay_signature) {
            return NextResponse.json({ success: true, message: "Payment verified successfully" });
        } else {
            return NextResponse.json({ success: false, message: "Invalid signature" }, { status: 400 });
        }
    } catch (error) {
        console.error("Payment verification failed", error);
        return NextResponse.json({ success: false, message: "Server error during verification" }, { status: 500 });
    }
}
