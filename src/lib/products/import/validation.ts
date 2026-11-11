/**
 * Bazaarvilla Shopify-Compatible CSV Bulk Product Import (TASK 030)
 * Validation & Field Diff Engine for Previews & Existing Product Updates
 */

import { isCustomizableProduct } from "../../orders/customizationEligibility.ts";
import type {
    ParsedProductGroup,
    ProductImportPreview,
    ProductFieldDiff,
    ImportMode,
    ImportValidationError,
    ImportValidationWarning,
    ImportPreviewSummary,
} from "./types.ts";

/**
 * Validates a parsed product group against existing Firestore catalog state (dry-run).
 * Generates field-level diffs, price change alerts, stock change alerts, and conflict warnings.
 */
export function buildProductPreview(options: {
    group: ParsedProductGroup;
    existingProduct?: any; // Live Firestore product document data
    mode: ImportMode;
}): ProductImportPreview {
    const { group, existingProduct, mode } = options;

    const diffs: ProductFieldDiff[] = [];
    const errors: ImportValidationError[] = [...group.errors];
    const warnings: ImportValidationWarning[] = [...group.warnings];

    let status: "new" | "existing_update" | "conflict" | "invalid" | "skipped" = "new";

    // 1. Price Safety Invariant: New products must have a valid positive base price
    if (!existingProduct) {
        if (isNaN(group.basePrice) || group.basePrice <= 0) {
            errors.push({
                rowNumber: group.firstRowNumber,
                handle: group.handle,
                field: "price",
                providedValue: String(group.basePrice),
                message: `New product '${group.title}' has invalid or missing base price (${group.basePrice}). Products cannot be created with missing or zero price.`,
                suggestedCorrection: "Provide a valid positive number for product base price.",
                fatal: true,
            });
        }
    }

    // 2. Variant Price and Inventory Safety Invariants
    for (const v of group.variants) {
        if (isNaN(v.inventory) || v.inventory < 0) {
            errors.push({
                rowNumber: v.csvRowNumber,
                handle: group.handle,
                field: "inventory",
                providedValue: String(v.inventory),
                message: `Variant '${v.sku || v.sizeName || "item"}' on '${group.title}' has negative stock count (${v.inventory}). Inventory cannot be negative.`,
                suggestedCorrection: "Provide a non-negative integer for inventory (0 or greater).",
                fatal: true,
            });
        }
        if (v.price !== null && v.price !== undefined && (isNaN(v.price) || v.price <= 0)) {
            errors.push({
                rowNumber: v.csvRowNumber,
                handle: group.handle,
                field: "price",
                providedValue: String(v.price),
                message: `Variant '${v.sku || v.sizeName || "item"}' on '${group.title}' has non-positive price override (${v.price}). Variant prices must be positive numbers.`,
                suggestedCorrection: "Provide a positive price override or leave blank to inherit base price.",
                fatal: true,
            });
        }
    }

    // 3. Image completeness warning on new products
    if (!existingProduct && group.images.length === 0) {
        warnings.push({
            rowNumber: group.firstRowNumber,
            handle: group.handle,
            field: "images",
            providedValue: "none",
            message: `New product '${group.title}' has no image URLs in the CSV. Products without photographs will render fallback placeholder imagery.`,
        });
    }

    // If initial grouping or validations found fatal errors, mark invalid immediately
    if (errors.some(e => e.fatal)) {
        status = "invalid";
    }

    if (existingProduct) {
        // Matched an existing product
        if (mode === "create_only") {
            status = "conflict";
            warnings.push({
                rowNumber: group.firstRowNumber,
                handle: group.handle,
                field: "handle",
                providedValue: group.handle,
                message: `Product with handle '${group.handle}' already exists in catalog. In 'Create New Products' mode, this product will be skipped to protect existing data.`,
            });
        } else {
            status = errors.some(e => e.fatal) ? "invalid" : "existing_update";
        }
    } else {
        // New product
        if (mode === "update_only") {
            status = "skipped";
            warnings.push({
                rowNumber: group.firstRowNumber,
                handle: group.handle,
                field: "handle",
                providedValue: group.handle,
                message: `Product with handle '${group.handle}' does not exist in catalog. In 'Update Existing Products' mode, this product will be skipped.`,
            });
        } else {
            status = errors.some(e => e.fatal) ? "invalid" : "new";
        }
    }

    // Compute field-by-field diffs if existing product exists
    let priceChange: { from: number; to: number } | undefined = undefined;
    let inventoryChange: { from: number; to: number; sellableDelta: number } | undefined = undefined;
    let personalizationChange: any = undefined;

    if (existingProduct) {
        // 1. Title / Name
        if (group.title && group.title !== existingProduct.name) {
            diffs.push({
                field: "name",
                label: "Product Name",
                oldValue: existingProduct.name,
                newValue: group.title,
                action: "update",
            });
        }

        // 2. Base Price
        if (group.basePrice > 0 && group.basePrice !== existingProduct.price) {
            priceChange = { from: existingProduct.price, to: group.basePrice };
            diffs.push({
                field: "price",
                label: "Base Price",
                oldValue: `₹${existingProduct.price}`,
                newValue: `₹${group.basePrice}`,
                action: "update",
                warning: `Price will change from ₹${existingProduct.price} to ₹${group.basePrice}`,
            });
        }

        // 3. Inventory
        if (!group.hasExplicitInventory) {
            diffs.push({
                field: "inventory",
                label: "Sellable Inventory",
                oldValue: `${existingProduct.inventory ?? 0} units`,
                newValue: `${existingProduct.inventory ?? 0} units`,
                action: "preserve",
            });
        } else {
            const csvSellableStock = group.variants.reduce((acc, v) => acc + (v.isActive !== false ? v.inventory : 0), 0);
            const existingStock = typeof existingProduct.inventory === "number" ? existingProduct.inventory : 0;

            if (csvSellableStock !== existingStock) {
                const delta = csvSellableStock - existingStock;
                inventoryChange = { from: existingStock, to: csvSellableStock, sellableDelta: delta };
                diffs.push({
                    field: "inventory",
                    label: "Sellable Inventory",
                    oldValue: `${existingStock} units`,
                    newValue: `${csvSellableStock} units`,
                    action: "update",
                    warning: `Inventory will adjust by ${delta >= 0 ? `+${delta}` : delta} units`,
                });
            }
        }

        // 4. Personalization & COD Protection (TASK 027 Integrity Guard)
        const oldIsCustom = isCustomizableProduct(existingProduct);
        const oldCustomType = existingProduct.customizationType || null;
        const newIsCustom = group.isCustomized;
        const newCustomType = group.customizationType || null;

        // CRITICAL: Omitting customization columns must NOT silently remove existing personalization settings!
        if (oldIsCustom && !group.isCustomized && !group.customizationType) {
            warnings.push({
                rowNumber: group.firstRowNumber,
                handle: group.handle,
                field: "customizationType",
                providedValue: "omitted",
                message: `Existing product has personalization active ('${oldCustomType}'). The CSV omitted customization columns. Existing personalization settings will be safely preserved.`,
            });
            diffs.push({
                field: "customizationType",
                label: "Personalization Setting",
                oldValue: oldCustomType || "Active",
                newValue: oldCustomType || "Active",
                action: "preserve",
            });
        } else if (oldIsCustom !== newIsCustom || oldCustomType !== newCustomType) {
            personalizationChange = {
                from: { isCustomized: oldIsCustom, customizationType: oldCustomType },
                to: { isCustomized: newIsCustom, customizationType: newCustomType },
            };
            diffs.push({
                field: "customizationType",
                label: "Personalization Setting",
                oldValue: oldCustomType ? `${oldCustomType} (Prepaid only)` : "None (COD eligible)",
                newValue: newCustomType ? `${newCustomType} (Prepaid only)` : "None (COD eligible)",
                action: "update",
                warning: newIsCustom
                    ? "Product will be marked personalized. Cash on Delivery (COD) will be disabled at checkout."
                    : "Personalization removed. Cash on Delivery will become available.",
            });
        }

        // 5. Visibility / Published Status
        // Existing visible products retain visibility unless an explicit change is made
        if (existingProduct.isVisible && !group.isVisible) {
            warnings.push({
                rowNumber: group.firstRowNumber,
                handle: group.handle,
                field: "isVisible",
                providedValue: "draft / false",
                message: "Existing product is currently visible on the storefront. CSV specifies draft status.",
            });
        }

        // 6. Missing CSV variants safeguard: missing variants must not be automatically deleted
        if (Array.isArray(existingProduct.variants) && existingProduct.variants.length > 0) {
            const csvVariantCount = group.variants.length;
            const existingVariantCount = existingProduct.variants.length;

            if (csvVariantCount < existingVariantCount && !group.isSimpleProduct) {
                warnings.push({
                    rowNumber: group.firstRowNumber,
                    handle: group.handle,
                    field: "variants",
                    providedValue: `${csvVariantCount} variants`,
                    message: `CSV contains fewer variants (${csvVariantCount}) than existing catalog record (${existingVariantCount}). Missing variants will be preserved in accordance with catalog safety rules.`,
                });
            }
        }
    } else {
        // New Product diffs
        diffs.push({
            field: "name",
            label: "Product Name",
            oldValue: "—",
            newValue: group.title,
            action: "create",
        });
        diffs.push({
            field: "price",
            label: "Base Price",
            oldValue: "—",
            newValue: `₹${group.basePrice}`,
            action: "create",
        });
        const initialStock = group.variants.reduce((acc, v) => acc + (v.isActive !== false ? v.inventory : 0), 0);
        diffs.push({
            field: "inventory",
            label: "Sellable Inventory",
            oldValue: "—",
            newValue: `${initialStock} units`,
            action: "create",
        });
    }

    return {
        handle: group.handle,
        title: group.title,
        status,
        existingProductId: existingProduct?.id,
        existingProductSnapshot: existingProduct,
        diffs,
        priceChange,
        inventoryChange,
        personalizationChange,
        variantCount: group.variants.length,
        imagesCount: group.images.length,
        expectedR2Uploads: group.images.filter(img => !img.url.includes("/api/media/public/")).length,
        errors,
        warnings,
        parsedGroup: group,
    };
}

