import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    isCustomizableProduct,
    evaluateCodEligibility,
} from "../../src/lib/orders/pricing.ts";
import type { ProductRecord } from "../../src/lib/orders/pricing.ts";

describe("Customizable Product COD Restriction Unit Tests (TASK 027)", () => {
    // 1. isCustomizableProduct Tests
    describe("isCustomizableProduct Catalog Detection", () => {
        it("COD-UNIT-001: should return false for a standard product with isCustomized=false", () => {
            const product: ProductRecord = {
                id: "prod-tshirt",
                name: "Basic Crewneck T-Shirt",
                price: 499,
                inventory: 10,
                isVisible: true,
                isCustomized: false,
            };
            assert.equal(isCustomizableProduct(product), false);
        });

        it("COD-UNIT-002: should return false for standard products with size variants alone", () => {
            const product: ProductRecord = {
                id: "prod-hoodie-sized",
                name: "Standard Hoodie",
                price: 1299,
                inventory: 15,
                isVisible: true,
                isCustomized: false,
                sizes: ["S", "M", "L", "XL", "XXL"],
            };
            assert.equal(isCustomizableProduct(product), false, "Size choices alone must NOT make a product customizable");
        });

        it("COD-UNIT-003: should return true when isCustomized=true", () => {
            const product: ProductRecord = {
                id: "prod-custom-frame",
                name: "Custom Acrylic Photo Frame",
                price: 899,
                inventory: 20,
                isVisible: true,
                isCustomized: true,
            };
            assert.equal(isCustomizableProduct(product), true);
        });

        it("COD-UNIT-004: should return true when customizationType='requires_name'", () => {
            const product: ProductRecord = {
                id: "prod-engraved-wallet",
                name: "Personalized Engraved Leather Wallet",
                price: 799,
                inventory: 25,
                isVisible: true,
                isCustomized: false, // even if flag missing, explicit type indicates personalization
                customizationType: "requires_name",
            };
            assert.equal(isCustomizableProduct(product), true);
        });

        it("COD-UNIT-005: should return true when customizationType='requires_picture'", () => {
            const product: ProductRecord = {
                id: "prod-photo-mug",
                name: "Personalized Magic Mug",
                price: 399,
                inventory: 30,
                isVisible: true,
                isCustomized: false,
                customizationType: "requires_picture",
            };
            assert.equal(isCustomizableProduct(product), true);
        });

        it("COD-UNIT-006: should return true for backwards-compatible customizable or isPersonalized flags", () => {
            const legacy1: ProductRecord = {
                id: "prod-legacy-1",
                name: "Custom Keychain",
                price: 199,
                customizable: true,
            };
            const legacy2: ProductRecord = {
                id: "prod-legacy-2",
                name: "Personalized Pen",
                price: 299,
                isPersonalized: true,
            };
            assert.equal(isCustomizableProduct(legacy1), true);
            assert.equal(isCustomizableProduct(legacy2), true);
        });

        it("COD-UNIT-007: should fail-safely return false for null, undefined, or empty objects", () => {
            assert.equal(isCustomizableProduct(null), false);
            assert.equal(isCustomizableProduct(undefined), false);
            assert.equal(isCustomizableProduct({} as any), false);
        });
    });

    // 2. evaluateCodEligibility Tests
    describe("evaluateCodEligibility Mixed-Cart & Catalog Validation", () => {
        const catalog = new Map<string, ProductRecord>([
            [
                "reg-tshirt",
                {
                    id: "reg-tshirt",
                    name: "Classic Regular T-Shirt",
                    price: 499,
                    inventory: 50,
                    isCustomized: false,
                    sizes: ["M", "L", "XL"],
                },
            ],
            [
                "reg-cap",
                {
                    id: "reg-cap",
                    name: "Casual Cap",
                    price: 299,
                    inventory: 30,
                    isCustomized: false,
                },
            ],
            [
                "custom-frame",
                {
                    id: "custom-frame",
                    name: "Custom Photo Frame",
                    price: 899,
                    inventory: 20,
                    isCustomized: true,
                    customizationType: "requires_picture",
                },
            ],
            [
                "custom-mug",
                {
                    id: "custom-mug",
                    name: "Personalized Name Mug",
                    price: 399,
                    inventory: 25,
                    isCustomized: true,
                    customizationType: "requires_name",
                },
            ],
        ]);

        it("COD-UNIT-008: Regular products only → COD is eligible", () => {
            const items = [
                { productId: "reg-tshirt", name: "Classic Regular T-Shirt" },
                { productId: "reg-cap", name: "Casual Cap" },
            ];
            const result = evaluateCodEligibility(items, catalog);
            assert.equal(result.isEligible, true);
            assert.equal(result.code, undefined);
            assert.equal(result.ineligibleItems, undefined);
        });

        it("COD-UNIT-009: One personalized product in cart → COD is strictly blocked", () => {
            const items = [{ productId: "custom-frame", name: "Custom Photo Frame" }];
            const result = evaluateCodEligibility(items, catalog);
            assert.equal(result.isEligible, false);
            assert.equal(result.code, "COD_NOT_ALLOWED_CUSTOM_PRODUCT");
            assert.ok(result.reason?.includes("Cash on Delivery is not available"));
            assert.equal(result.ineligibleItems?.length, 1);
            assert.equal(result.ineligibleItems?.[0].id, "custom-frame");
        });

        it("COD-UNIT-010: Multiple personalized products → COD is blocked and all custom items are reported", () => {
            const items = [
                { productId: "custom-frame", name: "Custom Photo Frame" },
                { productId: "custom-mug", name: "Personalized Name Mug" },
            ];
            const result = evaluateCodEligibility(items, catalog);
            assert.equal(result.isEligible, false);
            assert.equal(result.code, "COD_NOT_ALLOWED_CUSTOM_PRODUCT");
            assert.equal(result.ineligibleItems?.length, 2);
            assert.deepEqual(
                result.ineligibleItems?.map((i) => i.id),
                ["custom-frame", "custom-mug"]
            );
        });

        it("COD-UNIT-011: Mixed cart (regular apparel + custom product) → entire cart is prepaid-only", () => {
            const items = [
                { productId: "reg-tshirt", name: "Classic Regular T-Shirt" },
                { productId: "custom-mug", name: "Personalized Name Mug" },
                { productId: "reg-cap", name: "Casual Cap" },
            ];
            const result = evaluateCodEligibility(items, catalog);
            assert.equal(result.isEligible, false);
            assert.equal(result.code, "COD_NOT_ALLOWED_CUSTOM_PRODUCT");
            assert.equal(result.ineligibleItems?.length, 1);
            assert.equal(result.ineligibleItems?.[0].id, "custom-mug");
        });

        it("COD-UNIT-012: Removing all personalized products restores COD eligibility", () => {
            // Initial mixed cart
            let cart = [
                { productId: "reg-tshirt", name: "Classic Regular T-Shirt" },
                { productId: "custom-mug", name: "Personalized Name Mug" },
            ];
            let check = evaluateCodEligibility(cart, catalog);
            assert.equal(check.isEligible, false);

            // Customer removes personalized product
            cart = cart.filter((item) => item.productId !== "custom-mug");
            check = evaluateCodEligibility(cart, catalog);
            assert.equal(check.isEligible, true);
        });

        it("COD-UNIT-013: Personalized product with no customization fields filled → COD is STILL blocked", () => {
            // Client attempts to send personalized product without customization payload
            const items = [
                {
                    productId: "custom-frame",
                    name: "Custom Photo Frame",
                    isCustomized: false, // client attempts to bypass
                },
            ];
            const result = evaluateCodEligibility(items, catalog);
            assert.equal(result.isEligible, false, "Authoritative catalog data must override client flags");
            assert.equal(result.code, "COD_NOT_ALLOWED_CUSTOM_PRODUCT");
        });

        it("COD-UNIT-014: Forged client flag (isCustomized=true on regular product) → ignored, COD remains eligible", () => {
            const items = [
                {
                    productId: "reg-tshirt",
                    name: "Classic Regular T-Shirt",
                    isCustomized: true, // forged flag on standard product
                },
            ];
            const result = evaluateCodEligibility(items, catalog);
            assert.equal(result.isEligible, true, "Catalog truth must prevail over forged client flags");
        });
    });
});
