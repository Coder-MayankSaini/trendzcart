/**
 * Pure, browser-safe customization and COD eligibility evaluation utility.
 * Free of node built-in dependencies (like crypto), safe to import anywhere
 * across storefront client components, server components, and API routes.
 */

export interface CustomizableProductCandidate {
    id?: string;
    name?: string;
    isCustomized?: boolean;
    customizationType?: "requires_name" | "requires_picture" | null | string;
    customizable?: boolean;
    isPersonalized?: boolean;
    sizes?: string[];
    [key: string]: any;
}

/**
 * Authoritatively determines whether a product is customizable / personalized
 * based strictly on trusted catalog metadata.
 *
 * A customizable product supports customer-specific personalization such as
 * custom text/names, engraving, or photo uploads.
 * Standard products with size or color variants alone are NOT customizable.
 */
export function isCustomizableProduct(
    product: CustomizableProductCandidate | null | undefined
): boolean {
    if (!product) return false;
    return Boolean(
        product.isCustomized === true ||
        product.customizationType === "requires_name" ||
        product.customizationType === "requires_picture" ||
        product.customizable === true ||
        product.isPersonalized === true
    );
}

export interface CodEligibilityResult {
    isEligible: boolean;
    reason?: string;
    code?: string;
    ineligibleItems?: Array<{ id: string; name: string }>;
}

/**
 * Evaluates whether an order's items are eligible for Cash on Delivery (COD).
 * If even one item in the cart is customizable/personalized according to trusted catalog data,
 * COD is strictly disabled for the entire order.
 */
export function evaluateCodEligibility(
    items: Array<{ productId: string; name?: string; id?: string }>,
    catalogProducts: Map<string, CustomizableProductCandidate | null | undefined>
): CodEligibilityResult {
    const ineligibleItems: Array<{ id: string; name: string }> = [];

    for (const item of items) {
        const productId = item.productId || item.id;
        if (!productId) continue;
        const product = catalogProducts.get(productId);
        if (isCustomizableProduct(product)) {
            ineligibleItems.push({
                id: productId,
                name: product?.name || item.name || productId,
            });
        }
    }

    if (ineligibleItems.length > 0) {
        const itemNames = ineligibleItems.map((i) => `'${i.name}'`).join(", ");
        return {
            isEligible: false,
            code: "COD_NOT_ALLOWED_CUSTOM_PRODUCT",
            reason: `Cash on Delivery is not available for orders containing customizable or personalized items (${itemNames}). Please select an online payment method to complete your purchase.`,
            ineligibleItems,
        };
    }

    return { isEligible: true };
}
