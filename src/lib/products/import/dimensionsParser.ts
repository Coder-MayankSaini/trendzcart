/**
 * Bazaarvilla Shopify-Compatible CSV Bulk Product Import (TASK 030)
 * Sizing & Dimension Parsing Engine
 */

import type {
    DimensionUnit,
    SizeDimension,
    SizeMode,
} from "../variants.ts";
import { STANDARD_APPAREL_SIZES } from "../variants.ts";

export interface ParsedSizeInfo {
    displayName: string;
    cleanName: string;
    sizeMode: SizeMode;
    dimensions?: SizeDimension;
    isAmbiguous: boolean;
    ambiguityReason?: string;
}

const SUPPORTED_UNITS: DimensionUnit[] = ["cm", "mm", "inch", "in", "m", "ft"];

/**
 * Normalizes dimension unit string to valid DimensionUnit or null.
 */
export function normalizeDimensionUnit(rawUnit?: string | null): DimensionUnit | null {
    if (!rawUnit) return null;
    const lower = rawUnit.toLowerCase().trim().replace(/s$/, ""); // e.g. "inches" -> "inche"
    if (lower === "cm" || lower === "centimeter") return "cm";
    if (lower === "mm" || lower === "millimeter") return "mm";
    if (lower === "inch" || lower === "in" || lower === '"') return "inch";
    if (lower === "m" || lower === "meter" || lower === "metre") return "m";
    if (lower === "ft" || lower === "foot" || lower === "feet" || lower === "'") return "ft";
    return null;
}

/**
 * Regex patterns to extract dimensions from size labels:
 * e.g. "26 × 26 cm", "20x20x5 cm", "12 x 12 inch", "26*26 cm"
 */
const DIMENSION_REGEX_3D = /(\d+(?:\.\d+)?)\s*(?:[x×*]|by)\s*(\d+(?:\.\d+)?)\s*(?:[x×*]|by)\s*(\d+(?:\.\d+)?)\s*(cm|mm|inch|in|m|ft)?/i;
const DIMENSION_REGEX_2D = /(\d+(?:\.\d+)?)\s*(?:[x×*]|by)\s*(\d+(?:\.\d+)?)\s*(cm|mm|inch|in|m|ft)?/i;

/**
 * Parses a size string (from Shopify Option value or Bazaarvilla template).
 * Handles:
 * - "Large (26 × 26 cm)" -> cleanName: "Large", dimensions: { width: 26, height: 26, unit: "cm" }
 * - "Small — 20 × 20 cm" -> cleanName: "Small", dimensions: { width: 20, height: 20, unit: "cm" }
 * - "20 × 20 cm" -> cleanName: "20 × 20 cm", dimensions: { width: 20, height: 20, unit: "cm" }
 * - "XL" -> cleanName: "XL", mode: "apparel"
 * - "Free Size" -> cleanName: "Free Size", mode: "free_size"
 * - "Ambiguous 26-28" -> flags as ambiguous, does not invent numbers
 */
