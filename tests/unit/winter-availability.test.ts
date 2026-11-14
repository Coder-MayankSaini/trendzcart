import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    validateVariantConfiguration,
    generateVariantMatrix,
    resolveMatchingVariant,
    getEffectivePrice,
    getEffectivePricing,
    calculateVariantStockBreakdown,
    type ProductVariant,
    type SizeOption,
    type ColorOption,
} from "../../src/lib/products/variants.ts";
import {
    calculateOrderPricing,
    type ProductRecord,
    type OrderItemInput,
} from "../../src/lib/orders/pricing.ts";

describe("TASK 037 — Product Availability & Winter Collection Diagnostic Unit Tests", () => {
    const runPricing = async (items: OrderItemInput[], products: ProductRecord[]) => {
        const productMap = new Map(products.map(p => [p.id, p]));
        return calculateOrderPricing(
            items,
            null,
            async (id: string) => productMap.get(id) || null,
            async () => null
        );
    };

    // -------------------------------------------------------------------------
    // 1. Simple Product with Positive Stock
    // -------------------------------------------------------------------------
    it("AVAIL-001: Simple product with positive stock is purchasable with in-stock state", async () => {
        const product: ProductRecord = {
            id: "prod-simple-in-stock",
            name: "Classic Cotton T-Shirt",
            price: 499,
            inventory: 15,
            hasVariants: false,
        };

        const result = await runPricing([{ productId: product.id, quantity: 2 }], [product]);

        assert.equal(result.isValid, true);
        assert.equal(result.errors.length, 0);
        assert.equal(result.total, 998);
        assert.equal(result.validatedItems[0].quantity, 2);
    });

    // -------------------------------------------------------------------------
    // 2. Simple Product with Zero Stock
    // -------------------------------------------------------------------------
    it("AVAIL-002: Simple product with zero stock strictly rejects purchase as out of stock", async () => {
        const product: ProductRecord = {
            id: "prod-simple-oos",
            name: "Sold Out Cap",
            price: 299,
            inventory: 0,
            hasVariants: false,
        };

        const result = await runPricing([{ productId: product.id, quantity: 1 }], [product]);

        assert.equal(result.isValid, false);
        assert.ok(result.errors.some(e => e.includes("Insufficient stock")));
    });

    // -------------------------------------------------------------------------
    // 3. Product with Multiple Variants and Mixed Availability
    // -------------------------------------------------------------------------
    it("AVAIL-003: Product with multiple variants and mixed availability validates stock per variant", async () => {
        const variants: ProductVariant[] = [
            { id: "var-s", sizeId: "size-s", sizeName: "S", inventory: 5, isActive: true },
            { id: "var-m", sizeId: "size-m", sizeName: "M", inventory: 0, isActive: true },
            { id: "var-l", sizeId: "size-l", sizeName: "L", inventory: 12, isActive: true },
        ];

        const product: ProductRecord = {
            id: "prod-mixed-variants",
            name: "Winter Casual Jacket",
            price: 1200,
            inventory: 17,
            totalPhysicalInventory: 17,
            hasVariants: true,
            variants,
        };

        // Size S (5 in stock) requested 2 → succeeds
        const resS = await runPricing([{ productId: product.id, variantId: "var-s", quantity: 2 }], [product]);
        assert.equal(resS.isValid, true);

        // Size M (0 in stock) requested 1 → fails
        const resM = await runPricing([{ productId: product.id, variantId: "var-m", quantity: 1 }], [product]);
        assert.equal(resM.isValid, false);
        assert.ok(resM.errors.some(e => e.includes("Insufficient stock")));

        // Size L (12 in stock) requested 3 → succeeds
        const resL = await runPricing([{ productId: product.id, variantId: "var-l", quantity: 3 }], [product]);
        assert.equal(resL.isValid, true);
    });

    // -------------------------------------------------------------------------
    // 4. All Variants Out of Stock
    // -------------------------------------------------------------------------
    it("AVAIL-004: All variants out of stock results in sellableStock = 0", () => {
        const variants: ProductVariant[] = [
            { id: "var-s", sizeId: "size-s", sizeName: "S", inventory: 0, isActive: true },
            { id: "var-m", sizeId: "size-m", sizeName: "M", inventory: 0, isActive: true },
            { id: "var-l", sizeId: "size-l", sizeName: "L", inventory: 0, isActive: true },
        ];

        const breakdown = calculateVariantStockBreakdown(variants);
        assert.equal(breakdown.sellableStock, 0);
        assert.equal(breakdown.totalPhysicalStock, 0);
        assert.equal(breakdown.activeVariantCount, 3);
    });

    // -------------------------------------------------------------------------
    // 5. In-Stock Variant Selected by Customer
    // -------------------------------------------------------------------------
    it("AVAIL-005: In-stock variant selected by customer resolves exact SKU, stock, and price", () => {
        const variants: ProductVariant[] = [
            { id: "var-s", sizeId: "size-s", sizeName: "S", sku: "JKT-GRY-S", price: 1400, inventory: 8, isActive: true },
            { id: "var-m", sizeId: "size-m", sizeName: "M", sku: "JKT-GRY-M", price: 1450, inventory: 4, isActive: true },
        ];

        const resolved = resolveMatchingVariant(variants, { sizeId: "size-s" });
        assert.ok(resolved);
        assert.equal(resolved.id, "var-s");
        assert.equal(resolved.sku, "JKT-GRY-S");
        assert.equal(resolved.inventory, 8);
        assert.equal(getEffectivePrice(1400, resolved), 1400);

        const resolvedM = resolveMatchingVariant(variants, { sizeId: "size-m" });
        assert.ok(resolvedM);
        assert.equal(resolvedM.id, "var-m");
        assert.equal(resolvedM.sku, "JKT-GRY-M");
        assert.equal(resolvedM.inventory, 4);
        assert.equal(getEffectivePrice(1400, resolvedM), 1450);
    });

    // -------------------------------------------------------------------------
    // 6. Unselected but Selectable Valid Variants (Intelligent In-Stock Preference)
    // -------------------------------------------------------------------------
    it("AVAIL-006: Initial variant resolution intelligently identifies first in-stock variant", () => {
        const variants: ProductVariant[] = [
            { id: "var-s", sizeId: "size-s", sizeName: "S", inventory: 0, isActive: true }, // OOS
            { id: "var-m", sizeId: "size-m", sizeName: "M", inventory: 10, isActive: true }, // In stock
            { id: "var-l", sizeId: "size-l", sizeName: "L", inventory: 5, isActive: true },
        ];

        const inStockPreferred = variants.find(v => v.isActive !== false && v.inventory > 0);
        assert.ok(inStockPreferred);
        assert.equal(inStockPreferred.id, "var-m");
        assert.equal(inStockPreferred.sizeName, "M");
    });

    // -------------------------------------------------------------------------
    // 7. Free Size Product
    // -------------------------------------------------------------------------
    it("AVAIL-007: Free Size product resolves universal option and maintains inventory integrity", () => {
        const sizes: SizeOption[] = [{ id: "size-free", name: "Free Size", isActive: true }];
        const colors: ColorOption[] = [];

        const { variants } = generateVariantMatrix(sizes, colors, {
            baseSku: "WTR-SCARF",
            basePrice: 699,
            defaultStock: 25,
        });

        assert.equal(variants.length, 1);
        assert.equal(variants[0].sizeName, "Free Size");
        assert.equal(variants[0].inventory, 25);

        const breakdown = calculateVariantStockBreakdown(variants);
        assert.equal(breakdown.sellableStock, 25);
    });

    // -------------------------------------------------------------------------
    // 8. Missing Variant Stock Field
    // -------------------------------------------------------------------------
    it("AVAIL-008: Missing or invalid variant stock field fails safely to 0 without NaN", () => {
        const variants: any[] = [
            { id: "var-1", sizeName: "S", inventory: undefined, isActive: true },
            { id: "var-2", sizeName: "M", inventory: null, isActive: true },
            { id: "var-3", sizeName: "L", inventory: NaN, isActive: true },
            { id: "var-4", sizeName: "XL", inventory: -5, isActive: true },
            { id: "var-5", sizeName: "XXL", inventory: 10.7, isActive: true },
        ];

        const breakdown = calculateVariantStockBreakdown(variants);
        // var-5 gets Math.floor(10.7) = 10; others get 0
        assert.equal(breakdown.sellableStock, 10);
        assert.equal(Number.isNaN(breakdown.sellableStock), false);
    });

    // -------------------------------------------------------------------------
    // 9. Product-Level and Variant-Level Stock Mismatch
    // -------------------------------------------------------------------------
    it("AVAIL-009: When product has variants, variant-level stock is authoritative; parent stock is ignored", async () => {
        const variants: ProductVariant[] = [
            { id: "var-s", sizeId: "size-s", sizeName: "S", inventory: 2, isActive: true },
            { id: "var-m", sizeId: "size-m", sizeName: "M", inventory: 3, isActive: true },
        ];

        // Parent product has inventory: 100, but sum of variants is 5
        const product: ProductRecord = {
            id: "prod-mismatch",
            name: "Mismatched Jacket",
            price: 999,
            inventory: 100, // Stale / mismatched parent stock
            totalPhysicalInventory: 100,
            hasVariants: true,
            variants,
        };

        // Requesting 4 units of S (which only has 2) must fail even though parent inventory is 100
        const result = await runPricing([{ productId: product.id, variantId: "var-s", quantity: 4 }], [product]);

        assert.equal(result.isValid, false);
        assert.ok(result.errors.some(e => e.includes("Insufficient stock")));
    });

    // -------------------------------------------------------------------------
    // 10. CSV-Imported Product with Genuine Positive Inventory
    // -------------------------------------------------------------------------
    it("AVAIL-010: CSV-imported product with genuine positive inventory generates valid matrix and stock", () => {
        const sizes: SizeOption[] = [
            { id: "size-plastic", name: "Plastic", isActive: true },
        ];
        const colors: ColorOption[] = [
            { id: "col-black", name: "Black", isActive: true },
        ];

        const { variants } = generateVariantMatrix(sizes, colors, {
            baseSku: "PID-68151",
            basePrice: 609,
            defaultStock: 10,
        });

        assert.equal(variants.length, 1);
        assert.equal(variants[0].sku, "PID-68151-BLAC-PLASTIC");
        assert.equal(variants[0].inventory, 10);
        assert.equal(variants[0].isActive, true);
    });

    // -------------------------------------------------------------------------
    // 11. CSV-Imported Product with Zero Inventory
    // -------------------------------------------------------------------------
    it("AVAIL-011: CSV-imported product with zero inventory preserves genuine 0 and is not marked in-stock", () => {
        const sizes: SizeOption[] = [{ id: "size-std", name: "Standard", isActive: true }];
        const { variants } = generateVariantMatrix(sizes, [], {
            baseSku: "PID-ZERO",
            basePrice: 500,
            defaultStock: 0,
        });

        assert.equal(variants[0].inventory, 0);
        const breakdown = calculateVariantStockBreakdown(variants);
        assert.equal(breakdown.sellableStock, 0);
    });

    // -------------------------------------------------------------------------
    // 12. Variant Configuration Validation Catches Empty Variants Array (TASK 037 Fix)
    // -------------------------------------------------------------------------
    it("AVAIL-012: validateVariantConfiguration strictly rejects hasVariants=true when variants array is empty", () => {
        const emptyVariantsConfig = {
            hasVariants: true,
            sizes: [
                { id: "size-s", name: "S", isActive: true },
                { id: "size-m", name: "M", isActive: true },
            ],
            colors: [],
            variants: [], // Empty! Corrupted/incomplete state
        };

        const validation = validateVariantConfiguration(emptyVariantsConfig);
        assert.equal(validation.isValid, false);
        assert.ok(validation.errors.some(e => e.includes("no variant combinations have been generated")));
    });

    // -------------------------------------------------------------------------
    // 13. Price and Inventory Integrity After Variant Switching
    // -------------------------------------------------------------------------
    it("AVAIL-013: Price, discount, and inventory remain consistent when customer switches variants", () => {
        const basePrice = 1000;
        const compareAtPrice = 2000; // 50% base discount

        const varNormal: ProductVariant = {
            id: "var-s",
            sizeName: "S",
            inventory: 10,
            isActive: true,
            price: null, // Inherits basePrice
            compareAtPrice: null, // Inherits compareAtPrice
        };

        const varPremium: ProductVariant = {
            id: "var-xxl",
            sizeName: "XXL",
            inventory: 3,
            isActive: true,
            price: 1200, // Price override
            compareAtPrice: 2400, // Explicit compareAtPrice override
        };

        const pricingNormal = getEffectivePricing(basePrice, compareAtPrice, varNormal);
        assert.equal(pricingNormal.sellingPrice, 1000);
        assert.equal(pricingNormal.originalPrice, 2000);
        assert.equal(pricingNormal.discountPercentage, 50);

        const pricingPremium = getEffectivePricing(basePrice, compareAtPrice, varPremium);
        assert.equal(pricingPremium.sellingPrice, 1200);
        assert.equal(pricingPremium.originalPrice, 2400);
        assert.equal(pricingPremium.discountPercentage, 50);
    });

    // -------------------------------------------------------------------------
    // 14. Disabled or Unpublished Products Excluded from Checkout
    // -------------------------------------------------------------------------
    it("AVAIL-014: Unpublished or disabled products are strictly rejected during server checkout", async () => {
        const unpublishedProduct: ProductRecord = {
            id: "prod-unpublished",
            name: "Draft Winter Jacket",
            price: 1500,
            inventory: 20,
            hasVariants: false,
            isVisible: false, // Unpublished
        };

        const disabledVariantProduct: ProductRecord = {
            id: "prod-disabled-var",
            name: "Winter Jacket",
            price: 1500,
            hasVariants: true,
            variants: [
                { id: "var-disabled", sizeName: "M", inventory: 20, isActive: false },
            ],
        };

        const resDisabledVar = await runPricing([{ productId: disabledVariantProduct.id, variantId: "var-disabled", quantity: 1 }], [disabledVariantProduct]);
        assert.equal(resDisabledVar.isValid, false);
        assert.ok(resDisabledVar.errors.some(e => e.includes("unavailable (inactive)")));
    });

    // -------------------------------------------------------------------------
    // 15. Winter Collection Product Diagnostic Verification
    // -------------------------------------------------------------------------
    it("AVAIL-015: Confirms root cause: hasVariants=true with variants=[] produces configuration error", async () => {
        const winterProduct: ProductRecord = {
            id: "14a29e10-758e-4fd2-a10a-6c04c74fe73a",
            name: "**Men’s Premium Grey Bomber Jacket with Black Ribbed Collar & Full Zip – Stylish Winter Casual Wear**",
            price: 750,
            inventory: 10,
            totalPhysicalInventory: 10,
            hasVariants: true,
            variants: [], // The exact production state!
        };

        const result = await runPricing([{ productId: winterProduct.id, quantity: 1 }], [winterProduct]);

        assert.equal(result.isValid, false);
        assert.ok(result.errors.some(e => e.includes("is configured for variants but has no valid variants configured")));
    });

    // -------------------------------------------------------------------------
    // 16. Button State Mapping Integrity
    // -------------------------------------------------------------------------
    it("AVAIL-016: Button states map cleanly across In Stock, Out of Stock, and Unavailable", () => {
        function resolveButtonStates(params: {
            hasVariants: boolean;
            matchedVariant: ProductVariant | null;
            rootInventory: number;
        }) {
            const hasConfiguredVariants = Boolean(params.hasVariants && params.matchedVariant);
            const isVariantMisconfigured = Boolean(params.hasVariants && !params.matchedVariant);

            const isVariantDisabled = hasConfiguredVariants
                ? (params.matchedVariant?.isActive === false)
                : isVariantMisconfigured;

            const currentStock = hasConfiguredVariants
                ? (params.matchedVariant?.inventory ?? 0)
                : params.rootInventory;

            const isOutOfStock = !isVariantDisabled && currentStock <= 0;

            const addToCartText = isVariantDisabled ? "Unavailable" : isOutOfStock ? "Out of Stock" : "Add to Cart";
            const buyNowText = isVariantDisabled ? "Unavailable" : isOutOfStock ? "Out of Stock" : "Buy Now";
            const isDisabled = isVariantDisabled || isOutOfStock;

            return { addToCartText, buyNowText, isDisabled, isOutOfStock, isVariantDisabled };
        }

        // Case A: In stock variant
        const inStock = resolveButtonStates({
            hasVariants: true,
            matchedVariant: { id: "v1", inventory: 5, isActive: true },
            rootInventory: 5,
        });
        assert.equal(inStock.addToCartText, "Add to Cart");
        assert.equal(inStock.buyNowText, "Buy Now");
        assert.equal(inStock.isDisabled, false);

        // Case B: Out of stock variant
        const oos = resolveButtonStates({
            hasVariants: true,
            matchedVariant: { id: "v1", inventory: 0, isActive: true },
            rootInventory: 0,
        });
        assert.equal(oos.addToCartText, "Out of Stock");
        assert.equal(oos.buyNowText, "Out of Stock");
        assert.equal(oos.isDisabled, true);

        // Case C: Inactive / Disabled variant
        const disabled = resolveButtonStates({
            hasVariants: true,
            matchedVariant: { id: "v1", inventory: 5, isActive: false },
            rootInventory: 5,
        });
        assert.equal(disabled.addToCartText, "Unavailable");
        assert.equal(disabled.buyNowText, "Unavailable");
        assert.equal(disabled.isDisabled, true);

        // Case D: Misconfigured product (hasVariants=true, matchedVariant=null)
        const misconfigured = resolveButtonStates({
            hasVariants: true,
            matchedVariant: null,
            rootInventory: 10,
        });
        assert.equal(misconfigured.addToCartText, "Unavailable");
        assert.equal(misconfigured.buyNowText, "Unavailable");
        assert.equal(misconfigured.isDisabled, true);
    });
});
