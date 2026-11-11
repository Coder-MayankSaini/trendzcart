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
    inventory: number; // Variant-specific inventory count (>= 0)
    isActive: boolean; // Enabled/disabled state
    image?: string; // Variant-specific photo URL or R2 key
    dimensions?: SizeDimension;
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
                    inventory: typeof existing?.inventory === "number" ? existing.inventory : defaultStock,
                    isActive: existing?.isActive !== undefined ? existing.isActive : true,
                    image: existing?.image || c.image || undefined,
                    dimensions: s.dimensions,
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
                inventory: typeof existing?.inventory === "number" ? existing.inventory : defaultStock,
                isActive: existing?.isActive !== undefined ? existing.isActive : true,
                image: existing?.image || undefined,
                dimensions: s.dimensions,
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
                inventory: typeof existing?.inventory === "number" ? existing.inventory : defaultStock,
                isActive: existing?.isActive !== undefined ? existing.isActive : true,
                image: existing?.image || c.image || undefined,
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
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
}
