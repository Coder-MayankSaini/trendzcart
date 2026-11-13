/**
 * Bazaarvilla Shopify-to-Canonical CSV Converter & Normalizer (TASK 036)
 *
 * Implements deterministic conversion from Shopify export format to Bazaarvilla's
 * canonical product import CSV format:
 * - Groups product rows, supplementary image rows, and variant matrices
 * - Preserves all images with 1-based Image Position
 * - Decodes HTML entities and normalizes line breaks in descriptions
 * - Maps selling price and compare-at (MRP) price (preserving TASK 034 dual-pricing)
 * - Converts single-option specifications into structured Attributes
 * - Retains true multi-variant options (Size / Color)
 * - Identifies unmapped Shopify fields and generates conversion warnings
 */

import Papa from "papaparse";
import { groupCsvRows } from "./grouping.ts";
import { formatSafeCsvRow } from "./sanitizer.ts";
import type { RawCsvRow } from "./types.ts";

export const BAZAARVILLA_CANONICAL_HEADERS = [
    "Handle",
    "Title",
    "Description",
    "Category",
    "SKU",
    "Price",
    "Compare At Price",
    "Stock",
    "Image Src",
    "Image Position",
    "Attributes",
    "Option1 Name",
    "Option1 Value",
    "Option2 Name",
    "Option2 Value",
    "Published",
] as const;

export interface ConversionSummary {
    totalProducts: number;
    totalRows: number;
    totalImages: number;
    mappedFields: string[];
    unmappedFields: string[];
    warnings: string[];
}

export interface ConversionResult {
    success: boolean;
    convertedCsv: string;
    summary: ConversionSummary;
    error?: string;
}

export function convertShopifyToBazaarvillaCsv(shopifyCsvText: string): ConversionResult {
    if (!shopifyCsvText || !shopifyCsvText.trim()) {
        return {
            success: false,
            convertedCsv: "",
            summary: {
                totalProducts: 0,
                totalRows: 0,
                totalImages: 0,
                mappedFields: [],
                unmappedFields: [],
                warnings: ["Empty CSV content provided"],
            },
            error: "CSV content cannot be empty",
        };
    }

    const parseResult = Papa.parse<RawCsvRow>(shopifyCsvText, {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (h) => h.trim(),
    });

    const rawRows = parseResult.data || [];
    const rawHeaders = parseResult.meta.fields || [];

    if (rawRows.length === 0 || rawHeaders.length === 0) {
        return {
            success: false,
            convertedCsv: "",
            summary: {
                totalProducts: 0,
                totalRows: 0,
                totalImages: 0,
                mappedFields: [],
                unmappedFields: [],
                warnings: ["No data rows detected in CSV"],
            },
            error: "The provided CSV file contains no data rows or valid headers.",
        };
    }

    // Identify mapped and unmapped Shopify headers
    const knownShopifyMapped = new Set([
        "Handle",
        "Title",
        "Body (HTML)",
        "Vendor",
        "Type",
        "Product Category",
        "Tags",
        "Published",
        "Option1 Name",
        "Option1 Value",
        "Option2 Name",
        "Option2 Value",
        "Option3 Name",
        "Option3 Value",
        "Variant SKU",
        "Variant Inventory Qty",
        "Variant Price",
        "Variant Compare At Price",
        "Image Src",
        "Image Position",
    ]);

    const unmappedFields: string[] = [];
    const mappedFields: string[] = [];
    for (const h of rawHeaders) {
        if (knownShopifyMapped.has(h)) {
            mappedFields.push(h);
        } else {
            unmappedFields.push(h);
        }
    }

    // Group rows using the battle-tested grouping engine
    const { groups, fileErrors, fileWarnings } = groupCsvRows(rawRows);

    const warnings: string[] = [
        ...fileWarnings.map((w) => `Row ${w.rowNumber || "file"}: ${w.message}`),
        ...fileErrors.map((e) => `Row ${e.rowNumber || "file"}: ${e.message}`),
    ];

    const outputRows: string[][] = [
        [...BAZAARVILLA_CANONICAL_HEADERS],
    ];

    let totalImages = 0;

    for (const group of groups) {
        const primaryImage = group.images[0];
        const supplementaryImages = group.images.slice(1);
        totalImages += group.images.length;

        const primaryVariant = group.variants[0];
        const supplementaryVariants = group.hasVariantColumns && !group.isSimpleProduct
            ? group.variants.slice(1)
            : [];

        // Convert attributes into "Name: Value | Name: Value" format
        const attrString = (group.attributes || [])
            .map((a) => `${a.name}: ${a.value}`)
            .join(" | ");

        // 1. Primary Product Row
        const mainRow = [
            group.handle,
            group.title,
            group.description || "",
            group.category || "General",
            primaryVariant?.sku || "",
            group.basePrice > 0 ? String(group.basePrice) : "",
            group.compareAtPrice !== null && group.compareAtPrice !== undefined ? String(group.compareAtPrice) : "",
            String(primaryVariant?.inventory ?? 0),
            primaryImage?.url || "",
            primaryImage?.position ? String(primaryImage.position) : (primaryImage ? "1" : ""),
            attrString,
            group.hasVariantColumns && !group.isSimpleProduct && primaryVariant?.sizeName ? "Size" : "",
            group.hasVariantColumns && !group.isSimpleProduct && primaryVariant?.sizeName ? primaryVariant.sizeName : "",
            group.hasVariantColumns && !group.isSimpleProduct && primaryVariant?.colorName ? "Color" : "",
            group.hasVariantColumns && !group.isSimpleProduct && primaryVariant?.colorName ? primaryVariant.colorName : "",
            group.isVisible ? "true" : "false",
        ];
        outputRows.push(mainRow);

        // 2. Supplementary Image Rows (preserve gallery photos with position)
        for (const img of supplementaryImages) {
            const imgRow = [
                group.handle,
                "", // Title blank on supplementary rows
                "", // Description blank
                "", // Category blank
                "", // SKU blank
                "", // Price blank
                "", // Compare at price blank
                "", // Stock blank
                img.url,
                String(img.position || ""),
                "", // Attributes blank
                "", // Option1 Name blank
                "", // Option1 Value blank
                "", // Option2 Name blank
                "", // Option2 Value blank
                "", // Published blank
            ];
            outputRows.push(imgRow);
        }

        // 3. Supplementary Variant Rows (for true variants like clothing sizes/colors)
        for (const v of supplementaryVariants) {
            const vRow = [
                group.handle,
                "",
                "",
                "",
                v.sku || "",
                v.price !== null && v.price !== undefined ? String(v.price) : "",
                v.compareAtPrice !== null && v.compareAtPrice !== undefined ? String(v.compareAtPrice) : "",
                String(v.inventory ?? 0),
                v.imageUrl || "",
                "",
                "",
                v.sizeName ? "Size" : "",
                v.sizeName || "",
                v.colorName ? "Color" : "",
                v.colorName || "",
                "",
            ];
            outputRows.push(vRow);
        }
    }

    const convertedCsv = outputRows.map(formatSafeCsvRow).join("\r\n") + "\r\n";

    return {
        success: true,
        convertedCsv,
        summary: {
            totalProducts: groups.length,
            totalRows: outputRows.length - 1, // Exclude header
            totalImages,
            mappedFields: Array.from(new Set(mappedFields)),
            unmappedFields: Array.from(new Set(unmappedFields)),
            warnings,
        },
    };
}
