/**
 * Comprehensive Pricing Lifecycle End-to-End Integration Tests (TASK 034)
 *
 * Executed against Firebase Emulator Suite. Covers:
 * 1. Product Persistence (dual pricing, legacy compatibility, authoritative server validation)
 * 2. Variant-Specific Pricing (variant overrides, discount updates, cart preservation, server checkout, mispairing suppression)
 * 3. Complete Checkout Pricing Test (subtotals from selling price, no MRP double-discounting, coupon integration, client anti-tampering, COD & Razorpay amounts, immutable snapshots)
 * 4. Shopify CSV Compatibility (selling and compare-at import, variant compare-at, single-field updates, non-destructive blanks, invalid discount rejection, dry-run diffs & confirmation gates)
 */

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Razorpay from "razorpay";
import { POST as createOrderRoute } from "../../src/app/api/orders/create/route.ts";
import { POST as createRazorpayOrderRoute } from "../../src/app/api/razorpay/create-order/route.ts";
import { POST as previewRoute } from "../../src/app/api/admin/products/import/preview/route.ts";
import { POST as commitRoute } from "../../src/app/api/admin/products/import/commit/route.ts";
import { adminDb, adminAuth } from "../../src/lib/firebase/admin.ts";
import {
    getEffectivePricing,
    calculateDiscountPercentage,
} from "../../src/lib/products/variants.ts";
import { calculateOrderPricing } from "../../src/lib/orders/pricing.ts";
import {
    clearCollection,
    seedEmulatorDatabase,
    createJsonPostRequest,
    getSyntheticUserAuthToken,
} from "./testHelper.ts";
import { SYNTHETIC_SHIPPING_ADDRESS } from "../fixtures/orders.ts";

