/**
 * Bazaarvilla Flexible Product Variants & Inventory Model (TASK 029)
 *
 * Isomorphic, browser-safe and server-compatible utilities for product sizing,
 * dimensions, color variants, variant matrix generation, and inventory integrity.
 */

export type SizeMode = "none" | "apparel" | "free_size" | "dimensions" | "custom";

export type DimensionUnit = "cm" | "mm" | "inch" | "in" | "m" | "ft";

export interface SizeDimension {
    width?: number;
    height?: number;
    depth?: number;
    length?: number;
    unit: DimensionUnit;
}

export interface SizeOption {
    id: string; // Stable internal identifier, e.g. "size_s", "size_m"
    name: string; // Display label, e.g. "S", "Small", "Free Size", "8-inch"
    dimensions?: SizeDimension;
    order?: number;
    isActive?: boolean;
}

export interface ColorOption {
    id: string; // Stable internal identifier, e.g. "col_black", "col_blue"
    name: string; // Display name, e.g. "Midnight Black", "Royal Blue"
    hex?: string; // Optional CSS hex or color swatch, e.g. "#1e3a8a"
    image?: string; // Optional image key/URL for this color
    isActive?: boolean;
}

export interface ProductVariant {
    id: string; // Stable variant identifier, e.g. "var_s_black" or uuid
    sizeId?: string;
    sizeName?: string;
    colorId?: string;
    colorName?: string;
    sku?: string;
    price?: number | null; // Optional override; if null/undefined, uses base product price
    compareAtPrice?: number | null; // Optional original/MRP override; if null/undefined, inherited or suppressed
    inventory: number; // Variant-specific inventory count (>= 0)
    isActive: boolean; // Enabled/disabled state
    image?: string; // Variant-specific photo URL or R2 key
    dimensions?: SizeDimension;
    createdAt?: number; // Stable creation timestamp to detect recreated variants
    restoredFromReservation?: boolean;
    orphanedReservationId?: string;
}

export interface ProductVariantConfig {
    hasVariants?: boolean;
    sizeMode?: SizeMode;
    sizes?: SizeOption[];
    colors?: ColorOption[];
    variants?: ProductVariant[];
}

export const STANDARD_APPAREL_SIZES: string[] = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];

export const MAX_VARIANT_LIMIT = 100;

export interface VariantStockBreakdown {
    sellableStock: number;       // Sum of stock from active variants (isActive !== false)
    totalPhysicalStock: number;  // Total physical inventory across all variants (active + disabled)
    disabledStock: number;       // Physical inventory held in disabled variants (isActive === false)
    variantCount: number;
    activeVariantCount: number;
    disabledVariantCount: number;
}

/**
 * Authoritatively calculates aggregate inventory metrics across a product's variant collection.
 * Distinguishes between sellable inventory (purchasable by customers) and total physical stock.
 */
export function calculateVariantStockBreakdown(variants: ProductVariant[] = []): VariantStockBreakdown {
    let sellableStock = 0;
    let totalPhysicalStock = 0;
    let disabledStock = 0;
    let activeVariantCount = 0;
    let disabledVariantCount = 0;

    for (const v of variants) {
        const stock = (typeof v.inventory === "number" && !isNaN(v.inventory) && v.inventory > 0)
            ? Math.floor(v.inventory)
            : 0;

        totalPhysicalStock += stock;

        if (v.isActive !== false) {
            sellableStock += stock;
            activeVariantCount++;
        } else {
            disabledStock += stock;
            disabledVariantCount++;
        }
    }

    return {
        sellableStock,
        totalPhysicalStock,
        disabledStock,
        variantCount: variants.length,
        activeVariantCount,
        disabledVariantCount,
    };
}

/**
 * Formats structured dimensions into a clean human-readable label.
 * e.g. 26 × 26 cm or 20 × 20 × 5 cm
 */
export function formatDimensions(dim?: SizeDimension | null): string {
    if (!dim || typeof dim !== "object") return "";
    const parts: number[] = [];
    if (typeof dim.width === "number" && !isNaN(dim.width)) parts.push(dim.width);
    if (typeof dim.height === "number" && !isNaN(dim.height)) parts.push(dim.height);
    if (typeof dim.depth === "number" && !isNaN(dim.depth)) parts.push(dim.depth);
    else if (typeof dim.length === "number" && !isNaN(dim.length)) parts.push(dim.length);

    if (parts.length === 0) return "";
    const unit = dim.unit || "cm";
    return `${parts.join(" × ")} ${unit}`;
}