export function parseSizeString(rawString?: string | null): ParsedSizeInfo {
    if (!rawString || typeof rawString !== "string" || !rawString.trim()) {
        return {
            displayName: "Standard",
            cleanName: "Standard",
            sizeMode: "none",
            isAmbiguous: false,
        };
    }

    const trimmed = rawString.trim();

    // 1. Check for Free Size
    const lower = trimmed.toLowerCase();
    if (
        lower === "free size" ||
        lower === "freesize" ||
        lower === "one size" ||
        lower === "onesize" ||
        lower === "universal" ||
        lower === "osfa"
    ) {
        return {
            displayName: "Free Size",
            cleanName: "Free Size",
            sizeMode: "free_size",
            isAmbiguous: false,
        };
    }

    // 2. Check for Standard Apparel Sizes (exact match, case-insensitive)
    const upper = trimmed.toUpperCase();
    if (STANDARD_APPAREL_SIZES.includes(upper)) {
        return {
            displayName: upper,
            cleanName: upper,
            sizeMode: "apparel",
            isAmbiguous: false,
        };
    }

    // 3. Extract dimensions inside parentheses or after a dash
    // e.g. "Large (26 × 26 cm)", "Large [26x26 cm]", "Small - 20x20 cm", "Medium — 20 × 20 × 5 cm"
    const bracketMatch = trimmed.match(/^(.+?)\s*[([—–-]\s*([^\])—–]+)[\])]?$/);

    let prefixLabel = trimmed;
    let dimensionPortion = "";

    if (bracketMatch) {
        prefixLabel = bracketMatch[1].trim();
        dimensionPortion = bracketMatch[2].trim();
    } else {
        // Entire string might be a dimension, e.g. "26 × 26 cm"
        dimensionPortion = trimmed;
    }

    // Try 3D dimensions first (e.g. 20 x 20 x 5 cm)
    const match3D = dimensionPortion.match(DIMENSION_REGEX_3D);
    if (match3D) {
        const w = parseFloat(match3D[1]);
        const h = parseFloat(match3D[2]);
        const d = parseFloat(match3D[3]);
        const unit = normalizeDimensionUnit(match3D[4]) || "cm";

        if (w > 0 && h > 0 && d > 0) {
            const clean = prefixLabel !== trimmed ? prefixLabel : `${w} × ${h} × ${d} ${unit}`;
            return {
                displayName: trimmed,
                cleanName: clean,
                sizeMode: "dimensions",
                dimensions: { width: w, height: h, depth: d, unit },
                isAmbiguous: false,
            };
        }
    }

    // Try 2D dimensions (e.g. 26 × 26 cm or 20x20)
    const match2D = dimensionPortion.match(DIMENSION_REGEX_2D);
    if (match2D) {
        const w = parseFloat(match2D[1]);
        const h = parseFloat(match2D[2]);
        const unit = normalizeDimensionUnit(match2D[3]) || "cm";

        if (w > 0 && h > 0) {
            const clean = prefixLabel !== trimmed ? prefixLabel : `${w} × ${h} ${unit}`;
            return {
                displayName: trimmed,
                cleanName: clean,
                sizeMode: "dimensions",
                dimensions: { width: w, height: h, unit },
                isAmbiguous: false,
            };
        }
    }

    // 4. Ambiguity Detection:
    // If the label contains numbers with hyphens (e.g. "26-28", "Size 10/12", "Approx 20")
    // but not a clear dimensional multiplier, flag it as ambiguous
    if (/\b\d+\s*[-/]\s*\d+\b/.test(trimmed) || /\bapprox\b/i.test(trimmed)) {
        return {
            displayName: trimmed,
            cleanName: trimmed,
            sizeMode: "custom",
            isAmbiguous: true,
            ambiguityReason: `Value '${trimmed}' contains ambiguous numbers or ranges that could not be parsed as explicit dimensions. Treated as custom size label.`,
        };
    }

    // 5. Default to Custom Size Label (e.g. "King", "Queen", "8-inch", "Square")
    return {
        displayName: trimmed,
        cleanName: trimmed,
        sizeMode: "custom",
        isAmbiguous: false,
    };
}

/**
 * Builds explicit dimensions from individual CSV columns.
 * Supports explicit columns: Width, Height, Depth/Length, Unit.
 */
export function buildExplicitDimensions(options: {
    width?: string | number | null;
    height?: string | number | null;
    depth?: string | number | null;
    unit?: string | null;
}): { dimensions?: SizeDimension; error?: string } {
    const { width, height, depth, unit } = options;

    if (!width && !height && !depth) {
        return {};
    }

    const w = typeof width === "number" ? width : parseFloat(String(width || ""));
    const h = typeof height === "number" ? height : parseFloat(String(height || ""));
    const d = depth ? (typeof depth === "number" ? depth : parseFloat(String(depth))) : undefined;

    if (isNaN(w) || w <= 0 || isNaN(h) || h <= 0) {
        return {
            error: `Explicit dimensions require positive numbers for Width and Height. Given width: '${width}', height: '${height}'.`,
        };
    }

    if (d !== undefined && (isNaN(d) || d < 0)) {
        return {
            error: `Explicit Depth/Length must be a non-negative number. Given: '${depth}'.`,
        };
    }

    const parsedUnit = normalizeDimensionUnit(unit) || "cm";

    return {
        dimensions: {
            width: w,
            height: h,
            depth: d,
            unit: parsedUnit,
        },
    };
}
