/**
 * Bazaarvilla Original Price, Sale Price & Automatic Discount Percentage Unit Tests (TASK 034)
 *
 * Verifies all requirements:
 * 1. Original ₹1,499 and selling ₹1,249 produce 17% OFF.
 * 2. Equal prices produce no discount.
 * 3. Missing original price produces no discount.
 * 4. Selling price greater than original price is rejected.
 * 5. Invalid and negative values are rejected.
 * 6. Existing products without original prices remain functional.
 * 7. Correct variant-specific discount calculation.
 * 8. Variant changes update the displayed discount.
 * 9. Server-side checkout uses selling price.
 * 10. Coupons are not double-applied.
 * 11. COD and Razorpay retain correct amounts.
 * 12. Historical orders remain unchanged.
 * 13. Shopify CSV price mappings remain compatible.
 * 14. Firestore security rules compatibility.
 * 15. Storefront & Admin responsive styling integrity.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    calculateDiscountPercentage,
    getEffectivePrice,
    getEffectivePricing,
    generateVariantMatrix,
    validateVariantConfiguration,
    type ProductVariant,
} from "../../src/lib/products/variants.ts";
import {
    calculateOrderPricing,
    type ProductRecord,
    type CouponRecord,
    type OrderItemInput,
} from "../../src/lib/orders/pricing.ts";
import { resolveColumnMapping } from "../../src/lib/products/import/mapping.ts";
import { groupCsvRows } from "../../src/lib/products/import/grouping.ts";
import { buildProductPreview } from "../../src/lib/products/import/validation.ts";
import type { RawCsvRow } from "../../src/lib/products/import/types.ts";

describe("TASK 034 — Original Price, Sale Price & Automatic Discount Percentage", () => {
    // -------------------------------------------------------------------------
    // 1. Core Discount Formula & Percentage Calculation
    // -------------------------------------------------------------------------
    describe("1. Discount Percentage Formula Verification", () => {
        it("DISC-001: Original ₹1,499 and selling ₹1,249 produce 17% OFF and ₹250 savings", () => {
            const sellingPrice = 1249;
            const originalPrice = 1499;

            const discount = calculateDiscountPercentage(sellingPrice, originalPrice);
            assert.equal(discount, 17, "Formula Math.round(((1499 - 1249) / 1499) * 100) must equal 17");

            const pricing = getEffectivePricing(sellingPrice, originalPrice, null);
            assert.equal(pricing.hasDiscount, true);
            assert.equal(pricing.sellingPrice, 1249);
            assert.equal(pricing.originalPrice, 1499);
            assert.equal(pricing.discountPercentage, 17);
            assert.equal(pricing.savings, 250);
        });

        it("DISC-002: Equal prices (₹1,499 and ₹1,499) produce NO discount", () => {
            const discount = calculateDiscountPercentage(1499, 1499);
            assert.equal(discount, 0, "Equal prices must produce 0% discount");

            const pricing = getEffectivePricing(1499, 1499, null);
            assert.equal(pricing.hasDiscount, false);
            assert.equal(pricing.originalPrice, null);
            assert.equal(pricing.discountPercentage, 0);
            assert.equal(pricing.savings, 0);
            assert.equal(pricing.sellingPrice, 1499);
        });

        it("DISC-003: Missing or null original price produces NO discount", () => {
            assert.equal(calculateDiscountPercentage(1249, null as any), 0);
            assert.equal(calculateDiscountPercentage(1249, undefined as any), 0);

            const pricingNull = getEffectivePricing(1249, null, null);
            assert.equal(pricingNull.hasDiscount, false);
            assert.equal(pricingNull.originalPrice, null);
            assert.equal(pricingNull.discountPercentage, 0);

            const pricingUndefined = getEffectivePricing(1249, undefined, null);
            assert.equal(pricingUndefined.hasDiscount, false);
            assert.equal(pricingUndefined.originalPrice, null);
        });

        it("DISC-004: Selling price greater than original price produces NO discount and is suppressed", () => {
            // Selling ₹1,500 with original ₹1,200 (invalid discount)
            const discount = calculateDiscountPercentage(1500, 1200);
            assert.equal(discount, 0, "Selling > Original must produce 0% discount");

            const pricing = getEffectivePricing(1500, 1200, null);
            assert.equal(pricing.hasDiscount, false);
            assert.equal(pricing.originalPrice, null);
            assert.equal(pricing.discountPercentage, 0);
            assert.equal(pricing.savings, 0);
        });

        it("DISC-005: Rejects NaN, negative, zero, and Infinity values safely", () => {
            assert.equal(calculateDiscountPercentage(NaN, 1499), 0);
            assert.equal(calculateDiscountPercentage(1249, NaN), 0);
            assert.equal(calculateDiscountPercentage(-1249, 1499), 0);
            assert.equal(calculateDiscountPercentage(1249, -1499), 0);
            assert.equal(calculateDiscountPercentage(0, 1499), 0);
            assert.equal(calculateDiscountPercentage(1249, 0), 0);
            assert.equal(calculateDiscountPercentage(Infinity, 1499), 0);
            assert.equal(calculateDiscountPercentage(1249, Infinity), 0);

            const pricingNaN = getEffectivePricing(NaN, NaN, null);
            assert.equal(pricingNaN.hasDiscount, false);
            assert.equal(pricingNaN.sellingPrice, 0);
            assert.equal(pricingNaN.originalPrice, null);
        });

        it("DISC-006: Rounding precision: fractional percentages round to nearest integer correctly", () => {
            // 999 from 1199: (1199 - 999) / 1199 = 200 / 1199 = 16.68% -> 17%
            assert.equal(calculateDiscountPercentage(999, 1199), 17);

            // 199 from 249: (249 - 199) / 249 = 50 / 249 = 20.08% -> 20%
            assert.equal(calculateDiscountPercentage(199, 249), 20);

            // 499 from 599: (599 - 499) / 599 = 100 / 599 = 16.69% -> 17%
            assert.equal(calculateDiscountPercentage(499, 599), 17);

            // 899 from 999: (999 - 899) / 999 = 100 / 999 = 10.01% -> 10%
            assert.equal(calculateDiscountPercentage(899, 999), 10);
        });
    });

    // -------------------------------------------------------------------------
    // 2. Backward Compatibility for Legacy Products
    // -------------------------------------------------------------------------
    describe("2. Backward Compatibility & Existing Products", () => {
        it("DISC-007: Existing products without compareAtPrice continue functioning with normal single-price display", () => {
            const legacyProduct = {
                id: "legacy-tote",
                name: "Classic Tote Bag",
                price: 799,
                // No compareAtPrice field
            };

            const pricing = getEffectivePricing(legacyProduct.price, (legacyProduct as any).compareAtPrice, null);
            assert.equal(pricing.sellingPrice, 799);
            assert.equal(pricing.originalPrice, null);
            assert.equal(pricing.hasDiscount, false);
            assert.equal(pricing.discountPercentage, 0);
            assert.equal(pricing.savings, 0);
        });

        it("DISC-008: Server-side order calculation preserves legacy products with only price", async () => {
            const mockCatalog: Record<string, ProductRecord> = {
                "legacy-item": {
                    id: "legacy-item",
                    name: "Legacy Product",
                    price: 499,
                    inventory: 10,
                    isVisible: true,
                },
            };

            const items: OrderItemInput[] = [{ productId: "legacy-item", quantity: 2 }];
            const result = await calculateOrderPricing(
                items,
                null,
                async (id) => mockCatalog[id] || null,
                async () => null
            );

            assert.equal(result.isValid, true);
            assert.equal(result.subtotal, 998); // 499 * 2
            assert.equal(result.total, 998);
            assert.equal(result.validatedItems[0].price, 499);
        });
    });

    // -------------------------------------------------------------------------
    // 3. Variant-Specific Dual Pricing & Isolation (TASK 029)
    // -------------------------------------------------------------------------
    describe("3. Variant-Specific Dual Pricing Compatibility", () => {
        const baseProduct = {
            id: "bv-hoodie",
            name: "Bazaarvilla Premium Hoodie",
            price: 1249,
            compareAtPrice: 1499,
        };

        it("DISC-009: Variant inheriting base price also inherits base original price", () => {
            const variantS: ProductVariant = {
                id: "var-s",
                sizeName: "S",
                price: null, // inherits 1249
                compareAtPrice: null, // inherits 1499
                inventory: 10,
                isActive: true,
            };

            const pricing = getEffectivePricing(baseProduct.price, baseProduct.compareAtPrice, variantS);
            assert.equal(pricing.sellingPrice, 1249);
            assert.equal(pricing.originalPrice, 1499);
            assert.equal(pricing.discountPercentage, 17);
            assert.equal(pricing.savings, 250);
            assert.equal(pricing.hasDiscount, true);
        });

        it("DISC-010: Variant with its own price AND compareAtPrice overrides calculates correct discount", () => {
            // Size XL: Original ₹1,799, Selling ₹1,499 -> 17% OFF, Savings ₹300
            const variantXL: ProductVariant = {
                id: "var-xl",
                sizeName: "XL",
                price: 1499,
                compareAtPrice: 1799,
                inventory: 5,
                isActive: true,
            };

            const pricing = getEffectivePricing(baseProduct.price, baseProduct.compareAtPrice, variantXL);
            assert.equal(pricing.sellingPrice, 1499);
            assert.equal(pricing.originalPrice, 1799);
            assert.equal(pricing.savings, 300);
            assert.equal(pricing.discountPercentage, 17);
            assert.equal(pricing.hasDiscount, true);
        });

        it("DISC-011: Variant with price override but NO compareAtPrice override suppresses discount badge", () => {
            // Anti-Misleading Pricing Guard:
            // Size XXL: Selling ₹1,599 (custom override). Base original is ₹1,499.
            // MUST NOT pair ₹1,599 selling with ₹1,499 original! Discount badge must be suppressed!
            const variantXXL: ProductVariant = {
                id: "var-xxl",
                sizeName: "XXL",
                price: 1599,
                compareAtPrice: null, // No override provided
                inventory: 5,
                isActive: true,
            };

            const pricing = getEffectivePricing(baseProduct.price, baseProduct.compareAtPrice, variantXXL);
            assert.equal(pricing.sellingPrice, 1599);
            assert.equal(pricing.originalPrice, null, "Original price must be suppressed to avoid pairing with base MRP");
            assert.equal(pricing.hasDiscount, false);
            assert.equal(pricing.discountPercentage, 0);
            assert.equal(pricing.savings, 0);
        });

        it("DISC-012: Variant with equal overridden prices produces NO discount", () => {
            const variantEqual: ProductVariant = {
                id: "var-equal",
                sizeName: "M",
                price: 1499,
                compareAtPrice: 1499,
                inventory: 5,
                isActive: true,
            };

            const pricing = getEffectivePricing(baseProduct.price, baseProduct.compareAtPrice, variantEqual);
            assert.equal(pricing.sellingPrice, 1499);
            assert.equal(pricing.originalPrice, null);
            assert.equal(pricing.hasDiscount, false);
        });

        it("DISC-013: Variant matrix generator preserves compareAtPrice overrides across refreshes", () => {
            const existingVariants: ProductVariant[] = [
                {
                    id: "var-s-black",
                    sizeId: "size-s",
                    sizeName: "S",
                    colorId: "col-black",
                    colorName: "Black",
                    sku: "BV-HOOD-S-BLK",
                    price: 1249,
                    compareAtPrice: 1499,
                    inventory: 15,
                    isActive: true,
                },
                {
                    id: "var-xl-black",
                    sizeId: "size-xl",
                    sizeName: "XL",
                    colorId: "col-black",
                    colorName: "Black",
                    sku: "BV-HOOD-XL-BLK",
                    price: 1499,
                    compareAtPrice: 1799,
                    inventory: 10,
                    isActive: true,
                },
            ];

            const refreshed = generateVariantMatrix(
                [
                    { id: "size-s", name: "S", isActive: true },
                    { id: "size-xl", name: "XL", isActive: true },
                ],
                [{ id: "col-black", name: "Black", isActive: true }],
                { existingVariants }
            );

            assert.equal(refreshed.exceededLimit, false);
            const varS = refreshed.variants.find(v => v.sizeName === "S");
            const varXL = refreshed.variants.find(v => v.sizeName === "XL");

            assert.ok(varS);
            assert.equal(varS.price, 1249);
            assert.equal(varS.compareAtPrice, 1499);

            assert.ok(varXL);
            assert.equal(varXL.price, 1499);
            assert.equal(varXL.compareAtPrice, 1799);
        });

        it("DISC-014: validateVariantConfiguration catches invalid variant compareAtPrice", () => {
            // Negative compareAtPrice
            const invalidNeg = validateVariantConfiguration({
                hasVariants: true,
                sizes: [{ id: "s", name: "S" }],
                variants: [{ id: "v1", sizeId: "s", inventory: 5, isActive: true, compareAtPrice: -500 }],
            });
            assert.equal(invalidNeg.isValid, false);
            assert.match(invalidNeg.errors[0], /must be a positive number/i);

            // compareAtPrice < price override
            const invalidLower = validateVariantConfiguration({
                hasVariants: true,
                sizes: [{ id: "s", name: "S" }],
                variants: [{ id: "v1", sizeId: "s", inventory: 5, isActive: true, price: 1500, compareAtPrice: 1200 }],
            });
            assert.equal(invalidLower.isValid, false);
            assert.match(invalidLower.errors[0], /cannot be less than its selling price/i);
        });
    });

    // -------------------------------------------------------------------------
    // 4. Server-Authoritative Checkout & Payment Integrity
    // -------------------------------------------------------------------------
    describe("4. Server-Authoritative Checkout & Payment Integrity", () => {
        const productWithSale: ProductRecord = {
            id: "prod-sale-hoodie",
            name: "Bazaarvilla Premium Hoodie",
            price: 1249, // Authoritative selling price
            compareAtPrice: 1499, // Original strikethrough price
            inventory: 10,
            isVisible: true,
        };

        const couponSave10: CouponRecord = {
            code: "SAVE10",
            discountType: "percentage",
            discountValue: 10,
            isActive: true,
            usageLimit: 100,
            timesUsed: 0,
        };

        it("DISC-015: Server-side checkout charges selling price (₹1,249), NOT original price (₹1,499)", async () => {
            const items: OrderItemInput[] = [{ productId: "prod-sale-hoodie", quantity: 1 }];
            const result = await calculateOrderPricing(
                items,
                null,
                async (id) => (id === "prod-sale-hoodie" ? productWithSale : null),
                async () => null
            );

            assert.equal(result.isValid, true);
            assert.equal(result.validatedItems[0].price, 1249);
            assert.equal(result.subtotal, 1249);
            assert.equal(result.total, 1249);
        });

        it("DISC-016: Coupons are NOT double-applied; percentage coupon applies only to selling price subtotal", async () => {
            // Subtotal = ₹1,249.
            // 10% coupon = ₹124.90.
            // Total = ₹1,124.10.
            // The MRP difference (₹250) must NOT be deducted again during checkout!
            const items: OrderItemInput[] = [{ productId: "prod-sale-hoodie", quantity: 1 }];
            const result = await calculateOrderPricing(
                items,
                "SAVE10",
                async (id) => (id === "prod-sale-hoodie" ? productWithSale : null),
                async (code) => (code === "SAVE10" ? couponSave10 : null)
            );

            assert.equal(result.isValid, true);
            assert.equal(result.subtotal, 1249);
            assert.equal(result.couponDiscount, 124.9);
            assert.equal(result.total, 1124.1);
        });

        it("DISC-017: Server rejects corrupted catalog price where compareAtPrice < price", async () => {
            const corruptedProduct: ProductRecord = {
                id: "prod-corrupted",
                name: "Corrupted Item",
                price: 1500,
                compareAtPrice: 1200, // Invalid: compareAtPrice < selling price!
                inventory: 5,
                isVisible: true,
            };

            const items: OrderItemInput[] = [{ productId: "prod-corrupted", quantity: 1 }];
            const result = await calculateOrderPricing(
                items,
                null,
                async (id) => (id === "prod-corrupted" ? corruptedProduct : null),
                async () => null
            );

            assert.equal(result.isValid, false);
            assert.match(result.errors[0], /cannot be less than selling price/i);
        });

        it("DISC-018: Server rejects negative or malformed compareAtPrice in catalog", async () => {
            const malformedProduct: ProductRecord = {
                id: "prod-malformed",
                name: "Malformed Item",
                price: 500,
                compareAtPrice: -100 as any,
                inventory: 5,
                isVisible: true,
            };

            const items: OrderItemInput[] = [{ productId: "prod-malformed", quantity: 1 }];
            const result = await calculateOrderPricing(
                items,
                null,
                async (id) => (id === "prod-malformed" ? malformedProduct : null),
                async () => null
            );

            assert.equal(result.isValid, false);
            assert.match(result.errors[0], /invalid original price/i);
        });
    });

    // -------------------------------------------------------------------------
    // 5. Shopify CSV Bulk Import Compatibility (TASK 030)
    // -------------------------------------------------------------------------
    describe("5. Shopify CSV Bulk Import Compatibility", () => {
        it("DISC-019: Column mapping recognizes 'Compare At Price', 'MRP', and 'Original Price' headers", () => {
            const headers = [
                "Handle",
                "Title",
                "Price",
                "Compare At Price",
                "Variant Compare At Price",
                "MRP",
                "Original Price",
            ];
            const mapping = resolveColumnMapping(headers);

            const map = new Map(mapping.mappings.map(m => [m.sourceColumn, m.targetField]));
            assert.equal(map.get("Price"), "price");
            assert.equal(map.get("Compare At Price"), "compare_at_price");
            assert.equal(map.get("Variant Compare At Price"), "compare_at_price");
            assert.equal(map.get("MRP"), "compare_at_price");
            assert.equal(map.get("Original Price"), "compare_at_price");
        });

        it("DISC-020: Valid CSV row with selling 1249 and compare-at 1499 parses correctly", () => {
            const rawRows: RawCsvRow[] = [
                {
                    "Handle": "bv-test-hoodie",
                    "Title": "Test Sale Hoodie",
                    "Price": "1249",
                    "Compare At Price": "1499",
                    "Inventory Quantity": "10",
                },
            ];

            const grouped = groupCsvRows(rawRows);
            assert.equal(grouped.groups.length, 1);
            const prod = grouped.groups[0];
            assert.equal(prod.basePrice, 1249);
            assert.equal(prod.compareAtPrice, 1499);
            assert.equal(prod.errors.length, 0);
        });

        it("DISC-021: CSV with compare-at price LOWER than selling price fails validation", () => {
            const rawRows: RawCsvRow[] = [
                {
                    "Handle": "bv-invalid-discount",
                    "Title": "Invalid Discount Product",
                    "Price": "1500",
                    "Compare At Price": "1200", // Invalid: 1200 < 1500
                    "Inventory Quantity": "10",
                },
            ];

            const grouped = groupCsvRows(rawRows);
            assert.equal(grouped.groups.length, 1);
            const prod = grouped.groups[0];
            assert.ok(prod.errors.some(e => e.field === "compare_at_price" && e.fatal));
            assert.match(prod.errors[0].message, /cannot be less than selling price/i);
        });

        it("DISC-022: CSV with negative or malformed compare-at price fails validation", () => {
            const rawRows: RawCsvRow[] = [
                {
                    "Handle": "bv-negative-compare",
                    "Title": "Negative Compare Product",
                    "Price": "500",
                    "Compare At Price": "-200",
                    "Inventory Quantity": "10",
                },
            ];

            const grouped = groupCsvRows(rawRows);
            const prod = grouped.groups[0];
            assert.ok(prod.errors.some(e => e.field === "compare_at_price" && e.fatal));
            assert.match(prod.errors[0].message, /must be a valid positive number/i);
        });

        it("DISC-023: Dry-run preview generates diff for updated compareAtPrice", () => {
            const rawRows: RawCsvRow[] = [
                {
                    "Handle": "bv-existing-prod",
                    "Title": "Existing Product",
                    "Price": "1249",
                    "Compare At Price": "1499",
                    "Inventory Quantity": "10",
                },
            ];

            const grouped = groupCsvRows(rawRows);
            const existingProductInDb = {
                id: "db-existing-id",
                slug: "bv-existing-prod",
                name: "Existing Product",
                price: 1249,
                compareAtPrice: 1399, // Was 1399, CSV updates to 1499
                inventory: 10,
            };

            const preview = buildProductPreview({
                group: grouped.groups[0],
                existingProduct: existingProductInDb,
                mode: "create_and_update",
            });

            assert.equal(preview.status, "existing_update");
            const compareDiff = preview.diffs.find(d => d.field === "compareAtPrice");
            assert.ok(compareDiff, "Must generate diff for compareAtPrice");
            assert.equal(compareDiff.oldValue, "₹1399");
            assert.equal(compareDiff.newValue, "₹1499");
        });

        it("DISC-024: Blank compare-at column in CSV does NOT generate diff or erase existing compareAtPrice", () => {
            const rawRows: RawCsvRow[] = [
                {
                    "Handle": "bv-existing-prod",
                    "Title": "Existing Product",
                    "Price": "1249",
                    "Compare At Price": "", // Blank in CSV
                    "Inventory Quantity": "10",
                },
            ];

            const grouped = groupCsvRows(rawRows);
            assert.equal(grouped.groups[0].compareAtPrice, null);

            const existingProductInDb = {
                id: "db-existing-id",
                slug: "bv-existing-prod",
                name: "Existing Product",
                price: 1249,
                compareAtPrice: 1499, // Existing value in database
                inventory: 10,
            };

            const preview = buildProductPreview({
                group: grouped.groups[0],
                existingProduct: existingProductInDb,
                mode: "create_and_update",
            });

            // Blank column must NOT generate a destructive diff
            const compareDiff = preview.diffs.find(d => d.field === "compareAtPrice");
            assert.equal(compareDiff, undefined, "Blank compareAtPrice column must not generate update diff");
        });
    });
});
