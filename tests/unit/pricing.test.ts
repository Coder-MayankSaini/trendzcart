import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
    calculateOrderPricing,
    calculateCouponDiscount,
    isCouponExpired,
    verifyRazorpaySignature,
} from "../../src/lib/orders/pricing.ts";
import type {
    ProductRecord,
    CouponRecord,
    OrderItemInput,
} from "../../src/lib/orders/pricing.ts";

describe("Pricing and Order Validation Module", () => {
    const mockProducts: Record<string, ProductRecord> = {
        "prod-hoodie": {
            id: "prod-hoodie",
            name: "Classic TrendKartz Hoodie",
            price: 1499,
            inventory: 10,
            isVisible: true,
        },
        "prod-tshirt": {
            id: "prod-tshirt",
            name: "Custom Graphic T-Shirt",
            price: 699,
            inventory: 2,
            isVisible: true,
        },
        "prod-hidden": {
            id: "prod-hidden",
            name: "Unreleased Jacket",
            price: 2999,
            inventory: 5,
            isVisible: false,
        },
        "prod-soldout": {
            id: "prod-soldout",
            name: "Limited Edition Mug",
            price: 399,
            inventory: 0,
            isVisible: true,
        },
    };

    const mockCoupons: Record<string, CouponRecord> = {
        "SAVE10": {
            code: "SAVE10",
            discountType: "percentage",
            discountValue: 10,
            isActive: true,
            timesUsed: 5,
            usageLimit: 100,
            expiryDate: new Date(Date.now() + 86400000), // tomorrow
        },
        "FLAT200": {
            code: "FLAT200",
            discountType: "flat",
            discountValue: 200,
            isActive: true,
            timesUsed: 0,
            usageLimit: 10,
            expiryDate: new Date(Date.now() + 86400000),
        },
        "EXPIRED": {
            code: "EXPIRED",
            discountType: "percentage",
            discountValue: 20,
            isActive: true,
            timesUsed: 1,
            usageLimit: 100,
            expiryDate: new Date(Date.now() - 86400000), // yesterday
        },
        "MAXEDOUT": {
            code: "MAXEDOUT",
            discountType: "flat",
            discountValue: 100,
            isActive: true,
            timesUsed: 50,
            usageLimit: 50,
        },
        "INACTIVE": {
            code: "INACTIVE",
            discountType: "percentage",
            discountValue: 50,
            isActive: false,
            timesUsed: 0,
            usageLimit: 100,
        },
    };

    const fetchProduct = async (id: string) => mockProducts[id] || null;
    const fetchCoupon = async (code: string) => mockCoupons[code] || null;

    it("should accurately calculate subtotal and total using catalog prices", async () => {
        const items: OrderItemInput[] = [
            { productId: "prod-hoodie", quantity: 2 },
            { productId: "prod-tshirt", quantity: 1 },
        ];

        const result = await calculateOrderPricing(items, null, fetchProduct, fetchCoupon);

        assert.equal(result.isValid, true);
        assert.equal(result.errors.length, 0);
        // (1499 * 2) + (699 * 1) = 2998 + 699 = 3697
        assert.equal(result.subtotal, 3697);
        assert.equal(result.couponDiscount, 0);
        assert.equal(result.total, 3697);
        assert.equal(result.validatedItems.length, 2);
        assert.equal(result.validatedItems[0].price, 1499);
        assert.equal(result.validatedItems[1].price, 699);
    });

    it("should IGNORE client-tampered price and enforce catalog price (SEC-TEST-001)", async () => {
        const tamperedItems: OrderItemInput[] = [
            {
                productId: "prod-hoodie",
                price: 1, // Attacker sends ₹1 instead of ₹1499
                quantity: 2,
            },
        ];

        const result = await calculateOrderPricing(tamperedItems, null, fetchProduct, fetchCoupon);

        assert.equal(result.isValid, true);
        assert.equal(result.subtotal, 2998); // 1499 * 2, NOT 2
        assert.equal(result.total, 2998);
        assert.equal(result.validatedItems[0].price, 1499);
    });

    it("should reject order if requested quantity exceeds inventory (SEC-TEST-007)", async () => {
        const items: OrderItemInput[] = [
            { productId: "prod-tshirt", quantity: 5 }, // Only 2 available
        ];

        const result = await calculateOrderPricing(items, null, fetchProduct, fetchCoupon);

        assert.equal(result.isValid, false);
        assert.match(result.errors[0], /Insufficient stock/);
    });

    it("should reject order if product is out of stock", async () => {
        const items: OrderItemInput[] = [
            { productId: "prod-soldout", quantity: 1 },
        ];

        const result = await calculateOrderPricing(items, null, fetchProduct, fetchCoupon);

        assert.equal(result.isValid, false);
        assert.match(result.errors[0], /Insufficient stock/);
    });

    it("should reject order if product is marked as isVisible: false", async () => {
        const items: OrderItemInput[] = [
            { productId: "prod-hidden", quantity: 1 },
        ];

        const result = await calculateOrderPricing(items, null, fetchProduct, fetchCoupon);

        assert.equal(result.isValid, false);
        assert.match(result.errors[0], /no longer available/);
    });

    it("should apply percentage coupon correctly (SEC-TEST-006)", async () => {
        const items: OrderItemInput[] = [
            { productId: "prod-hoodie", quantity: 1 }, // 1499
        ];

        const result = await calculateOrderPricing(items, "SAVE10", fetchProduct, fetchCoupon);

        assert.equal(result.isValid, true);
        assert.equal(result.subtotal, 1499);
        // 10% of 1499 = 149.9
        assert.equal(result.couponDiscount, 149.9);
        // 1499 - 149.9 = 1349.1
        assert.equal(result.total, 1349.1);
        assert.equal(result.appliedCouponCode, "SAVE10");
    });

    it("should apply flat coupon correctly", async () => {
        const items: OrderItemInput[] = [
            { productId: "prod-hoodie", quantity: 1 }, // 1499
        ];

        const result = await calculateOrderPricing(items, "FLAT200", fetchProduct, fetchCoupon);

        assert.equal(result.isValid, true);
        assert.equal(result.subtotal, 1499);
        assert.equal(result.couponDiscount, 200);
        assert.equal(result.total, 1299);
    });

    it("should reject expired coupon and not grant discount", async () => {
        const items: OrderItemInput[] = [
            { productId: "prod-hoodie", quantity: 1 },
        ];

        const result = await calculateOrderPricing(items, "EXPIRED", fetchProduct, fetchCoupon);

        assert.equal(result.isValid, false);
        assert.match(result.errors[0], /Coupon has expired/);
        assert.equal(result.couponDiscount, 0);
    });

    it("should reject coupon that has reached usageLimit", async () => {
        const items: OrderItemInput[] = [
            { productId: "prod-hoodie", quantity: 1 },
        ];

        const result = await calculateOrderPricing(items, "MAXEDOUT", fetchProduct, fetchCoupon);

        assert.equal(result.isValid, false);
        assert.match(result.errors[0], /Coupon usage limit reached/);
        assert.equal(result.couponDiscount, 0);
    });

    it("should reject inactive coupon", async () => {
        const items: OrderItemInput[] = [
            { productId: "prod-hoodie", quantity: 1 },
        ];

        const result = await calculateOrderPricing(items, "INACTIVE", fetchProduct, fetchCoupon);

        assert.equal(result.isValid, false);
        assert.match(result.errors[0], /Coupon is not active/);
        assert.equal(result.couponDiscount, 0);
    });

    it("should verify valid Razorpay HMAC signatures (SEC-TEST-008)", () => {
        const secret = "test_razorpay_secret_key";
        const orderId = "order_O4uF8HqXoZqQyV";
        const paymentId = "pay_O4uG3j6UqA9M7t";
        const payload = `${orderId}|${paymentId}`;
        const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");

        const isValid = verifyRazorpaySignature(orderId, paymentId, signature, secret);
        assert.equal(isValid, true);
    });

    it("should reject invalid or mismatched Razorpay HMAC signatures", () => {
        const secret = "test_razorpay_secret_key";
        const orderId = "order_O4uF8HqXoZqQyV";
        const paymentId = "pay_O4uG3j6UqA9M7t";
        const wrongSignature = crypto.createHmac("sha256", "wrong_secret").update(`${orderId}|${paymentId}`).digest("hex");

        const isValid = verifyRazorpaySignature(orderId, paymentId, wrongSignature, secret);
        assert.equal(isValid, false);

        // Mismatched order ID
        const signature = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
        const isWrongOrder = verifyRazorpaySignature("order_DIFFERENT", paymentId, signature, secret);
        assert.equal(isWrongOrder, false);
    });
});