describe("Pricing Lifecycle & Financial Integrity E2E Integration Tests (TASK 034)", () => {
    const adminUid = "admin_pricing_e2e_034";
    let adminToken: string;
    let capturedRazorpayOrder: any = null;

    before(async () => {
        if (!adminDb || !adminAuth) {
            throw new Error("adminDb/adminAuth is not initialized. Ensure Firebase emulator is running.");
        }

        // Setup Razorpay mock interceptor
        process.env.COMMERCIAL_CHECKOUT_ENABLED = "true";
        process.env.RAZORPAY_KEY_ID = "rzp_test_pricing_e2e";
        process.env.RAZORPAY_KEY_SECRET = "mockSecretPricingE2E";

        const dummy = new Razorpay({ key_id: "rzp_test_mock", key_secret: "mock" });
        const apiProto = Object.getPrototypeOf(dummy.api);
        apiProto.post = async function (params: any) {
            capturedRazorpayOrder = params.data;
            return {
                id: "order_rzp_pricing_" + Date.now(),
                currency: params.data?.currency || "INR",
                amount: params.data?.amount || 0,
                receipt: params.data?.receipt,
                notes: params.data?.notes,
                ...params.data,
            };
        };

        // Create or update admin user for CSV import tests
        try { await adminAuth.deleteUser(adminUid); } catch {}
        await adminAuth.createUser({
            uid: adminUid,
            email: "admin_pricing_e2e@bazaarvilla.test",
            displayName: "Pricing Administrator",
        });
        await adminAuth.setCustomUserClaims(adminUid, { admin: true });
        adminToken = await getSyntheticUserAuthToken(adminUid);
    });

    beforeEach(async () => {
        capturedRazorpayOrder = null;
        await clearCollection(adminDb!, "orders");
        await seedEmulatorDatabase(adminDb!);
    });

    // =========================================================================
    // SECTION 1: Product Persistence
    // =========================================================================
    describe("1. Product Persistence & Schema Compatibility", () => {
        it("PERSIST-001: Persists selling price ₹1,249 and original price ₹1,499 correctly in Firestore", async () => {
            const productId = "prod-dual-price-persist";
            const productData = {
                id: productId,
                name: "Dual Price Verification Hoodie",
                slug: "dual-price-verification-hoodie",
                price: 1249,
                compareAtPrice: 1499,
                inventory: 50,
                category: "Apparel",
                isVisible: true,
                isCustomized: false,
                hasVariants: false,
                createdAt: Date.now(),
            };

            await adminDb!.collection("products").doc(productId).set(productData);

            // Reload from Firestore
            const snapshot = await adminDb!.collection("products").doc(productId).get();
            assert.equal(snapshot.exists, true);
            const saved = snapshot.data()!;
            assert.equal(saved.price, 1249, "Selling price must persist as 1249");
            assert.equal(saved.compareAtPrice, 1499, "Original price must persist as 1499");

            // Verify effective pricing calculation
            const effective = getEffectivePricing(saved.price, saved.compareAtPrice);
            assert.equal(effective.sellingPrice, 1249);
            assert.equal(effective.originalPrice, 1499);
            assert.equal(effective.discountPercentage, 17);
            assert.equal(effective.savings, 250);
            assert.equal(effective.hasDiscount, true);
        });

        it("PERSIST-002: Edits existing legacy product and preserves single price without compareAtPrice", async () => {
            // Existing legacy product seeded by testHelper: prod-hoodie-1000 has price: 1000
            const legacyId = "prod-hoodie-1000";
            const beforeSnap = await adminDb!.collection("products").doc(legacyId).get();
            assert.equal(beforeSnap.exists, true);
            assert.equal(beforeSnap.data()?.price, 1000);
            assert.equal(beforeSnap.data()?.compareAtPrice, undefined);

            // Edit product description and title, saving without compareAtPrice
            await adminDb!.collection("products").doc(legacyId).update({
                name: "Updated Legacy Cotton Hoodie",
                description: "Updated description preserving legacy schema.",
            });

            // Reload from Firestore
            const afterSnap = await adminDb!.collection("products").doc(legacyId).get();
            const updated = afterSnap.data()!;
            assert.equal(updated.name, "Updated Legacy Cotton Hoodie");
            assert.equal(updated.price, 1000, "Selling price must remain unchanged");
            assert.equal(updated.compareAtPrice, undefined, "compareAtPrice must remain absent");

            // Effective pricing must produce single price without discount badge
            const effective = getEffectivePricing(updated.price, updated.compareAtPrice);
            assert.equal(effective.sellingPrice, 1000);
            assert.equal(effective.originalPrice, null);
            assert.equal(effective.discountPercentage, 0);
            assert.equal(effective.savings, 0);
            assert.equal(effective.hasDiscount, false);
        });

        it("PERSIST-003: Rejects invalid original/selling price combinations via authoritative server validation", async () => {
            // 1. compareAtPrice < price is strictly rejected
            const res1 = await calculateOrderPricing(
                [{ productId: "prod-invalid-1", quantity: 1 }],
                null,
                async () => ({ id: "prod-invalid-1", name: "Invalid", price: 1500, compareAtPrice: 1200 }),
                async () => null
            );
            assert.equal(res1.isValid, false);
            assert.ok(res1.errors.some(e => /cannot be less than selling price/i.test(e)));

            // 2. Negative compareAtPrice is strictly rejected
            const res2 = await calculateOrderPricing(
                [{ productId: "prod-invalid-2", quantity: 1 }],
                null,
                async () => ({ id: "prod-invalid-2", name: "Negative Compare", price: 1000, compareAtPrice: -500 }),
                async () => null
            );
            assert.equal(res2.isValid, false);
            assert.ok(res2.errors.some(e => /invalid original price/i.test(e)));

            // 3. Negative selling price is strictly rejected
            const res3 = await calculateOrderPricing(
                [{ productId: "prod-invalid-3", quantity: 1 }],
                null,
                async () => ({ id: "prod-invalid-3", name: "Negative Price", price: -100 }),
                async () => null
            );
            assert.equal(res3.isValid, false);
            assert.ok(res3.errors.some(e => /invalid catalog price/i.test(e)));
        });
    });

    // =========================================================================
    // SECTION 2: Variant-Specific Pricing
    // =========================================================================
    describe("2. Variant-Specific Pricing Compatibility (TASK 029)", () => {
        const variantProdId = "prod-variant-pricing-e2e";

        beforeEach(async () => {
            // Seed multi-variant product with distinct variant prices
            await adminDb!.collection("products").doc(variantProdId).set({
                id: variantProdId,
                name: "Multi-Price Variant Polo Shirt",
                slug: "multi-price-variant-polo-shirt",
                price: 1249, // Base selling price
                compareAtPrice: 1499, // Base original price (17% OFF)
                inventory: 65,
                category: "Apparel",
                isVisible: true,
                isCustomized: false,
                hasVariants: true,
                sizeMode: "apparel",
                sizesList: [
                    { id: "size-s", name: "S", isActive: true },
                    { id: "size-xl", name: "XL", isActive: true },
                    { id: "size-xxl", name: "XXL", isActive: true },
                ],
                colors: [{ id: "col-navy", name: "Navy Blue", hex: "#000080", isActive: true }],
                variants: [
                    {
                        id: "var-s-navy",
                        sizeId: "size-s",
                        sizeName: "S",
                        colorId: "col-navy",
                        colorName: "Navy Blue",
                        sku: "POLO-S-NVY",
                        price: 1249,
                        compareAtPrice: 1499,
                        inventory: 25,
                        isActive: true,
                    },
                    {
                        id: "var-xl-navy",
                        sizeId: "size-xl",
                        sizeName: "XL",
                        colorId: "col-navy",
                        colorName: "Navy Blue",
                        sku: "POLO-XL-NVY",
                        price: 1499,
                        compareAtPrice: 1799,
                        inventory: 20,
                        isActive: true,
                    },
                    {
                        id: "var-xxl-navy",
                        sizeId: "size-xxl",
                        sizeName: "XXL",
                        colorId: "col-navy",
                        colorName: "Navy Blue",
                        sku: "POLO-XXL-NVY",
                        price: 1699, // Custom price override, but NO compareAtPrice override
                        compareAtPrice: null,
                        inventory: 20,
                        isActive: true,
                    },
                ],
                createdAt: Date.now(),
            });
        });

        it("VAR-INT-001: Preserves variant selling and original prices independently in Firestore", async () => {
            const snap = await adminDb!.collection("products").doc(variantProdId).get();
            assert.equal(snap.exists, true);
            const data = snap.data()!;
            assert.equal(data.variants.length, 3);

            const vS = data.variants.find((v: any) => v.id === "var-s-navy");
            assert.equal(vS.price, 1249);
            assert.equal(vS.compareAtPrice, 1499);
            assert.equal(vS.inventory, 25);

            const vXL = data.variants.find((v: any) => v.id === "var-xl-navy");
            assert.equal(vXL.price, 1499);
            assert.equal(vXL.compareAtPrice, 1799);
            assert.equal(vXL.inventory, 20);

            const vXXL = data.variants.find((v: any) => v.id === "var-xxl-navy");
            assert.equal(vXXL.price, 1699);
            assert.equal(vXXL.compareAtPrice, null);
        });

        it("VAR-INT-002: Dynamic variant switching recalculates prices, percentage, and suppresses mispaired discounts", async () => {
            const snap = await adminDb!.collection("products").doc(variantProdId).get();
            const data = snap.data()!;
            const basePrice = data.price;
            const baseCompare = data.compareAtPrice;

            // 1. Variant S (1249 / 1499) -> 17% OFF, ₹250 savings
            const pricingS = getEffectivePricing(basePrice, baseCompare, data.variants[0]);
            assert.equal(pricingS.sellingPrice, 1249);
            assert.equal(pricingS.originalPrice, 1499);
            assert.equal(pricingS.discountPercentage, 17);
            assert.equal(pricingS.savings, 250);
            assert.equal(pricingS.hasDiscount, true);

            // 2. Variant XL (1499 / 1799) -> 17% OFF, ₹300 savings
            const pricingXL = getEffectivePricing(basePrice, baseCompare, data.variants[1]);
            assert.equal(pricingXL.sellingPrice, 1499);
            assert.equal(pricingXL.originalPrice, 1799);
            assert.equal(pricingXL.discountPercentage, 17);
            assert.equal(pricingXL.savings, 300);
            assert.equal(pricingXL.hasDiscount, true);

            // 3. Variant XXL (1699 / null): Custom price override differing from base price, but NO compare-at price
            // CRITICAL GUARD: Must NEVER pair with base original price (1499), which would be lower than 1699!
            const pricingXXL = getEffectivePricing(basePrice, baseCompare, data.variants[2]);
            assert.equal(pricingXXL.sellingPrice, 1699);
            assert.equal(pricingXXL.originalPrice, null, "Must suppress original price to prevent misleading discount");
            assert.equal(pricingXXL.discountPercentage, 0);
            assert.equal(pricingXXL.savings, 0);
            assert.equal(pricingXXL.hasDiscount, false);
        });

        it("VAR-INT-003: Server-side checkout independently charges the variant's selling price and decrements variant stock", async () => {
            // Order 1 unit of Size XL (Selling price ₹1,499)
            const payload = {
                items: [
                    {
                        productId: variantProdId,
                        variantId: "var-xl-navy",
                        price: 9999, // Tampered client price (must be ignored)
                        quantity: 1,
                    },
                ],
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
                paymentMethod: "COD",
            };

            const req = createJsonPostRequest("http://localhost/api/orders/create", payload);
            const res = await createOrderRoute(req);
            assert.equal(res.status, 200);
            const data = await res.json();

            // Order must be charged ₹1,499 (variant selling price), NOT base price (1249) or compareAtPrice (1799)
            assert.equal(data.total, 1499);

            // Inspect persisted order snapshot
            const orderDoc = await adminDb!.collection("orders").doc(data.id).get();
            assert.equal(orderDoc.exists, true);
            const order = orderDoc.data()!;
            assert.equal(order.subtotal, 1499);
            assert.equal(order.total, 1499);
            assert.equal(order.items[0].price, 1499);
            assert.equal(order.items[0].variantId, "var-xl-navy");

            // Verify variant stock decremented from 20 to 19
            const prodSnap = await adminDb!.collection("products").doc(variantProdId).get();
            const updatedVarXL = prodSnap.data()!.variants.find((v: any) => v.id === "var-xl-navy");
            assert.equal(updatedVarXL.inventory, 19);

            // Variant S stock remains untouched (25)
            const updatedVarS = prodSnap.data()!.variants.find((v: any) => v.id === "var-s-navy");
            assert.equal(updatedVarS.inventory, 25);
        });
    });

    // =========================================================================
    // SECTION 3: Complete Checkout Pricing Test
    // =========================================================================
    describe("3. Complete Checkout Pricing Test & Financial Invariants", () => {
        const testProdId = "prod-pricing-e2e-item";

        beforeEach(async () => {
            // Original: ₹1,499, Selling: ₹1,249, Inventory: 50
            await adminDb!.collection("products").doc(testProdId).set({
                id: testProdId,
                name: "Pricing E2E Test Jacket",
                slug: "pricing-e2e-test-jacket",
                price: 1249,
                compareAtPrice: 1499,
                inventory: 50,
                category: "Apparel",
                isVisible: true,
                isCustomized: false,
                hasVariants: false,
                createdAt: Date.now(),
            });
        });

        it("CHECKOUT-001: Item subtotal for quantity 2 is strictly ₹2,498 (2 × ₹1,249), NOT ₹2,998", async () => {
            const payload = {
                items: [
                    {
                        productId: testProdId,
                        quantity: 2,
                    },
                ],
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
                paymentMethod: "COD",
            };

            const req = createJsonPostRequest("http://localhost/api/orders/create", payload);
            const res = await createOrderRoute(req);
            assert.equal(res.status, 200);
            const data = await res.json();

            // Authoritative server check: 2 * 1249 = 2498 (NOT 2 * 1499 = 2998)
            assert.equal(data.total, 2498, "Total must strictly be ₹2,498");

            const orderDoc = await adminDb!.collection("orders").doc(data.id).get();
            assert.equal(orderDoc.exists, true);
            assert.equal(orderDoc.data()?.subtotal, 2498, "Persisted subtotal must strictly be ₹2,498");
            assert.equal(orderDoc.data()?.total, 2498, "Persisted total must strictly be ₹2,498");
        });

        it("CHECKOUT-002: Coupons apply strictly against selling price; MRP discount is NEVER applied twice", async () => {
            // FLAT200 coupon seeded by testHelper gives ₹200 off orders >= ₹500
            const payload = {
                items: [
                    {
                        productId: testProdId,
                        quantity: 2, // Selling subtotal: ₹2,498 (Catalog already saved 2 × ₹250 = ₹500)
                    },
                ],
                couponCode: "FLAT200",
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
                paymentMethod: "COD",
            };

            const req = createJsonPostRequest("http://localhost/api/orders/create", payload);
            const res = await createOrderRoute(req);
            assert.equal(res.status, 200);
            const data = await res.json();

            assert.equal(data.total, 2298, "Total must be ₹2,498 - ₹200 = ₹2,298");

            const orderDoc = await adminDb!.collection("orders").doc(data.id).get();
            assert.equal(orderDoc.exists, true);
            assert.equal(orderDoc.data()?.subtotal, 2498, "Persisted subtotal must be ₹2,498");
            assert.equal(orderDoc.data()?.discount, 200, "Persisted discount must be ₹200");
            assert.equal(orderDoc.data()?.couponDiscount, 200, "Persisted couponDiscount must be ₹200");
            assert.equal(orderDoc.data()?.total, 2298, "Persisted total must be ₹2,298");
        });

        it("CHECKOUT-003: Client price tampering is completely ignored; charges authoritative database price", async () => {
            // Case A: Attacker attempts to forge price: 1 and total: 2 -> Server strictly rejects with 400
            const forgedTotalPayload = {
                items: [
                    {
                        productId: testProdId,
                        price: 1, // Malicious price
                        compareAtPrice: 1,
                        quantity: 2,
                    },
                ],
                subtotal: 2, // Malicious subtotal
                total: 2, // Malicious total
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
                paymentMethod: "COD",
            };

            const reqForged = createJsonPostRequest("http://localhost/api/orders/create", forgedTotalPayload);
            const resForged = await createOrderRoute(reqForged);
            assert.equal(resForged.status, 400, "Must reject tampered client total with HTTP 400");
            const errData = await resForged.json();
            assert.match(errData.error, /Order total mismatch/i);

            // Case B: Attacker submits price: 1 on items without forged total -> Server calculates strictly from DB: ₹2,498
            const forgedItemPayload = {
                items: [
                    {
                        productId: testProdId,
                        price: 1, // Malicious price
                        compareAtPrice: 1,
                        quantity: 2,
                    },
                ],
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
                paymentMethod: "COD",
            };

            const reqItem = createJsonPostRequest("http://localhost/api/orders/create", forgedItemPayload);
            const resItem = await createOrderRoute(reqItem);
            assert.equal(resItem.status, 200);
            const orderData = await resItem.json();
            assert.equal(orderData.total, 2498, "Server must charge database selling price ₹2,498, ignoring client price");
        });

        it("CHECKOUT-004: Razorpay test-mode order creates gateway order in paise from selling price (249800 paise)", async () => {
            const payload = {
                items: [
                    {
                        productId: testProdId,
                        quantity: 2,
                    },
                ],
                couponCode: null,
                receipt: "rcpt-pricing-e2e-rzp",
            };

            const req = createJsonPostRequest("http://localhost/api/razorpay/create-order", payload);
            const res = await createRazorpayOrderRoute(req);
            assert.equal(res.status, 200);
            const data = await res.json();

            // 2 units * ₹1,249 = ₹2,498 = 249800 paise
            assert.equal(data.amount, 249800, "Paise amount must strictly match selling price (249800)");
            assert.equal(capturedRazorpayOrder?.amount, 249800);
        });

        it("CHECKOUT-005: Order pricing snapshot remains immutable when product prices are subsequently updated", async () => {
            // 1. Create order for 1 unit at ₹1,249
            const createReq = createJsonPostRequest("http://localhost/api/orders/create", {
                items: [{ productId: testProdId, quantity: 1 }],
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
                paymentMethod: "COD",
            });
            const createRes = await createOrderRoute(createReq);
            assert.equal(createRes.status, 200);
            const orderData = await createRes.json();
            const orderId = orderData.id;
            assert.ok(orderId, "Order creation must return valid ID");

            // 2. Administrator updates live product in Firestore to higher prices
            await adminDb!.collection("products").doc(testProdId).update({
                price: 1999,
                compareAtPrice: 2499,
            });

            // 3. Reload historical order from Firestore
            const historicalDoc = await adminDb!.collection("orders").doc(orderId).get();
            assert.equal(historicalDoc.exists, true);
            const historicalOrder = historicalDoc.data()!;

            // Pricing snapshot in historical order must remain 1249
            assert.equal(historicalOrder.items[0].price, 1249, "Historical item price must not change");
            assert.equal(historicalOrder.subtotal, 1249, "Historical subtotal must not change");
            assert.equal(historicalOrder.total, 1249, "Historical total must not change");
        });
    });

    // =========================================================================
    // SECTION 4: Shopify CSV Compatibility
    // =========================================================================
    describe("4. Shopify CSV Compatibility (TASK 030)", () => {
        it("CSV-001: Imports simple product containing selling and compare-at prices", async () => {
            const csv = `Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Variant Price,Variant Compare At Price,Variant Inventory Qty,Image Src
csv-hoodie-034,"CSV Imported Hoodie","<p>Warm hoodie.</p>",Bazaarvilla,Apparel,"hoodie, winter",false,Title,Default Title,1249,1499,30,https://example.com/hoodie.jpg
`;
            // Preview
            const prevRes = await previewRoute(
                createJsonPostRequest(
                    "http://localhost/api/admin/products/import/preview",
                    { csvText: csv },
                    { Authorization: `Bearer ${adminToken}` }
                )
            );
            assert.equal(prevRes.status, 200);
            const prevData = await prevRes.json();
            assert.equal(prevData.success, true);
            assert.equal(prevData.previewSummary.totalProducts, 1);

            // Commit
            const commitRes = await commitRoute(
                createJsonPostRequest(
                    "http://localhost/api/admin/products/import/commit",
                    {
                        batchId: prevData.batchId,
                        fileChecksum: prevData.fileChecksum,
                        confirmations: { confirmedNotice: true },
                    },
                    { Authorization: `Bearer ${adminToken}` }
                )
            );
            assert.equal(commitRes.status, 200);

            // Verify in Firestore
            const snap = await adminDb!.collection("products").where("slug", "==", "csv-hoodie-034").get();
            assert.equal(snap.empty, false);
            const imported = snap.docs[0].data();
            assert.equal(imported.price, 1249);
            assert.equal(imported.compareAtPrice, 1499);
        });

        it("CSV-002: Imports variant-specific comparison prices across multiple rows", async () => {
            const csv = `Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Variant Price,Variant Compare At Price,Variant Inventory Qty,Variant SKU,Image Src
csv-tee-multi,"Multi Variant CSV Tee","<p>Cotton Tee.</p>",Bazaarvilla,Apparel,"tee",false,Size,S,1249,1499,20,CSV-TEE-S,https://example.com/tee-s.jpg
csv-tee-multi,"Multi Variant CSV Tee","<p>Cotton Tee.</p>",Bazaarvilla,Apparel,"tee",false,Size,XL,1499,1799,15,CSV-TEE-XL,https://example.com/tee-xl.jpg
`;
            const prevRes = await previewRoute(
                createJsonPostRequest(
                    "http://localhost/api/admin/products/import/preview",
                    { csvText: csv },
                    { Authorization: `Bearer ${adminToken}` }
                )
            );
            const prevData = await prevRes.json();

            const commitRes = await commitRoute(
                createJsonPostRequest(
                    "http://localhost/api/admin/products/import/commit",
                    {
                        batchId: prevData.batchId,
                        fileChecksum: prevData.fileChecksum,
                        confirmations: { confirmedNotice: true },
                    },
                    { Authorization: `Bearer ${adminToken}` }
                )
            );
            assert.equal(commitRes.status, 200);

            const snap = await adminDb!.collection("products").where("slug", "==", "csv-tee-multi").get();
            assert.equal(snap.empty, false);
            const imported = snap.docs[0].data();
            assert.equal(imported.hasVariants, true);
            assert.equal(imported.variants.length, 2);

            const vS = imported.variants.find((v: any) => v.sizeName === "S" || v.sizeLabel === "S");
            assert.ok(vS, "Variant S must exist");
            assert.equal(vS.price, 1249);
            assert.equal(vS.compareAtPrice, 1499);

            const vXL = imported.variants.find((v: any) => v.sizeName === "XL" || v.sizeLabel === "XL");
            assert.ok(vXL, "Variant XL must exist");
            assert.equal(vXL.price, 1499);
            assert.equal(vXL.compareAtPrice, 1799);
        });

        it("CSV-003: Updating only selling price with blank compare-at preserves existing compareAtPrice", async () => {
            // Existing product created in CSV-001 has price: 1249, compareAtPrice: 1499
            // Update CSV has Price: 1299, Compare At Price: "" (blank)
            const csv = `Handle,Title,Price,Compare At Price
csv-hoodie-034,"CSV Imported Hoodie",1299,
`;
            const prevRes = await previewRoute(
                createJsonPostRequest(
                    "http://localhost/api/admin/products/import/preview",
                    { csvText: csv },
                    { Authorization: `Bearer ${adminToken}` }
                )
            );
            const prevData = await prevRes.json();

            // Price change requires confirmation
            assert.ok(prevData.previewSummary.priceChangeCount > 0, "Price changes must be flagged in preview");

            const commitRes = await commitRoute(
                createJsonPostRequest(
                    "http://localhost/api/admin/products/import/commit",
                    {
                        batchId: prevData.batchId,
                        fileChecksum: prevData.fileChecksum,
                        confirmations: {
                            confirmedNotice: true,
                            confirmPriceChanges: true,
                            confirmExistingProductUpdates: true,
                        },
                    },
                    { Authorization: `Bearer ${adminToken}` }
                )
            );
            assert.equal(commitRes.status, 200);

            // Verify live product in Firestore: price updated to 1299, compareAtPrice retained as 1499
            const snap = await adminDb!.collection("products").where("slug", "==", "csv-hoodie-034").get();
            const updated = snap.docs[0].data();
            assert.equal(updated.price, 1299, "Selling price must update to 1299");
            assert.equal(updated.compareAtPrice, 1499, "Blank compare-at column must preserve existing 1499");
        });

        it("CSV-004: Updating only comparison price updates compareAtPrice while preserving price", async () => {
            // Update CSV has Price: 1299, Compare At Price: 1699
            const csv = `Handle,Title,Price,Compare At Price
csv-hoodie-034,"CSV Imported Hoodie",1299,1699
`;
            const prevRes = await previewRoute(
                createJsonPostRequest(
                    "http://localhost/api/admin/products/import/preview",
                    { csvText: csv },
                    { Authorization: `Bearer ${adminToken}` }
                )
            );
            const prevData = await prevRes.json();

            const commitRes = await commitRoute(
                createJsonPostRequest(
                    "http://localhost/api/admin/products/import/commit",
                    {
                        batchId: prevData.batchId,
                        fileChecksum: prevData.fileChecksum,
                        confirmations: {
                            confirmedNotice: true,
                            confirmPriceChanges: true,
                            confirmExistingProductUpdates: true,
                        },
                    },
                    { Authorization: `Bearer ${adminToken}` }
                )
            );
            assert.equal(commitRes.status, 200);

            const snap = await adminDb!.collection("products").where("slug", "==", "csv-hoodie-034").get();
            const updated = snap.docs[0].data();
            assert.equal(updated.price, 1299);
            assert.equal(updated.compareAtPrice, 1699, "compareAtPrice must update to 1699");
        });

        it("CSV-005: Rejects invalid discount combination (Compare At Price < Price) in dry-run preview", async () => {
            const csv = `Handle,Title,Price,Compare At Price
csv-invalid-discount,"Invalid Discount Tee",1500,1200
`;
            const prevRes = await previewRoute(
                createJsonPostRequest(
                    "http://localhost/api/admin/products/import/preview",
                    { csvText: csv },
                    { Authorization: `Bearer ${adminToken}` }
                )
            );
            const prevData = await prevRes.json();

            // Preview must report validation error and block execution
            assert.equal(prevData.previewSummary.errorCount > 0, true);
            assert.equal(prevData.previewSummary.canProceedWithImport, false);
            assert.ok(
                prevData.previewSummary.productPreviews[0].errors.some(
                    (err: any) => err.field === "compare_at_price" && /cannot be less than selling price/i.test(err.message)
                ),
                "Must report error that compare_at_price cannot be less than selling price"
            );
        });
    });
});
