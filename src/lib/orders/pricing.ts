import crypto from "crypto";

export interface OrderItemInput {
    id?: string;
    productId?: string;
    name?: string;
    price?: number;
    quantity: number;
    size?: string;
    image?: string;
    isCustomized?: boolean;
    customizationData?: {
        name?: string;
        pictureUrl?: string;
        storagePath?: string;
        ownerUid?: string;
        fileId?: string;
        sessionId?: string;
    };
}

export interface ValidatedOrderItem {
    id: string;
    productId: string;
    name: string;
    price: number;
    quantity: number;
    itemSubtotal: number;
    size?: string;
    image?: string;
    isCustomized: boolean;
    customizationData?: {
        name?: string;
        pictureUrl?: string;
        storagePath?: string;
        ownerUid?: string;
        fileId?: string;
        sessionId?: string;
    };
}

export interface ProductRecord {
    id: string;
    name: string;
    price: number;
    inventory?: number;
    isVisible?: boolean;
    images?: string[];
    category?: string;
    isTestFixture?: boolean;
    purchasable?: boolean;
    isArchived?: boolean;
    isCustomized?: boolean;
    customizationType?: "requires_name" | "requires_picture" | null;
    customizable?: boolean;
    isPersonalized?: boolean;
    sizes?: string[];
}

import {
    isCustomizableProduct,
    evaluateCodEligibility,
} from "./customizationEligibility.ts";
export {
    isCustomizableProduct,
    evaluateCodEligibility,
};
export type { CodEligibilityResult } from "./customizationEligibility.ts";

export interface CouponRecord {
    code: string;
    discountType: "percentage" | "flat";
    discountValue: number;
    expiryDate?: any; // Firestore Timestamp, Date, or ISO string
    usageLimit?: number;
    timesUsed?: number;
    isActive?: boolean;
    isTestFixture?: boolean;
}

export interface PriceCalculationResult {
    isValid: boolean;
    errors: string[];
    validatedItems: ValidatedOrderItem[];
    subtotal: number;
    couponDiscount: number;
    total: number;
    appliedCouponCode: string | null;
}

/**
 * Parses and verifies whether a coupon expiration date is in the past.
 */
export function isCouponExpired(expiryDate: any, now: Date = new Date()): boolean {
    if (!expiryDate) return false;

    let expiry: Date | null = null;
    if (typeof expiryDate.toDate === "function") {
        expiry = expiryDate.toDate();
    } else if (expiryDate instanceof Date) {
        expiry = expiryDate;
    } else if (typeof expiryDate === "number" || typeof expiryDate === "string") {
        expiry = new Date(expiryDate);
    }

    if (!expiry || Number.isNaN(expiry.getTime())) {
        return false;
    }

    return expiry.getTime() < now.getTime();
}

/**
 * Calculates discount for a validated coupon given a subtotal.
 */
export function calculateCouponDiscount(
    coupon: CouponRecord,
    subtotal: number,
    now: Date = new Date(),
    options?: { allowTestFixtures?: boolean }
): { discount: number; error?: string } {
    if (!coupon.isActive) {
        return { discount: 0, error: "Coupon is not active" };
    }

    if (!options?.allowTestFixtures && (coupon.isTestFixture === true || coupon.code.startsWith("TASK013_") || coupon.code.startsWith("TEST_"))) {
        return { discount: 0, error: "Test coupons cannot be used for commercial checkout" };
    }

    if (isCouponExpired(coupon.expiryDate, now)) {
        return { discount: 0, error: "Coupon has expired" };
    }

    if (typeof coupon.usageLimit === "number" && typeof coupon.timesUsed === "number") {
        if (coupon.timesUsed >= coupon.usageLimit) {
            return { discount: 0, error: "Coupon usage limit reached" };
        }
    }

    const value = Number(coupon.discountValue) || 0;
    if (value <= 0) {
        return { discount: 0 };
    }

    if (coupon.discountType === "percentage") {
        const discount = Math.round(((subtotal * value) / 100) * 100) / 100;
        return { discount: Math.min(discount, subtotal) };
    } else if (coupon.discountType === "flat") {
        return { discount: Math.min(value, subtotal) };
    }

    return { discount: 0, error: "Unsupported coupon discount type" };
}

/**
 * Authoritatively calculates item totals, coupon discount, and order total
 * using trusted database records for products and coupons.
 */