/**
 * Formats a size option into its full display string.
 * e.g. "Large — 26 × 26 cm" or "Small (20 × 20 cm)" or "XL"
 */
export function formatSizeDisplay(size?: SizeOption | null, style: "dash" | "parens" = "dash"): string {
    if (!size) return "";
    const dimStr = formatDimensions(size.dimensions);
    if (!dimStr) return size.name;
    return style === "dash" ? `${size.name} — ${dimStr}` : `${size.name} (${dimStr})`;
}

/**
 * Formats a variant summary label combining size, dimensions, and color.
 * e.g. "Large (26 × 26 cm) / Blue" or "XL / Black" or "Blue" or "Free Size"
 */
export function formatVariantTitle(variant: {
    sizeName?: string;
    colorName?: string;
    dimensions?: SizeDimension;
}): string {
    const parts: string[] = [];
    if (variant.sizeName) {
        const dimStr = formatDimensions(variant.dimensions);
        parts.push(dimStr ? `${variant.sizeName} (${dimStr})` : variant.sizeName);
    }
    if (variant.colorName) {
        parts.push(variant.colorName);
    }
    return parts.length > 0 ? parts.join(" / ") : "Standard";
}

/**
 * Creates a deterministic combination ID from size and color IDs.
 */
export function buildCombinationId(sizeId?: string | null, colorId?: string | null): string {
    const s = sizeId ? sizeId.trim() : "";
    const c = colorId ? colorId.trim() : "";
    if (s && c) return `var_${s}_${c}`;
    if (s) return `var_${s}`;
    if (c) return `var_${c}`;
    return "var_default";
}

/**
 * Generates an automatic SKU for a variant based on base product SKU or slug.
 */
export function generateVariantSku(
    baseSkuOrSlug: string,
    sizeName?: string | null,
    colorName?: string | null
): string {
    const cleanBase = (baseSkuOrSlug || "PRD").toUpperCase().replace(/[^A-Z0-9]/g, "-").slice(0, 12);
    const cleanSize = sizeName ? sizeName.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
    const cleanColor = colorName ? colorName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) : "";

    const parts = [cleanBase];
    if (cleanColor) parts.push(cleanColor);
    if (cleanSize) parts.push(cleanSize);
    return parts.join("-");
}

/**
 * Generates a full variant matrix combining selected sizes and colors.
 * Reconciles with existing variants to preserve historical SKUs, prices, stock, and images.
 * Hardened to reject oversized matrices (> 100) without silent truncation, preserving
 * the existing valid matrix and utilizing conservative stock defaults (0).
 */
