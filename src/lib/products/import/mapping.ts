/**
 * Bazaarvilla Shopify-Compatible CSV Bulk Product Import (TASK 030)
 * Column Mapping & Format Detection Engine
 */

import type {
    ColumnMappingItem,
    ColumnMappingResult,
    CsvFormatType,
} from "./types.ts";

/**
 * Standard column aliases dictionary. Keys are normalized Bazaarvilla target fields,
 * values are lists of lowercase, trimmed header strings commonly found in Shopify exports,
 * legacy templates, or custom Bazaarvilla CSVs.
 */
export const TARGET_FIELD_ALIASES: Record<string, string[]> = {
    handle: ["handle", "url handle", "slug", "product handle", "product slug", "url_handle"],
    title: ["title", "name", "product name", "product title", "product_name"],
    description: [
        "body (html)",
        "body html",
        "description",
        "body",
        "product description",
        "body_html",
        "details",
    ],
    vendor: ["vendor", "brand", "manufacturer"],
    category: [
        "product category",
        "type",
        "product type",
        "category",
        "product_category",
        "product_type",
    ],
    tags: ["tags", "tag", "keywords"],
    published: ["published", "status", "is_visible", "visible", "state"],
    option1_name: ["option1 name", "option 1 name", "option1_name", "first option name"],
    option1_value: ["option1 value", "option 1 value", "option1_value", "first option value"],
    option2_name: ["option2 name", "option 2 name", "option2_name", "second option name"],
    option2_value: ["option2 value", "option 2 value", "option2_value", "second option value"],
    option3_name: ["option3 name", "option 3 name", "option3_name", "third option name"],
    option3_value: ["option3 value", "option 3 value", "option3_value", "third option value"],
    sku: ["variant sku", "sku", "variant_sku", "item sku"],
    price: ["variant price", "price", "variant_price", "selling price", "retail price"],
    compare_at_price: [
        "variant compare at price",
        "compare at price",
        "original price",
        "mrp",
        "compare_at_price",
        "strikethrough price",
    ],
    inventory: [
        "variant inventory qty",
        "inventory quantity",
        "quantity",
        "stock",
        "qty",
        "variant_inventory_qty",
        "inventory",
        "available",
    ],
    image_src: [
        "image src",
        "product image url",
        "image url",
        "image",
        "photo",
        "image_src",
        "image link",
    ],
    image_position: ["image position", "position", "image_position", "photo position", "sort order"],
    image_alt: ["image alt text", "alt text", "alt", "image_alt", "photo alt"],
    variant_image: ["variant image", "variant image url", "variant_image", "color image"],
    seo_title: ["seo title", "meta title", "page title"],
    seo_description: ["seo description", "meta description", "search description"],
    // Bazaarvilla-specific extensions
    bazaarvilla_product_id: ["product id", "bazaarvilla id", "id", "product_id"],
    is_customized: ["is customized", "customizable", "personalized", "is_customized", "is_personalized"],
    customization_type: ["customization type", "personalization type", "customization_type"],
    dimension_width: ["dimension width", "width", "width (cm)", "width_cm"],
    dimension_height: ["dimension height", "height", "height (cm)", "height_cm"],
    dimension_depth: ["dimension depth", "depth", "length", "depth (cm)", "depth_cm"],
    dimension_unit: ["dimension unit", "unit", "dimension_unit"],
};

/**
 * Known commercially significant columns that Shopify exports, but Bazaarvilla does not track.
 * These columns must not be silently ignored; they must be surfaced in the mapping preview
 * with an explanatory reason.
 */
export const UNSUPPORTED_SHOPIFY_COLUMNS: Record<string, string> = {
    "variant grams": "Bazaarvilla does not track item weight in grams for shipping calculations.",
    "variant weight unit": "Item weight units are not tracked.",
    "cost per item": "Bazaarvilla catalog does not store wholesale merchant acquisition costs.",
    "variant barcode": "Barcode identifiers (UPC/EAN/ISBN) are not currently indexed in catalog records.",
    "google shopping / google product category": "Google Shopping category tax mapping is not used in the Bazaarvilla storefront.",
    "google shopping / gender": "Google Shopping gender attributes are not mapped.",
    "google shopping / age group": "Google Shopping age group attributes are not mapped.",
    "google shopping / mpn": "Manufacturer Part Numbers (MPN) are not mapped.",
    "google shopping / condition": "Condition attributes are not mapped.",
    "google shopping / custom product": "Google Shopping custom product flags are not mapped.",
    "taxable": "All Bazaarvilla catalog prices are strictly all-inclusive of applicable taxes.",
    "variant tax code": "Product-level tax codes are not managed in catalog records.",
    "gift card": "Gift card product types are not supported by the Bazaarvilla catalog.",
    "variant inventory tracker": "Bazaarvilla provides its own authoritative inventory tracker.",
    "variant inventory policy": "Bazaarvilla enforces authoritative stock gating (deny on zero inventory).",
    "variant fulfillment service": "Fulfillment services are managed through Bazaarvilla's internal operations.",
    "variant requires shipping": "All catalog merchandise requires physical delivery.",
};

