/**
 * Bazaarvilla Shopify-Compatible CSV Bulk Product Import (TASK 030)
 * Multi-Row Product Grouping & Variant Extraction Engine
 */

import type {
    SizeMode,
    SizeOption,
    ColorOption,
} from "../variants.ts";
import { MAX_VARIANT_LIMIT } from "../variants.ts";
import { parseSizeString, buildExplicitDimensions } from "./dimensionsParser.ts";
import { sanitizeHtmlDescription } from "./sanitizer.ts";
import type {
    RawCsvRow,
    ParsedProductGroup,
    ParsedImageRow,
    ParsedVariantRow,
    ImportValidationError,
    ImportValidationWarning,
} from "./types.ts";
import { normalizeHeader, TARGET_FIELD_ALIASES } from "./mapping.ts";

/**
 * Normalizes product handle / slug string.
 */
export function normalizeHandle(rawHandle?: string | null): string {
    if (!rawHandle || typeof rawHandle !== "string") return "";
    return rawHandle
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");
}

/**
 * Normalizes boolean string (e.g. "true", "yes", "active", "1" -> true).
 */
export function parseBoolean(val?: string | null, defaultVal = false): boolean {
    if (!val || typeof val !== "string") return defaultVal;
    const lower = val.trim().toLowerCase();
    if (lower === "true" || lower === "yes" || lower === "active" || lower === "1" || lower === "published") {
        return true;
    }
    if (lower === "false" || lower === "no" || lower === "draft" || lower === "0" || lower === "hidden") {
        return false;
    }
    return defaultVal;
}

/**
 * Resolves value from a raw row by checking target field's aliases.
 */
function getRowFieldValue(row: RawCsvRow, targetField: string): string {
    const aliases = TARGET_FIELD_ALIASES[targetField] || [targetField];

    for (const key of Object.keys(row)) {
        const normKey = normalizeHeader(key);
        if (aliases.includes(normKey)) {
            const val = row[key];
            if (val !== undefined && val !== null && val.trim() !== "") {
                return val.trim();
            }
        }
    }
    return "";
}

/**
 * Determines whether an option name corresponds to Size or Color.
 */
function classifyOptionName(optName: string): "size" | "color" | "other" {
    const lower = optName.toLowerCase().trim();
    if (
        lower === "size" ||
        lower === "sizes" ||
        lower === "dimensions" ||
        lower === "dimension" ||
        lower === "size / dimensions" ||
        lower === "size/dimensions"
    ) {
        return "size";
    }
    if (
        lower === "color" ||
        lower === "colour" ||
        lower === "shade" ||
        lower === "colors" ||
        lower === "colours"
    ) {
        return "color";
    }
    // Shopify default for single-variant products
    if (lower === "title" || lower === "default") {
        return "other";
    }
    return "other";
}

/**
 * Groups raw CSV rows by normalized handle into distinct product groups.
 * Reconciles multi-row Shopify structures, variant matrices, and photos.
 */