export function generateVariantMatrix(
    sizes: SizeOption[],
    colors: ColorOption[],
    options?: {
        existingVariants?: ProductVariant[];
        baseSku?: string;
        basePrice?: number;
        defaultStock?: number;
        maxLimit?: number;
    }
): {
    variants: ProductVariant[];
    exceededLimit: boolean;
    error?: string;
    requestedCount?: number;
    limit?: number;
} {
    const activeSizes = sizes.filter(s => s.isActive !== false);
    const activeColors = colors.filter(c => c.isActive !== false);
    const limit = options?.maxLimit ?? MAX_VARIANT_LIMIT;

    // Calculate total requested combinations before generating
    let requestedCount = 0;
    if (activeSizes.length > 0 && activeColors.length > 0) {
        requestedCount = activeSizes.length * activeColors.length;
    } else if (activeSizes.length > 0) {
        requestedCount = activeSizes.length;
    } else if (activeColors.length > 0) {
        requestedCount = activeColors.length;
    }

    // TASK 029 Hardening: NEVER silently truncate combinations to limit.
    // Reject generation with a descriptive validation error, explain the limit,
    // and preserve the previous valid matrix.
    if (requestedCount > limit) {
        return {
            variants: options?.existingVariants ? [...options.existingVariants] : [],
            exceededLimit: true,
            requestedCount,
            limit,
            error: `Cannot generate variants: ${requestedCount} combinations were requested, which exceeds the supported limit of ${limit}. Please reduce the number of active sizes or colors.`,
        };
    }

    const existingMap = new Map<string, ProductVariant>();
    if (Array.isArray(options?.existingVariants)) {
        for (const v of options.existingVariants) {
            existingMap.set(buildCombinationId(v.sizeId, v.colorId), v);
            if (v.id) existingMap.set(v.id, v);
        }
    }

    const result: ProductVariant[] = [];
    const defaultStock = options?.defaultStock ?? 0; // Conservative stock default

    // Case 1: Size + Color
    if (activeSizes.length > 0 && activeColors.length > 0) {
        for (const s of activeSizes) {
            for (const c of activeColors) {
                const comboId = buildCombinationId(s.id, c.id);
                const existing = existingMap.get(comboId);

                result.push({
                    id: existing?.id || comboId,
                    sizeId: s.id,
                    sizeName: s.name,
                    colorId: c.id,
                    colorName: c.name,
                    sku: existing?.sku || generateVariantSku(options?.baseSku || "SKU", s.name, c.name),
                    price: typeof existing?.price === "number" ? existing.price : null,
                    compareAtPrice: typeof existing?.compareAtPrice === "number" ? existing.compareAtPrice : null,
                    inventory: typeof existing?.inventory === "number" ? existing.inventory : defaultStock,
                    isActive: existing?.isActive !== undefined ? existing.isActive : true,
                    image: existing?.image || c.image || undefined,
                    dimensions: s.dimensions,
                    createdAt: existing?.createdAt || Date.now(),
                });
            }
        }
    }
    // Case 2: Size only
    else if (activeSizes.length > 0) {
        for (const s of activeSizes) {
            const comboId = buildCombinationId(s.id, undefined);
            const existing = existingMap.get(comboId);

            result.push({
                id: existing?.id || comboId,
                sizeId: s.id,
                sizeName: s.name,
                sku: existing?.sku || generateVariantSku(options?.baseSku || "SKU", s.name, undefined),
                price: typeof existing?.price === "number" ? existing.price : null,
                compareAtPrice: typeof existing?.compareAtPrice === "number" ? existing.compareAtPrice : null,
                inventory: typeof existing?.inventory === "number" ? existing.inventory : defaultStock,
                isActive: existing?.isActive !== undefined ? existing.isActive : true,
                image: existing?.image || undefined,
                dimensions: s.dimensions,
                createdAt: existing?.createdAt || Date.now(),
            });
        }
    }
    // Case 3: Color only
    else if (activeColors.length > 0) {
        for (const c of activeColors) {
            const comboId = buildCombinationId(undefined, c.id);
            const existing = existingMap.get(comboId);

            result.push({
                id: existing?.id || comboId,
                colorId: c.id,
                colorName: c.name,
                sku: existing?.sku || generateVariantSku(options?.baseSku || "SKU", undefined, c.name),
                price: typeof existing?.price === "number" ? existing.price : null,
                compareAtPrice: typeof existing?.compareAtPrice === "number" ? existing.compareAtPrice : null,
                inventory: typeof existing?.inventory === "number" ? existing.inventory : defaultStock,
                isActive: existing?.isActive !== undefined ? existing.isActive : true,
                image: existing?.image || c.image || undefined,
                createdAt: existing?.createdAt || Date.now(),
            });
        }
    }

    return { variants: result, exceededLimit: false, requestedCount, limit };
}

/**
 * Resolves the matching variant for a given size and/or color selection.
 */
export function resolveMatchingVariant(
    variants: ProductVariant[] | undefined | null,
    selection: {
        sizeId?: string | null;
        colorId?: string | null;
        sizeName?: string | null;
        colorName?: string | null;
        variantId?: string | null;
    }
): ProductVariant | null {
    if (!Array.isArray(variants) || variants.length === 0) {
        return null;
    }

    // Direct ID match
    if (selection.variantId) {
        const direct = variants.find(v => v.id === selection.variantId);
        if (direct) return direct;
    }

    // Match by sizeId/colorId or fallback to sizeName/colorName
    return variants.find(v => {
        const sizeMatches = selection.sizeId
            ? v.sizeId === selection.sizeId
            : selection.sizeName
            ? (v.sizeName || "").toLowerCase() === selection.sizeName.toLowerCase()
            : !v.sizeId && !v.sizeName;

        const colorMatches = selection.colorId
            ? v.colorId === selection.colorId
            : selection.colorName
            ? (v.colorName || "").toLowerCase() === selection.colorName.toLowerCase()
            : !v.colorId && !v.colorName;

        return sizeMatches && colorMatches;
    }) || null;
}

