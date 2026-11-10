import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Razorpay from "razorpay";
import { POST as createRazorpayOrderRoute } from "../../src/app/api/razorpay/create-order/route.ts";
import { adminDb } from "../../src/lib/firebase/admin.ts";
import { seedEmulatorDatabase, createJsonPostRequest } from "./testHelper.ts";

describe("POST /api/razorpay/create-order Integration Tests", () => {
    let capturedOptions: any = null;

    before(() => {
        process.env.COMMERCIAL_CHECKOUT_ENABLED = "true";
        process.env.RAZORPAY_KEY_ID = "rzp_test_mockKeyId123";
        process.env.RAZORPAY_KEY_SECRET = "mockSecretKey456";

        // Intercept Razorpay SDK API call prototype to prevent real external HTTP calls
        const dummy = new Razorpay({ key_id: "rzp_test_mock", key_secret: "mock" });
        const apiProto = Object.getPrototypeOf(dummy.api);
        apiProto.post = async function (params: any) {
            capturedOptions = params.data;
            return {
                id: "order_rzp_mock_123456",
                currency: params.data?.currency || "INR",
                amount: params.data?.amount || 0,
                ...params.data,
            };
        };
    });

    beforeEach(async () => {
        capturedOptions = null;
        if (!adminDb) {
            throw new Error("adminDb is not initialized. Ensure Firestore emulator is running.");
        }
        await seedEmulatorDatabase(adminDb);
    });

    it("should calculate paise amount from database product prices when items are provided", async () => {
        // Product prod-hoodie-1000 is ₹1000. 2 units = ₹2000 = 200000 paise.
        // Client attempts to pass amount: 1 to pay ₹1.
        const payload = {
            amount: 1, // Malicious amount
            currency: "INR",
            receipt: "order-receipt-1",
            items: [{ productId: "prod-hoodie-1000", quantity: 2 }],
            couponCode: null,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", payload);
        const res = await createRazorpayOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.amount, 200000); // 200000 paise (₹2000), NOT 100 paise (₹1)
        assert.equal(capturedOptions?.amount, 200000);
    });

    it("should accurately apply coupon discounts to Razorpay order amount", async () => {
        // Product prod-hoodie-1000 (₹1000) with FLAT200 coupon = ₹800 = 80000 paise.
        const payload = {
            currency: "INR",
            receipt: "order-receipt-coupon",
            items: [{ productId: "prod-hoodie-1000", quantity: 1 }],
            couponCode: "FLAT200",
        };

        const req = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", payload);
        const res = await createRazorpayOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.amount, 80000); // 80000 paise (₹800)
    });

    it("DEFECT CHECK: Direct Amount Fallback Vulnerability when items are omitted", async () => {
        // An attacker directly invokes /api/razorpay/create-order omitting items:
        // { amount: 1, receipt: "order-malicious-bypass" }
        const payload = {
            amount: 1,
            currency: "INR",
            receipt: "order-malicious-bypass",
            // items omitted
        };

        const req = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", payload);
        const res = await createRazorpayOrderRoute(req);
        const data = await res.json();

        console.log("[DIRECT AMOUNT FALLBACK CHECK] Status:", res.status, "Created Amount:", data?.amount);

        // Security Requirement:
        // Razorpay order creation should NOT allow arbitrary client amounts without items verification.
        // If this test fails (status 200 with amount: 100 paise), it proves that an unsafe legacy fallback path remains!
        assert.notEqual(
            data?.amount,
            100,
            "VULNERABILITY DETECTED: Caller omitted items and successfully created a Razorpay order for ₹1 via fallback path!"
        );
    });
});