export function groupCsvRows(rawRows: RawCsvRow[]): {
    groups: ParsedProductGroup[];
    fileErrors: ImportValidationError[];
    fileWarnings: ImportValidationWarning[];
} {
    const groupsByHandle = new Map<string, {
        firstRow: RawCsvRow;
        firstRowNumber: number;
        rows: Array<{ row: RawCsvRow; rowNumber: number }>;
    }>();

    const fileErrors: ImportValidationError[] = [];
    const fileWarnings: ImportValidationWarning[] = [];

    // Step 1: Cluster rows by normalized handle
    let currentRowIndex = 0;
    for (const row of rawRows) {
        currentRowIndex++;
        const rawHandle = getRowFieldValue(row, "handle");
        const rawTitle = getRowFieldValue(row, "title");

        // If both handle and title are missing on a row, skip or report error
        if (!rawHandle && !rawTitle) {
            fileWarnings.push({
                rowNumber: currentRowIndex,
                field: "handle",
                providedValue: "",
                message: `Row ${currentRowIndex} has neither Handle nor Title; skipped empty row.`,
            });
            continue;
        }

        const handle = normalizeHandle(rawHandle || rawTitle);

        if (!groupsByHandle.has(handle)) {
            groupsByHandle.set(handle, {
                firstRow: row,
                firstRowNumber: currentRowIndex,
                rows: [{ row, rowNumber: currentRowIndex }],
            });
        } else {
            groupsByHandle.get(handle)!.rows.push({ row, rowNumber: currentRowIndex });
        }
    }

    // Step 2: Process each product group
    const productGroups: ParsedProductGroup[] = [];
    const seenGlobalSkus = new Map<string, number>(); // sku -> first rowNumber

    for (const [handle, cluster] of groupsByHandle.entries()) {
        const errors: ImportValidationError[] = [];
        const warnings: ImportValidationWarning[] = [];
        const allRowNumbers = cluster.rows.map(r => r.rowNumber);

        // Parent-level metadata from first row (or subsequent if omitted in first)
        let title = getRowFieldValue(cluster.firstRow, "title");
        let description = getRowFieldValue(cluster.firstRow, "description");
        let vendor = getRowFieldValue(cluster.firstRow, "vendor");
        let category = getRowFieldValue(cluster.firstRow, "category");
        let tagsRaw = getRowFieldValue(cluster.firstRow, "tags");
        let publishedRaw = getRowFieldValue(cluster.firstRow, "published");
        let customizationTypeRaw = getRowFieldValue(cluster.firstRow, "customization_type");
        let isCustomizedRaw = getRowFieldValue(cluster.firstRow, "is_customized");

        // If parent metadata is empty on first row, find first non-empty in subsequent rows
        for (const item of cluster.rows) {
            if (!title) title = getRowFieldValue(item.row, "title");
            if (!description) description = getRowFieldValue(item.row, "description");
            if (!vendor) vendor = getRowFieldValue(item.row, "vendor");
            if (!category) category = getRowFieldValue(item.row, "category");
            if (!tagsRaw) tagsRaw = getRowFieldValue(item.row, "tags");
            if (!customizationTypeRaw) customizationTypeRaw = getRowFieldValue(item.row, "customization_type");
        }

        if (!title) {
            errors.push({
                rowNumber: cluster.firstRowNumber,
                handle,
                field: "title",
                providedValue: "",
                message: "Product title is required and cannot be empty.",
                suggestedCorrection: "Provide a valid product title.",
                fatal: true,
            });
        }

        // Safe publishing default: newly imported products default to draft (isVisible: false)
        // Only set true if explicitly published/active in CSV
        const isVisible = parseBoolean(publishedRaw, false);

        // Clean & sanitize description
        const cleanDescription = sanitizeHtmlDescription(description);

        // Tags parsing (comma separated)
        const tags = tagsRaw
            ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean)
            : [];

        // Personalization evaluation
        let isCustomized = parseBoolean(isCustomizedRaw, false);
        let customizationType: "requires_name" | "requires_picture" | null = null;

        if (customizationTypeRaw) {
            const normType = customizationTypeRaw.toLowerCase().trim();
            if (normType === "requires_name" || normType === "name" || normType === "text") {
                customizationType = "requires_name";
                isCustomized = true;
            } else if (normType === "requires_picture" || normType === "picture" || normType === "photo") {
                customizationType = "requires_picture";
                isCustomized = true;
            } else {
                warnings.push({
                    rowNumber: cluster.firstRowNumber,
                    handle,
                    field: "customization_type",
                    providedValue: customizationTypeRaw,
                    message: `Unrecognized customization type '${customizationTypeRaw}'. Supported types are 'requires_name' and 'requires_picture'.`,
                });
            }
        }

        // Image collection and deduplication
        const imagesMap = new Map<string, ParsedImageRow>();
        for (const item of cluster.rows) {
            const imgSrc = getRowFieldValue(item.row, "image_src");
            if (imgSrc) {
                const posRaw = getRowFieldValue(item.row, "image_position");
                const pos = posRaw ? parseInt(posRaw, 10) : undefined;
                const altText = getRowFieldValue(item.row, "image_alt");

                if (!imagesMap.has(imgSrc)) {
                    imagesMap.set(imgSrc, {
                        url: imgSrc,
                        position: isNaN(pos as any) ? undefined : pos,
                        altText: altText || undefined,
                        csvRowNumber: item.rowNumber,
                    });
                }
            }
        }

        // Sort images by position if available, preserving initial encounter order
        const imagesList = Array.from(imagesMap.values());
        imagesList.sort((a, b) => {
            if (a.position !== undefined && b.position !== undefined) {
                return a.position - b.position;
            }
            if (a.position !== undefined) return -1;
            if (b.position !== undefined) return 1;
            return 0;
        });

        // Variant processing
        const parsedVariants: ParsedVariantRow[] = [];
        const seenCombinationPairs = new Set<string>();
        let overallBasePrice = 0;
        let overallComparePrice: number | null = null;
        let isSimpleProduct = false;

        // Inspect Option headers from the first row with option definitions
        let opt1Name = "";
        let opt2Name = "";
        let opt3Name = "";

        for (const item of cluster.rows) {
            if (!opt1Name) opt1Name = getRowFieldValue(item.row, "option1_name");
            if (!opt2Name) opt2Name = getRowFieldValue(item.row, "option2_name");
            if (!opt3Name) opt3Name = getRowFieldValue(item.row, "option3_name");
        }

        // Determine if this is a Shopify simple product with "Default Title"
        const opt1Class = classifyOptionName(opt1Name);
        const opt2Class = classifyOptionName(opt2Name);

        // Check if Option3 has varied non-empty values (incompatible 3rd dimension)
        const option3Values = new Set<string>();
        for (const item of cluster.rows) {
            const val3 = getRowFieldValue(item.row, "option3_value");
            if (val3 && val3 !== "Default Title" && val3 !== "default") {
                option3Values.add(val3);
            }
        }

        if (option3Values.size > 1) {
            errors.push({
                rowNumber: cluster.firstRowNumber,
                handle,
                field: "option3",
                providedValue: Array.from(option3Values).join(", "),
                message: `Shopify CSV contains a 3rd independent attribute ('${opt3Name || "Option 3"}: ${Array.from(option3Values).join(", ")}'). Bazaarvilla currently supports Size and Color variants. A 3rd independent dimension is not supported.`,
                suggestedCorrection: "Remove or consolidate Option 3 into Size or Color before importing.",
                fatal: true,
            });
        }

        // Collect sizes and colors options
        const sizeOptionsMap = new Map<string, SizeOption>();
        const colorOptionsMap = new Map<string, ColorOption>();
        let detectedSizeMode: SizeMode = "none";

        // Process rows for variants
        let hasExplicitInventory = false;
        let hasExplicitPrice = false;
        let hasVariantColumns = false;

        for (const item of cluster.rows) {
            const rawPrice = getRowFieldValue(item.row, "price");
            const rawComparePrice = getRowFieldValue(item.row, "compare_at_price");
            const rawQty = getRowFieldValue(item.row, "inventory");
            const sku = getRowFieldValue(item.row, "sku");
            const variantImg = getRowFieldValue(item.row, "variant_image");

            const opt1Val = getRowFieldValue(item.row, "option1_value");
            const opt2Val = getRowFieldValue(item.row, "option2_value");
            const opt3Val = getRowFieldValue(item.row, "option3_value");

            if (rawPrice) hasExplicitPrice = true;
            if (rawQty) hasExplicitInventory = true;
            if (opt1Name || opt1Val || opt2Name || opt2Val) hasVariantColumns = true;

            // Explicit dimension columns in Bazaarvilla template
            const dimWidth = getRowFieldValue(item.row, "dimension_width");
            const dimHeight = getRowFieldValue(item.row, "dimension_height");
            const dimDepth = getRowFieldValue(item.row, "dimension_depth");
            const dimUnit = getRowFieldValue(item.row, "dimension_unit");

            // If a row has no price, no SKU, and no option value, it's an image-only row!
            if (!rawPrice && !sku && !opt1Val && !opt2Val && !rawQty) {
                continue;
            }

            // Price validation
            const numPrice = parseFloat(rawPrice);
            if (isNaN(numPrice) || numPrice <= 0) {
                errors.push({
                    rowNumber: item.rowNumber,
                    handle,
                    field: "price",
                    providedValue: rawPrice,
                    message: `Invalid price '${rawPrice}'. Products and variants must have a valid positive price.`,
                    suggestedCorrection: "Specify a price greater than 0.",
                    fatal: true,
                });
            } else if (overallBasePrice === 0) {
                overallBasePrice = numPrice;
            }

            let numCompare: number | null = null;
            if (rawComparePrice) {
                const parsedComp = parseFloat(rawComparePrice);
                if (!isNaN(parsedComp) && parsedComp > 0) {
                    numCompare = parsedComp;
                    if (overallComparePrice === null) overallComparePrice = parsedComp;
                }
            }

            // Inventory parsing: default to 0 if missing or invalid
            let numQty = 0;
            if (rawQty) {
                const parsedQty = parseInt(rawQty, 10);
                if (isNaN(parsedQty) || parsedQty < 0) {
                    warnings.push({
                        rowNumber: item.rowNumber,
                        handle,
                        field: "inventory",
                        providedValue: rawQty,
                        message: `Invalid inventory quantity '${rawQty}'. Defaulted to 0.`,
                    });
                    numQty = 0;
                } else {
                    numQty = parsedQty;
                }
            }

            // SKU Uniqueness Check
            if (sku) {
                const upperSku = sku.toUpperCase().trim();
                if (seenGlobalSkus.has(upperSku)) {
                    const previousRow = seenGlobalSkus.get(upperSku)!;
                    errors.push({
                        rowNumber: item.rowNumber,
                        handle,
                        field: "sku",
                        providedValue: sku,
                        message: `Duplicate SKU '${sku}' detected. Already used in row ${previousRow}.`,
                        suggestedCorrection: "Ensure every SKU in the CSV is globally unique.",
                        fatal: true,
                    });
                } else {
                    seenGlobalSkus.set(upperSku, item.rowNumber);
                }
            }

            // Identify simple product: "Default Title" in Option1 or blank options
            if (
                (!opt1Val || opt1Val.toLowerCase() === "default title") &&
                (!opt2Val || opt2Val.toLowerCase() === "default title") &&
                cluster.rows.length <= (imagesList.length > 0 ? imagesList.length + 1 : 1)
            ) {
                isSimpleProduct = true;
                parsedVariants.push({
                    csvRowNumber: item.rowNumber,
                    sku: sku || undefined,
                    price: numPrice > 0 ? numPrice : null,
                    compareAtPrice: numCompare,
                    inventory: numQty,
                    imageUrl: variantImg || undefined,
                    isActive: true,
                });
                break;
            }

            // Determine which option is Size and which is Color
            let sizeVal: string | undefined = undefined;
            let colorVal: string | undefined = undefined;

            if (opt1Class === "size" || (!opt1Class && opt2Class === "color")) {
                sizeVal = opt1Val;
                colorVal = opt2Val;
            } else if (opt1Class === "color" || (!opt1Class && opt2Class === "size")) {
                colorVal = opt1Val;
                sizeVal = opt2Val;
            } else if (opt2Class === "size") {
                sizeVal = opt2Val;
                colorVal = opt1Val;
            } else if (opt2Class === "color") {
                colorVal = opt2Val;
                sizeVal = opt1Val;
            } else {
                // Heuristic fallback: if only 1 option is present, inspect value
                if (opt1Val && !opt2Val) {
                    const parsed = parseSizeString(opt1Val);
                    if (parsed.sizeMode !== "custom" || opt1Name.toLowerCase().includes("size")) {
                        sizeVal = opt1Val;
                    } else if (opt1Name.toLowerCase().includes("color") || opt1Name.toLowerCase().includes("colour")) {
                        colorVal = opt1Val;
                    } else {
                        sizeVal = opt1Val;
                    }
                } else {
                    sizeVal = opt1Val;
                    colorVal = opt2Val;
                }
            }

            // Parse size details & dimensions
            let sizeDimensions = undefined;
            let sizeName = sizeVal;

            if (sizeVal) {
                const parsedSize = parseSizeString(sizeVal);
                sizeName = parsedSize.cleanName;
                sizeDimensions = parsedSize.dimensions;

                if (parsedSize.isAmbiguous) {
                    warnings.push({
                        rowNumber: item.rowNumber,
                        handle,
                        field: "size",
                        providedValue: sizeVal,
                        message: parsedSize.ambiguityReason || `Size '${sizeVal}' contains ambiguous dimensions.`,
                    });
                }

                if (detectedSizeMode === "none") {
                    detectedSizeMode = parsedSize.sizeMode;
                } else if (detectedSizeMode !== parsedSize.sizeMode && parsedSize.sizeMode !== "none") {
                    // If mixing dimensions and custom, upgrade to dimensions or custom
                    detectedSizeMode = "custom";
                }

                // If explicit dimension columns exist in row, override
                if (dimWidth || dimHeight) {
                    const explicit = buildExplicitDimensions({
                        width: dimWidth,
                        height: dimHeight,
                        depth: dimDepth,
                        unit: dimUnit,
                    });
                    if (explicit.error) {
                        errors.push({
                            rowNumber: item.rowNumber,
                            handle,
                            field: "dimensions",
                            providedValue: `W:${dimWidth}, H:${dimHeight}, D:${dimDepth}`,
                            message: explicit.error,
                            suggestedCorrection: "Provide valid positive numbers for dimension width and height.",
                            fatal: false,
                        });
                    } else if (explicit.dimensions) {
                        sizeDimensions = explicit.dimensions;
                        detectedSizeMode = "dimensions";
                    }
                }

                // Register size option
                const sId = `size_${sizeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
                if (!sizeOptionsMap.has(sId)) {
                    sizeOptionsMap.set(sId, {
                        id: sId,
                        name: sizeName,
                        dimensions: sizeDimensions,
                        isActive: true,
                        order: sizeOptionsMap.size,
                    });
                }
            }

            // Register color option
            let colorName = colorVal;
            if (colorVal) {
                const cId = `col_${colorVal.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
                if (!colorOptionsMap.has(cId)) {
                    colorOptionsMap.set(cId, {
                        id: cId,
                        name: colorVal,
                        image: variantImg || undefined,
                        isActive: true,
                    });
                }
            }

            // Detect duplicate combination within the same product
            const comboKey = `${(sizeName || "").toLowerCase()}:::${(colorName || "").toLowerCase()}`;
            if (seenCombinationPairs.has(comboKey)) {
                errors.push({
                    rowNumber: item.rowNumber,
                    handle,
                    field: "variant",
                    providedValue: `Size: ${sizeName || "None"}, Color: ${colorName || "None"}`,
                    message: `Duplicate variant combination detected for '${sizeName || "None"}' + '${colorName || "None"}'.`,
                    suggestedCorrection: "Ensure each size/color variant combination appears only once per product.",
                    fatal: true,
                });
            } else {
                seenCombinationPairs.add(comboKey);
            }

            parsedVariants.push({
                csvRowNumber: item.rowNumber,
                sizeName: sizeName || undefined,
                sizeDimensions,
                colorName: colorName || undefined,
                sku: sku || undefined,
                price: numPrice > 0 ? numPrice : null,
                compareAtPrice: numCompare,
                inventory: numQty,
                imageUrl: variantImg || undefined,
                option3: opt3Val ? { name: opt3Name || "Option 3", value: opt3Val } : undefined,
                isActive: true,
            });
        }

        // Variant Limit Check (MAX_VARIANT_LIMIT = 100)
        if (parsedVariants.length > MAX_VARIANT_LIMIT) {
            errors.push({
                rowNumber: cluster.firstRowNumber,
                handle,
                field: "variants",
                providedValue: `${parsedVariants.length} variants`,
                message: `Product '${title}' contains ${parsedVariants.length} variants, which exceeds the supported limit of ${MAX_VARIANT_LIMIT}.`,
                suggestedCorrection: `Reduce the number of variant combinations to at most ${MAX_VARIANT_LIMIT}.`,
                fatal: true,
            });
        }

        // Finalize simple product flag
        if (sizeOptionsMap.size === 0 && colorOptionsMap.size === 0) {
            isSimpleProduct = true;
            detectedSizeMode = "none";
        }

        productGroups.push({
            handle,
            title,
            description: cleanDescription,
            vendor: vendor || undefined,
            category: category || "General",
            tags,
            isVisible,
            isCustomized,
            customizationType,
            basePrice: overallBasePrice,
            compareAtPrice: overallComparePrice,
            images: imagesList,
            variants: parsedVariants,
            isSimpleProduct,
            hasExplicitInventory,
            hasExplicitPrice,
            hasVariantColumns,
            sizeMode: detectedSizeMode,
            sizesList: Array.from(sizeOptionsMap.values()),
            colors: Array.from(colorOptionsMap.values()),
            firstRowNumber: cluster.firstRowNumber,
            allRowNumbers,
            errors,
            warnings,
            unsupportedColumns: [],
        });
    }

    return {
        groups: productGroups,
        fileErrors,
        fileWarnings,
    };
}
