import Razorpay from "razorpay";

if (typeof window !== "undefined") {
    throw new Error("This module can only be executed in a server environment.");
}

const getServerEnv = (key: string): string | undefined => process.env[key];

export interface GatewayVerificationParams {
    paymentId: string;
    expectedOrderId?: string | null;
    expectedAmountPaise: number;
    expectedCurrency?: string;
}

export interface GatewayVerificationResult {
    verified: boolean;
    gatewayPayment?: any;
    status?: "CAPTURED" | "AUTHORIZED" | "FAILED" | "CREATED" | "REFUNDED" | "UNKNOWN";
    notFound?: boolean;
    networkError?: boolean;
    mismatch?: boolean;
    mismatchReason?: string;
    error?: string;
}

/**
 * Returns a configured Razorpay client or instantiates one from server environment variables.
 */
export function getRazorpayClient(client?: any): Razorpay | null {
    if (client) return client;

    const keyId = getServerEnv("RAZORPAY_KEY_ID");
    const keySecret = getServerEnv("RAZORPAY_KEY_SECRET");

    if (!keyId || !keySecret) {
        return null;
    }

    return new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
    });
}

/**
 * Server-to-server gateway status verification.
 * Fetches the payment record from Razorpay API and validates payment existence,
 * captured status, order association, amount in paise, and currency.
 * Fails closed on nonexistent payments or gateway timeouts.
 */
export async function verifyPaymentWithGateway(
    clientOrCustom: any,
    params: GatewayVerificationParams
): Promise<GatewayVerificationResult> {
    const { paymentId, expectedOrderId, expectedAmountPaise, expectedCurrency = "INR" } = params;

    if (!paymentId || typeof paymentId !== "string" || paymentId.trim().length === 0) {
        return {
            verified: false,
            notFound: true,
            error: "Payment ID is missing or invalid",
        };
    }

    const client = getRazorpayClient(clientOrCustom);
    if (!client) {
        return {
            verified: false,
            networkError: true,
            error: "Razorpay credentials are not configured",
        };
    }

    let gatewayPayment: any;
    try {
        gatewayPayment = await client.payments.fetch(paymentId);
    } catch (fetchErr: any) {
        const errorDesc =
            fetchErr?.error?.description ||
            fetchErr?.message ||
            (typeof fetchErr === "string" ? fetchErr : "");
        const statusCode = fetchErr?.statusCode || fetchErr?.error?.code;

        // Detect definitive "does not exist" from Razorpay API
        const isNotFound =
            statusCode === 400 ||
            statusCode === 404 ||
            statusCode === "BAD_REQUEST_ERROR" ||
            /does not exist|not found|invalid id/i.test(errorDesc);

        if (isNotFound) {
            return {
                verified: false,
                notFound: true,
                error: `Payment ID ${paymentId} does not exist in Razorpay gateway: ${errorDesc}`,
            };
        }

        // Other errors (network, timeout, 5xx) -> fail-closed transient error
        return {
            verified: false,
            networkError: true,
            error: `Failed to fetch payment from gateway: ${errorDesc}`,
        };
    }

    if (!gatewayPayment || typeof gatewayPayment !== "object") {
        return {
            verified: false,
            notFound: true,
            error: "Gateway returned empty payment object",
        };
    }

    // 1. Payment ID exact match check
    if (gatewayPayment.id !== paymentId) {
        return {
            verified: false,
            mismatch: true,
            mismatchReason: `Gateway payment ID mismatch: requested ${paymentId}, returned ${gatewayPayment.id}`,
            error: "Gateway payment ID mismatch",
        };
    }

    // 2. Gateway Order ID association check
    if (expectedOrderId && gatewayPayment.order_id && gatewayPayment.order_id !== expectedOrderId) {
        return {
            verified: false,
            mismatch: true,
            mismatchReason: `Gateway order ID mismatch: expected ${expectedOrderId}, received ${gatewayPayment.order_id}`,
            error: `Gateway order ID mismatch. Expected: ${expectedOrderId}, received: ${gatewayPayment.order_id}`,
        };
    }

    // 3. Currency match check
    const actualCurrency = (gatewayPayment.currency || "INR").toUpperCase();
    const normalizedExpectedCurrency = expectedCurrency.toUpperCase();
    if (actualCurrency !== normalizedExpectedCurrency) {
        return {
            verified: false,
            mismatch: true,
            mismatchReason: `Currency mismatch: expected ${normalizedExpectedCurrency}, received ${actualCurrency}`,
            error: `Payment currency mismatch. Expected: ${normalizedExpectedCurrency}, received: ${actualCurrency}`,
        };
    }

    // 4. Amount (in paise) match check
    const actualAmount = Number(gatewayPayment.amount);
    if (actualAmount !== expectedAmountPaise) {
        return {
            verified: false,
            mismatch: true,
            mismatchReason: `Amount mismatch: expected ${expectedAmountPaise} paise, received ${actualAmount} paise`,
            error: `Payment amount mismatch: expected ${expectedAmountPaise} paise, received ${actualAmount} paise`,
        };
    }

    // 5. Captured status check
    const rawStatus = (gatewayPayment.status || "").toLowerCase();
    const isCaptured = rawStatus === "captured" || gatewayPayment.captured === true;

    if (rawStatus === "authorized") {
        return {
            verified: false,
            status: "AUTHORIZED",
            gatewayPayment,
            error: "Payment is authorized but not captured yet",
        };
    }

    if (!isCaptured) {
        return {
            verified: false,
            status: (rawStatus.toUpperCase() as any) || "UNKNOWN",
            gatewayPayment,
            error: `Payment is not in captured status (current status: ${gatewayPayment.status})`,
        };
    }

    return {
        verified: true,
        status: "CAPTURED",
        gatewayPayment,
    };
}
