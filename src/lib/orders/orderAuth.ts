import crypto from "crypto";
import { adminAuth } from "@/lib/firebase/admin";

export interface VerifiedAuthUser {
    uid: string;
    email?: string;
}

export interface AuthVerificationResult {
    user: VerifiedAuthUser | null;
    isGuest: boolean;
    error?: string;
}

/**
 * Generates a cryptographically secure 256-bit guest access token.
 */
export function generateGuestAccessToken(): string {
    return crypto.randomBytes(32).toString("hex");
}

/**
 * Computes SHA-256 hash of a guest access token for secure database storage.
 * Only the hash is ever persisted in Firestore.
 */
export function hashGuestAccessToken(token: string): string {
    if (!token || typeof token !== "string") {
        throw new Error("Guest access token must be a non-empty string");
    }
    return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

/**
 * Verifies a provided guest access token against the stored SHA-256 hash
 * using constant-time comparison to prevent timing side-channel attacks.
 */
export function verifyGuestAccessToken(
    providedToken: string | null | undefined,
    storedHash: string | null | undefined
): boolean {
    if (!providedToken || !storedHash || typeof providedToken !== "string" || typeof storedHash !== "string") {
        return false;
    }

    try {
        const computedHash = hashGuestAccessToken(providedToken);
        const computedBuf = Buffer.from(computedHash, "utf8");
        const storedBuf = Buffer.from(storedHash, "utf8");

        if (computedBuf.length !== storedBuf.length) {
            return false;
        }

        return crypto.timingSafeEqual(computedBuf, storedBuf);
    } catch {
        return false;
    }
}

/**
 * Verifies a Firebase ID token from the Authorization header.
 * - Missing Authorization header => Guest mode (user: null, isGuest: true).
 * - Present header with invalid/expired token => Auth failure (error returned, isGuest: false).
 * Enforces fail-closed behavior so invalid authenticated requests cannot silently fall back to guest.
 */
export async function verifyFirebaseAuthorization(
    authHeader: string | null | undefined
): Promise<AuthVerificationResult> {
    if (!authHeader || !authHeader.trim()) {
        return { user: null, isGuest: true };
    }

    const trimmed = authHeader.trim();
    if (!trimmed.startsWith("Bearer ")) {
        return {
            user: null,
            isGuest: false,
            error: "Malformed authorization header. Expected 'Bearer <token>'.",
        };
    }

    const idToken = trimmed.slice(7).trim();
    if (!idToken) {
        return {
            user: null,
            isGuest: false,
            error: "Missing Bearer token value.",
        };
    }

    if (!adminAuth) {
        return {
            user: null,
            isGuest: false,
            error: "Authentication service is unavailable.",
        };
    }

    try {
        const decoded = await adminAuth.verifyIdToken(idToken, true);
        return {
            user: {
                uid: decoded.uid,
                email: decoded.email,
            },
            isGuest: false,
        };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Token verification failed";
        return {
            user: null,
            isGuest: false,
            error: `Invalid or expired authentication token: ${message}`,
        };
    }
}

/**
 * Safely converts Firestore timestamp or date value to ISO string.
 */
export const toIsoDateString = (value: unknown): string | null => {
    if (!value) return null;
    const anyVal = value as Record<string, unknown>;
    if (typeof anyVal?.toDate === "function") {
        return (anyVal.toDate as () => Date)().toISOString();
    }
    const date = new Date(value as string | number | Date);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export interface CustomerOrderSummaryItem {
    id?: string;
    productId: string;
    name: string;
    price: number;
    quantity: number;
    image?: string;
    size?: string;
    customization?: {
        text?: string;
        hasImage?: boolean;
    };
}

export interface CustomerOrderDTO {
    id: string;
    createdAt: string | null;
    updatedAt: string | null;
    orderStatus: string;
    paymentStatus: string;
    paymentMethod: string;
    total: number;
    subtotal: number;
    discount?: number;
    couponDiscount?: number;
    couponCode?: string | null;
    currency?: string;
    items?: CustomerOrderSummaryItem[];
    requiresVerification?: boolean;
    verificationNotice?: string;
    shippingAddress?: {
        fullName?: string;
        city?: string;
        state?: string;
        pincode?: string;
        phoneMasked?: string;
        emailMasked?: string;
    };
}

/**
 * Projects a raw Firestore order document into a customer-facing DTO,
 * stripping internal sensitive fields (hashes, raw gateway signatures, internal fraud flags, etc.)
 */
export function projectCustomerOrder(
    rawOrder: Record<string, unknown>,
    options?: { isDetail?: boolean }
): CustomerOrderDTO {
    if (!rawOrder) {
        throw new Error("Raw order data is required for projection");
    }

    // Handle legacy order requiring identity verification
    if (rawOrder.requiresVerification) {
        return {
            id: String(rawOrder.id),
            createdAt: toIsoDateString(rawOrder.createdAt),
            updatedAt: toIsoDateString(rawOrder.updatedAt),
            orderStatus: "Verification Required",
            paymentStatus: String(rawOrder.paymentStatus || "UNKNOWN"),
            paymentMethod: String(rawOrder.paymentMethod || "UNKNOWN"),
            total: Number(rawOrder.total) || 0,
            subtotal: Number(rawOrder.subtotal) || 0,
            requiresVerification: true,
            verificationNotice:
                "This order was placed before modern security controls and requires identity verification. Please contact support at support@bazaarvilla.com.",
        };
    }

    const items: CustomerOrderSummaryItem[] = Array.isArray(rawOrder.items)
        ? rawOrder.items.map((rawItem: unknown) => {
              const item = (rawItem || {}) as Record<string, unknown>;
              const customization = item.customization as Record<string, unknown> | undefined;
              return {
                  id: (item.id as string) || (item.productId as string),
                  productId: (item.productId as string) || (item.id as string),
                  name: String(item.name || "Product"),
                  price: Number(item.price) || 0,
                  quantity: Number(item.quantity) || 1,
                  image: (item.image as string) || undefined,
                  size: (item.size as string) || undefined,
                  customization: customization
                      ? {
                            text: (customization.text as string) || undefined,
                            hasImage: Boolean(customization.imageUrl || customization.hasImage),
                        }
                      : undefined,
              };
          })
        : [];

    const rawShipping = rawOrder.shippingAddress as Record<string, unknown> | undefined;

    const projected: CustomerOrderDTO = {
        id: String(rawOrder.id),
        createdAt: toIsoDateString(rawOrder.createdAt),
        updatedAt: toIsoDateString(rawOrder.updatedAt),
        orderStatus: String(rawOrder.orderStatus || "Pending"),
        paymentStatus: String(rawOrder.paymentStatus || "PENDING"),
        paymentMethod: String(rawOrder.paymentMethod || "COD"),
        total: Number(rawOrder.total) || 0,
        subtotal: Number(rawOrder.subtotal) || 0,
        discount: typeof rawOrder.discount === "number" ? rawOrder.discount : 0,
        couponDiscount: typeof rawOrder.couponDiscount === "number" ? rawOrder.couponDiscount : 0,
        couponCode: typeof rawOrder.couponCode === "string" ? rawOrder.couponCode : null,
        currency: typeof rawOrder.currency === "string" ? rawOrder.currency : "INR",
        items,
    };

    // Masked shipping details for detailed views only, never exposing full address or raw contact details
    if (options?.isDetail && rawShipping) {
        projected.shippingAddress = {
            fullName: maskName(rawShipping.fullName as string | undefined),
            city: (rawShipping.city as string) || undefined,
            state: (rawShipping.state as string) || undefined,
            pincode: rawShipping.pincode ? maskPincode(String(rawShipping.pincode)) : undefined,
            phoneMasked: rawShipping.phone ? maskPhone(String(rawShipping.phone)) : undefined,
            emailMasked: rawShipping.email ? maskEmail(String(rawShipping.email)) : undefined,
        };
    }

    return projected;
}

function maskName(name?: string): string | undefined {
    if (!name) return undefined;
    const parts = name.trim().split(" ");
    return parts
        .map((p) => (p.length > 1 ? `${p[0]}${"*".repeat(p.length - 1)}` : p))
        .join(" ");
}

function maskPhone(phone?: string): string | undefined {
    if (!phone) return undefined;
    const clean = phone.replace(/\D/g, "");
    if (clean.length < 4) return "****";
    return `${"*".repeat(clean.length - 4)}${clean.slice(-4)}`;
}

function maskEmail(email?: string): string | undefined {
    if (!email || !email.includes("@")) return undefined;
    const [local, domain] = email.split("@");
    const maskedLocal = local.length > 2 ? `${local[0]}${"*".repeat(local.length - 2)}${local.slice(-1)}` : "**";
    return `${maskedLocal}@${domain}`;
}

function maskPincode(pincode?: string): string | undefined {
    if (!pincode) return undefined;
    const str = String(pincode).trim();
    if (str.length <= 3) return "***";
    return `${str.slice(0, 3)}***`;
}