/**
 * Returns the effective customer-facing price for a variant or base product.
 */
export function getEffectivePrice(basePrice: number, variant?: ProductVariant | null): number {
    if (variant && typeof variant.price === "number" && !isNaN(variant.price) && variant.price >= 0) {
        return variant.price;
    }
    return Number(basePrice) || 0;
}

/**
 * Calculates discount percentage given a selling price and original price.
 * Formula: Math.round(((originalPrice - sellingPrice) / originalPrice) * 100)
 * Returns 0 if prices are equal, original <= selling, or values are invalid.
 */
export function calculateDiscountPercentage(sellingPrice: number, originalPrice: number | null | undefined): number {
    if (
        typeof originalPrice !== "number" ||
        !Number.isFinite(originalPrice) ||
        originalPrice <= 0 ||
        typeof sellingPrice !== "number" ||
        !Number.isFinite(sellingPrice) ||
        sellingPrice <= 0 ||
        originalPrice <= sellingPrice
    ) {
        return 0;
    }
    const discount = Math.round(((originalPrice - sellingPrice) / originalPrice) * 100);
    return Number.isFinite(discount) && discount > 0 ? discount : 0;
}

export interface EffectivePricing {
    sellingPrice: number;
    originalPrice: number | null;
    discountPercentage: number;
    savings: number;
    hasDiscount: boolean;
}

/**
 * Calculates effective selling price, original price, discount percentage, and customer savings
 * for a product, taking into account variant overrides and fallback rules.
 *
 * Rules:
 * 1. Selling price uses variant.price override if present, else basePrice.
 * 2. If variant has an explicit positive compareAtPrice override, that is its original price.
 * 3. If variant has a custom selling price override differing from basePrice but NO compareAtPrice override:
 *    Suppress discount (never pair a variant's selling price with an unrelated original price).
 * 4. If variant inherits base price (or no variant selected) and baseCompareAtPrice is valid:
 *    Use baseCompareAtPrice.
 * 5. If originalPrice <= sellingPrice or discountPercentage <= 0, no discount is displayed.
 */
export function getEffectivePricing(
    basePrice: number,
    baseCompareAtPrice?: number | null,
    variant?: ProductVariant | null
): EffectivePricing {
    const rawSellingPrice = getEffectivePrice(basePrice, variant);
    const sellingPrice = (typeof rawSellingPrice === "number" && Number.isFinite(rawSellingPrice) && rawSellingPrice > 0)
        ? Math.round(rawSellingPrice)
        : 0;

    let originalPrice: number | null = null;

    if (variant && typeof variant.compareAtPrice === "number" && Number.isFinite(variant.compareAtPrice) && variant.compareAtPrice > 0) {
        // Variant has its own explicit compareAtPrice override
        originalPrice = Math.round(variant.compareAtPrice);
    } else if (
        variant &&
        typeof variant.price === "number" &&
        Number.isFinite(variant.price) &&
        variant.price !== basePrice
    ) {
        // Variant has a custom price override that differs from base price, but NO compareAtPrice override.
        // Never show a misleading discount pairing one variant's selling price with another's original price.
        originalPrice = null;
    } else if (typeof baseCompareAtPrice === "number" && Number.isFinite(baseCompareAtPrice) && baseCompareAtPrice > 0) {
        // Inherits base compareAtPrice
        originalPrice = Math.round(baseCompareAtPrice);
    }

    if (originalPrice !== null && originalPrice > sellingPrice && sellingPrice > 0) {
        const discountPercentage = calculateDiscountPercentage(sellingPrice, originalPrice);
        if (discountPercentage > 0) {
            return {
                sellingPrice,
                originalPrice,
                discountPercentage,
                savings: originalPrice - sellingPrice,
                hasDiscount: true,
            };
        }
    }

    return {
        sellingPrice,
        originalPrice: null,
        discountPercentage: 0,
        savings: 0,
        hasDiscount: false,
    };
}