/**
 * Builds the complete preview summary across all parsed products and raw rows.
 */
export function buildPreviewSummary(options: {
    previews: ProductImportPreview[];
    totalRows: number;
    unsupportedHeaders: Array<{ header: string; reason: string }>;
    detectedFormat: any;
}): ImportPreviewSummary {
    const { previews, totalRows, unsupportedHeaders, detectedFormat } = options;

    let newProducts = 0;
    let existingProducts = 0;
    let conflictingProducts = 0;
    let invalidProducts = 0;
    let totalVariants = 0;
    let totalImages = 0;
    let expectedR2Transfers = 0;
    let errorCount = 0;
    let warningCount = 0;
    let priceChangeCount = 0;
    let inventoryChangeCount = 0;
    let personalizationChangeCount = 0;
    let draftCount = 0;
    let publishedCount = 0;

    for (const p of previews) {
        if (p.status === "new") newProducts++;
        else if (p.status === "existing_update") existingProducts++;
        else if (p.status === "conflict") conflictingProducts++;
        else if (p.status === "invalid") invalidProducts++;

        totalVariants += p.variantCount;
        totalImages += p.imagesCount;
        expectedR2Transfers += p.expectedR2Uploads;
        errorCount += p.errors.length;
        warningCount += p.warnings.length;

        if (p.priceChange) priceChangeCount++;
        if (p.inventoryChange) inventoryChangeCount++;
        if (p.personalizationChange) personalizationChangeCount++;

        if (p.parsedGroup.isVisible) publishedCount++;
        else draftCount++;
    }

    const canProceedWithImport = invalidProducts === 0 && errorCount === 0 && previews.length > 0;

    return {
        totalRows,
        totalProducts: previews.length,
        newProducts,
        existingProducts,
        conflictingProducts,
        invalidProducts,
        totalVariants,
        totalImages,
        expectedR2Transfers,
        errorCount,
        warningCount,
        priceChangeCount,
        inventoryChangeCount,
        personalizationChangeCount,
        draftCount,
        publishedCount,
        productPreviews: previews,
        unsupportedHeaders,
        detectedFormat,
        canProceedWithImport,
    };
}
