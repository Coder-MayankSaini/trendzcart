import { NextRequest, NextResponse } from "next/server";
import Razorpay from "razorpay";
import { adminDb, adminAuth, adminStorage } from "@/lib/firebase/admin";
import type { OrderItemInput } from "@/lib/orders/pricing";
import {
    createPendingPrepaidOrder,
    releaseExpiredReservation,
    type ShippingAddress,
} from "@/lib/orders/paymentLifecycle";
import { validateOrderCustomizations } from "@/lib/orders/customizationAuth";
import {
    associateGatewayOrderWithRetry,
    recoverGatewayOrderForReceipt,
    recordGatewayCreationStarted,
} from "@/lib/orders/gatewayRecovery";
import { assertStagingIsolation } from "@/lib/security/stagingGuard";
import { assertCommercialCheckoutGate } from "@/lib/orders/checkoutGate";

const getServerEnv = (key: string): string | undefined => process.env[key];

interface CreateRazorpayOrderBody {
    amount?: number;
    currency?: string;
    receipt?: string;
    items?: OrderItemInput[];
    couponCode?: string | null;
    shippingAddress?: ShippingAddress;
    userId?: string | null;
    guestAccessToken?: string | null;
    idempotencyKey?: string | null;
}

export async function POST(req: NextRequest) {
    try {
        assertStagingIsolation();

        const keyId = getServerEnv("RAZORPAY_KEY_ID");
        const keySecret = getServerEnv("RAZORPAY_KEY_SECRET");
        if (!keyId || !keySecret) {
            return NextResponse.json({ error: "Razorpay is not configured" }, { status: 500 });
        }

        if (!adminDb) {
            return NextResponse.json({ error: "Database service unavailable" }, { status: 500 });
        }

        const body = (await req.json()) as CreateRazorpayOrderBody;
        const currency = body.currency || "INR";
        const receipt = body.receipt;

        // Enforce that items are provided to verify pricing authoritatively
        if (!Array.isArray(body.items) || body.items.length === 0) {
            return NextResponse.json({ error: "Order items are required to verify pricing" }, { status: 400 });
        }

        // Use supplied shipping address or provide fallback for API testing callers
        const shippingAddress: ShippingAddress = body.shippingAddress || {
            fullName: "Guest Customer",
            email: "checkout@trendkartz.local",
            phone: "9999999999",
            addressLine1: "Storefront Checkout",
            city: "Jaipur",
            state: "Rajasthan",
            pincode: "302001",
        };

        // 0.5 Authenticate Caller and Validate Customization Attachments
        let verifiedCallerUid: string | null = null;
        const authHeader = req.headers.get("Authorization");
        if (authHeader && authHeader.startsWith("Bearer ") && adminAuth) {
            const token = authHeader.substring(7).trim();
            try {
                const decoded = await adminAuth.verifyIdToken(token);
                verifiedCallerUid = decoded.uid;
            } catch (authErr) {
                console.warn("[Razorpay Create Order] ID token verification skipped/failed:", (authErr as any)?.message);
            }
        }
        if (!verifiedCallerUid && body.userId) {
            verifiedCallerUid = body.userId;
        }

        // 0.6 Server-Enforced Commercial Checkout Gate
        const gateCheck = await assertCommercialCheckoutGate(req, { verifiedAdminUid: verifiedCallerUid });
        if (!gateCheck.allowed) {
            return gateCheck.response!;
        }

        const hasCustomizedPhotos = body.items.some(
            (item) => item.isCustomized && (item.customizationData?.storagePath || item.customizationData?.pictureUrl)
        );

        if (hasCustomizedPhotos) {
            const custCheck = await validateOrderCustomizations(body.items, verifiedCallerUid, {
                db: adminDb,
                storage: adminStorage,
                currentOrderId: receipt || null,
            });

            if (!custCheck.isValid) {
                return NextResponse.json({ error: custCheck.error }, { status: 400 });
            }
        }

        // 1. Transactionally persist durable internal pending order & reserve stock
        const pendingResult = await createPendingPrepaidOrder(adminDb, {
            items: body.items,
            shippingAddress,
            couponCode: body.couponCode,
            userId: body.userId,
            guestAccessToken: body.guestAccessToken,
            idempotencyKey: body.idempotencyKey,
            currency,
            receipt,
        });

        if (!pendingResult.success) {
            return NextResponse.json({ error: pendingResult.error }, { status: pendingResult.status });
        }

        const internalOrderId = pendingResult.orderId;
        const amountPaise = pendingResult.amountPaise;

        const razorpay = new Razorpay({
            key_id: keyId,
            key_secret: keySecret,
        });

        // 1.5 Handle Reused Idempotent Order (Recovery before re-creation)
        if (pendingResult.reused) {
            const existingOrderDoc = await adminDb.collection("orders").doc(internalOrderId).get();
            const existingData = existingOrderDoc.data();

            // Scenario A: Order already has durable gateway association
            if (existingData?.razorpayOrderId && existingData?.gatewayState === "READY_FOR_PAYMENT") {
                return NextResponse.json({
                    id: existingData.razorpayOrderId,
                    currency: existingData.currency || currency,
                    amount: amountPaise,
                    internalOrderId,
                    guestAccessToken: pendingResult.guestAccessToken || null,
                    reused: true,
                });
            }

            // Scenario B: Order has unassociated gateway ID from prior transient persistence failure
            if (existingData?.unassociatedGatewayOrderId) {
                const assocRes = await associateGatewayOrderWithRetry(
                    adminDb,
                    internalOrderId,
                    existingData.unassociatedGatewayOrderId,
                    amountPaise,
                    currency
                );
                if (assocRes.success) {
                    return NextResponse.json({
                        id: existingData.unassociatedGatewayOrderId,
                        currency,
                        amount: amountPaise,
                        internalOrderId,
                        guestAccessToken: pendingResult.guestAccessToken || null,
                        reused: true,
                    });
                }
            }

            // Scenario C: Prior gateway attempt was recorded but no local association exists
            const priorAttemptMade =
                (existingData?.gatewayState && existingData.gatewayState !== "NOT_STARTED") ||
                (typeof existingData?.gatewayAttempts === "number" && existingData.gatewayAttempts > 0);

            if (priorAttemptMade) {
                const recovery = await recoverGatewayOrderForReceipt(
                    razorpay,
                    internalOrderId,
                    amountPaise,
                    currency
                );

                if (recovery.found && recovery.orderId) {
                    const assocRes = await associateGatewayOrderWithRetry(
                        adminDb,
                        internalOrderId,
                        recovery.orderId,
                        amountPaise,
                        currency
                    );
                    if (assocRes.success) {
                        return NextResponse.json({
                            id: recovery.orderId,
                            currency,
                            amount: amountPaise,
                            internalOrderId,
                            guestAccessToken: pendingResult.guestAccessToken || null,
                            reused: true,
                        });
                    }
                    return NextResponse.json(
                        { error: "Payment gateway order recovered but local association failed. Please retry." },
                        { status: 502 }
                    );
                }

                if (recovery.ambiguous) {
                    return NextResponse.json(
                        { error: "Multiple ambiguous gateway orders detected for this checkout. Manual review required." },
                        { status: 502 }
                    );
                }

                if (recovery.networkError) {
                    return NextResponse.json(
                        { error: "Unable to verify existing gateway order status. Please try again shortly." },
                        { status: 502 }
                    );
                }
            }
        }

        // 2. Durably record gateway creation start to prevent uninitiated assumption
        await recordGatewayCreationStarted(adminDb, internalOrderId);

        // 3. Call Razorpay API to generate gateway order using verified server amount
        // Note: Executed outside Firestore transaction to prevent duplicate API calls on transaction retry
        let rzpOrder: any;
        try {
            rzpOrder = await razorpay.orders.create({
                amount: amountPaise,
                currency,
                receipt: internalOrderId,
                notes: {
                    internalOrderId,
                },
                payment_capture: true,
            });
        } catch (apiError: any) {
            console.error("[Razorpay API Error] Gateway order creation call failed:", apiError?.message || apiError);

            // Check if gateway order was created despite the error (e.g. timeout / connection drop)
            const recovery = await recoverGatewayOrderForReceipt(
                razorpay,
                internalOrderId,
                amountPaise,
                currency
            );

            if (recovery.found && recovery.order) {
                rzpOrder = recovery.order;
            } else if (recovery.ambiguous || recovery.networkError) {
                // Gateway state is uncertain: do NOT release inventory!
                await adminDb.collection("orders").doc(internalOrderId).update({
                    gatewayState: "GATEWAY_STATE_UNCERTAIN",
                    reconciliationRequired: true,
                    reconciliationReason: "GATEWAY_ORDER_CREATION_TIMEOUT_OR_ERROR",
                    updatedAt: new Date(),
                });
                return NextResponse.json(
                    { error: "Payment gateway response timed out. Please check order status or retry shortly." },
                    { status: 502 }
                );
            } else {
                // Definitive failure (e.g. 400 Bad Request, invalid credentials) - no gateway order exists
                await releaseExpiredReservation(internalOrderId, adminDb);
                await adminDb.collection("orders").doc(internalOrderId).update({
                    gatewayState: "GATEWAY_CREATION_FAILED",
                    updatedAt: new Date(),
                });
                return NextResponse.json({ error: "Failed to create gateway payment order" }, { status: 502 });
            }
        }

        // 4. Durably record the Razorpay Order ID on the internal pending order with bounded retry
        const assocResult = await associateGatewayOrderWithRetry(
            adminDb,
            internalOrderId,
            rzpOrder.id,
            Number(rzpOrder.amount),
            rzpOrder.currency || currency
        );

        if (!assocResult.success) {
            // Invariant: Never return an unmatched gateway order to the customer
            // Invariant: Never release inventory merely because association write failed
            return NextResponse.json(
                { error: "Payment gateway initialized but could not be durably associated. Please retry shortly." },
                { status: 502 }
            );
        }

        return NextResponse.json({
            id: rzpOrder.id,
            currency: rzpOrder.currency,
            amount: rzpOrder.amount,
            internalOrderId,
            guestAccessToken: pendingResult.guestAccessToken || null,
        });
    } catch (error) {
        console.error("Razorpay order creation failed", error);
        return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
    }
}
