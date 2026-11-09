import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
    verifyRazorpayWebhookSignature,
    finalizeOrderPayment,
    recordPaymentFailure,
} from "@/lib/orders/paymentLifecycle";
import {
    verifyPaymentWithGateway,
    getRazorpayClient,
} from "@/lib/orders/gatewayVerification";
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

                // Check Level 1 event deduplication
                if (eventId) {
                    const eventSnap = await adminDb.collection("paymentWebhookEvents").doc(eventId).get();
                    if (eventSnap.exists && eventSnap.data()?.status === "PROCESSED") {
                        return NextResponse.json({
                            success: true,
                            duplicate: true,
                            message: "Event already processed",
                        });
                    }
                }

                // Locate internal order record
                let orderDocSnap = await adminDb
                    .collection("orders")
                    .where("razorpayOrderId", "==", razorpayOrderId)
                    .limit(1)
                    .get();

                if (orderDocSnap.empty) {
                    orderDocSnap = await adminDb
                        .collection("orders")
                        .where("unassociatedGatewayOrderId", "==", razorpayOrderId)
                        .limit(1)
                        .get();
                }

                if (orderDocSnap.empty) {
                    // Record unmatched payment safely for admin reconciliation
                    await adminDb.collection("unmatchedPayments").doc(razorpayPaymentId).set({
                        razorpayPaymentId,
                        razorpayOrderId,
                        amountPaise,
                        currency,
                        eventId: eventId || null,
                        receivedAt: new Date(),
                        reason: "INTERNAL_ORDER_NOT_FOUND",
                    });

                    return NextResponse.json(
                        { error: `No internal order found matching Razorpay Order ID: ${razorpayOrderId}` },
                        { status: 404 }
                    );
                }

                const internalOrderDoc = orderDocSnap.docs[0];
                const internalOrderData = internalOrderDoc.data();

                // If already paid with this payment ID, return idempotent success
                if (internalOrderData.paymentStatus === "PAID" && internalOrderData.razorpayPaymentId === razorpayPaymentId) {
                    return NextResponse.json({
                        success: true,
                        orderId: internalOrderDoc.id,
                        duplicate: true,
                        message: "Payment already finalized for this order",
                    });
                }

                // Authoritative expected values from internal order
                const expectedAmountPaise: number =
                    typeof internalOrderData.amountPaise === "number"
                        ? internalOrderData.amountPaise
                        : Math.round(Number(internalOrderData.total) * 100);
                const expectedCurrency: string = (internalOrderData.currency || "INR").toUpperCase();

                // Validate webhook payload against internal authoritative values
                if (amountPaise !== expectedAmountPaise) {
                    await adminDb.collection("orders").doc(internalOrderDoc.id).update({
                        reconciliationRequired: true,
                        reconciliationReason: `Payment amount mismatch: expected ${expectedAmountPaise} paise, received ${amountPaise} paise`,
                        reconciliationPaymentId: razorpayPaymentId,
                        updatedAt: new Date(),
                    });
                    return NextResponse.json(
                        { error: `Payment amount mismatch: expected ${expectedAmountPaise} paise, received ${amountPaise} paise` },
                        { status: 400 }
                    );
                }

                if (currency.toUpperCase() !== expectedCurrency.toUpperCase()) {
                    await adminDb.collection("orders").doc(internalOrderDoc.id).update({
                        reconciliationRequired: true,
                        reconciliationReason: `Payment currency mismatch: expected ${expectedCurrency}, received ${currency}`,
                        reconciliationPaymentId: razorpayPaymentId,
                        updatedAt: new Date(),
                    });
                    return NextResponse.json(
                        { error: `Payment currency mismatch: expected ${expectedCurrency}, received ${currency}` },
                        { status: 400 }
                    );
                }

                // 4.1 TRUST BOUNDARY ENFORCEMENT: Server-to-Server Gateway Status Verification
                const verification = await verifyPaymentWithGateway(undefined, {
                    paymentId: razorpayPaymentId,
                    expectedOrderId: razorpayOrderId,
                    expectedAmountPaise,
                    expectedCurrency,
                });

                if (verification.notFound) {
                    console.warn(
                        `[Razorpay Webhook Trust Warning] Payment ${razorpayPaymentId} does not exist in gateway: ${verification.error}`
                    );
                    return NextResponse.json(
                        { error: verification.error || "Payment ID does not exist in gateway" },
                        { status: 400 }
                    );
                }

                if (verification.networkError) {
                    console.error(
                        `[Razorpay Webhook Error] Gateway unavailable during verification for payment ${razorpayPaymentId}`
                    );
                    await adminDb.collection("orders").doc(internalOrderDoc.id).update({
                        reconciliationRequired: true,
                        reconciliationReason: "GATEWAY_TIMEOUT_DURING_WEBHOOK",
                        updatedAt: new Date(),
                    });
                    return NextResponse.json(
                        { error: "Gateway verification temporarily unavailable" },
                        { status: 502 }
                    );
                }

                if (!verification.verified) {
                    console.warn(
                        `[Razorpay Webhook Warning] Gateway payment ${razorpayPaymentId} not verified (status: ${verification.status}, mismatch: ${verification.mismatch})`
                    );
                    if (verification.mismatch) {
                        await adminDb.collection("orders").doc(internalOrderDoc.id).update({
                            reconciliationRequired: true,
                            reconciliationReason: verification.mismatchReason || "GATEWAY_PAYMENT_MISMATCH",
                            reconciliationPaymentId: razorpayPaymentId,
                            updatedAt: new Date(),
                        });
                    }
                    return NextResponse.json(
                        { error: verification.error || "Payment verification failed" },
                        { status: 400 }
                    );
                }

                // 4.2 Authoritative Transactional Payment Finalization
                const result = await finalizeOrderPayment(adminDb, {
                    razorpayOrderId,
                    razorpayPaymentId,
                    amountPaise: expectedAmountPaise,
                    currency: expectedCurrency,
                    internalOrderId: internalOrderDoc.id,
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
                let razorpayPaymentId = paymentEntity?.id;

                if (!razorpayOrderId) {
                    return NextResponse.json(
                        { error: "Incomplete order.paid metadata: missing order_id" },
                        { status: 400 }
                    );
                }

                // Locate internal order
                let existingOrderSnap = await adminDb
                    .collection("orders")
                    .where("razorpayOrderId", "==", razorpayOrderId)
                    .limit(1)
                    .get();

                if (existingOrderSnap.empty) {
                    existingOrderSnap = await adminDb
                        .collection("orders")
                        .where("unassociatedGatewayOrderId", "==", razorpayOrderId)
                        .limit(1)
                        .get();
                }

                if (existingOrderSnap.empty) {
                    return NextResponse.json(
                        { error: `No internal order found matching Razorpay Order ID: ${razorpayOrderId}` },
                        { status: 404 }
                    );
                }

                const orderDoc = existingOrderSnap.docs[0];
                const orderData = orderDoc.data();

                if (orderData?.paymentStatus === "PAID") {
                    return NextResponse.json({
                        success: true,
                        duplicate: true,
                        message: "Order already paid",
                    });
                }

                const expectedAmountPaise: number =
                    typeof orderData.amountPaise === "number"
                        ? orderData.amountPaise
                        : Math.round(Number(orderData.total) * 100);
                const expectedCurrency: string = (orderData.currency || "INR").toUpperCase();

                // If payment entity was not attached directly, query gateway payments for this order
                if (!razorpayPaymentId) {
                    const client = getRazorpayClient();
                    if (!client) {
                        return NextResponse.json(
                            { error: "Razorpay client unavailable for order.paid reconciliation" },
                            { status: 502 }
                        );
                    }

                    let paymentsRes: any;
                    try {
                        paymentsRes = await client.orders.fetchPayments(razorpayOrderId);
                    } catch (gwErr: any) {
                        console.error("[Razorpay Webhook Error] Failed to fetch payments for order.paid:", gwErr);
                        return NextResponse.json(
                            { error: "Gateway lookup failed for order.paid" },
                            { status: 502 }
                        );
                    }

                    const payments: any[] = Array.isArray(paymentsRes?.items)
                        ? paymentsRes.items
                        : Array.isArray(paymentsRes)
                        ? paymentsRes
                        : [];

                    const capturedPayment = payments.find(
                        (p: any) =>
                            p &&
                            (p.status === "captured" || p.captured === true) &&
                            Number(p.amount) === expectedAmountPaise &&
                            (p.currency || "INR").toUpperCase() === expectedCurrency
                    );

                    if (!capturedPayment) {
                        return NextResponse.json({
                            success: true,
                            message: "order.paid acknowledged, no captured payment verified yet",
                        });
                    }

                    razorpayPaymentId = capturedPayment.id;
                }

                // Verify the resolved payment with gateway
                const verification = await verifyPaymentWithGateway(undefined, {
                    paymentId: razorpayPaymentId,
                    expectedOrderId: razorpayOrderId,
                    expectedAmountPaise,
                    expectedCurrency,
                });

                if (!verification.verified) {
                    return NextResponse.json(
                        { error: verification.error || "Payment verification failed for order.paid" },
                        { status: 400 }
                    );
                }

                const result = await finalizeOrderPayment(adminDb, {
                    razorpayOrderId,
                    razorpayPaymentId,
                    amountPaise: expectedAmountPaise,
                    currency: expectedCurrency,
                    internalOrderId: orderDoc.id,
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

            case "payment.authorized": {
                const payment = event.payload?.payment?.entity;
                const razorpayOrderId = payment?.order_id;
                const razorpayPaymentId = payment?.id;

                if (!razorpayOrderId) {
                    return NextResponse.json(
                        { error: "Missing order_id for payment.authorized" },
                        { status: 400 }
                    );
                }

                // Locate internal order
                const existingOrderSnap = await adminDb
                    .collection("orders")
                    .where("razorpayOrderId", "==", razorpayOrderId)
                    .limit(1)
                    .get();

                if (existingOrderSnap.empty) {
                    return NextResponse.json(
                        { error: `No internal order found matching: ${razorpayOrderId}` },
                        { status: 404 }
                    );
                }

                const orderDoc = existingOrderSnap.docs[0];
                const orderData = orderDoc.data();

                // Invariant: An authorized event must NEVER regress an already PAID order
                if (orderData?.paymentStatus === "PAID") {
                    return NextResponse.json({
                        success: true,
                        ignored: true,
                        message: "Order is already PAID; payment.authorized ignored",
                    });
                }

                // Record authorization attempt without marking order as PAID
                const existingAttempts = Array.isArray(orderData?.paymentAttempts) ? orderData.paymentAttempts : [];
                const updatedAttempts = [
                    ...existingAttempts,
                    {
                        razorpayPaymentId: razorpayPaymentId || null,
                        authorizedAt: new Date(),
                        status: "AUTHORIZED",
                    },
                ];

                await orderDoc.ref.update({
                    gatewayState: "PAYMENT_AUTHORIZED",
                    paymentAttempts: updatedAttempts,
                    updatedAt: new Date(),
                });

                return NextResponse.json({
                    success: true,
                    status: "AUTHORIZED",
                    message: "Payment authorized recorded; order awaits payment capture",
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
