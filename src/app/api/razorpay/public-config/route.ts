import { NextResponse } from "next/server";

const getServerEnv = (key: string): string | undefined => process.env[key];

export async function GET() {
    const keyId = getServerEnv("NEXT_PUBLIC_RAZORPAY_KEY_ID") || getServerEnv("RAZORPAY_KEY_ID");

    if (!keyId) {
        return NextResponse.json({ error: "Razorpay key is not configured" }, { status: 500 });
    }

    return NextResponse.json({ keyId });
}