export async function calculateOrderPricing(
    items: OrderItemInput[],
    couponCode: string | null | undefined,
    fetchProduct: (productId: string) => Promise<ProductRecord | null>,
    fetchCoupon: (code: string) => Promise<CouponRecord | null>,
    now: Date = new Date(),
    options?: { allowTestFixtures?: boolean }
): Promise<PriceCalculationResult> {
    const errors: string[] = [];
    const validatedItems: ValidatedOrderItem[] = [];
    let subtotal = 0;

    if (!Array.isArray(items) || items.length === 0) {
        return {
            isValid: false,
            errors: ["Order must contain at least one item."],
            validatedItems: [],
            subtotal: 0,
            couponDiscount: 0,
            total: 0,
            appliedCouponCode: null,
        };
    }

    // Aggregate requested quantities per product to prevent inventory bypass with split line items
    const totalRequestedPerProduct = new Map<string, number>();
    for (const item of items) {
        const pId = item.productId || item.id;
        const q = Number(item.quantity);
        if (pId && Number.isInteger(q) && q > 0) {
            totalRequestedPerProduct.set(pId, (totalRequestedPerProduct.get(pId) || 0) + q);
        }
    }

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const productId = item.productId || item.id;
        const quantity = Number(item.quantity);

        if (!productId) {
            errors.push(`Item at index ${i} is missing product ID.`);
            continue;
        }

        if (!Number.isInteger(quantity) || quantity <= 0) {
            errors.push(`Item '${productId}' has invalid quantity: ${item.quantity}.`);
            continue;
        }

        const product = await fetchProduct(productId);
        if (!product) {
            errors.push(`Product '${productId}' not found in catalog.`);
            continue;
        }

        if (
            product.isVisible === false ||
            product.isArchived === true ||
            product.purchasable === false ||
            (!options?.allowTestFixtures && (product.category === "Testing" || product.isTestFixture === true || productId.startsWith("task013_test_")))
        ) {
            errors.push(`Product '${product.name}' is no longer available.`);
            continue;
        }

        const totalRequested = totalRequestedPerProduct.get(productId) || quantity;
        if (typeof product.inventory === "number" && product.inventory < totalRequested) {
            errors.push(`Insufficient stock for '${product.name}'. Available: ${product.inventory}, requested: ${totalRequested}.`);
            continue;
        }

        const authoritativePrice = Number(product.price);
        if (Number.isNaN(authoritativePrice) || authoritativePrice < 0) {
            errors.push(`Product '${product.name}' has invalid catalog price.`);
            continue;
        }

        const itemSubtotal = authoritativePrice * quantity;
        subtotal += itemSubtotal;

        const validatedItem: ValidatedOrderItem = {
            id: item.id || productId,
            productId,
            name: product.name,
            price: authoritativePrice,
            quantity,
            itemSubtotal,
            isCustomized: isCustomizableProduct(product) || Boolean(item.isCustomized),
        };
        if (item.size) {
            validatedItem.size = item.size;
        }
        if (item.image || (product.images && product.images[0])) {
            validatedItem.image = item.image || (product.images && product.images[0]) || "";
        }
        if (item.customizationData) {
            validatedItem.customizationData = item.customizationData;
        }

        validatedItems.push(validatedItem);
    }

    let couponDiscount = 0;
    let appliedCouponCode: string | null = null;

    if (couponCode && couponCode.trim().length > 0) {
        const normalizedCode = couponCode.trim().toUpperCase();
        const coupon = await fetchCoupon(normalizedCode);

        if (!coupon) {
            errors.push(`Coupon '${normalizedCode}' not found.`);
        } else {
            const result = calculateCouponDiscount(coupon, subtotal, now, options);
            if (result.error) {
                errors.push(`Coupon error: ${result.error}`);
            } else {
                couponDiscount = result.discount;
                appliedCouponCode = normalizedCode;
            }
        }
    }

    const total = Math.max(0, Math.round((subtotal - couponDiscount) * 100) / 100);

    return {
        isValid: errors.length === 0,
        errors,
        validatedItems,
        subtotal: Math.round(subtotal * 100) / 100,
        couponDiscount: Math.round(couponDiscount * 100) / 100,
        total,
        appliedCouponCode,
    };
}

/**
 * Validates Razorpay HMAC-SHA256 signature.
 */
export function verifyRazorpaySignature(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string,
    keySecret: string
): boolean {
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !keySecret) {
        return false;
    }

    const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expected = crypto
        .createHmac("sha256", keySecret)
        .update(payload)
        .digest("hex");

    const expectedBuf = Buffer.from(expected);
    const signatureBuf = Buffer.from(razorpaySignature);

    if (expectedBuf.length !== signatureBuf.length) {
        return false;
    }

    return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

/**
 * Validates Razorpay Webhook HMAC-SHA256 signature against raw request body bytes.
 */
export function verifyRazorpayWebhookSignature(
    rawBody: string,
    signature: string | null | undefined,
    webhookSecret: string | null | undefined
): boolean {
    if (!rawBody || !signature || !webhookSecret) {
        return false;
    }

    try {
        const expected = crypto
            .createHmac("sha256", webhookSecret)
            .update(rawBody)
            .digest("hex");

        const expectedBuf = Buffer.from(expected, "utf8");
        const signatureBuf = Buffer.from(signature, "utf8");

        if (expectedBuf.length !== signatureBuf.length) {
            return false;
        }

        return crypto.timingSafeEqual(expectedBuf, signatureBuf);
    } catch {
        return false;
    }
}

