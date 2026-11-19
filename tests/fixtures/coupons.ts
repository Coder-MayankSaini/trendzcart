/**
 * Synthetic Coupon Fixtures for Firebase Emulator Integration Tests
 */

export interface TestCoupon {
    code: string;
    discountType: "percentage" | "flat";
    discountValue: number;
    expiryDate: any;
    usageLimit: number;
    timesUsed: number;
    isActive: boolean;
}

export const SYNTHETIC_COUPONS: Record<string, TestCoupon> = {
    "VALID10": {
        code: "VALID10",
        discountType: "percentage",
        discountValue: 10, // 10% discount
        expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Valid for 7 days
        usageLimit: 100,
        timesUsed: 5,
        isActive: true,
    },
    "FLAT200": {
        code: "FLAT200",
        discountType: "flat",
        discountValue: 200, // ₹200 flat discount
        expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        usageLimit: 50,
        timesUsed: 0,
        isActive: true,
    },
    "EXPIRED20": {
        code: "EXPIRED20",
        discountType: "percentage",
        discountValue: 20,
        expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // Expired yesterday
        usageLimit: 100,
        timesUsed: 0,
        isActive: true,
    },
    "MAXEDOUT": {
        code: "MAXEDOUT",
        discountType: "flat",
        discountValue: 100,
        expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        usageLimit: 10,
        timesUsed: 10, // Limit reached
        isActive: true,
    },
    "INACTIVE50": {
        code: "INACTIVE50",
        discountType: "percentage",
        discountValue: 50,
        expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        usageLimit: 100,
        timesUsed: 0,
        isActive: false, // Inactive coupon
    },
    "LASTUSE1": {
        code: "LASTUSE1",
        discountType: "flat",
        discountValue: 50,
        expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        usageLimit: 5,
        timesUsed: 4, // Exactly 1 redemption remaining for concurrency testing
        isActive: true,
    },
};
