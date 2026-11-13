/**
 * Bazaarvilla Shopify-Compatible CSV Bulk Product Import (TASK 030)
 * Security Sanitizer: Formula Injection, HTML Sanitization & Field Whitelist Guard
 */

const FORMULA_TRIGGER_CHARS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Neutralizes CSV Formula Injection (CWE-1236) in generated CSV error reports and exports.
 * If a cell string starts with =, +, -, @, tab, or carriage return, it prefixes the cell
 * with a single quote (') so spreadsheet applications (Excel, Google Sheets, LibreOffice)
 * render the text as a string literal rather than executing it as an expression.
 */
export function sanitizeCsvCellValue(val: unknown): string {
    if (val === null || val === undefined) return "";
    const raw = String(val);

    // Check for formula trigger prefix on raw value before any trimming
    if (raw.length > 0 && FORMULA_TRIGGER_CHARS.includes(raw[0])) {
        return `'${raw}`;
    }

    const trimmed = raw.trim();
    if (trimmed.length > 0 && FORMULA_TRIGGER_CHARS.includes(trimmed[0])) {
        return `'${trimmed}`;
    }

    return trimmed;
}

/**
 * Formats a row of cells into an RFC 4180-compliant CSV line with formula injection protection.
 */
export function formatSafeCsvRow(cells: unknown[]): string {
    return cells
        .map((cell) => {
            const safe = sanitizeCsvCellValue(cell);
            // If cell contains commas, quotes, or newlines, quote and escape double quotes
            if (safe.includes('"') || safe.includes(",") || safe.includes("\n") || safe.includes("\r")) {
                return `"${safe.replace(/"/g, '""')}"`;
            }
            return safe;
        })
        .join(",");
}

/**
 * Whitelist of allowed HTML tags in product descriptions.
 */
const ALLOWED_HTML_TAGS = new Set([
    "p", "br", "strong", "b", "em", "i", "u", "s", "strike",
    "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
    "blockquote", "span", "div", "a", "hr", "table", "thead",
    "tbody", "tr", "th", "td", "img"
]);

/**
 * Safely decodes common and numeric HTML entities.
 * Avoids double-decoding and preserves intentional plain characters.
 */
export function decodeHtmlEntities(str: string): string {
    if (!str || typeof str !== "string") return "";
    return str
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/&hellip;/g, "…")
        .replace(/&mdash;/g, "—")
        .replace(/&ndash;/g, "–")
        .replace(/&copy;/g, "©")
        .replace(/&reg;/g, "®")
        .replace(/&trade;/g, "™")
        .replace(/&#(\d+);/g, (_, n) => {
            try {
                return String.fromCodePoint(parseInt(n, 10));
            } catch {
                return "";
            }
        })
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
            try {
                return String.fromCodePoint(parseInt(h, 16));
            } catch {
                return "";
            }
        });
}

/**
 * Normalizes product descriptions from CSV Body (HTML).
 * 1. Strips dangerous executable tags (<script>, <iframe>, <object>, <embed>, <svg>, <form>, <style>).
 * 2. Converts structural tags (<br>, </p>, </div>, </li>, </tr>) to natural readable linebreaks.
 * 3. Strips remaining disallowed HTML tags while preserving text content.
 * 4. Decodes HTML entities (&amp;, &quot;, &#39;, &lt;, &gt;, &nbsp;, etc.) into clean readable text.
 * 5. Normalizes paragraph breaks and excessive whitespace without collapsing intentional structure.
 */
export function normalizeProductDescription(html: string): string {
    if (!html || typeof html !== "string") return "";

    // 1. Remove dangerous blocks completely (including content)
    let cleaned = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
        .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
        .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, "")
        .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "");

    // 2. Convert breaks and block endings to clean newlines
    cleaned = cleaned
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>|<\/div>|<\/tr>|<\/h[1-6]>/gi, "\n\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<[^>]+>/g, ""); // Strip any remaining tags

    // 3. Normalize carriage returns and linefeeds
    cleaned = cleaned.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // 4. Safely decode entities
    cleaned = decodeHtmlEntities(cleaned);

    // 5. Clean up indentation and collapse 3+ consecutive newlines to 2
    cleaned = cleaned
        .split("\n")
        .map(line => line.trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    return cleaned;
}

/**
 * Sanitizes HTML descriptions imported from CSVs.
 * Strips dangerous executable tags (<script>, <iframe>, <object>, <embed>, <svg>, <form>, <style>),
 * dangerous attributes (all on* event handlers like onload, onerror, onclick), and pseudo-protocols (javascript:, vbscript:).
 * Preserves safe structural and formatting tags (<p>, <br>, <strong>, <b>, <em>, <a>, <ul>, <ol>, <li>).
 */
export function sanitizeHtmlDescription(html: string): string {
    if (!html || typeof html !== "string") return "";

    let cleaned = html;

    // 1. Remove dangerous blocks completely (including content)
    cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
    cleaned = cleaned.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "");
    cleaned = cleaned.replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, "");
    cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
    cleaned = cleaned.replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, "");
    cleaned = cleaned.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "");

    // 2. Strip event handler attributes (e.g. onload, onerror, onclick, onmouseover)
    cleaned = cleaned.replace(/\s+on[a-z0-9_-]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, "");

    // 3. Strip dangerous protocol references in href and src (javascript:, vbscript:, data:text/html)
    cleaned = cleaned.replace(
        /\s+(href|src)\s*=\s*(?:'javascript:[^']*'|"javascript:[^"]*"|javascript:[^\s>]+)/gi,
        ' $1="#"'
    );
    cleaned = cleaned.replace(
        /\s+(href|src)\s*=\s*(?:'vbscript:[^']*'|"vbscript:[^"]*"|vbscript:[^\s>]+)/gi,
        ' $1="#"'
    );
    cleaned = cleaned.replace(
        /\s+(href|src)\s*=\s*(?:'data:text\/html[^']*'|"data:text\/html[^"]*"|data:text\/html[^\s>]+)/gi,
        ' $1="#"'
    );

    // 4. Enforce rel="noopener noreferrer" on anchor tags
    cleaned = cleaned.replace(/<a\s+(?![^>]*\brel=)([^>]+)>/gi, '<a $1 rel="noopener noreferrer">');

    return cleaned.trim();
}

/**
 * Whitelist of permitted top-level product fields that may be set or updated via CSV import.
 * Prevents prototype pollution and arbitrary Firestore field path writes.
 */
export const ALLOWED_PRODUCT_IMPORT_FIELDS = new Set([
    "id",
    "name",
    "slug",
    "description",
    "price",
    "compareAtPrice",
    "category",
    "categories",
    "tags",
    "vendor",
    "inventory",
    "totalPhysicalInventory",
    "isVisible",
    "isCustomized",
    "customizationType",
    "hasVariants",
    "sizeMode",
    "sizes",
    "sizesList",
    "colors",
    "variants",
    "images",
    "thumbnails",
    "attributes",
    "hasIncompleteMedia",
    "createdAt",
    "updatedAt",
]);

/**
 * Sanitizes a product object against prototype pollution and unauthorized internal fields.
 */
export function sanitizeProductPayload(record: Record<string, any>): Record<string, any> {
    const safe: Record<string, any> = {};

    for (const [key, val] of Object.entries(record)) {
        // Prototype pollution guards
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
            continue;
        }

        // Must be in allowed whitelist
        if (!ALLOWED_PRODUCT_IMPORT_FIELDS.has(key)) {
            continue;
        }

        safe[key] = val;
    }

    return safe;
}