/**
 * Normalizes a header string for matching (lowercase, trimmed, strip quotes and punctuation).
 */
export function normalizeHeader(header: string): string {
    if (!header || typeof header !== "string") return "";
    return header
        .toLowerCase()
        .replace(/["'_]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Automatically detects whether the CSV matches Shopify Standard, Legacy, Bazaarvilla Template, or Custom.
 */
export function detectCsvFormat(headers: string[]): CsvFormatType {
    const normHeaders = new Set(headers.map(normalizeHeader));

    const hasHandle = normHeaders.has("handle") || normHeaders.has("url handle");
    const hasShopifyBody = normHeaders.has("body (html)") || normHeaders.has("body html");
    const hasShopifyOptions = normHeaders.has("option1 name") || normHeaders.has("option 1 name");
    const hasShopifyVariantPrice = normHeaders.has("variant price");
    const hasShopifyImageSrc = normHeaders.has("image src");

    const hasBazaarvillaId = normHeaders.has("bazaarvilla id") || normHeaders.has("product id");
    const hasBazaarvillaCustomization = normHeaders.has("customization type") || normHeaders.has("is customized");
    const hasExplicitDimensions = normHeaders.has("dimension width") || normHeaders.has("dimension unit");

    if (hasHandle && hasShopifyBody && (hasShopifyOptions || hasShopifyVariantPrice) && hasShopifyImageSrc) {
        return "shopify_standard";
    }

    if (hasHandle && (hasShopifyBody || normHeaders.has("description")) && normHeaders.has("price")) {
        return "shopify_legacy";
    }

    if (hasBazaarvillaId || hasBazaarvillaCustomization || hasExplicitDimensions) {
        return "bazaarvilla_template";
    }

    return "custom";
}

/**
 * Resolves column mappings for all headers in a CSV, identifying exact matches,
 * aliases, unsupported columns, and potential 3rd option incompatibilities.
 */
export function resolveColumnMapping(
    rawHeaders: string[],
    sampleRow?: Record<string, string>
): ColumnMappingResult {
    const mappings: ColumnMappingItem[] = [];
    const unsupportedHeaders: Array<{ header: string; reason: string }> = [];
    const recognizedHeaders: string[] = [];
    const mappedTargets = new Set<string>();

    let hasThirdOption = false;
    let thirdOptionName: string | undefined = undefined;

    for (const rawCol of rawHeaders) {
        const norm = normalizeHeader(rawCol);
        if (!norm) continue;

        const sampleVal = sampleRow ? sampleRow[rawCol] : undefined;

        // 1. Check if it matches a known unsupported column
        if (UNSUPPORTED_SHOPIFY_COLUMNS[norm]) {
            const reason = UNSUPPORTED_SHOPIFY_COLUMNS[norm];
            mappings.push({
                sourceColumn: rawCol,
                targetField: null,
                confidence: "unsupported",
                sampleValue: sampleVal,
                isIgnored: true,
                unsupportedReason: reason,
            });
            unsupportedHeaders.push({ header: rawCol, reason });
            continue;
        }

        // 2. Check alias dictionary
        let matchedTarget: string | null = null;
        let confidence: "exact" | "alias" = "exact";

        for (const [targetField, aliases] of Object.entries(TARGET_FIELD_ALIASES)) {
            if (aliases.includes(norm)) {
                matchedTarget = targetField;
                confidence = aliases[0] === norm ? "exact" : "alias";
                break;
            }
        }

        if (matchedTarget) {
            mappings.push({
                sourceColumn: rawCol,
                targetField: matchedTarget,
                confidence,
                sampleValue: sampleVal,
                isIgnored: false,
            });
            recognizedHeaders.push(rawCol);
            mappedTargets.add(matchedTarget);

            if (matchedTarget === "option3_name" || matchedTarget === "option3_value") {
                hasThirdOption = true;
                if (matchedTarget === "option3_name" && sampleVal) {
                    thirdOptionName = sampleVal;
                }
            }
        } else {
            // Unrecognized custom column
            mappings.push({
                sourceColumn: rawCol,
                targetField: null,
                confidence: "manual",
                sampleValue: sampleVal,
                isIgnored: true,
                unsupportedReason: "Unrecognized column header. Will not be mapped to product document.",
            });
            unsupportedHeaders.push({
                header: rawCol,
                reason: "Unrecognized column header. Will not be mapped to product document.",
            });
        }
    }

    // Determine missing required headers
    const missingRequired: string[] = [];
    if (!mappedTargets.has("handle")) missingRequired.push("Handle / Slug");
    if (!mappedTargets.has("title")) missingRequired.push("Title / Product Name");

    const formatDetected = detectCsvFormat(rawHeaders);

    return {
        formatDetected,
        mappings,
        unsupportedHeaders,
        recognizedHeaders,
        missingRequiredHeaders: missingRequired,
        hasThirdOption,
        thirdOptionName,
    };
}
