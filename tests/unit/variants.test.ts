import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    formatDimensions,
    formatSizeDisplay,
    formatVariantTitle,
    buildCombinationId,
    generateVariantSku,
    generateVariantMatrix,
    resolveMatchingVariant,
    getEffectivePrice,
    validateVariantConfiguration,
    reconcileProductInventoryOnSave,
    MAX_VARIANT_LIMIT,
} from "../../src/lib/products/variants.ts";
import type {
    SizeOption,
    ColorOption,
    ProductVariant,
} from "../../src/lib/products/variants.ts";
import {
    calculateOrderPricing,
    isCustomizableProduct,
    evaluateCodEligibility,
} from "../../src/lib/orders/pricing.ts";
import type {
    ProductRecord,
    OrderItemInput,
} from "../../src/lib/orders/pricing.ts";

describe("Flexible Product Variants & Inventory Integrity Unit Tests (TASK 029)", () => {

    // =========================================================================
    // SECTION 1: SIZING MODES & DIMENSION FORMATTING
    // =========================================================================
    describe("1. Sizing Modes & Dimension Formatting", () => {
        it("VAR-001: Mode A (No Size) — formatSizeDisplay returns display name or empty", () => {
            const sizeOption: SizeOption = { id: "size_none", name: "" };
            assert.equal(formatSizeDisplay(sizeOption), "");
        });

        it("VAR-002: Mode B (Apparel) — formats standard apparel sizes correctly", () => {
            const sizeS: SizeOption = { id: "size_s", name: "S" };
            const sizeXxl: SizeOption = { id: "size_xxl", name: "XXL" };
            assert.equal(formatSizeDisplay(sizeS), "S");
            assert.equal(formatSizeDisplay(sizeXxl), "XXL");
        });

        it("VAR-003: Mode C (Free Size) — formats universal free size label", () => {
            const freeSize: SizeOption = { id: "size_free", name: "Free Size" };
            assert.equal(formatSizeDisplay(freeSize), "Free Size");
        });

        it("VAR-004: Mode D (Dimensions 2D) — formats width × height with unit", () => {
            const dim2D: SizeOption = {
                id: "size_small_cushion",
                name: "Small",
                dimensions: { width: 20, height: 20, unit: "cm" },
            };
            assert.equal(formatDimensions(dim2D.dimensions!), "20 × 20 cm");
            assert.equal(formatSizeDisplay(dim2D), "Small — 20 × 20 cm");
        });

        it("VAR-005: Mode D (Dimensions 3D) — formats width × height × depth with inch unit", () => {
            const dim3D: SizeOption = {
                id: "size_box",
                name: "Large Box",
                dimensions: { width: 26, height: 26, depth: 10, unit: "inch" },
            };
            assert.equal(formatDimensions(dim3D.dimensions!), "26 × 26 × 10 inch");
            assert.equal(formatSizeDisplay(dim3D), "Large Box — 26 × 26 × 10 inch");
        });

        it("VAR-006: Mode E (Custom Size Labels) — formats custom labels like Mini, King, A4", () => {
            const mini: SizeOption = { id: "size_mini", name: "Mini" };
            const king: SizeOption = { id: "size_king", name: "King Size" };
            const a4: SizeOption = { id: "size_a4", name: "A4 (8.3 × 11.7 in)" };
            assert.equal(formatSizeDisplay(mini), "Mini");
            assert.equal(formatSizeDisplay(king), "King Size");
            assert.equal(formatSizeDisplay(a4), "A4 (8.3 × 11.7 in)");
        });
    });

    // =========================================================================
    // SECTION 2: COLOR ATTRIBUTES & COMBINATION RESOLUTION
    // =========================================================================
    describe("2. Color Attributes & Combination Resolution", () => {
        it("VAR-007: buildCombinationId generates deterministic, canonical IDs", () => {
            assert.equal(buildCombinationId("size_m", "col_black"), "var_size_m_col_black");
            assert.equal(buildCombinationId("size_l", undefined), "var_size_l");
            assert.equal(buildCombinationId(undefined, "col_red"), "var_col_red");
            assert.equal(buildCombinationId(undefined, undefined), "var_default");
        });

        it("VAR-008: generateVariantSku builds clean, readable SKUs without illegal characters", () => {
            assert.equal(generateVariantSku("TSHIRT", "XL", "Navy Blue"), "TSHIRT-NAVY-XL");
            assert.equal(generateVariantSku("CUSHION", "20 × 20 cm", "Burgundy"), "CUSHION-BURG-2020CM");
            assert.equal(generateVariantSku("MUG", undefined, "Matte Black"), "MUG-MATT");
        });

        it("VAR-009: formatVariantTitle displays combined labels or single attributes cleanly", () => {
            const vBoth: ProductVariant = {
                id: "v1",
                sizeName: "Medium",
                colorName: "Navy Blue",
                inventory: 5,
                isActive: true,
            };
            const vSizeOnly: ProductVariant = {
                id: "v2",
                sizeName: "Large",
                inventory: 5,
                isActive: true,
            };
            const vColorOnly: ProductVariant = {
                id: "v3",
                colorName: "Emerald Green",
                inventory: 5,
                isActive: true,
            };
            assert.equal(formatVariantTitle(vBoth), "Medium / Navy Blue");
            assert.equal(formatVariantTitle(vSizeOnly), "Large");
            assert.equal(formatVariantTitle(vColorOnly), "Emerald Green");
        });
    });

    // =========================================================================
    // SECTION 3: COMBINED VARIANT MATRIX GENERATION & RECONCILIATION
    // =========================================================================
    describe("3. Variant Matrix Generation & Limit Enforcement", () => {
        const sizes: SizeOption[] = [
            { id: "size_s", name: "S", isActive: true },
            { id: "size_m", name: "M", isActive: true },
            { id: "size_l", name: "L", isActive: true },
        ];
        const colors: ColorOption[] = [
            { id: "col_blue", name: "Blue", hex: "#0000ff", isActive: true },
            { id: "col_red", name: "Red", hex: "#ff0000", isActive: true },
            { id: "col_black", name: "Black", hex: "#000000", isActive: true },
        ];

        it("VAR-010: Generates complete 3×3 matrix (9 distinct combinations)", () => {
            const { variants, exceededLimit } = generateVariantMatrix(sizes, colors, {
                baseSku: "HOODIE",
                defaultStock: 15,
            });
            assert.equal(variants.length, 9);
            assert.equal(exceededLimit, false);
            assert.equal(variants[0].sizeName, "S");
            assert.equal(variants[0].colorName, "Blue");
            assert.equal(variants[0].sku, "HOODIE-BLUE-S");
            assert.equal(variants[0].inventory, 15);
        });

        it("VAR-011: Generates size-only matrix when colors list is empty", () => {
            const { variants } = generateVariantMatrix(sizes, []);
            assert.equal(variants.length, 3);
            assert.equal(variants[0].sizeName, "S");
            assert.equal(variants[0].colorName, undefined);
        });

        it("VAR-012: Generates color-only matrix when sizes list is empty", () => {
            const { variants } = generateVariantMatrix([], colors);
            assert.equal(variants.length, 3);
            assert.equal(variants[0].sizeName, undefined);
            assert.equal(variants[0].colorName, "Blue");
        });

        it("VAR-013: Ignores inactive sizes and colors during matrix generation", () => {
            const sizesWithInactive: SizeOption[] = [
                { id: "size_s", name: "S", isActive: true },
                { id: "size_xl", name: "XL", isActive: false },
            ];
            const colorsWithInactive: ColorOption[] = [
                { id: "col_black", name: "Black", isActive: true },
                { id: "col_pink", name: "Pink", isActive: false },
            ];
            const { variants } = generateVariantMatrix(sizesWithInactive, colorsWithInactive);
            assert.equal(variants.length, 1);
            assert.equal(variants[0].sizeName, "S");
            assert.equal(variants[0].colorName, "Black");
        });

        it("VAR-014: Enforces MAX_VARIANT_LIMIT (100), rejects oversized generation without truncation, and preserves existing matrix", () => {
            const previousMatrix: ProductVariant[] = [
                { id: "v_prev_1", sizeName: "S", colorName: "Black", inventory: 5, isActive: true },
            ];

            // Generate 12 sizes × 10 colors = 120 combinations
            const bigSizes: SizeOption[] = Array.from({ length: 12 }, (_, i) => ({
                id: `s_${i}`,
                name: `Size${i}`,
                isActive: true,
            }));
            const bigColors: ColorOption[] = Array.from({ length: 10 }, (_, i) => ({
                id: `c_${i}`,
                name: `Color${i}`,
                isActive: true,
            }));

            const { variants, exceededLimit, error, requestedCount, limit } = generateVariantMatrix(bigSizes, bigColors, {
                existingVariants: previousMatrix,
                maxLimit: 100,
            });
            // Must NOT truncate to 100! Must preserve previously valid matrix!
            assert.equal(exceededLimit, true);
            assert.equal(variants.length, 1);
            assert.equal(variants[0].id, "v_prev_1");
            assert.equal(requestedCount, 120);
            assert.equal(limit, 100);
            assert.ok(error?.includes("120"));
            assert.ok(error?.includes("100"));
        });

        it("VAR-015: Preserves custom SKU, price override, stock, and photo when refreshing matrix", () => {
            const existing: ProductVariant[] = [
                {
                    id: "var_size_m_col_black",
                    sizeId: "size_m",
                    sizeName: "M",
                    colorId: "col_black",
                    colorName: "Black",
                    sku: "CUSTOM-SKU-BLACK-M",
                    price: 1499,
                    inventory: 42,
                    isActive: true,
                    image: "https://r2.bazaarvilla.com/products/custom-photo.jpg",
                },
            ];

            const { variants } = generateVariantMatrix(sizes, colors, {
                existingVariants: existing,
                baseSku: "DEFAULT",
                defaultStock: 10,
            });

            const preserved = variants.find(v => v.id === "var_size_m_col_black");
            assert.ok(preserved);
            assert.equal(preserved.sku, "CUSTOM-SKU-BLACK-M");
            assert.equal(preserved.price, 1499);
            assert.equal(preserved.inventory, 42);
            assert.equal(preserved.image, "https://r2.bazaarvilla.com/products/custom-photo.jpg");
        });
    });

    // =========================================================================
    // SECTION 4: SERVER-AUTHORITATIVE PRICING & INVENTORY VALIDATION
    // =========================================================================
    describe("4. Authoritative Pricing & Variant Stock Validation", () => {
        const variantProduct: ProductRecord = {
            id: "prod-hoodie-001",
            name: "Bazaarvilla Signature Hoodie",
            price: 999, // Base price
            inventory: 50,
            isVisible: true,
            hasVariants: true,
            sizeMode: "apparel",
            sizesList: [
                { id: "size_s", name: "S", isActive: true },
                { id: "size_xl", name: "XL", isActive: true },
            ],
            colors: [
                { id: "col_black", name: "Black", hex: "#000000", isActive: true },
            ],
            variants: [
                {
                    id: "var_s_black",
                    sizeId: "size_s",
                    sizeName: "S",
                    colorId: "col_black",
                    colorName: "Black",
                    sku: "HOODIE-BLACK-S",
                    price: null, // Inherits base price 999
                    inventory: 10,
                    isActive: true,
                },
                {
                    id: "var_xl_black",
                    sizeId: "size_xl",
                    sizeName: "XL",
                    colorId: "col_black",
                    colorName: "Black",
                    sku: "HOODIE-BLACK-XL",
                    price: 1199, // Variant price override
                    inventory: 5,
                    isActive: true,
                },
                {
                    id: "var_disabled",
                    sizeId: "size_s",
                    sizeName: "S",
                    sku: "HOODIE-DISABLED",
                    price: 500,
                    inventory: 20,
                    isActive: false, // Disabled variant
                },
            ],
        };

        const mockCatalog: Record<string, ProductRecord> = {
            [variantProduct.id]: variantProduct,
        };
        const fetchProduct = async (id: string) => mockCatalog[id] || null;

        it("VAR-016: Correctly applies variant price override over base product price", async () => {
            const items: OrderItemInput[] = [
                {
                    productId: variantProduct.id,
                    price: 999, // Client claims 999
                    quantity: 2,
                    variantId: "var_xl_black",
                },
            ];

            const result = await calculateOrderPricing(items, null, fetchProduct, null);
            assert.equal(result.isValid, true);
            // Authoritative price is 1199 * 2 = 2398
            assert.equal(result.subtotal, 2398);
            assert.equal(result.validatedItems[0].price, 1199);
            assert.equal(result.validatedItems[0].sku, "HOODIE-BLACK-XL");
            assert.equal(result.validatedItems[0].size, "XL");
            assert.equal(result.validatedItems[0].color, "Black");
        });

        it("VAR-017: Falls back to base product price when variant price override is null", async () => {
            const items: OrderItemInput[] = [
                {
                    productId: variantProduct.id,
                    price: 1234, // Forged client price
                    quantity: 1,
                    variantId: "var_s_black",
                },
            ];

            const result = await calculateOrderPricing(items, null, fetchProduct, null);
            assert.equal(result.isValid, true);
            // Must use authoritative base price 999
            assert.equal(result.subtotal, 999);
            assert.equal(result.validatedItems[0].price, 999);
        });

        it("VAR-018: Strictly rejects non-existent variant ID", async () => {
            const items: OrderItemInput[] = [
                {
                    productId: variantProduct.id,
                    price: 999,
                    quantity: 1,
                    variantId: "var_non_existent_id",
                },
            ];

            const result = await calculateOrderPricing(items, null, fetchProduct, null);
            assert.equal(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes("does not belong to product") || e.includes("valid variant")));
        });

        it("VAR-019: Strictly rejects inactive/disabled variant", async () => {
            const items: OrderItemInput[] = [
                {
                    productId: variantProduct.id,
                    price: 500,
                    quantity: 1,
                    variantId: "var_disabled",
                },
            ];

            const result = await calculateOrderPricing(items, null, fetchProduct, null);
            assert.equal(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes("currently unavailable")));
        });

        it("VAR-020: Strictly rejects purchase when requested quantity exceeds variant inventory", async () => {
            const items: OrderItemInput[] = [
                {
                    productId: variantProduct.id,
                    price: 1199,
                    quantity: 6, // Stock is only 5!
                    variantId: "var_xl_black",
                },
            ];

            const result = await calculateOrderPricing(items, null, fetchProduct, null);
            assert.equal(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes("Insufficient stock")));
        });

        it("VAR-021: Aggregates split line items of same variant to prevent inventory bypass", async () => {
            const items: OrderItemInput[] = [
                {
                    productId: variantProduct.id,
                    price: 1199,
                    quantity: 3,
                    variantId: "var_xl_black",
                },
                {
                    productId: variantProduct.id,
                    price: 1199,
                    quantity: 3, // Total requested = 6, stock = 5
                    variantId: "var_xl_black",
                },
            ];

            const result = await calculateOrderPricing(items, null, fetchProduct, null);
            assert.equal(result.isValid, false);
            assert.ok(result.errors.some(e => e.includes("Insufficient stock")));
        });

        it("VAR-022: Distinct variants of the same product are evaluated independently", async () => {
            const items: OrderItemInput[] = [
                {
                    productId: variantProduct.id,
                    price: 999,
                    quantity: 5, // S Black (stock 10) → OK
                    variantId: "var_s_black",
                },
                {
                    productId: variantProduct.id,
                    price: 1199,
                    quantity: 4, // XL Black (stock 5) → OK
                    variantId: "var_xl_black",
                },
            ];

            const result = await calculateOrderPricing(items, null, fetchProduct, null);
            assert.equal(result.isValid, true);
            // 5 * 999 (4995) + 4 * 1199 (4796) = 9791
            assert.equal(result.subtotal, 9791);
            assert.equal(result.validatedItems.length, 2);
        });
    });

    // =========================================================================
    // SECTION 5: CASH ON DELIVERY & PERSONALIZATION INTEGRITY (TASK 027 GUARD)
    // =========================================================================
    describe("5. COD Eligibility vs Personalization Integrity (TASK 027 Guard)", () => {
        const regularVariantProduct: ProductRecord = {
            id: "prod-tshirt-variants",
            name: "Classic Unisex T-Shirt",
            price: 599,
            inventory: 20,
            isVisible: true,
            hasVariants: true,
            isCustomized: false, // Standard variation, NOT personalized!
            variants: [
                {
                    id: "var_tshirt_black_xl",
                    sizeName: "XL",
                    colorName: "Black",
                    inventory: 10,
                    isActive: true,
                },
            ],
        };

        const personalizedVariantProduct: ProductRecord = {
            id: "prod-custom-cushion",
            name: "Personalized Photo Cushion",
            price: 799,
            inventory: 15,
            isVisible: true,
            hasVariants: true,
            isCustomized: true, // Requires photo upload!
            customizationType: "requires_picture",
            variants: [
                {
                    id: "var_cushion_large_blue",
                    sizeName: "Large",
                    colorName: "Blue",
                    inventory: 8,
                    isActive: true,
                },
            ],
        };

        it("VAR-023: Standard size/color variant has isCustomizableProduct = false and is COD eligible", () => {
            assert.equal(isCustomizableProduct(regularVariantProduct), false);

            const cart = [
                {
                    id: regularVariantProduct.id,
                    name: regularVariantProduct.name,
                    price: 599,
                    quantity: 1,
                    variantId: "var_tshirt_black_xl",
                    size: "XL",
                    color: "Black",
                },
            ];
            const eligibility = evaluateCodEligibility(cart, new Map([[regularVariantProduct.id, regularVariantProduct]]));
            assert.equal(eligibility.isEligible, true);
        });

        it("VAR-024: Personalized product with variants has isCustomizableProduct = true and is prepaid-only", () => {
            assert.equal(isCustomizableProduct(personalizedVariantProduct), true);

            const cart = [
                {
                    id: personalizedVariantProduct.id,
                    name: personalizedVariantProduct.name,
                    price: 799,
                    quantity: 1,
                    variantId: "var_cushion_large_blue",
                    size: "Large",
                    color: "Blue",
                },
            ];
            const eligibility = evaluateCodEligibility(cart, new Map([[personalizedVariantProduct.id, personalizedVariantProduct]]));
            assert.equal(eligibility.isEligible, false);
            assert.equal(eligibility.ineligibleItems?.length, 1);
            assert.ok(eligibility.reason?.includes("Personalized Photo Cushion"));
        });
    });

    // =========================================================================
    // SECTION 6: BACKWARD COMPATIBILITY
    // =========================================================================
    describe("6. Backward Compatibility for Legacy Products", () => {
        const legacyProduct: ProductRecord = {
            id: "prod-legacy-001",
            name: "Original Ceramic Mug",
            price: 349,
            inventory: 8,
            isVisible: true,
            sizes: ["Standard"], // Legacy sizes array
            // No hasVariants or variants array
        };

        it("VAR-025: Legacy product pricing and inventory function unchanged", async () => {
            const fetchLegacy = async (id: string) => id === legacyProduct.id ? legacyProduct : null;
            const items: OrderItemInput[] = [
                {
                    productId: legacyProduct.id,
                    price: 349,
                    quantity: 2,
                    size: "Standard",
                },
            ];

            const result = await calculateOrderPricing(items, null, fetchLegacy, null);
            assert.equal(result.isValid, true);
            assert.equal(result.subtotal, 698);
            assert.equal(result.validatedItems[0].variantId, undefined);
            assert.equal(result.validatedItems[0].size, "Standard");
        });
    });

    // =========================================================================
    // SECTION 7: CONCURRENCY RECONCILIATION & VARIANT IDENTITY
    // =========================================================================
    describe("7. Admin Concurrency & Variant Identity Hardening", () => {
        it("VAR-026: Admin save with stale form data preserves interim checkout deductions", () => {
            const loadedProduct = {
                hasVariants: true,
                variants: [
                    { id: "var_black_xl", sizeName: "XL", colorName: "Black", inventory: 5, isActive: true },
                    { id: "var_white_m", sizeName: "M", colorName: "White", inventory: 3, isActive: true },
                ],
            };

            // Customer purchased 2 units of Black XL in Firestore while admin form was open
            const liveProduct = {
                hasVariants: true,
                variants: [
                    { id: "var_black_xl", sizeName: "XL", colorName: "Black", inventory: 3, isActive: true },
                    { id: "var_white_m", sizeName: "M", colorName: "White", inventory: 3, isActive: true },
                ],
            };

            // Admin saves unrelated edit (e.g. description changed, stock unchanged in form)
            const formVariants = [
                { id: "var_black_xl", sizeName: "XL", colorName: "Black", inventory: 5, isActive: true },
                { id: "var_white_m", sizeName: "M", colorName: "White", inventory: 3, isActive: true },
            ];

            const result = reconcileProductInventoryOnSave({
                formHasVariants: true,
                formVariants,
                loadedProduct,
                liveProduct,
            });

            // Black XL stock must remain 3 (the live stock), not reset to 5
            const reconciledBlack = result.variants?.find(v => v.id === "var_black_xl");
            assert.equal(reconciledBlack?.inventory, 3);
            assert.equal(result.inventory, 6); // 3 (Black XL) + 3 (White M)
        });

        it("VAR-027: Simultaneous admin editing of variant prices and inventory merges correctly", () => {
            const loadedProduct = {
                hasVariants: true,
                variants: [
                    { id: "var_black_xl", sizeName: "XL", colorName: "Black", price: 500, inventory: 5, isActive: true },
                    { id: "var_white_m", sizeName: "M", colorName: "White", price: 400, inventory: 3, isActive: true },
                ],
            };

            // Customer bought 2 Black XL in interim -> live stock is 3
            const liveProduct = {
                hasVariants: true,
                variants: [
                    { id: "var_black_xl", sizeName: "XL", colorName: "Black", price: 500, inventory: 3, isActive: true },
                    { id: "var_white_m", sizeName: "M", colorName: "White", price: 400, inventory: 3, isActive: true },
                ],
            };

            // Admin edited Black XL price (500 -> 600) and White M inventory (3 -> 10)
            const formVariants = [
                { id: "var_black_xl", sizeName: "XL", colorName: "Black", price: 600, inventory: 5, isActive: true }, // unedited stock
                { id: "var_white_m", sizeName: "M", colorName: "White", price: 400, inventory: 10, isActive: true }, // edited stock (+7)
            ];

            const result = reconcileProductInventoryOnSave({
                formHasVariants: true,
                formVariants,
                loadedProduct,
                liveProduct,
            });

            const reconciledBlack = result.variants?.find(v => v.id === "var_black_xl");
            const reconciledWhite = result.variants?.find(v => v.id === "var_white_m");

            assert.equal(reconciledBlack?.price, 600);
            assert.equal(reconciledBlack?.inventory, 3); // Preserved live checkout deduction
            assert.equal(reconciledWhite?.price, 400);
            assert.equal(reconciledWhite?.inventory, 10); // Restocked to 10
            assert.equal(result.inventory, 13);
        });

        it("VAR-028: Admin legacy product save preserves checkout deductions when root inventory was unedited", () => {
            const loadedProduct = {
                inventory: 20,
            };

            // Customer purchased 4 items while admin form was open
            const liveProduct = {
                inventory: 16,
            };

            // Admin form still has 20 because admin only edited product description
            const result = reconcileProductInventoryOnSave({
                formHasVariants: false,
                formInventory: 20,
                loadedProduct,
                liveProduct,
            });

            // Root inventory must remain 16, not reset to 20
            assert.equal(result.inventory, 16);
            assert.equal(result.totalPhysicalInventory, 16);
        });

        it("VAR-029: Brand new variant addition with live product creation preserves timestamps", () => {
            const liveProduct = {
                hasVariants: true,
                variants: [
                    { id: "var_black_xl", sizeName: "XL", colorName: "Black", inventory: 5, isActive: true, createdAt: 1000 },
                ],
            };

            const formVariants = [
                { id: "var_black_xl", sizeName: "XL", colorName: "Black", inventory: 5, isActive: true, createdAt: 1000 },
                { id: "var_white_s", sizeName: "S", colorName: "White", inventory: 8, isActive: true },
            ];

            const result = reconcileProductInventoryOnSave({
                formHasVariants: true,
                formVariants,
                loadedProduct: liveProduct,
                liveProduct,
            });

            assert.equal(result.variants?.length, 2);
            const whiteS = result.variants?.find(v => v.id === "var_white_s");
            assert.equal(whiteS?.inventory, 8);
            assert.ok(typeof whiteS?.createdAt === "number");
        });
    });
});
