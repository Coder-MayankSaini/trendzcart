import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { verifyRazorpaySignature } from "@/lib/orders/pricing";
import { finalizeOrderPayment } from "@/lib/orders/paymentLifecycle";
import { verifyPaymentWithGateway } from "@/lib/orders/gatewayVerification";
import { assertStagingIsolation } from "@/lib/security/stagingGuard";

const getServerEnv = (key: string): string | undefined => process.env[key];

export async function POST(req: NextRequest) {
    try {
        assertStagingIsolation();

        const body = await req.json();
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = body;

        const keyId = getServerEnv("RAZORPAY_KEY_ID");
        const keySecret = getServerEnv("RAZORPAY_KEY_SECRET");
        if (!keyId || !keySecret) {
            return NextResponse.json(
                { success: false, message: "Razorpay is not configured" },
                { status: 500 }
            );
        }

        if (!adminDb) {
            return NextResponse.json(
                { success: false, message: "Database service unavailable" },
                { status: 500 }
            );
        }

        // 1. Validate request structure
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return NextResponse.json(
                { success: false, message: "Missing required payment verification parameters" },
                { status: 400 }
            );
        }

        // 2. Cryptographic HMAC Callback Signature Verification
        const isSignatureValid = verifyRazorpaySignature(
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            keySecret
        );

        if (!isSignatureValid) {
            return NextResponse.json(
                { success: false, message: "Invalid signature" },
                { status: 400 }
            );
        }

        // 3. Locate internal order record in Firestore
        let targetOrderId = orderId;
        let orderDocSnap: any = null;

        if (targetOrderId) {
            orderDocSnap = await adminDb.collection("orders").doc(targetOrderId).get();
        }

        if (!orderDocSnap || !orderDocSnap.exists) {
            const querySnap = await adminDb
                .collection("orders")
                .where("razorpayOrderId", "==", razorpay_order_id)
                .limit(1)
                .get();

            if (!querySnap.empty) {
                targetOrderId = querySnap.docs[0].id;
                orderDocSnap = querySnap.docs[0];
            }
        }

        if (!orderDocSnap || !orderDocSnap.exists) {
            return NextResponse.json(
                { success: false, message: "Order not found" },
                { status: 404 }
            );
        }

        const orderData = orderDocSnap.data();

        // 4. Validate Gateway Order Association
        if (orderData?.razorpayOrderId && orderData.razorpayOrderId !== razorpay_order_id) {
            return NextResponse.json(
                { success: false, message: "Razorpay order ID mismatch with internal order record" },
                { status: 400 }
            );
        }

        const expectedAmountPaise: number =
            typeof orderData?.amountPaise === "number"
                ? orderData.amountPaise
                : Math.round(Number(orderData?.total) * 100);
        const expectedCurrency: string = (orderData?.currency || "INR").toUpperCase();

        // 5. Server-to-Server Gateway Status Verification (payments.fetch)
        const verification = await verifyPaymentWithGateway(undefined, {
            paymentId: razorpay_payment_id,
            expectedOrderId: razorpay_order_id,
            expectedAmountPaise,
            expectedCurrency,
        });

        if (verification.notFound) {
            return NextResponse.json(
                { success: false, message: verification.error || "Payment not found in gateway" },
                { status: 400 }
            );
        }

        if (verification.networkError) {
            return NextResponse.json(
                {
                    success: false,
                    message: "Payment verification failed: gateway unavailable or timeout",
                    pending: true,
                },
                { status: 502 }
            );
        }

        if (verification.status === "AUTHORIZED") {
            return NextResponse.json(
                {
                    success: false,
                    message: "Payment is authorized but not captured yet",
                    pending: true,
                    status: "AUTHORIZED",
                },
                { status: 202 }
            );
        }

        if (!verification.verified) {
            return NextResponse.json(
                {
                    success: false,
                    message: verification.error || `Payment is not in captured status`,
                },
                { status: 400 }
            );
        }

        // 6. Authoritative Transactional Payment Finalization
        const finalizationResult = await finalizeOrderPayment(adminDb, {
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            amountPaise: expectedAmountPaise,
            currency: expectedCurrency,
            internalOrderId: targetOrderId,
            source: "BROWSER_CALLBACK",
        });

        if (!finalizationResult.success) {
            return NextResponse.json(
                { success: false, message: finalizationResult.error },
                { status: finalizationResult.status }
            );
        }

        if (finalizationResult.reconciliationRequired) {
            return NextResponse.json({
                success: true,
                message: finalizationResult.message || "Payment flagged for reconciliation",
                orderId: targetOrderId,
                reconciliationRequired: true,
            });
        }

        return NextResponse.json({
            success: true,
            message: "Payment verified successfully",
            orderId: targetOrderId,
        });
    } catch (error) {
        console.error("Payment verification failed", error);
        return NextResponse.json(
            { success: false, message: "Server error during verification" },
            { status: 500 }
        );
    }
}