/**
 * Validates a variant configuration for uniqueness, bounds, and consistency.
 */
export function validateVariantConfiguration(config: ProductVariantConfig): {
    isValid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    if (!config.hasVariants) {
        return { isValid: true, errors: [] };
    }

    const sizes = Array.isArray(config.sizes) ? config.sizes : [];
    const colors = Array.isArray(config.colors) ? config.colors : [];
    const variants = Array.isArray(config.variants) ? config.variants : [];

    // Check size IDs uniqueness
    const sizeIds = new Set<string>();
    for (const s of sizes) {
        if (!s.id || !s.name?.trim()) {
            errors.push("All size options must have a valid identifier and name.");
        }
        if (sizeIds.has(s.id)) {
            errors.push(`Duplicate size option identifier: '${s.id}'.`);
        }
        sizeIds.add(s.id);
    }

    // Check color IDs uniqueness
    const colorIds = new Set<string>();
    for (const c of colors) {
        if (!c.id || !c.name?.trim()) {
            errors.push("All color options must have a valid identifier and name.");
        }
        if (colorIds.has(c.id)) {
            errors.push(`Duplicate color option identifier: '${c.id}'.`);
        }
        colorIds.add(c.id);
    }

    // Check variants matrix bounds
    if (variants.length > MAX_VARIANT_LIMIT) {
        errors.push(`Variant count (${variants.length}) exceeds the maximum allowed limit of ${MAX_VARIANT_LIMIT}.`);
    }

    // Check variant IDs, SKUs uniqueness, and combination pairs
    const variantIds = new Set<string>();
    const skus = new Set<string>();
    const combinationPairs = new Set<string>();

    for (const v of variants) {
        if (!v.id) {
            errors.push("Every variant must have a valid identifier.");
        }
        if (variantIds.has(v.id)) {
            errors.push(`Duplicate variant identifier: '${v.id}'.`);
        }
        variantIds.add(v.id);

        const pairKey = `${v.sizeId || ""}:${v.colorId || ""}`;
        if (pairKey !== ":" && combinationPairs.has(pairKey)) {
            errors.push(`Duplicate variant combination detected for size '${v.sizeName || v.sizeId || "None"}' and color '${v.colorName || v.colorId || "None"}'.`);
        }
        if (pairKey !== ":") {
            combinationPairs.add(pairKey);
        }

        if (v.sku && v.sku.trim().length > 0) {
            const normalizedSku = v.sku.trim().toUpperCase();
            if (!/^[A-Za-z0-9-_]+$/.test(v.sku.trim())) {
                errors.push(`Variant '${v.id}' has invalid SKU format '${v.sku}'. SKUs may only contain letters, numbers, hyphens, and underscores.`);
            }
            if (skus.has(normalizedSku)) {
                errors.push(`Duplicate variant SKU detected: '${normalizedSku}'.`);
            }
            skus.add(normalizedSku);
        }

        if (typeof v.inventory === "number" && (isNaN(v.inventory) || v.inventory < 0 || !Number.isInteger(v.inventory))) {
            errors.push(`Variant '${v.id}' has invalid stock quantity: ${v.inventory}. Must be a non-negative integer.`);
        }

        if (v.price !== null && v.price !== undefined) {
            if (isNaN(v.price) || v.price < 0) {
                errors.push(`Variant '${v.id}' has invalid price override: ${v.price}. Must be a non-negative number.`);
            }
        }

        if (v.compareAtPrice !== null && v.compareAtPrice !== undefined) {
            if (isNaN(v.compareAtPrice) || v.compareAtPrice <= 0) {
                errors.push(`Variant '${v.id}' has invalid compare-at price override: ${v.compareAtPrice}. Must be a positive number.`);
            } else if (typeof v.price === "number" && v.compareAtPrice < v.price) {
                errors.push(`Variant '${v.id}' compare-at price (₹${v.compareAtPrice}) cannot be less than its selling price override (₹${v.price}).`);
            }
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
}

export interface ReconcileInventoryParams {
    formHasVariants: boolean;
    formVariants?: ProductVariant[];
    formInventory?: number;
    loadedProduct: {
        hasVariants?: boolean;
        variants?: ProductVariant[];
        inventory?: number;
    } | null;
    liveProduct: {
        hasVariants?: boolean;
        variants?: ProductVariant[];
        inventory?: number;
    } | null;
}

export interface ReconciledInventoryResult {
    inventory: number;
    totalPhysicalInventory: number;
    variants?: ProductVariant[];
}

/**
 * Reconciles inventory between admin form submission, original loaded product snapshot,
 * and live Firestore document state to prevent stale form data from clobbering
 * concurrent customer checkouts, reservations, or inventory updates.
 */
export function reconcileProductInventoryOnSave(params: ReconcileInventoryParams): ReconciledInventoryResult {
    const { formHasVariants, formVariants = [], formInventory = 0, loadedProduct, liveProduct } = params;

    // If no live product exists (new product creation), trust submitted form values
    if (!liveProduct) {
        if (formHasVariants && formVariants.length > 0) {
            const breakdown = calculateVariantStockBreakdown(formVariants);
            return {
                inventory: breakdown.sellableStock,
                totalPhysicalInventory: breakdown.totalPhysicalStock,
                variants: formVariants,
            };
        }
        const rootInv = Math.max(0, Number(formInventory) || 0);
        return {
            inventory: rootInv,
            totalPhysicalInventory: rootInv,
        };
    }

    // Product with variants
    if (formHasVariants && formVariants.length > 0) {
        const loadedVariants = loadedProduct?.variants || [];
        const liveVariants = liveProduct?.variants || [];

        const reconciledVariants = formVariants.map((fv) => {
            const origV = loadedVariants.find((ov) => ov.id === fv.id);
            const liveV = liveVariants.find((lv) => lv.id === fv.id);

            if (liveV) {
                // If loaded snapshot is available, check whether admin explicitly edited this variant's stock
                const adminEditedStock = origV ? (fv.inventory !== origV.inventory) : false;
                let finalInventory = liveV.inventory;

                if (adminEditedStock && origV) {
                    // Admin intended a change: apply delta to live stock so interim customer purchases are preserved
                    const delta = fv.inventory - origV.inventory;
                    finalInventory = Math.max(0, (liveV.inventory || 0) + delta);
                } else if (!adminEditedStock && origV) {
                    // Admin did NOT touch inventory: preserve live inventory (e.g. customer purchased interim units)
                    finalInventory = liveV.inventory;
                } else {
                    // No original snapshot: if form matches live, keep live; otherwise trust form
                    finalInventory = fv.inventory;
                }

                return {
                    ...fv,
                    inventory: finalInventory,
                    createdAt: liveV.createdAt || origV?.createdAt || fv.createdAt || Date.now(),
                };
            }

            // Brand new variant added by admin
            return {
                ...fv,
                createdAt: fv.createdAt || Date.now(),
            };
        });

        const breakdown = calculateVariantStockBreakdown(reconciledVariants);
        return {
            inventory: breakdown.sellableStock,
            totalPhysicalInventory: breakdown.totalPhysicalStock,
            variants: reconciledVariants,
        };
    }

    // Legacy product without variants
    const loadedInv = loadedProduct?.inventory;
    const liveInv = typeof liveProduct.inventory === "number" ? liveProduct.inventory : 0;
    let finalRootInv = Number(formInventory) || 0;

    if (typeof loadedInv === "number") {
        const adminEditedStock = formInventory !== loadedInv;
        if (!adminEditedStock) {
            // Admin made unrelated edit (e.g. price/name); preserve live customer deductions
            finalRootInv = liveInv;
        } else {
            // Admin adjusted stock; apply delta to live stock
            const delta = (Number(formInventory) || 0) - loadedInv;
            finalRootInv = Math.max(0, liveInv + delta);
        }
    } else {
        // No loaded inventory baseline; trust form
        finalRootInv = Math.max(0, Number(formInventory) || 0);
    }

    return {
        inventory: finalRootInv,
        totalPhysicalInventory: finalRootInv,
    };
}
