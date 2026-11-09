import { adminAuth } from "@/lib/firebase/admin";
import { NextRequest } from "next/server";

export interface AdminAuthResult {
    isAdmin: boolean;
    uid?: string;
    email?: string;
    error?: string;
}

/**
 * Verifies that a server-side request contains a valid Firebase ID token
 * minted with the trusted custom claim `admin: true`.
 * Fails closed if the token is missing, invalid, expired, or lacks the claim.
 */
export async function verifyAdminRequest(
    reqOrHeader: NextRequest | Headers | string | null | undefined
): Promise<AdminAuthResult> {
    if (!adminAuth) {
        return { isAdmin: false, error: "Authentication service unavailable" };
    }

    let authHeader: string | null = null;
    if (typeof reqOrHeader === "string") {
        authHeader = reqOrHeader;
    } else if (reqOrHeader && "headers" in reqOrHeader) {
        authHeader = reqOrHeader.headers.get("authorization");
    } else if (reqOrHeader && typeof (reqOrHeader as Headers).get === "function") {
        authHeader = (reqOrHeader as Headers).get("authorization");
    }

    if (!authHeader || !authHeader.trim().startsWith("Bearer ")) {
        return { isAdmin: false, error: "Missing or malformed Authorization header" };
    }

    const token = authHeader.trim().slice(7).trim();
    if (!token) {
        return { isAdmin: false, error: "Empty Bearer token" };
    }

    try {
        const decoded = await adminAuth.verifyIdToken(token, true);
        if (decoded.admin === true) {
            return {
                isAdmin: true,
                uid: decoded.uid,
                email: decoded.email,
            };
        }
        return {
            isAdmin: false,
            uid: decoded.uid,
            email: decoded.email,
            error: "Forbidden: Account lacks administrative privileges (admin custom claim required)",
        };
    } catch (err: any) {
        return {
            isAdmin: false,
            error: `Invalid or expired admin token: ${err?.message || "Verification failed"}`,
        };
    }
}
