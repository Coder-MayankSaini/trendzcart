import * as adminModule from "firebase-admin";

const admin = (adminModule as any).default || adminModule;

export type GatewayState =
    | "NOT_STARTED"
    | "GATEWAY_CREATION_STARTED"
    | "GATEWAY_ASSOCIATION_PENDING"
    | "READY_FOR_PAYMENT"
    | "GATEWAY_STATE_UNCERTAIN"
    | "GATEWAY_CREATION_FAILED"
    | "RECONCILIATION_REQUIRED";

export interface RecoverGatewayOrderResult {
    found: boolean;
    count: number;
    order?: any;
    orderId?: string;
    amount?: number;
    currency?: string;
    ambiguous?: boolean;
    mismatch?: boolean;
    mismatchReason?: string;
    networkError?: boolean;
    error?: string;
}

export interface AssociateGatewayOrderResult {
    success: boolean;
    attempts: number;
    error?: string;
}

/**
 * Searches the payment gateway for orders matching a stable internal receipt.
 * Enforces strict receipt equality, amount equality (in paise), and currency matching.
 * Fails closed if ambiguous (multiple matches) or network error occurs.
 */
export async function recoverGatewayOrderForReceipt(
    client: any,
    receipt: string,
    expectedAmountPaise: number,
    expectedCurrency: string = "INR"
): Promise<RecoverGatewayOrderResult> {
    if (!client || typeof client.orders?.all !== "function") {
        return {
            found: false,
            count: 0,
            networkError: true,
            error: "Gateway client unavailable or does not support orders.all",
        };
    }

    try {
        const response = await client.orders.all({ receipt, count: 100 });
        const items: any[] = Array.isArray(response?.items)
            ? response.items
            : Array.isArray(response)
            ? response
            : [];

        // Filter strictly for exact receipt match (guards against gateway broad or prefix matches)
        const exactMatches = items.filter(
            (item: any) => item && typeof item.receipt === "string" && item.receipt === receipt
        );

        if (exactMatches.length === 0) {
            return {
                found: false,
                count: 0,
            };
        }

        // Detect multiple matches or pagination overflow (fail-closed for manual reconciliation)
        const totalGatewayCount = typeof response?.count === "number" ? response.count : exactMatches.length;
        if (exactMatches.length > 1 || (totalGatewayCount > items.length && items.length >= 100)) {
            // Invariant: Multiple gateway orders for the same internal receipt is ambiguous.
            // Never arbitrarily pick one; fail closed for manual reconciliation.
            return {
                found: false,
                count: Math.max(exactMatches.length, totalGatewayCount),
                ambiguous: true,
                error: `Multiple (${exactMatches.length}) gateway orders returned for receipt: ${receipt}`,
            };
        }

        const candidate = exactMatches[0];

        // Verify exact receipt
        if (candidate.receipt !== receipt) {
            return {
                found: false,
                count: 1,
                mismatch: true,
                mismatchReason: `Receipt mismatch. Expected ${receipt}, received ${candidate.receipt}`,
                error: "Candidate gateway order has mismatched receipt",
            };
        }

        // Verify currency
        const candidateCurrency = (candidate.currency || "INR").toUpperCase();
        const normExpectedCurrency = expectedCurrency.toUpperCase();
        if (candidateCurrency !== normExpectedCurrency) {
            return {
                found: false,
                count: 1,
                mismatch: true,
                mismatchReason: `Currency mismatch. Expected ${normExpectedCurrency}, received ${candidateCurrency}`,
                error: "Candidate gateway order has mismatched currency",
            };
        }

        // Verify exact amount in paise
        const candidateAmount = Number(candidate.amount);
        if (candidateAmount !== expectedAmountPaise) {
            return {
                found: false,
                count: 1,
                mismatch: true,
                mismatchReason: `Amount mismatch. Expected ${expectedAmountPaise} paise, received ${candidateAmount} paise`,
                error: "Candidate gateway order has mismatched amount",
            };
        }

        return {
            found: true,
            count: 1,
            order: candidate,
            orderId: candidate.id,
            amount: candidateAmount,
            currency: candidateCurrency,
        };
    } catch (err: any) {
        return {
            found: false,
            count: 0,
            networkError: true,
            error: err?.message || "Gateway orders lookup threw an error",
        };
    }
}

/**
 * Durably associates a verified Razorpay Order ID with the internal Firestore order.
 * Uses bounded retries with exponential backoff for transient Firestore write failures.
 * If all retries fail, flags the order as GATEWAY_STATE_UNCERTAIN without deleting stock.
 */
export async function associateGatewayOrderWithRetry(
    db: adminModule.firestore.Firestore,
    internalOrderId: string,
    razorpayOrderId: string,
    amountPaise: number,
    currency: string = "INR",
    maxAttempts: number = 3,
    customDocRef?: any
): Promise<AssociateGatewayOrderResult> {
    const orderRef = customDocRef || db.collection("orders").doc(internalOrderId);
    const deleteField = admin.firestore.FieldValue.delete();

    let lastError: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await orderRef.update({
                razorpayOrderId,
                gatewayState: "READY_FOR_PAYMENT",
                amountPaise,
                currency,
                unassociatedGatewayOrderId: deleteField,
                gatewayAssociatedAt: new Date(),
                reconciliationRequired: false,
                updatedAt: new Date(),
            });

            return {
                success: true,
                attempts: attempt,
            };
        } catch (err: any) {
            lastError = err;
            console.error(
                `[Gateway Association] Transient write failure (attempt ${attempt}/${maxAttempts}) for order ${internalOrderId}:`,
                err?.message || err
            );
            if (attempt < maxAttempts) {
                // Exponential backoff: 100ms, 250ms, 500ms
                const delayMs = attempt * 125;
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }

    // All retries failed. Durably record uncertain gateway state for reconciliation.
    try {
        await orderRef.update({
            gatewayState: "GATEWAY_STATE_UNCERTAIN",
            unassociatedGatewayOrderId: razorpayOrderId,
            reconciliationRequired: true,
            reconciliationReason: "FIRESTORE_ASSOCIATION_FAILED_AFTER_RETRIES",
            updatedAt: new Date(),
        });
    } catch (flagErr: any) {
        console.error(
            `[Gateway Association] CRITICAL: Failed to flag uncertain state on order ${internalOrderId}:`,
            flagErr?.message || flagErr
        );
    }

    return {
        success: false,
        attempts: maxAttempts,
        error: lastError?.message || "Failed to associate gateway order in Firestore after retries",
    };
}

/**
 * Durably records that gateway creation has started prior to calling Razorpay API.
 * Ensures the order document cannot be mistaken for an uninitiated order if the server crashes.
 */
export async function recordGatewayCreationStarted(
    db: adminModule.firestore.Firestore,
    internalOrderId: string
): Promise<void> {
    const orderRef = db.collection("orders").doc(internalOrderId);
    await orderRef.update({
        gatewayState: "GATEWAY_CREATION_STARTED",
        lastGatewayAttemptAt: new Date(),
        gatewayAttempts: admin.firestore.FieldValue.increment(1),
        updatedAt: new Date(),
    });
}
