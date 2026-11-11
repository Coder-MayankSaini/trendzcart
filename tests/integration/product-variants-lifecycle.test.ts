import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import Razorpay from "razorpay";
import { POST as createOrderRoute } from "../../src/app/api/orders/create/route.ts";
import { POST as createRazorpayOrderRoute } from "../../src/app/api/razorpay/create-order/route.ts";
import { POST as webhookRoute } from "../../src/app/api/webhooks/razorpay/route.ts";
import { adminDb } from "../../src/lib/firebase/admin.ts";
import {
    releaseExpiredReservation,
    finalizeOrderPayment,
    cancelOrder,
} from "../../src/lib/orders/paymentLifecycle.ts";
import { runReservationCleanup } from "../../src/lib/orders/reservationCleanup.ts";
import { seedEmulatorDatabase, clearCollection, createJsonPostRequest } from "./testHelper.ts";
import { SYNTHETIC_SHIPPING_ADDRESS } from "../fixtures/orders.ts";

describe("Product Variants & Multi-Attribute Inventory Integrity Integration Tests (TASK 029)", () => {
    const mockKeyId = "rzp_test_variantMock123";
    const mockKeySecret = "variantSecretMock456";
    const mockWebhookSecret = "webhook_secret_variant_mock_789";

    let capturedOptions: any = null;
    let mockOrderCounter = 5000;

    const MULTI_VARIANT_PRODUCT_ID = "prod-variant-tee-multi";
    const SCARCE_VARIANT_PRODUCT_ID = "prod-variant-scarce";
    const PERSONALIZED_VARIANT_PRODUCT_ID = "prod-variant-custom-cushion";
    const LEGACY_PRODUCT_ID = "prod-hoodie-1000";

    before(() => {
        process.env.RAZORPAY_KEY_ID = mockKeyId;
        process.env.RAZORPAY_KEY_SECRET = mockKeySecret;
        process.env.RAZORPAY_WEBHOOK_SECRET = mockWebhookSecret;

        // Intercept Razorpay SDK API prototype to isolate from external networks
        const dummy = new Razorpay({ key_id: "rzp_test_mock", key_secret: "mock" });
        const apiProto = Object.getPrototypeOf(dummy.api);
        apiProto.post = async function (params: any) {
            capturedOptions = params.data;
            mockOrderCounter++;
            return {
                id: `order_rzp_var_${mockOrderCounter}`,
                currency: params.data?.currency || "INR",
                amount: params.data?.amount || 0,
                receipt: params.data?.receipt,
                notes: params.data?.notes,
                ...params.data,
            };
        };

        apiProto.get = async function (params: any) {
            const url = params?.url || "";
            if (url.includes("/payments/")) {
                const parts = url.split("/");
                const paymentId = parts[parts.length - 1];
                return {
                    id: paymentId,
                    entity: "payment",
                    amount: typeof capturedOptions?.amount === "number" ? capturedOptions.amount : 200000,
                    currency: capturedOptions?.currency || "INR",
                    status: "captured",
                    order_id: `order_rzp_var_${mockOrderCounter}`,
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
        await clearCollection(adminDb, "paymentRecords");
        await clearCollection(adminDb, "paymentWebhookEvents");
        await seedEmulatorDatabase(adminDb);

        // Seed authoritative multi-variant product:
        // Black XL: 5 units, ₹1199
        // White M: 3 units, ₹999
        // Midnight Blue S (disabled): 15 units, ₹899
        await adminDb.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).set({
            id: MULTI_VARIANT_PRODUCT_ID,
            name: "Bazaarvilla Signature Variant Tee",
            slug: "bazaarvilla-signature-variant-tee",
            price: 999, // Base price
            inventory: 8, // Active sellable inventory (5 + 3)
            totalPhysicalInventory: 23, // Physical inventory (5 + 3 + 15)
            hasVariants: true,
            sizeMode: "apparel",
            sizesList: [
                { id: "size_m", name: "M", isActive: true },
                { id: "size_xl", name: "XL", isActive: true },
                { id: "size_s", name: "S", isActive: true },
            ],
            colors: [
                { id: "col_black", name: "Black", hex: "#000000", isActive: true },
                { id: "col_white", name: "White", hex: "#ffffff", isActive: true },
                { id: "col_blue", name: "Midnight Blue", hex: "#1e3a8a", isActive: true },
            ],
            variants: [
                {
                    id: "var_black_xl",
                    sizeId: "size_xl",
                    sizeName: "XL",
                    colorId: "col_black",
                    colorName: "Black",
                    sku: "TEE-BLACK-XL",
                    price: 1199, // Override price
                    inventory: 5,
                    isActive: true,
                },
                {
                    id: "var_white_m",
                    sizeId: "size_m",
                    sizeName: "M",
                    colorId: "col_white",
                    colorName: "White",
                    sku: "TEE-WHITE-M",
                    price: 999, // Base price match
                    inventory: 3,
                    isActive: true,
                },
                {
                    id: "var_disabled_blue_s",
                    sizeId: "size_s",
                    sizeName: "S",
                    colorId: "col_blue",
                    colorName: "Midnight Blue",
                    sku: "TEE-BLUE-S",
                    price: 899,
                    inventory: 15,
                    isActive: false, // Disabled variant with physical stock
                },
            ],
            isVisible: true,
            isCustomized: false,
            category: "apparel",
            images: ["https://example.com/tee.jpg"],
            createdAt: Date.now(),
        });

        // Seed scarce variant product (stock = 1)
        await adminDb.collection("products").doc(SCARCE_VARIANT_PRODUCT_ID).set({
            id: SCARCE_VARIANT_PRODUCT_ID,
            name: "Scarce Edition Cap",
            slug: "scarce-edition-cap",
            price: 799,
            inventory: 1,
            totalPhysicalInventory: 1,
            hasVariants: true,
            variants: [
                {
                    id: "var_scarce_black",
                    sizeName: "Free Size",
                    colorName: "Black",
                    sku: "CAP-SCARCE-BLK",
                    price: 799,
                    inventory: 1,
                    isActive: true,
                },
            ],
            isVisible: true,
            isCustomized: false,
            category: "accessories",
            images: ["https://example.com/cap.jpg"],
            createdAt: Date.now(),
        });

        // Seed personalized variant product (requires customer picture)
        await adminDb.collection("products").doc(PERSONALIZED_VARIANT_PRODUCT_ID).set({
            id: PERSONALIZED_VARIANT_PRODUCT_ID,
            name: "Custom Photo Velvet Cushion",
            slug: "custom-photo-velvet-cushion",
            price: 699,
            inventory: 10,
            hasVariants: true,
            isCustomized: true,
            customizationType: "requires_picture",
            variants: [
                {
                    id: "var_cushion_small_blue",
                    sizeName: "Small",
                    colorName: "Royal Blue",
                    sku: "CSH-BLUE-SM",
                    price: 699,
                    inventory: 10,
                    isActive: true,
                    dimensions: { width: 20, height: 20, unit: "cm" },
                },
            ],
            isVisible: true,
            category: "home",
            images: ["https://example.com/cushion.jpg"],
            createdAt: Date.now(),
        });
    });

    // -------------------------------------------------------------------------
    // TEST 1: Two different variants of the same product in one order
    // -------------------------------------------------------------------------
    it("VAR-INT-001: Two different variants of the same product in one order deducts both accurately", async () => {
        // Black XL (5) ordered x 2 -> 3
        // White M (3) ordered x 1 -> 2
        // Subtotal = 2 * 1199 + 1 * 999 = 2398 + 999 = 3397
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [
                { productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_black_xl", quantity: 2, price: 1199 },
                { productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_white_m", quantity: 1, price: 999 },
            ],
            total: 3397,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });

        const res = await createOrderRoute(req);
        const data = await res.json();
        assert.equal(res.status, 200);
        assert.equal(data.success, true);

        // Verify product document in Firestore
        const prodSnap = await adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).get();
        const prod = prodSnap.data();
        const blackXl = prod?.variants.find((v: any) => v.id === "var_black_xl");
        const whiteM = prod?.variants.find((v: any) => v.id === "var_white_m");

        assert.equal(blackXl.inventory, 3, "Black XL stock must be decremented from 5 to 3");
        assert.equal(whiteM.inventory, 2, "White M stock must be decremented from 3 to 2");
        assert.equal(prod?.inventory, 5, "Aggregate sellable inventory must be 3 + 2 = 5");

        // Verify single order created with both variant snapshots
        const orderSnap = await adminDb!.collection("orders").doc(data.id).get();
        assert.equal(orderSnap.exists, true);
        const orderData = orderSnap.data();
        assert.equal(orderData?.items.length, 2);
        assert.equal(orderData?.items[0].variantId, "var_black_xl");
        assert.equal(orderData?.items[0].sku, "TEE-BLACK-XL");
        assert.equal(orderData?.items[1].variantId, "var_white_m");
        assert.equal(orderData?.items[1].sku, "TEE-WHITE-M");
    });

    // -------------------------------------------------------------------------
    // TEST 2: Multiple quantities of the same variant
    // -------------------------------------------------------------------------
    it("VAR-INT-002: Multiple quantities of the same variant in a single line item", async () => {
        // Black XL (5) ordered x 4 -> 1
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [
                { productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_black_xl", quantity: 4, price: 1199 },
            ],
            total: 4796,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });

        const res = await createOrderRoute(req);
        assert.equal(res.status, 200);

        const prodSnap = await adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).get();
        const blackXl = prodSnap.data()?.variants.find((v: any) => v.id === "var_black_xl");
        assert.equal(blackXl.inventory, 1);
    });

    // -------------------------------------------------------------------------
    // TEST 3: Two lines containing the same variant with separate personalizations
    // -------------------------------------------------------------------------
    it("VAR-INT-003: Two lines containing the same variant aggregate deductions correctly", async () => {
        // Line 1: Black XL x 1 with "Custom Line A"
        // Line 2: Black XL x 2 with "Custom Line B"
        // Total deduction = 3. Stock 5 -> 2.
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [
                {
                    productId: MULTI_VARIANT_PRODUCT_ID,
                    variantId: "var_black_xl",
                    quantity: 1,
                    price: 1199,
                    customText: "Custom Line A",
                },
                {
                    productId: MULTI_VARIANT_PRODUCT_ID,
                    variantId: "var_black_xl",
                    quantity: 2,
                    price: 1199,
                    customText: "Custom Line B",
                },
            ],
            total: 3597,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });

        const res = await createOrderRoute(req);
        assert.equal(res.status, 200);

        const prodSnap = await adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).get();
        const blackXl = prodSnap.data()?.variants.find((v: any) => v.id === "var_black_xl");
        assert.equal(blackXl.inventory, 2, "Stock must be 5 - (1 + 2) = 2");
    });

    // -------------------------------------------------------------------------
    // TEST 4: Concurrent customers purchasing the same low-stock variant
    // -------------------------------------------------------------------------
    it("VAR-INT-004: Concurrent checkout on scarce variant (Stock = 1) prevents overselling", async () => {
        const payloadA = {
            userId: "cust_a",
            items: [{ productId: SCARCE_VARIANT_PRODUCT_ID, variantId: "var_scarce_black", quantity: 1, price: 799 }],
            total: 799,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: { ...SYNTHETIC_SHIPPING_ADDRESS, fullName: "Buyer A" },
        };
        const payloadB = {
            userId: "cust_b",
            items: [{ productId: SCARCE_VARIANT_PRODUCT_ID, variantId: "var_scarce_black", quantity: 1, price: 799 }],
            total: 799,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: { ...SYNTHETIC_SHIPPING_ADDRESS, fullName: "Buyer B" },
        };

        const [resA, resB] = await Promise.all([
            createOrderRoute(createJsonPostRequest("http://localhost:3000/api/orders/create", payloadA)),
            createOrderRoute(createJsonPostRequest("http://localhost:3000/api/orders/create", payloadB)),
        ]);

        const statuses = [resA.status, resB.status];
        assert.ok(statuses.includes(200), "One order must succeed");
        assert.ok(statuses.includes(400), "The conflicting order must fail with 400");

        const prodSnap = await adminDb!.collection("products").doc(SCARCE_VARIANT_PRODUCT_ID).get();
        const scarceVar = prodSnap.data()?.variants.find((v: any) => v.id === "var_scarce_black");
        assert.equal(scarceVar.inventory, 0, "Inventory must be 0, never negative");
    });

    // -------------------------------------------------------------------------
    // TEST 5: Concurrent customers purchasing different variants of the same product
    // -------------------------------------------------------------------------
    it("VAR-INT-005: Concurrent customers purchasing different variants do not overwrite each other", async () => {
        // Customer A buys Black XL (5 -> 4)
        // Customer B buys White M (3 -> 2)
        const payloadA = {
            userId: "cust_alice",
            items: [{ productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_black_xl", quantity: 1, price: 1199 }],
            total: 1199,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: { ...SYNTHETIC_SHIPPING_ADDRESS, fullName: "Alice" },
        };
        const payloadB = {
            userId: "cust_bob",
            items: [{ productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_white_m", quantity: 1, price: 999 }],
            total: 999,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: { ...SYNTHETIC_SHIPPING_ADDRESS, fullName: "Bob" },
        };

        const [resA, resB] = await Promise.all([
            createOrderRoute(createJsonPostRequest("http://localhost:3000/api/orders/create", payloadA)),
            createOrderRoute(createJsonPostRequest("http://localhost:3000/api/orders/create", payloadB)),
        ]);

        assert.equal(resA.status, 200);
        assert.equal(resB.status, 200);

        const prodSnap = await adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).get();
        const prod = prodSnap.data();
        const blackXl = prod?.variants.find((v: any) => v.id === "var_black_xl");
        const whiteM = prod?.variants.find((v: any) => v.id === "var_white_m");

        assert.equal(blackXl.inventory, 4, "Black XL must be 4");
        assert.equal(whiteM.inventory, 2, "White M must be 2");
        assert.equal(prod?.inventory, 6, "Total sellable inventory must be 4 + 2 = 6");
    });

    // -------------------------------------------------------------------------
    // TEST 6: Insufficient variant inventory: no order or inventory side effects
    // -------------------------------------------------------------------------
    it("VAR-INT-006: Insufficient variant inventory aborts with no side effects", async () => {
        // White M has stock 3; requesting 4
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_white_m", quantity: 4, price: 999 }],
            total: 3996,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });

        const res = await createOrderRoute(req);
        assert.equal(res.status, 400);

        // Verify stock is untouched
        const prodSnap = await adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).get();
        const whiteM = prodSnap.data()?.variants.find((v: any) => v.id === "var_white_m");
        assert.equal(whiteM.inventory, 3);

        // Verify no order document created
        const ordersSnap = await adminDb!.collection("orders").get();
        assert.equal(ordersSnap.size, 0);
    });

    // -------------------------------------------------------------------------
    // TEST 7: Variant price tampering
    // -------------------------------------------------------------------------
    it("VAR-INT-007: Variant price tampering rejected or recalculated strictly to authoritative price", async () => {
        // Client tampers with price (sends price: 10, total: 10 instead of 1199)
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_black_xl", quantity: 1, price: 10 }],
            total: 10, // Tampered total
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });

        const res = await createOrderRoute(req);
        const data = await res.json();
        // Server rejects due to order total mismatch against authoritative ₹1199
        assert.equal(res.status, 400);
        assert.ok(data.error.includes("Order total mismatch") || data.error.includes("1199"));
    });

    // -------------------------------------------------------------------------
    // TEST 8: Missing variantId on a variant-managed product
    // -------------------------------------------------------------------------
    it("VAR-INT-008: Missing variantId on variant-managed product is strictly rejected without generic fallback", async () => {
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: MULTI_VARIANT_PRODUCT_ID, quantity: 1 }],
            total: 999,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });

        const res = await createOrderRoute(req);
        const data = await res.json();
        assert.equal(res.status, 400);
        assert.ok(data.error.includes("missing variantId") || data.error.includes("variant selection"));
    });

    // -------------------------------------------------------------------------
    // TEST 9: Forged variantId belonging to a different product
    // -------------------------------------------------------------------------
    it("VAR-INT-009: Forged variantId from another product is strictly rejected", async () => {
        // Using var_scarce_black on MULTI_VARIANT_PRODUCT_ID
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_scarce_black", quantity: 1 }],
            total: 799,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });

        const res = await createOrderRoute(req);
        const data = await res.json();
        assert.equal(res.status, 400);
        assert.ok(data.error.includes("does not belong to product"));
    });

    // -------------------------------------------------------------------------
    // TEST 10: Disabled or deleted variant
    // -------------------------------------------------------------------------
    it("VAR-INT-010: Purchasing a disabled variant is strictly rejected", async () => {
        // var_disabled_blue_s has isActive: false
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_disabled_blue_s", quantity: 1, price: 899 }],
            total: 899,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });

        const res = await createOrderRoute(req);
        const data = await res.json();
        assert.equal(res.status, 400);
        assert.ok(data.error.includes("unavailable") || data.error.includes("inactive"));
    });

    // -------------------------------------------------------------------------
    // TEST 11: Saved cart containing an outdated variant
    // -------------------------------------------------------------------------
    it("VAR-INT-011: Outdated or deleted variant ID from saved cart is rejected with a clear error", async () => {
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_obsolete_id_999", quantity: 1 }],
            total: 999,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });

        const res = await createOrderRoute(req);
        assert.equal(res.status, 400);
    });

    // -------------------------------------------------------------------------
    // TEST 12: Razorpay order creation and correct amount calculation
    // -------------------------------------------------------------------------
    it("VAR-INT-012: Razorpay order creation uses authoritative variant pricing and reserves stock", async () => {
        // Black XL (₹1199) x 2 = ₹2398 -> 239800 paise
        const req = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_black_xl", quantity: 2 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });

        const res = await createRazorpayOrderRoute(req);
        const data = await res.json();
        assert.equal(res.status, 200);
        assert.equal(data.amount, 239800);
        assert.ok(data.id.startsWith("order_rzp_var_"));

        // Stock reserved: 5 -> 3
        const prodSnap = await adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).get();
        const blackXl = prodSnap.data()?.variants.find((v: any) => v.id === "var_black_xl");
        assert.equal(blackXl.inventory, 3);
    });

    // -------------------------------------------------------------------------
    // TEST 13: Duplicate payment verification or webhook events
    // -------------------------------------------------------------------------
    it("VAR-INT-013: Duplicate payment webhooks are idempotent and never double-decrement stock", async () => {
        // 1. Create prepaid order
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_black_xl", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();
        const rzpOrderId = orderData.id;

        // Stock was 5, now 4
        let prodSnap = await adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).get();
        assert.equal(prodSnap.data()?.variants.find((v: any) => v.id === "var_black_xl").inventory, 4);

        // 2. First Webhook: payment.captured
        const rawBody1 = JSON.stringify({
            event: "payment.captured",
            payload: {
                payment: {
                    entity: {
                        id: "pay_var_dup_1",
                        order_id: rzpOrderId,
                        amount: 119900,
                        currency: "INR",
                        status: "captured",
                    },
                },
            },
        });
        const sig1 = crypto.createHmac("sha256", mockWebhookSecret).update(rawBody1).digest("hex");
        const hookReq1 = createJsonPostRequest("http://localhost:3000/api/webhooks/razorpay", JSON.parse(rawBody1), {
            "x-razorpay-signature": sig1,
        });
        const hookRes1 = await webhookRoute(hookReq1);
        assert.equal(hookRes1.status, 200);

        // 3. Second Webhook: duplicate delivery of same event
        const hookReq2 = createJsonPostRequest("http://localhost:3000/api/webhooks/razorpay", JSON.parse(rawBody1), {
            "x-razorpay-signature": sig1,
        });
        const hookRes2 = await webhookRoute(hookReq2);
        assert.equal(hookRes2.status, 200);

        // Stock must STILL be 4 (never double-decremented to 3)
        prodSnap = await adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).get();
        assert.equal(prodSnap.data()?.variants.find((v: any) => v.id === "var_black_xl").inventory, 4);
    });

    // -------------------------------------------------------------------------
    // TEST 14: Expired reservation restoring the exact variant
    // -------------------------------------------------------------------------
    it("VAR-INT-014: Expired reservation restores the exact variant stock", async () => {
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_white_m", quantity: 2 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();
        const internalOrderId = orderData.internalOrderId;

        // Stock was 3, reserved 2 -> 1
        let prodSnap = await adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).get();
        assert.equal(prodSnap.data()?.variants.find((v: any) => v.id === "var_white_m").inventory, 1);

        // Release expired reservation
        const releaseRes = await releaseExpiredReservation(internalOrderId, adminDb!);
        assert.equal(releaseRes.released, true);

        // Stock restored back to 3
        prodSnap = await adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).get();
        assert.equal(prodSnap.data()?.variants.find((v: any) => v.id === "var_white_m").inventory, 3);
    });

    // -------------------------------------------------------------------------
    // TEST 15: Reservation release involving multiple variants of one product
    // -------------------------------------------------------------------------
    it("VAR-INT-015: Reservation release restores multiple variants of the same product safely", async () => {
        // Reserve Black XL x 2 and White M x 1
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [
                { productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_black_xl", quantity: 2 },
                { productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_white_m", quantity: 1 },
            ],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();
        const internalOrderId = orderData.internalOrderId;

        // Black XL is 3, White M is 2
        let prodSnap = await adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).get();
        assert.equal(prodSnap.data()?.variants.find((v: any) => v.id === "var_black_xl").inventory, 3);
        assert.equal(prodSnap.data()?.variants.find((v: any) => v.id === "var_white_m").inventory, 2);

        // Expiration release
        await releaseExpiredReservation(internalOrderId, adminDb!);

        // Both variants restored: Black XL back to 5, White M back to 3
        prodSnap = await adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).get();
        assert.equal(prodSnap.data()?.variants.find((v: any) => v.id === "var_black_xl").inventory, 5);
        assert.equal(prodSnap.data()?.variants.find((v: any) => v.id === "var_white_m").inventory, 3);
        assert.equal(prodSnap.data()?.inventory, 8);
    });

    // -------------------------------------------------------------------------
    // TEST 16: Late payment after reservation release
    // -------------------------------------------------------------------------
    it("VAR-INT-016: Late payment after release re-decrements if available or flags reconciliation without overselling", async () => {
        // Scarce item (Stock 1) reserved then released
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: SCARCE_VARIANT_PRODUCT_ID, variantId: "var_scarce_black", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();
        const internalOrderId = orderData.internalOrderId;
        const rzpOrderId = orderData.id;

        // Release reservation back to 1
        await releaseExpiredReservation(internalOrderId, adminDb!);

        // Another buyer purchases the scarce variant -> stock becomes 0
        await createOrderRoute(
            createJsonPostRequest("http://localhost:3000/api/orders/create", {
                items: [{ productId: SCARCE_VARIANT_PRODUCT_ID, variantId: "var_scarce_black", quantity: 1, price: 799 }],
                total: 799,
                paymentMethod: "COD",
                paymentStatus: "PENDING",
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            })
        );

        // Late payment arrives for original order
        const finalization = await finalizeOrderPayment(adminDb!, {
            razorpayOrderId: rzpOrderId,
            razorpayPaymentId: "pay_late_capture_var_016",
            amountPaise: 79900,
            currency: "INR",
            internalOrderId,
            source: "WEBHOOK",
        });

        // Must NOT oversell! Must be flagged for reconciliation
        assert.equal(finalization.reconciliationRequired, true);

        const prodSnap = await adminDb!.collection("products").doc(SCARCE_VARIANT_PRODUCT_ID).get();
        const scarceVar = prodSnap.data()?.variants.find((v: any) => v.id === "var_scarce_black");
        assert.equal(scarceVar.inventory, 0, "Inventory must remain 0 and not become negative");
    });

    // -------------------------------------------------------------------------
    // TEST 17: COD transaction with ordinary size/color variants
    // -------------------------------------------------------------------------
    it("VAR-INT-017: Ordinary size/color variants remain 100% eligible for Cash on Delivery", async () => {
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_black_xl", quantity: 1, price: 1199 }],
            total: 1199,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });

        const res = await createOrderRoute(req);
        const data = await res.json();
        assert.equal(res.status, 200);
        assert.equal(data.orderStatus, "Processing");
        assert.equal(data.paymentStatus, "PENDING");
    });

    // -------------------------------------------------------------------------
    // TEST 18: COD transaction with personalized variants
    // -------------------------------------------------------------------------
    it("VAR-INT-018: Personalized product with variants is strictly forbidden from Cash on Delivery", async () => {
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [
                {
                    productId: PERSONALIZED_VARIANT_PRODUCT_ID,
                    variantId: "var_cushion_small_blue",
                    quantity: 1,
                    price: 699,
                    isCustomized: true,
                },
            ],
            total: 699,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });

        const res = await createOrderRoute(req);
        const data = await res.json();
        assert.equal(res.status, 400);
        assert.equal(data.code, "COD_NOT_ALLOWED_CUSTOM_PRODUCT");
    });

    // -------------------------------------------------------------------------
    // TEST 19: Existing legacy product with no variant configuration
    // -------------------------------------------------------------------------
    it("VAR-INT-019: Legacy product with no variant configuration functions seamlessly", async () => {
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: LEGACY_PRODUCT_ID, quantity: 2, price: 1000 }],
            total: 2000,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });

        const res = await createOrderRoute(req);
        assert.equal(res.status, 200);

        const prodSnap = await adminDb!.collection("products").doc(LEGACY_PRODUCT_ID).get();
        assert.equal(prodSnap.data()?.inventory, 8); // 10 - 2
    });

    // -------------------------------------------------------------------------
    // TEST 20: Correct immutable variant details in the final order record
    // -------------------------------------------------------------------------
    it("VAR-INT-020: Final order record preserves immutable snapshot of variant details", async () => {
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_black_xl", quantity: 1, price: 1199 }],
            total: 1199,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });

        const res = await createOrderRoute(req);
        const data = await res.json();
        const orderSnap = await adminDb!.collection("orders").doc(data.id).get();
        const item = orderSnap.data()?.items[0];

        assert.equal(item.variantId, "var_black_xl");
        assert.equal(item.sku, "TEE-BLACK-XL");
        assert.equal(item.size, "XL");
        assert.equal(item.color, "Black");
        assert.equal(item.price, 1199);
        assert.equal(item.itemSubtotal, 1199);
    });

    // -------------------------------------------------------------------------
    // TEST 21: Coupon calculations based on authoritative variant prices
    // -------------------------------------------------------------------------
    it("VAR-INT-021: Coupons calculate discounts based on authoritative variant prices", async () => {
        // VALID10 gives 10% discount.
        // Variant price is 1199 -> subtotal 1199 -> 10% discount = 119.9 -> total = 1079.10
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_black_xl", quantity: 1, price: 1199 }],
            couponCode: "VALID10",
            total: 1079.1,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });

        const res = await createOrderRoute(req);
        const data = await res.json();
        assert.equal(res.status, 200);
        assert.equal(data.total, 1079.1);
    });

    // -------------------------------------------------------------------------
    // TEST 22: Admin modifications while an active reservation exists
    // -------------------------------------------------------------------------
    it("VAR-INT-022: Admin modifying or removing variants while reservation is active restores stock safely", async () => {
        // 1. Reserve White M (stock 3 -> 2)
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_white_m", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();
        const internalOrderId = orderData.internalOrderId;

        // 2. Admin edits product and removes var_white_m from variants array
        const prodRef = adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID);
        const prodSnap = await prodRef.get();
        const filteredVariants = prodSnap.data()?.variants.filter((v: any) => v.id !== "var_white_m");
        await prodRef.update({ variants: filteredVariants });

        // 3. Reservation expires and releases stock
        const releaseRes = await releaseExpiredReservation(internalOrderId, adminDb!);
        assert.equal(releaseRes.released, true);

        // 4. Stock must NOT be lost: var_white_m is safely restored into variants collection
        const updatedProdSnap = await prodRef.get();
        const restoredVariant = updatedProdSnap.data()?.variants.find((v: any) => v.id === "var_white_m");
        assert.ok(restoredVariant, "Orphaned variant must be preserved/restored upon reservation release");
        assert.equal(restoredVariant.inventory, 1, "Restored inventory unit must be accounted for");
        assert.equal(restoredVariant.isActive, false, "Restored variant must be inactive to prevent unexpected purchase");
    });

    // -------------------------------------------------------------------------
    // TEST 23: Reservation cleanup idempotency
    // -------------------------------------------------------------------------
    it("VAR-INT-023: Reservation cleanup job is idempotent across multiple executions", async () => {
        // Create an expired reservation
        const createReq = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", {
            items: [{ productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_black_xl", quantity: 1 }],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const createRes = await createRazorpayOrderRoute(createReq);
        const orderData = await createRes.json();
        const internalOrderId = orderData.internalOrderId;

        // Manually set expiration date to 1 hour ago
        const pastDate = new Date(Date.now() - 3600 * 1000);
        await adminDb!.collection("orders").doc(internalOrderId).update({
            reservationExpiresAt: pastDate,
        });

        // Run cleanup run 1
        const run1 = await runReservationCleanup(adminDb!, { now: new Date() });
        assert.equal(run1.released, 1);

        // Run cleanup run 2 (must be idempotent)
        const run2 = await runReservationCleanup(adminDb!, { now: new Date() });
        assert.equal(run2.released, 0);

        // Black XL stock must be restored to 5 (not double-incremented to 6)
        const prodSnap = await adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).get();
        const blackXl = prodSnap.data()?.variants.find((v: any) => v.id === "var_black_xl");
        assert.equal(blackXl.inventory, 5);
    });

    // -------------------------------------------------------------------------
    // TEST 24: Refund/cancellation stock-restoration policy
    // -------------------------------------------------------------------------
    it("VAR-INT-024: Order cancellation restores exact variant stock idempotently", async () => {
        // Place COD order for White M (stock 3 -> 2)
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            items: [{ productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_white_m", quantity: 1, price: 999 }],
            total: 999,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        });
        const res = await createOrderRoute(req);
        const data = await res.json();
        const orderId = data.id;

        let prodSnap = await adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).get();
        assert.equal(prodSnap.data()?.variants.find((v: any) => v.id === "var_white_m").inventory, 2);

        // Cancel order
        const cancelRes1 = await cancelOrder(adminDb!, orderId, { reason: "Customer request" });
        assert.equal(cancelRes1.success, true);

        // Stock restored back to 3
        prodSnap = await adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).get();
        assert.equal(prodSnap.data()?.variants.find((v: any) => v.id === "var_white_m").inventory, 3);

        // Second cancellation call is idempotent
        const cancelRes2 = await cancelOrder(adminDb!, orderId);
        assert.equal(cancelRes2.success, true);
        assert.equal(cancelRes2.duplicate, true);

        prodSnap = await adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).get();
        assert.equal(prodSnap.data()?.variants.find((v: any) => v.id === "var_white_m").inventory, 3);
    });

    // -------------------------------------------------------------------------
    // TEST 25: No negative inventory under concurrent transactions
    // -------------------------------------------------------------------------
    it("VAR-INT-025: High concurrency transactions prevent negative inventory under load", async () => {
        // White M has stock 3. Submit 5 concurrent orders requesting 1 unit each.
        // Exactly 3 must succeed, 2 must fail. Final stock must be exactly 0, never negative.
        const requests = Array.from({ length: 5 }, (_, i) => {
            return createOrderRoute(
                createJsonPostRequest("http://localhost:3000/api/orders/create", {
                    userId: `concurrent_user_${i}`,
                    items: [{ productId: MULTI_VARIANT_PRODUCT_ID, variantId: "var_white_m", quantity: 1, price: 999 }],
                    total: 999,
                    paymentMethod: "COD",
                    paymentStatus: "PENDING",
                    shippingAddress: { ...SYNTHETIC_SHIPPING_ADDRESS, fullName: `User ${i}` },
                })
            );
        });

        const responses = await Promise.all(requests);
        const successCount = responses.filter((r) => r.status === 200).length;
        const failCount = responses.filter((r) => r.status === 400).length;

        assert.equal(successCount, 3, "Exactly 3 orders should succeed for 3 available units");
        assert.equal(failCount, 2, "Remaining 2 orders should fail with 400");

        const prodSnap = await adminDb!.collection("products").doc(MULTI_VARIANT_PRODUCT_ID).get();
        const whiteM = prodSnap.data()?.variants.find((v: any) => v.id === "var_white_m");
        assert.equal(whiteM.inventory, 0, "Inventory must be exactly 0, never negative");
    });
});
