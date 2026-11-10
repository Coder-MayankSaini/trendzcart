import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import Razorpay from "razorpay";
import * as adminModule from "firebase-admin";
import { POST as createOrderRoute } from "../../src/app/api/orders/create/route.ts";
import { adminDb } from "../../src/lib/firebase/admin.ts";
import { seedEmulatorDatabase, clearCollection, createJsonPostRequest } from "./testHelper.ts";
import { SYNTHETIC_SHIPPING_ADDRESS } from "../fixtures/orders.ts";

const admin = (adminModule as any).default || adminModule;

describe("Customizable Product COD Restriction Integration Tests (TASK 027)", () => {
    const mockSecret = "test_razorpay_secret_key_mock_cod_027";

    before(() => {
        process.env.RAZORPAY_KEY_ID = "rzp_test_mock_create";
        process.env.RAZORPAY_KEY_SECRET = mockSecret;

        // Mock Razorpay SDK payments.fetch for prepaid verification
        const dummy = new Razorpay({ key_id: "rzp_test_mock", key_secret: "mock" });
        const apiProto = Object.getPrototypeOf(dummy.api);
        apiProto.get = async function (params: any) {
            const url = params?.url || "";
            if (url.includes("/payments/")) {
                return {
                    id: "pay_rzp_mock_cod_027",
                    entity: "payment",
                    amount: 80000,
                    currency: "INR",
                    status: "captured",
                    order_id: "order_rzp_mock_cod_027",
                    captured: true,
                };
            }
            return {};
        };
    });

    beforeEach(async () => {
        if (!adminDb) {
            throw new Error("adminDb is not initialized. Ensure Firestore emulator is running.");
        }
        await clearCollection(adminDb, "orders");
        await seedEmulatorDatabase(adminDb);
    });

    // 1. Regular product only → COD follows existing eligibility
    it("COD-INT-001: Regular product only → COD succeeds with HTTP 200 and PENDING payment status", async () => {
        const payload = {
            items: [
                {
                    productId: "prod-hoodie-1000",
                    quantity: 1,
                },
            ],
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.ok(data.id);
        assert.equal(data.paymentStatus, "PENDING");
        assert.equal(data.orderStatus, "Processing");

        const orderDoc = await adminDb!.collection("orders").doc(data.id).get();
        assert.equal(orderDoc.exists, true);
        assert.equal(orderDoc.data()?.paymentMethod, "COD");
    });

    // 2. One personalized product → COD blocked
    it("COD-INT-002: One personalized product in cart → COD is blocked with HTTP 400 and structured code", async () => {
        const payload = {
            items: [
                {
                    productId: "prod-custom-frame-800",
                    quantity: 1,
                    isCustomized: true,
                },
            ],
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 400);
        assert.equal(data.code, "COD_NOT_ALLOWED_CUSTOM_PRODUCT");
        assert.match(data.error, /Cash on Delivery is not available for orders containing customizable or personalized items/i);
        assert.equal(data.ineligibleItems?.length, 1);
        assert.equal(data.ineligibleItems[0].id, "prod-custom-frame-800");

        // Verify zero orders persisted
        const ordersSnap = await adminDb!.collection("orders").get();
        assert.equal(ordersSnap.size, 0);
    });

    // 3. Multiple personalized products → COD blocked
    it("COD-INT-003: Multiple personalized products → COD is blocked and all custom items are reported", async () => {
        const payload = {
            items: [
                {
                    productId: "prod-custom-frame-800",
                    quantity: 1,
                },
                {
                    productId: "prod-custom-mug-400",
                    quantity: 2,
                },
            ],
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 400);
        assert.equal(data.code, "COD_NOT_ALLOWED_CUSTOM_PRODUCT");
        assert.equal(data.ineligibleItems?.length, 2);
        const itemIds = data.ineligibleItems.map((i: any) => i.id);
        assert.ok(itemIds.includes("prod-custom-frame-800"));
        assert.ok(itemIds.includes("prod-custom-mug-400"));
    });

    // 4. Mixed regular/personalized cart → COD blocked
    it("COD-INT-004: Mixed cart (regular apparel + custom product) → entire cart COD is blocked", async () => {
        const payload = {
            items: [
                {
                    productId: "prod-hoodie-1000",
                    quantity: 1,
                },
                {
                    productId: "prod-custom-frame-800",
                    quantity: 1,
                },
            ],
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 400);
        assert.equal(data.code, "COD_NOT_ALLOWED_CUSTOM_PRODUCT");
        assert.equal(data.ineligibleItems?.length, 1);
        assert.equal(data.ineligibleItems[0].id, "prod-custom-frame-800");
    });

    // 5. Removing all personalized products → COD can become available
    it("COD-INT-005: Removing all personalized products leaves only regular products → COD succeeds", async () => {
        // Customer previously had custom item, but removed it and submitted regular items only
        const payload = {
            items: [
                {
                    productId: "prod-tshirt-500",
                    quantity: 2,
                },
            ],
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.ok(data.id);
        assert.equal(data.paymentStatus, "PENDING");
    });

    // 6. Size/color variants alone → not automatically treated as personalized
    it("COD-INT-006: Product with size choices alone → NOT treated as personalized; COD allowed", async () => {
        const payload = {
            items: [
                {
                    productId: "prod-sized-shirt-600",
                    quantity: 1,
                    size: "L",
                },
            ],
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.ok(data.id);
        assert.equal(data.paymentStatus, "PENDING");
    });

    // 7. Personalized product with no customization fields filled → COD blocked
    it("COD-INT-007: Personalized product with empty customization fields / isCustomized=false → COD blocked", async () => {
        // Client maliciously or accidentally omits customization payload on a catalog custom product
        const payload = {
            items: [
                {
                    productId: "prod-custom-mug-400",
                    quantity: 1,
                    isCustomized: false, // client attempts to bypass
                },
            ],
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 400);
        assert.equal(data.code, "COD_NOT_ALLOWED_CUSTOM_PRODUCT");
        assert.equal(data.ineligibleItems[0].id, "prod-custom-mug-400");
    });

    // 8. Forged client personalization flag → ignored
    it("COD-INT-008: Forged client flag (isCustomized=true on regular product) → ignored, COD allowed based on catalog", async () => {
        const payload = {
            items: [
                {
                    productId: "prod-tshirt-500",
                    quantity: 1,
                    isCustomized: true, // forged client flag on regular catalog product
                },
            ],
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.ok(data.id);
    });

    // 9. Direct API request attempting COD → rejected
    it("COD-INT-009: Direct API request attempting COD on customizable product → strictly rejected", async () => {
        const directPayload = {
            items: [
                {
                    productId: "prod-custom-frame-800",
                    quantity: 1,
                },
            ],
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", directPayload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 400);
        assert.equal(data.code, "COD_NOT_ALLOWED_CUSTOM_PRODUCT");
    });

    // 10. Rejected COD attempt → no order or inventory side effects
    it("COD-INT-010: Rejected COD attempt produces NO order or inventory side effects", async () => {
        const initialDoc = await adminDb!.collection("products").doc("prod-custom-frame-800").get();
        const initialInventory = initialDoc.data()?.inventory;

        const payload = {
            items: [
                {
                    productId: "prod-custom-frame-800",
                    quantity: 3,
                },
            ],
            couponCode: "SAVE10", // Synthetic coupon from fixtures
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);
        assert.equal(res.status, 400);

        // 1. Verify 0 orders exist
        const ordersSnap = await adminDb!.collection("orders").get();
        assert.equal(ordersSnap.size, 0);

        // 2. Verify inventory was NOT decremented
        const afterDoc = await adminDb!.collection("products").doc("prod-custom-frame-800").get();
        assert.equal(afterDoc.data()?.inventory, initialInventory);

        // 3. Verify coupon usage was NOT incremented
        const couponDoc = await adminDb!.collection("coupons").doc("SAVE10").get();
        assert.equal(couponDoc.data()?.timesUsed || 0, 0);
    });

    // 11. Prepaid checkout still works for customizable products
    it("COD-INT-011: Prepaid checkout works cleanly for customizable products", async () => {
        const keySecret = mockSecret;
        const rzpOrderId = "order_rzp_mock_cod_027";
        const rzpPaymentId = "pay_rzp_mock_cod_027";
        const signature = crypto
            .createHmac("sha256", keySecret)
            .update(`${rzpOrderId}|${rzpPaymentId}`)
            .digest("hex");

        const payload = {
            items: [
                {
                    productId: "prod-custom-frame-800",
                    quantity: 1,
                },
            ],
            total: 800,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PAID",
            razorpayOrderId: rzpOrderId,
            razorpayPaymentId: rzpPaymentId,
            razorpaySignature: signature,
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.ok(data.id);
        assert.equal(data.paymentStatus, "PAID");
        assert.equal(data.orderStatus, "Processing");
    });

    // 12. Dynamic catalog update: product changed to customizable after adding to cart
    it("COD-INT-012: Product updated from regular to customizable in Firestore → latest rule applied, COD rejected", async () => {
        // Initially prod-tshirt-500 is regular. Update in Firestore to customizable.
        await adminDb!.collection("products").doc("prod-tshirt-500").update({
            isCustomized: true,
            customizationType: "requires_name",
        });

        const payload = {
            items: [
                {
                    productId: "prod-tshirt-500",
                    quantity: 1,
                },
            ],
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 400);
        assert.equal(data.code, "COD_NOT_ALLOWED_CUSTOM_PRODUCT");
    });

    // 13. Dynamic catalog update: product updated from customized to regular in Firestore
    it("COD-INT-013: Product updated from customized to regular in Firestore → latest rule applied, COD allowed", async () => {
        // Change prod-custom-mug-400 from customized to regular
        await adminDb!.collection("products").doc("prod-custom-mug-400").update({
            isCustomized: false,
            customizationType: null,
        });

        const payload = {
            items: [
                {
                    productId: "prod-custom-mug-400",
                    quantity: 1,
                },
            ],
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.ok(data.id);
    });

    // 14. Unverifiable / missing product in catalog during COD attempt
    it("COD-INT-014: Missing product in catalog during COD attempt fails safely with HTTP 400", async () => {
        const payload = {
            items: [
                {
                    productId: "non-existent-product-id",
                    quantity: 1,
                },
            ],
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload);
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 400);
        assert.match(data.error, /not found in catalog/i);
    });
});
