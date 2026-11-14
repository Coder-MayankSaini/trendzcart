/**
 * Winter Collection Availability Lifecycle Integration Tests (TASK 037)
 *
 * Runs against the Firebase Emulator Suite.
 * Validates:
 * 1. Root cause reproduction: hasVariants=true with variants=[] fails checkout validation cleanly.
 * 2. Variant repair lifecycle: populated variants allow seamless checkout, stock deduction, and reservation.
 * 3. Simple product (hasVariants=false) availability lifecycle.
 * 4. Zero stock variant checkout rejection.
 * 5. Concurrent checkout stock integrity on variant products.
 */

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Razorpay from "razorpay";
import { POST as createOrderRoute } from "../../src/app/api/orders/create/route.ts";
import { adminDb } from "../../src/lib/firebase/admin.ts";
import {
    clearCollection,
    seedEmulatorDatabase,
    createJsonPostRequest,
} from "./testHelper.ts";
import { SYNTHETIC_SHIPPING_ADDRESS } from "../fixtures/orders.ts";

describe("Winter Collection Availability Lifecycle Integration Tests (TASK 037)", () => {
    let mockOrderCounter = 9000;

    const CORRUPT_WINTER_PRODUCT_ID = "winter-prod-corrupt-empty-variants";
    const REPAIRED_WINTER_PRODUCT_ID = "winter-prod-repaired-variants";
    const SIMPLE_WINTER_PRODUCT_ID = "winter-prod-simple-in-stock";
    const ZERO_STOCK_WINTER_PRODUCT_ID = "winter-prod-zero-stock";

    before(() => {
        process.env.COMMERCIAL_CHECKOUT_ENABLED = "true";
        process.env.RAZORPAY_KEY_ID = "rzp_test_winter_037";
        process.env.RAZORPAY_KEY_SECRET = "mockSecretWinter037";

        const dummy = new Razorpay({ key_id: "rzp_test_mock", key_secret: "mock" });
        const apiProto = Object.getPrototypeOf(dummy.api);
        apiProto.post = async function (params: any) {
            mockOrderCounter++;
            return {
                id: `order_rzp_wtr_${mockOrderCounter}`,
                currency: params.data?.currency || "INR",
                amount: params.data?.amount || 0,
                receipt: params.data?.receipt,
                notes: params.data?.notes,
                ...params.data,
            };
        };
    });

    beforeEach(async () => {
        if (!adminDb) throw new Error("adminDb is not initialized");
        await clearCollection(adminDb, "orders");
        await seedEmulatorDatabase(adminDb);

        // Seed representative Winter Collection test fixtures
        // 1. Corrupt state replicating exact production defect: hasVariants=true, variants=[]
        await adminDb.collection("products").doc(CORRUPT_WINTER_PRODUCT_ID).set({
            name: "Men's Premium Grey Bomber Jacket (Production State)",
            price: 750,
            compareAtPrice: 6999,
            inventory: 10,
            hasVariants: true,
            variants: [], // Empty variants array
            sizesList: ["S", "M", "L", "XL", "XXL"],
            isVisible: true,
            category: "Winter Special",
            categoryId: "ace36311-21a9-43ce-b377-e7a0852d3fd1",
        });

        // 2. Repaired state with complete variant matrix
        await adminDb.collection("products").doc(REPAIRED_WINTER_PRODUCT_ID).set({
            name: "Men's Premium Black Sherpa Fur-Lined Winter Jacket",
            price: 1400,
            compareAtPrice: 7888,
            inventory: 10,
            totalPhysicalInventory: 10,
            hasVariants: true,
            variants: [
                { id: "var-s", sizeId: "size-s", sizeName: "S", sku: "SHERPA-BLK-S", price: 1400, inventory: 3, isActive: true },
                { id: "var-m", sizeId: "size-m", sizeName: "M", sku: "SHERPA-BLK-M", price: 1400, inventory: 4, isActive: true },
                { id: "var-l", sizeId: "size-l", sizeName: "L", sku: "SHERPA-BLK-L", price: 1400, inventory: 3, isActive: true },
                { id: "var-xl", sizeId: "size-xl", sizeName: "XL", sku: "SHERPA-BLK-XL", price: 1400, inventory: 0, isActive: true }, // Out of stock
            ],
            sizesList: ["S", "M", "L", "XL"],
            isVisible: true,
            category: "Winter Special",
            categoryId: "ace36311-21a9-43ce-b377-e7a0852d3fd1",
        });

        // 3. Simple Winter product (hasVariants=false)
        await adminDb.collection("products").doc(SIMPLE_WINTER_PRODUCT_ID).set({
            name: "Winter Warm Woolen Beanie",
            price: 299,
            compareAtPrice: 999,
            inventory: 20,
            hasVariants: false,
            isVisible: true,
            category: "Winter Special",
            categoryId: "ace36311-21a9-43ce-b377-e7a0852d3fd1",
        });

        // 4. Zero stock winter product
        await adminDb.collection("products").doc(ZERO_STOCK_WINTER_PRODUCT_ID).set({
            name: "Sold Out Winter Gloves",
            price: 199,
            inventory: 0,
            hasVariants: false,
            isVisible: true,
            category: "Winter Special",
            categoryId: "ace36311-21a9-43ce-b377-e7a0852d3fd1",
        });
    });

    // -------------------------------------------------------------------------
    // TEST 1: Replicating Production Root Cause Rejection
    // -------------------------------------------------------------------------
    it("WINTER-001: Product with hasVariants=true and empty variants[] is strictly rejected by server checkout", async () => {
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            customer: {
                name: "Rahul Sharma",
                phone: "9876543210",
                email: "rahul@example.com",
            },
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            paymentMethod: "COD",
            items: [
                {
                    productId: CORRUPT_WINTER_PRODUCT_ID,
                    quantity: 1,
                    price: 750,
                },
            ],
        });

        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 400);
        assert.ok(data.error.includes("is configured for variants but has no valid variants configured"));
    });

    // -------------------------------------------------------------------------
    // TEST 2: Repaired Variant Product Allows Successful Checkout
    // -------------------------------------------------------------------------
    it("WINTER-002: Repaired variant product allows valid checkout and decrements variant stock", async () => {
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            customer: {
                name: "Vikram Malhotra",
                phone: "9876543211",
                email: "vikram@example.com",
            },
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            paymentMethod: "COD",
            items: [
                {
                    productId: REPAIRED_WINTER_PRODUCT_ID,
                    variantId: "var-m",
                    quantity: 2,
                    price: 1400,
                },
            ],
        });

        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.success, true);
        assert.ok(data.id);

        // Verify variant stock was deducted in Firestore
        const docSnap = await adminDb!.collection("products").doc(REPAIRED_WINTER_PRODUCT_ID).get();
        const productData = docSnap.data();
        const updatedVarM = productData?.variants?.find((v: any) => v.id === "var-m");
        assert.equal(updatedVarM.inventory, 2); // 4 - 2 = 2
    });

    // -------------------------------------------------------------------------
    // TEST 3: Out-of-Stock Variant Strictly Rejected
    // -------------------------------------------------------------------------
    it("WINTER-003: Out-of-stock variant (inventory 0) is rejected with 400", async () => {
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            customer: {
                name: "Amit Patel",
                phone: "9876543212",
                email: "amit@example.com",
            },
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            paymentMethod: "COD",
            items: [
                {
                    productId: REPAIRED_WINTER_PRODUCT_ID,
                    variantId: "var-xl", // inventory: 0
                    quantity: 1,
                    price: 1400,
                },
            ],
        });

        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 400);
        assert.ok(data.error.includes("Insufficient stock"));
    });

    // -------------------------------------------------------------------------
    // TEST 4: Simple In-Stock Product Checkout Succeeded
    // -------------------------------------------------------------------------
    it("WINTER-004: Simple in-stock product successfully checks out and decrements root inventory", async () => {
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            customer: {
                name: "Pooja Verma",
                phone: "9876543213",
                email: "pooja@example.com",
            },
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            paymentMethod: "COD",
            items: [
                {
                    productId: SIMPLE_WINTER_PRODUCT_ID,
                    quantity: 3,
                    price: 299,
                },
            ],
        });

        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.success, true);
        assert.ok(data.id);

        // Verify root inventory deducted
        const docSnap = await adminDb!.collection("products").doc(SIMPLE_WINTER_PRODUCT_ID).get();
        assert.equal(docSnap.data()?.inventory, 17); // 20 - 3 = 17
    });

    // -------------------------------------------------------------------------
    // TEST 5: Zero-Stock Simple Product Rejection
    // -------------------------------------------------------------------------
    it("WINTER-005: Zero-stock simple product is rejected during checkout", async () => {
        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", {
            customer: {
                name: "Deepak Joshi",
                phone: "9876543214",
                email: "deepak@example.com",
            },
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            paymentMethod: "COD",
            items: [
                {
                    productId: ZERO_STOCK_WINTER_PRODUCT_ID,
                    quantity: 1,
                    price: 199,
                },
            ],
        });

        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 400);
        assert.ok(data.error.includes("Insufficient stock"));
    });

    // -------------------------------------------------------------------------
    // TEST 6: Concurrent Checkout Inventory Integrity
    // -------------------------------------------------------------------------
    it("WINTER-006: Concurrent checkout requests on limited variant inventory prevent overselling", async () => {
        // var-s has 3 units in stock. Fire 4 concurrent requests of 1 unit each. Exactly 3 must succeed, 1 must fail.
        const makeRequest = (buyerName: string) =>
            createJsonPostRequest("http://localhost:3000/api/orders/create", {
                customer: {
                    name: buyerName,
                    phone: "9876543215",
                    email: `${buyerName.toLowerCase().replace(/ /g, "")}@example.com`,
                },
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
                paymentMethod: "COD",
                items: [
                    {
                        productId: REPAIRED_WINTER_PRODUCT_ID,
                        variantId: "var-s",
                        quantity: 1,
                        price: 1400,
                    },
                ],
            });

        const responses = await Promise.all([
            createOrderRoute(makeRequest("Buyer 1")),
            createOrderRoute(makeRequest("Buyer 2")),
            createOrderRoute(makeRequest("Buyer 3")),
            createOrderRoute(makeRequest("Buyer 4")),
        ]);

        const statuses = responses.map(r => r.status);
        const successes = statuses.filter(s => s === 200).length;
        const failures = statuses.filter(s => s === 400).length;

        assert.equal(successes, 3, "Exactly 3 requests should succeed");
        assert.equal(failures, 1, "Exactly 1 request should fail with stock exhaustion");

        // Verify remaining stock is exactly 0
        const docSnap = await adminDb!.collection("products").doc(REPAIRED_WINTER_PRODUCT_ID).get();
        const updatedVarS = docSnap.data()?.variants?.find((v: any) => v.id === "var-s");
        assert.equal(updatedVarS.inventory, 0);
    });
});
