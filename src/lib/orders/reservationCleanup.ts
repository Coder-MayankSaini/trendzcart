import * as adminModule from "firebase-admin";
import Razorpay from "razorpay";
import {
    releaseExpiredReservation,
    finalizeOrderPayment,
} from "./paymentLifecycle";
import { recoverGatewayOrderForReceipt } from "./gatewayRecovery";
import { assertStagingIsolation } from "../security/stagingGuard";

export interface ReservationCleanupOptions {
    batchSize?: number;
    now?: Date;
    razorpayClient?: any;
}

export interface ReservationCleanupResult {
    processed: number;
    released: number;
    finalized: number;
    skipped: number;
    gatewayErrors: number;
    firestoreErrors: number;
    reconciliationCount: number;
    durationMs: number;
    hasMore: boolean;
    errors: string[];
}

function getRazorpayClient(customClient?: any): any {
    if (customClient) return customClient;
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    if (!key_id || !key_secret) return null;
    return new Razorpay({ key_id, key_secret });
}

/**
 * Discovers and safely processes expired prepaid inventory & coupon reservations.
 * Enforces server-to-server gateway payment state checks prior to releasing stock.
 * Uses bounded batching to strictly respect serverless execution time limits.
 */
export async function runReservationCleanup(
    db: adminModule.firestore.Firestore,
    options?: ReservationCleanupOptions
): Promise<ReservationCleanupResult> {
    assertStagingIsolation();

    const startTime = Date.now();
    const batchSize = Math.max(1, Math.min(options?.batchSize || 25, 100));
    const now = options?.now || new Date();

    const result: ReservationCleanupResult = {
        processed: 0,
        released: 0,
        finalized: 0,
        skipped: 0,
        gatewayErrors: 0,
        firestoreErrors: 0,
        reconciliationCount: 0,
        durationMs: 0,
        hasMore: false,
        errors: [],
    };

    // Bounded query for expired prepaid reservations
    let snapshot: adminModule.firestore.QuerySnapshot;
    try {
        snapshot = await db
            .collection("orders")
            .where("paymentMethod", "==", "RAZORPAY")
            .where("inventoryReserved", "==", true)
            .where("reservationReleased", "==", false)
            .where("reservationExpiresAt", "<=", now)
            .orderBy("reservationExpiresAt", "asc")
            .limit(batchSize + 1)
            .get();
    } catch (err: any) {
        result.firestoreErrors++;
        result.errors.push(`Query execution error: ${err?.message || "Unknown Firestore error"}`);
        result.durationMs = Date.now() - startTime;
        return result;
    }

    const docs = snapshot.docs;
    if (docs.length > batchSize) {
        result.hasMore = true;
        docs.pop(); // Remove lookahead document
    }

    const client = getRazorpayClient(options?.razorpayClient);

    for (const doc of docs) {
        result.processed++;
        const orderId = doc.id;
        const orderData = doc.data();

        try {
            // 1. Validate preconditions: must be RAZORPAY, reserved, unreleased, unpaid
            if (
                orderData.paymentMethod !== "RAZORPAY" ||
                orderData.inventoryReserved !== true ||
                orderData.reservationReleased === true ||
                orderData.paymentStatus === "PAID"
            ) {
                result.skipped++;
                continue;
            }

            // 2. Gateway Status Check Before Releasing Stock
            let resolvedGatewayOrderId: string | null =
                orderData.razorpayOrderId || orderData.unassociatedGatewayOrderId || null;
            let needsGatewayRecovery = false;

            const expectedAmountPaise =
                typeof orderData.amountPaise === "number"
                    ? orderData.amountPaise
                    : Math.round(Number(orderData.total) * 100);
            const expectedCurrency = (orderData.currency || "INR").toUpperCase();

            // If gateway order ID is missing, check if initiation was ever attempted
            if (!resolvedGatewayOrderId) {
                const gatewayAttemptMade =
                    (orderData.gatewayState && orderData.gatewayState !== "NOT_STARTED") ||
                    (typeof orderData.gatewayAttempts === "number" && orderData.gatewayAttempts > 0);

                if (gatewayAttemptMade) {
                    needsGatewayRecovery = true;
                } else {
                    // Initiation never started (e.g. abandoned before gateway call or uninitiated)
                    // Safe to release reservation
                }
            }

            // If gateway recovery is required, query gateway by stable receipt before touching inventory
            if (needsGatewayRecovery) {
                if (!client || typeof client.orders?.all !== "function") {
                    // Gateway credentials or method missing: fail closed!
                    result.gatewayErrors++;
                    result.errors.push(`Gateway client unavailable for receipt lookup on order ${orderId}`);
                    continue; // Skip order; do NOT release
                }

                const recovery = await recoverGatewayOrderForReceipt(
                    client,
                    orderId,
                    expectedAmountPaise,
                    expectedCurrency
                );

                if (recovery.networkError) {
                    result.gatewayErrors++;
                    result.errors.push(
                        `Gateway receipt lookup failed for order ${orderId}: ${recovery.error || "Gateway Error"}`
                    );
                    continue; // Skip order; do NOT release
                }

                if (recovery.ambiguous) {
                    await db.collection("orders").doc(orderId).update({
                        orderStatus: "Pending_Reconciliation",
                        reconciliationRequired: true,
                        reconciliationReason: "AMBIGUOUS_GATEWAY_ORDERS_FOR_RECEIPT",
                        updatedAt: new Date(),
                    });
                    result.reconciliationCount++;
                    continue; // Skip order; do NOT release
                }

                if (recovery.mismatch) {
                    await db.collection("orders").doc(orderId).update({
                        orderStatus: "Pending_Reconciliation",
                        reconciliationRequired: true,
                        reconciliationReason: recovery.mismatchReason || "GATEWAY_ORDER_MISMATCH",
                        updatedAt: new Date(),
                    });
                    result.reconciliationCount++;
                    continue; // Skip order; do NOT release
                }

                if (recovery.found && recovery.orderId) {
                    // Recovered! Durably associate the order ID and proceed to payment check
                    resolvedGatewayOrderId = recovery.orderId;
                    await db.collection("orders").doc(orderId).update({
                        razorpayOrderId: recovery.orderId,
                        gatewayState: "READY_FOR_PAYMENT",
                        updatedAt: new Date(),
                    });
                } else {
                    // Gateway confirmed 0 orders exist for this receipt.
                    // Critical Safety Principle (TASK 010): Do not immediately assume an empty lookup proves
                    // that no gateway order was created if creation was uncertain or recently attempted.
                    const lastAttempt = orderData.lastGatewayAttemptAt?.toDate?.() ||
                        (orderData.lastGatewayAttemptAt ? new Date(orderData.lastGatewayAttemptAt) : null);
                    const timeSinceAttemptMs = lastAttempt ? Date.now() - lastAttempt.getTime() : Infinity;

                    // If order is flagged GATEWAY_STATE_UNCERTAIN or creation was attempted within 15 minutes,
                    // keep inventory reserved and flag for reconciliation observation.
                    const isUncertainOrRecent =
                        orderData.gatewayState === "GATEWAY_STATE_UNCERTAIN" ||
                        (orderData.gatewayState === "GATEWAY_CREATION_STARTED" && timeSinceAttemptMs < 15 * 60 * 1000);

                    if (isUncertainOrRecent) {
                        await db.collection("orders").doc(orderId).update({
                            orderStatus: "Pending_Reconciliation",
                            reconciliationRequired: true,
                            reconciliationReason: "UNCERTAIN_GATEWAY_CREATION_IN_OBSERVATION_WINDOW",
                            updatedAt: new Date(),
                        });
                        result.reconciliationCount++;
                        continue;
                    }

                    // Beyond observation grace window with confirmed 0 matches -> safe to release
                    resolvedGatewayOrderId = null;
                }
            }

            // If a gateway order is known or recovered, inspect its payments on Razorpay
            if (resolvedGatewayOrderId && typeof resolvedGatewayOrderId === "string") {
                if (!client) {
                    // Gateway credentials missing: fail closed!
                    result.gatewayErrors++;
                    result.errors.push(`Gateway client unavailable for order ${orderId}`);
                    continue;
                }

                let gatewayPaymentsResponse: any;
                try {
                    gatewayPaymentsResponse = await client.orders.fetchPayments(resolvedGatewayOrderId);
                } catch (gwErr: any) {
                    // Case D: Gateway Lookup Failed or Timed Out -> Fail Closed
                    result.gatewayErrors++;
                    result.errors.push(
                        `Gateway lookup failed for order ${orderId}: ${gwErr?.message || "Gateway Error"}`
                    );
                    continue; // Skip order; do NOT release
                }

                const paymentsList: any[] = Array.isArray(gatewayPaymentsResponse?.items)
                    ? gatewayPaymentsResponse.items
                    : (Array.isArray(gatewayPaymentsResponse) ? gatewayPaymentsResponse : []);

                // Check for confirmed captured payment
                const capturedPayment = paymentsList.find(
                    (p: any) => p && (p.status === "captured" || p.captured === true)
                );

                if (capturedPayment) {
                    // Case A: Captured Payment confirmed by gateway! Finalize idempotently
                    const actualCurrency = (capturedPayment.currency || "INR").toUpperCase();

                    if (
                        Number(capturedPayment.amount) === expectedAmountPaise &&
                        actualCurrency === expectedCurrency
                    ) {
                        const finRes = await finalizeOrderPayment(db, {
                            razorpayOrderId: resolvedGatewayOrderId,
                            razorpayPaymentId: capturedPayment.id,
                            amountPaise: expectedAmountPaise,
                            currency: expectedCurrency,
                            internalOrderId: orderId,
                            source: "RECONCILIATION_WORKER",
                        });

                        if (finRes.success) {
                            result.finalized++;
                        } else {
                            result.reconciliationCount++;
                        }
                        continue;
                    } else {
                        // Amount or currency mismatch: flag for manual review
                        await db.collection("orders").doc(orderId).update({
                            orderStatus: "Pending_Reconciliation",
                            reconciliationRequired: true,
                            reconciliationReason: "PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH",
                            updatedAt: new Date(),
                        });
                        result.reconciliationCount++;
                        continue;
                    }
                }

                // Check for authorized payment (authorized but uncaptured)
                const authorizedPayment = paymentsList.find(
                    (p: any) => p && p.status === "authorized"
                );

                if (authorizedPayment) {
                    // Case C: Authorized Payment -> Do NOT release stock; preserve for reconciliation
                    await db.collection("orders").doc(orderId).update({
                        orderStatus: "Pending_Reconciliation",
                        reconciliationRequired: true,
                        reconciliationReason: "PAYMENT_AUTHORIZED_PENDING_CAPTURE",
                        updatedAt: new Date(),
                    });
                    result.reconciliationCount++;
                    continue;
                }

                // Case B: Gateway confirms no captured or authorized payment -> safe to release
            }

            // 3. Atomically release reservation
            const releaseRes = await releaseExpiredReservation(orderId, db);
            if (releaseRes.success && releaseRes.released) {
                result.released++;
            } else {
                result.skipped++;
            }
        } catch (docErr: any) {
            result.firestoreErrors++;
            result.errors.push(
                `Error processing order ${orderId}: ${docErr?.message || "Document error"}`
            );
        }
    }

    result.durationMs = Date.now() - startTime;
    return result;
}
