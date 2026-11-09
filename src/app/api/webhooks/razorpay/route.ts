import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
    verifyRazorpayWebhookSignature,
    finalizeOrderPayment,
    recordPaymentFailure,
} from "@/lib/orders/paymentLifecycle";
import { assertStagingIsolation } from "@/lib/security/stagingGuard";

const getServerEnv = (key: string): string | undefined => process.env[key];

export async function POST(req: NextRequest) {
    try {
        assertStagingIsolation();

        const webhookSecret = getServerEnv("RAZORPAY_WEBHOOK_SECRET");
        if (!webhookSecret) {
            console.error("[Razorpay Webhook Error] RAZORPAY_WEBHOOK_SECRET is not configured.");
            return NextResponse.json(
                { error: "Webhook verification service is not configured" },
                { status: 500 }
            );
        }

        const signature = req.headers.get("x-razorpay-signature");
        if (!signature) {
            return NextResponse.json(
                { error: "Missing x-razorpay-signature header" },
                { status: 400 }
            );
        }

        // 1. Read exact raw request body bytes for cryptographic verification
        const rawBody = await req.text();
        if (!rawBody || rawBody.trim().length === 0) {
            return NextResponse.json(
                { error: "Request body cannot be empty" },
                { status: 400 }
            );
        }

        // 2. Strict HMAC-SHA256 signature verification
        const isSignatureValid = verifyRazorpayWebhookSignature(rawBody, signature, webhookSecret);
        if (!isSignatureValid) {
            console.warn("[Razorpay Webhook Warning] Signature verification failed.");
            return NextResponse.json(
                { error: "Invalid webhook signature" },
                { status: 400 }
            );
        }

        // 3. Parse JSON only after signature verification succeeds
        let event: any;
        try {
            event = JSON.parse(rawBody);
        } catch {
            return NextResponse.json(
                { error: "Malformed JSON payload" },
                { status: 400 }
            );
        }

        if (!event || typeof event.event !== "string") {
            return NextResponse.json(
                { error: "Invalid event structure" },
                { status: 400 }
            );
        }

        if (!adminDb) {
            console.error("[Razorpay Webhook Error] Firestore adminDb is not initialized.");
            return NextResponse.json(
                { error: "Database service unavailable" },
                { status: 500 }
            );
        }

        const eventId =
            req.headers.get("x-razorpay-event-id") ||
            (typeof event.id === "string" ? event.id : undefined);

        // 4. Handle Supported Payment Lifecycle Events
        switch (event.event) {
            case "payment.captured": {
                const payment = event.payload?.payment?.entity;
                if (!payment) {
                    return NextResponse.json(
                        { error: "Missing payment entity in payload" },
                        { status: 400 }
                    );
                }

                const razorpayOrderId = payment.order_id;
                const razorpayPaymentId = payment.id;
                const amountPaise = Number(payment.amount);
                const currency = payment.currency || "INR";

                if (!razorpayOrderId || !razorpayPaymentId || !amountPaise) {
                    return NextResponse.json(
                        { error: "Incomplete payment captured metadata" },
                        { status: 400 }
                    );
                }

                const result = await finalizeOrderPayment(adminDb, {
                    razorpayOrderId,
                    razorpayPaymentId,
                    amountPaise,
                    currency,
                    source: "WEBHOOK",
                    eventId,
                });

                if (!result.success) {
                    return NextResponse.json({ error: result.error }, { status: result.status });
                }

                return NextResponse.json({
                    success: true,
                    orderId: result.orderId,
                    duplicate: result.duplicate || false,
                    reconciliationRequired: result.reconciliationRequired || false,
                });
            }

            case "order.paid": {
                const orderEntity = event.payload?.order?.entity;
                const paymentEntity = event.payload?.payment?.entity;

                const razorpayOrderId = orderEntity?.id || paymentEntity?.order_id;
                const razorpayPaymentId = paymentEntity?.id;
                const amountPaise = Number(orderEntity?.amount_paid || paymentEntity?.amount);
                const currency = orderEntity?.currency || paymentEntity?.currency || "INR";

                if (!razorpayOrderId) {
                    return NextResponse.json(
                        { error: "Incomplete order.paid metadata" },
                        { status: 400 }
                    );
                }

                // If payment entity is not included in order.paid, locate payment record or order
                if (!razorpayPaymentId) {
                    // Try to locate order to see if it was already marked PAID
                    const existingOrderSnap = await adminDb
                        .collection("orders")
                        .where("razorpayOrderId", "==", razorpayOrderId)
                        .limit(1)
                        .get();

                    if (!existingOrderSnap.empty && existingOrderSnap.docs[0].data()?.paymentStatus === "PAID") {
                        return NextResponse.json({
                            success: true,
                            duplicate: true,
                            message: "Order already paid",
                        });
                    }

                    return NextResponse.json({
                        success: true,
                        message: "order.paid acknowledged, awaiting payment.captured with payment ID",
                    });
                }

                const result = await finalizeOrderPayment(adminDb, {
                    razorpayOrderId,
                    razorpayPaymentId,
                    amountPaise,
                    currency,
                    source: "WEBHOOK",
                    eventId,
                });

                if (!result.success) {
                    return NextResponse.json({ error: result.error }, { status: result.status });
                }

                return NextResponse.json({
                    success: true,
                    orderId: result.orderId,
                    duplicate: result.duplicate || false,
                });
            }

            case "payment.failed": {
                const payment = event.payload?.payment?.entity;
                const razorpayOrderId = payment?.order_id;
                const razorpayPaymentId = payment?.id;
                const reason = payment?.error_description || payment?.error_reason;

                if (!razorpayOrderId) {
                    return NextResponse.json(
                        { error: "Missing order_id for payment.failed" },
                        { status: 400 }
                    );
                }

                const result = await recordPaymentFailure(
                    adminDb,
                    razorpayOrderId,
                    razorpayPaymentId,
                    reason,
                    eventId
                );

                return NextResponse.json({
                    success: true,
                    ignored: result.ignored || false,
                });
            }

            default:
                // Safely acknowledge unhandled authenticated events
                return NextResponse.json({
                    success: true,
                    message: `Event '${event.event}' received and ignored`,
                });
        }
    } catch (error) {
        console.error("[Razorpay Webhook Internal Error]", error);
        return NextResponse.json(
            { error: "Internal error processing webhook" },
            { status: 500 }
        );
    }
}
