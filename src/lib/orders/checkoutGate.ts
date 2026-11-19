import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";

export interface CheckoutGateResult {
    allowed: boolean;
    isAuthorizedTest?: boolean;
    response?: NextResponse;
}

/**
 * Returns whether commercial checkout is currently open to the public.
 * Defaults strictly to false unless COMMERCIAL_CHECKOUT_ENABLED is explicitly "true".
 */
export function isCommercialCheckoutEnabled(): boolean {
    return process.env.COMMERCIAL_CHECKOUT_ENABLED === "true";
}

/**
 * Validates whether a request carries verified authorization for synthetic test-mode verification.
 * Does NOT accept arbitrary client-provided body flags.
 * Requires either:
 * 1. An authenticated administrator token (Custom Claims admin == true)
 * 2. A verified secret test authorization header matching server-configured token
 */
export async function isAuthorizedTestCheckout(req: NextRequest, verifiedAdminUid?: string | null): Promise<boolean> {
    // 1. Check verified admin UID from Custom Claims if already verified or verify from Authorization header
    if (verifiedAdminUid && adminAuth) {
        try {
            const user = await adminAuth.getUser(verifiedAdminUid);
            if (user?.customClaims?.admin === true) {
                return true;
            }
        } catch {
            // continue to token check
        }
    }

    // 2. Check secret test authorization header
    const testAuthHeader = req.headers.get("x-bazaarvilla-test-authorization");
    if (testAuthHeader) {
        const expectedSecret =
            process.env.TEST_CHECKOUT_AUTHORIZATION_TOKEN ||
            process.env.RAZORPAY_KEY_SECRET;

        if (expectedSecret && testAuthHeader === expectedSecret) {
            return true;
        }
    }

    return false;
}

/**
 * Centralized, server-authoritative checkout gate.
 * Protects both COD and prepaid checkout routes against unintended public orders
 * prior to formal commercial launch sign-off.
 */
export async function assertCommercialCheckoutGate(
    req: NextRequest,
    options?: { verifiedAdminUid?: string | null }
): Promise<CheckoutGateResult> {
    // 1. If commercial checkout is enabled, all valid requests are permitted
    if (isCommercialCheckoutEnabled()) {
        return { allowed: true };
    }

    // 2. If disabled, check for explicit authorized test mode verification
    const isTest = await isAuthorizedTestCheckout(req, options?.verifiedAdminUid);
    if (isTest) {
        return { allowed: true, isAuthorizedTest: true };
    }

    // 3. Fail-closed: Block public orders with clear customer message
    return {
        allowed: false,
        response: NextResponse.json(
            {
                error: "Ordering will open soon. Bazaarvilla is preparing for commercial launch!",
                code: "COMMERCIAL_CHECKOUT_DISABLED",
                launchReadiness: "Pre-Commercial Hardening in Progress",
            },
            { status: 503 }
        ),
    };
}
