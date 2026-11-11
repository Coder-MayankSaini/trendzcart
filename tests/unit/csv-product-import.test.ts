/**
 * Unit Tests for Bazaarvilla Shopify-Compatible CSV Bulk Product Import (TASK 030)
 *
 * Verifies CSV parsing, format detection, column mapping, multi-row product grouping,
 * dimension parsing, formula injection sanitization, HTML sanitization, SSRF filters,
 * and catalog integrity guards.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Papa from "papaparse";
import {
    detectCsvFormat,
    resolveColumnMapping,
    normalizeHeader,
    TARGET_FIELD_ALIASES,
    UNSUPPORTED_SHOPIFY_COLUMNS,
} from "../../src/lib/products/import/mapping.ts";
import {
    parseSizeString,
    buildExplicitDimensions,
    normalizeDimensionUnit,
} from "../../src/lib/products/import/dimensionsParser.ts";
import {
    groupCsvRows,
    normalizeHandle,
    parseBoolean,
} from "../../src/lib/products/import/grouping.ts";
import {
    sanitizeCsvCellValue,
    formatSafeCsvRow,
    sanitizeHtmlDescription,
    sanitizeProductPayload,
} from "../../src/lib/products/import/sanitizer.ts";
import {
    isPrivateIp,
    detectImageMagicBytes,
    validateRemoteImageUrl,
} from "../../src/lib/products/import/imageIngestion.ts";
import { buildProductPreview } from "../../src/lib/products/import/validation.ts";
import { isCustomizableProduct } from "../../src/lib/orders/customizationEligibility.ts";
import {
    STANDARD_PRODUCT_TEMPLATE_CSV,
    VARIANTS_PRODUCT_TEMPLATE_CSV,
    PERSONALIZED_PRODUCT_TEMPLATE_CSV,
} from "../../src/lib/products/import/templates.ts";

describe("CSV Bulk Product Import Unit Tests (TASK 030)", () => {
    // -------------------------------------------------------------------------
    // 1. CSV Format Detection & Header Normalization
    // -------------------------------------------------------------------------
    describe("1. Format Detection & Header Normalization", () => {
        it("CSV-001: should detect Shopify Standard CSV headers", () => {
            const headers = [
                "Handle",
                "Title",
                "Body (HTML)",
                "Vendor",
                "Product Category",
                "Type",
                "Tags",
                "Published",
                "Option1 Name",
                "Option1 Value",
                "Option2 Name",
                "Option2 Value",
                "Variant SKU",
                "Variant Price",
                "Image Src",
            ];
            assert.equal(detectCsvFormat(headers), "shopify_standard");
        });

        it("CSV-002: should detect Shopify Legacy CSV headers", () => {
            const headers = ["Handle", "Title", "Description", "Price", "Quantity"];
            assert.equal(detectCsvFormat(headers), "shopify_legacy");
        });

        it("CSV-003: should detect Bazaarvilla Custom Template headers", () => {
            const headers = [
                "Handle",
                "Product Name",
                "Customization Type",
                "Dimension Width",
                "Dimension Height",
                "Dimension Unit",
                "Price",
            ];
            assert.equal(detectCsvFormat(headers), "bazaarvilla_template");
        });

        it("CSV-004: should classify unknown column sets as 'custom'", () => {
            const headers = ["ArticleID", "ShortDesc", "Cost"];
            assert.equal(detectCsvFormat(headers), "custom");
        });

        it("CSV-005: normalizeHeader should trim, lowercase, and strip punctuation", () => {
            assert.equal(normalizeHeader("  Body (HTML)  "), "body (html)");
            assert.equal(normalizeHeader("Variant_SKU"), "variant sku");
            assert.equal(normalizeHeader('"Option1 Name"'), "option1 name");
        });
    });

    // -------------------------------------------------------------------------
    // 2. Column Mapping & Unsupported Columns Reporting
    // -------------------------------------------------------------------------
    describe("2. Column Mapping & Unsupported Columns Reporting", () => {
        it("CSV-006: should resolve standard Shopify aliases to canonical target fields", () => {
            const headers = ["Handle", "Body (HTML)", "Variant Price", "Variant Inventory Qty", "Image Src"];
            const res = resolveColumnMapping(headers);

            const map = new Map(res.mappings.map(m => [m.sourceColumn, m.targetField]));
            assert.equal(map.get("Handle"), "handle");
            assert.equal(map.get("Body (HTML)"), "description");
            assert.equal(map.get("Variant Price"), "price");
            assert.equal(map.get("Variant Inventory Qty"), "inventory");
            assert.equal(map.get("Image Src"), "image_src");
        });

        it("CSV-007: should surface unsupported Shopify columns with explanatory reason", () => {
            const headers = ["Handle", "Title", "Cost per item", "Variant Grams", "Google Shopping / Google Product Category"];
            const res = resolveColumnMapping(headers);

            assert.equal(res.unsupportedHeaders.length, 3);
            const costItem = res.unsupportedHeaders.find(u => u.header === "Cost per item");
            assert.ok(costItem);
            assert.match(costItem.reason, /wholesale merchant acquisition costs/i);

            const gramsItem = res.unsupportedHeaders.find(u => u.header === "Variant Grams");
            assert.ok(gramsItem);
            assert.match(gramsItem.reason, /weight in grams/i);
        });

        it("CSV-008: should report missing required headers when Handle or Title are missing", () => {
            const headers = ["Price", "Variant SKU", "Quantity"];
            const res = resolveColumnMapping(headers);

            assert.ok(res.missingRequiredHeaders.includes("Handle / Slug"));
            assert.ok(res.missingRequiredHeaders.includes("Title / Product Name"));
        });
    });

    // -------------------------------------------------------------------------
    // 3. Sizing Modes & Dimension Parsing
    // -------------------------------------------------------------------------
    describe("3. Sizing Modes & Dimension Parsing", () => {
        it("CSV-009: should parse standard apparel sizes into mode 'apparel'", () => {
            for (const s of ["XS", "S", "M", "L", "XL", "XXL", "3XL"]) {
                const parsed = parseSizeString(s);
                assert.equal(parsed.sizeMode, "apparel");
                assert.equal(parsed.cleanName, s);
                assert.equal(parsed.dimensions, undefined);
                assert.equal(parsed.isAmbiguous, false);
            }
        });

        it("CSV-010: should parse Free Size variants into mode 'free_size'", () => {
            for (const s of ["Free Size", "One Size", "Universal", "OSFA", "freesize"]) {
                const parsed = parseSizeString(s);
                assert.equal(parsed.sizeMode, "free_size");
                assert.equal(parsed.cleanName, "Free Size");
                assert.equal(parsed.isAmbiguous, false);
            }
        });

        it("CSV-011: should parse bracketed dimensions: 'Large (26 × 26 cm)'", () => {
            const parsed = parseSizeString("Large (26 × 26 cm)");
            assert.equal(parsed.sizeMode, "dimensions");
            assert.equal(parsed.cleanName, "Large");
            assert.deepEqual(parsed.dimensions, { width: 26, height: 26, unit: "cm" });
            assert.equal(parsed.isAmbiguous, false);
        });

        it("CSV-012: should parse dash-separated dimensions: 'Small — 20 × 20 cm'", () => {
            const parsed = parseSizeString("Small — 20 × 20 cm");
            assert.equal(parsed.sizeMode, "dimensions");
            assert.equal(parsed.cleanName, "Small");
            assert.deepEqual(parsed.dimensions, { width: 20, height: 20, unit: "cm" });
        });

        it("CSV-013: should parse standalone 2D dimensions: '26x26 cm'", () => {
            const parsed = parseSizeString("26x26 cm");
            assert.equal(parsed.sizeMode, "dimensions");
            assert.deepEqual(parsed.dimensions, { width: 26, height: 26, unit: "cm" });
        });

        it("CSV-014: should parse 3D dimensions: 'Medium (20 x 20 x 5 cm)'", () => {
            const parsed = parseSizeString("Medium (20 x 20 x 5 cm)");
            assert.equal(parsed.sizeMode, "dimensions");
            assert.equal(parsed.cleanName, "Medium");
            assert.deepEqual(parsed.dimensions, { width: 20, height: 20, depth: 5, unit: "cm" });
        });

        it("CSV-015: should flag ambiguous numbers/ranges without guessing: 'Size 26-28 with box'", () => {
            const parsed = parseSizeString("Size 26-28 with box");
            assert.equal(parsed.sizeMode, "custom");
            assert.equal(parsed.isAmbiguous, true);
            assert.equal(parsed.dimensions, undefined);
            assert.match(parsed.ambiguityReason || "", /ambiguous numbers or ranges/i);
        });

        it("CSV-016: buildExplicitDimensions builds validated dimension object from columns", () => {
            const valid = buildExplicitDimensions({ width: "26", height: "26", unit: "cm" });
            assert.deepEqual(valid.dimensions, { width: 26, height: 26, depth: undefined, unit: "cm" });

            const invalid = buildExplicitDimensions({ width: "-5", height: "26" });
            assert.ok(invalid.error);
            assert.match(invalid.error, /positive numbers/i);
        });
    });

    // -------------------------------------------------------------------------
    // 4. Multi-Row Product Grouping
    // -------------------------------------------------------------------------
    describe("4. Multi-Row Product Grouping", () => {
        it("CSV-017: should group multi-row variants under single normalized handle", () => {
            const rows = [
                { Handle: "crewneck-tee", Title: "Crewneck T-Shirt", Price: "799", "Option1 Name": "Size", "Option1 Value": "M", SKU: "TEE-M" },
                { Handle: "crewneck-tee", Title: "", Price: "799", "Option1 Name": "Size", "Option1 Value": "L", SKU: "TEE-L" },
                { Handle: "crewneck-tee", Title: "", Price: "849", "Option1 Name": "Size", "Option1 Value": "XL", SKU: "TEE-XL" },
            ];

            const { groups, fileErrors } = groupCsvRows(rows);
            assert.equal(fileErrors.length, 0);
            assert.equal(groups.length, 1);
            assert.equal(groups[0].handle, "crewneck-tee");
            assert.equal(groups[0].title, "Crewneck T-Shirt");
            assert.equal(groups[0].variants.length, 3);
            assert.equal(groups[0].sizesList.length, 3);
        });

        it("CSV-018: should handle image-only rows without creating phantom variants", () => {
            const rows = [
                { Handle: "tote-bag", Title: "Canvas Tote Bag", Price: "499", "Image Src": "https://example.com/img1.jpg", "Image Position": "1" },
                { Handle: "tote-bag", Title: "", Price: "", "Image Src": "https://example.com/img2.jpg", "Image Position": "2" },
                { Handle: "tote-bag", Title: "", Price: "", "Image Src": "https://example.com/img3.jpg", "Image Position": "3" },
            ];

            const { groups } = groupCsvRows(rows);
            assert.equal(groups.length, 1);
            assert.equal(groups[0].images.length, 3);
            assert.equal(groups[0].isSimpleProduct, true);
            assert.equal(groups[0].variants.length, 1); // 1 simple variant
        });

        it("CSV-019: should handle Shopify simple product with 'Default Title'", () => {
            const rows = [
                { Handle: "mug", Title: "Ceramic Coffee Mug", Price: "349", "Option1 Name": "Title", "Option1 Value": "Default Title", SKU: "MUG-01" },
            ];

            const { groups } = groupCsvRows(rows);
            assert.equal(groups.length, 1);
            assert.equal(groups[0].isSimpleProduct, true);
            assert.equal(groups[0].sizeMode, "none");
            assert.equal(groups[0].sizesList.length, 0); // No bogus "Default Title" size created!
        });

        it("CSV-020: should allow Size and Color in either Option1 or Option2 order", () => {
            // Case A: Option1 = Color, Option2 = Size
            const rowsA = [
                { Handle: "cushion", Title: "Cushion", Price: "599", "Option1 Name": "Color", "Option1 Value": "Blue", "Option2 Name": "Size", "Option2 Value": "Small (20 × 20 cm)" },
            ];
            const resA = groupCsvRows(rowsA);
            assert.equal(resA.groups[0].variants[0].colorName, "Blue");
            assert.equal(resA.groups[0].variants[0].sizeName, "Small");

            // Case B: Option1 = Size, Option2 = Color
            const rowsB = [
                { Handle: "cushion", Title: "Cushion", Price: "599", "Option1 Name": "Size", "Option1 Value": "Small (20 × 20 cm)", "Option2 Name": "Color", "Option2 Value": "Blue" },
            ];
            const resB = groupCsvRows(rowsB);
            assert.equal(resB.groups[0].variants[0].sizeName, "Small");
            assert.equal(resB.groups[0].variants[0].colorName, "Blue");
        });

        it("CSV-021: should detect and report 3rd independent Shopify option incompatibility", () => {
            const rows = [
                { Handle: "shirt", Title: "Shirt", Price: "999", "Option1 Name": "Size", "Option1 Value": "M", "Option2 Name": "Color", "Option2 Value": "Blue", "Option3 Name": "Material", "Option3 Value": "Silk" },
                { Handle: "shirt", Title: "", Price: "999", "Option1 Name": "Size", "Option1 Value": "M", "Option2 Name": "Color", "Option2 Value": "Blue", "Option3 Name": "Material", "Option3 Value": "Linen" },
            ];

            const { groups } = groupCsvRows(rows);
            assert.equal(groups.length, 1);
            const err = groups[0].errors.find(e => e.field === "option3");
            assert.ok(err, "Must report fatal error for 3rd independent attribute");
            assert.equal(err.fatal, true);
            assert.match(err.message, /3rd independent attribute/i);
        });

        it("CSV-022: should detect duplicate SKUs across products", () => {
            const rows = [
                { Handle: "prod-1", Title: "Product 1", Price: "100", SKU: "DUP-SKU-1" },
                { Handle: "prod-2", Title: "Product 2", Price: "200", SKU: "DUP-SKU-1" },
            ];

            const { groups } = groupCsvRows(rows);
            const prod2 = groups.find(g => g.handle === "prod-2");
            assert.ok(prod2);
            const skuErr = prod2.errors.find(e => e.field === "sku");
            assert.ok(skuErr);
            assert.match(skuErr.message, /Duplicate SKU 'DUP-SKU-1' detected/i);
        });

        it("CSV-023: should detect duplicate variant combination on same product", () => {
            const rows = [
                { Handle: "tee", Title: "Tee", Price: "500", "Option1 Name": "Size", "Option1 Value": "M", "Option2 Name": "Color", "Option2 Value": "Black" },
                { Handle: "tee", Title: "", Price: "500", "Option1 Name": "Size", "Option1 Value": "M", "Option2 Name": "Color", "Option2 Value": "Black" },
            ];

            const { groups } = groupCsvRows(rows);
            const err = groups[0].errors.find(e => e.field === "variant");
            assert.ok(err);
            assert.match(err.message, /Duplicate variant combination detected/i);
        });
    });

    // -------------------------------------------------------------------------
    // 5. Personalization & COD Protection (TASK 027 Guard)
    // -------------------------------------------------------------------------
    describe("5. Personalization & COD Protection", () => {
        it("CSV-024: Ordinary variant products must have isCustomizableProduct = false and remain COD eligible", () => {
            const rows = [
                { Handle: "tee", Title: "Plain Cotton Tee", Price: "500", "Option1 Name": "Size", "Option1 Value": "XL" },
            ];
            const { groups } = groupCsvRows(rows);
            assert.equal(isCustomizableProduct(groups[0]), false);
        });

        it("CSV-025: Personalized products (requires_name or requires_picture) must have isCustomizableProduct = true", () => {
            const rowsName = [
                { Handle: "keychain", Title: "Custom Keychain", Price: "299", "Customization Type": "requires_name" },
            ];
            const resName = groupCsvRows(rowsName);
            assert.equal(resName.groups[0].isCustomized, true);
            assert.equal(resName.groups[0].customizationType, "requires_name");
            assert.equal(isCustomizableProduct(resName.groups[0]), true);

            const rowsPhoto = [
                { Handle: "cushion", Title: "Photo Cushion", Price: "649", "Customization Type": "requires_picture" },
            ];
            const resPhoto = groupCsvRows(rowsPhoto);
            assert.equal(resPhoto.groups[0].isCustomized, true);
            assert.equal(resPhoto.groups[0].customizationType, "requires_picture");
            assert.equal(isCustomizableProduct(resPhoto.groups[0]), true);
        });

        it("CSV-026: MUST NOT infer personalization solely from words like 'custom' or 'printed' in title", () => {
            const rows = [
                { Handle: "printed-tshirt", Title: "Custom Printed Graphic T-Shirt", Price: "699" },
            ];
            const { groups } = groupCsvRows(rows);
            // Without explicit customization column, must not assume personalized
            assert.equal(groups[0].isCustomized, false);
            assert.equal(groups[0].customizationType, null);
            assert.equal(isCustomizableProduct(groups[0]), false);
        });
    });

    // -------------------------------------------------------------------------
    // 6. Security Sanitization & Injection Defense
    // -------------------------------------------------------------------------
    describe("6. Security Sanitization & Injection Defense", () => {
        it("CSV-027: Neutralizes CSV formula injection prefixes (=, +, -, @, tab)", () => {
            assert.equal(sanitizeCsvCellValue("=cmd|' /C calc'!A0"), "'=cmd|' /C calc'!A0");
            assert.equal(sanitizeCsvCellValue("+12345"), "'+12345");
            assert.equal(sanitizeCsvCellValue("-SUM(A1:A10)"), "'-SUM(A1:A10)");
            assert.equal(sanitizeCsvCellValue("@SUM(A1)"), "'@SUM(A1)");
            assert.equal(sanitizeCsvCellValue("\tmalicious"), "'\tmalicious");
            assert.equal(sanitizeCsvCellValue("Normal Text"), "Normal Text");
        });

        it("CSV-028: formatSafeCsvRow quotes cells with commas/newlines and prevents formula injection", () => {
            const line = formatSafeCsvRow(["Row 1", "=HYPERLINK(\"http://evil.com\")", "Has, comma"]);
            assert.equal(line, 'Row 1,"\'=HYPERLINK(""http://evil.com"")","Has, comma"');
        });

        it("CSV-029: Strips dangerous HTML tags and event handlers from descriptions", () => {
            const dirty = `
                <p>Great product</p>
                <script>alert('xss')</script>
                <img src="https://example.com/pic.jpg" onerror="alert(1)" />
                <a href="javascript:steal()">Click me</a>
                <iframe src="https://evil.com"></iframe>
            `;
            const clean = sanitizeHtmlDescription(dirty);

            assert.ok(!clean.includes("<script>"));
            assert.ok(!clean.includes("alert('xss')"));
            assert.ok(!clean.includes("onerror"));
            assert.ok(!clean.includes("javascript:"));
            assert.ok(!clean.includes("<iframe"));
            assert.ok(clean.includes("<p>Great product</p>"));
        });

        it("CSV-030: sanitizeProductPayload enforces strict field whitelist and prototype pollution guard", () => {
            const maliciousPayload = {
                __proto__: { isAdmin: true },
                constructor: "polluted",
                name: "Clean Product",
                slug: "clean-product",
                price: 999,
                isAdmin: true,
                role: "admin",
            };

            const sanitized = sanitizeProductPayload(maliciousPayload);
            assert.equal(sanitized.name, "Clean Product");
            assert.equal(sanitized.slug, "clean-product");
            assert.equal(sanitized.price, 999);
            assert.equal(sanitized.isAdmin, undefined);
            assert.equal(sanitized.role, undefined);
            assert.equal(Object.prototype.hasOwnProperty.call(sanitized, "__proto__"), false);
        });
    });

    // -------------------------------------------------------------------------
    // 7. SSRF Defense & Magic Bytes Format Verification
    // -------------------------------------------------------------------------
    describe("7. SSRF Defense & Magic Bytes Verification", () => {
        it("CSV-031: isPrivateIp correctly identifies private/loopback/cloud metadata IP ranges", () => {
            assert.equal(isPrivateIp("127.0.0.1"), true);
            assert.equal(isPrivateIp("10.0.1.5"), true);
            assert.equal(isPrivateIp("172.16.0.1"), true);
            assert.equal(isPrivateIp("172.31.255.255"), true);
            assert.equal(isPrivateIp("192.168.1.1"), true);
            assert.equal(isPrivateIp("169.254.169.254"), true); // AWS/GCP Metadata
            assert.equal(isPrivateIp("::1"), true); // IPv6 loopback
            assert.equal(isPrivateIp("fe80::1"), true); // IPv6 link-local

            // Public IPs must pass
            assert.equal(isPrivateIp("8.8.8.8"), false);
            assert.equal(isPrivateIp("1.1.1.1"), false);
            assert.equal(isPrivateIp("104.26.10.1"), false);
        });

        it("CSV-032: detectImageMagicBytes validates authentic binary headers", () => {
            // JPEG: FF D8 FF
            const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
            assert.deepEqual(detectImageMagicBytes(jpegBuf), { contentType: "image/jpeg", ext: "jpg" });

            // PNG: 89 50 4E 47 0D 0A 1A 0A
            const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
            assert.deepEqual(detectImageMagicBytes(pngBuf), { contentType: "image/png", ext: "png" });

            // WebP: RIFF ... WEBP
            const webpBuf = Buffer.from("RIFFxxxxWEBPxxxx", "ascii");
            assert.deepEqual(detectImageMagicBytes(webpBuf), { contentType: "image/webp", ext: "webp" });

            // GIF: GIF89a
            const gifBuf = Buffer.from("GIF89axxxxxxxx", "ascii");
            assert.deepEqual(detectImageMagicBytes(gifBuf), { contentType: "image/gif", ext: "gif" });

            // Disguised HTML must be strictly rejected
            const htmlBuf = Buffer.from("<!DOCTYPE html><html><body><h1>Fake Image</h1></body></html>");
            assert.equal(detectImageMagicBytes(htmlBuf), null);

            // Disguised SVG / XML must be strictly rejected (XSS vector)
            const svgBuf = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
            assert.equal(detectImageMagicBytes(svgBuf), null);
        });
    });

    // -------------------------------------------------------------------------
    // 8. Downloadable Templates Verification
    // -------------------------------------------------------------------------
    describe("8. Downloadable Templates Verification", () => {
        it("CSV-033: Standard template must be valid CSV and parse cleanly", () => {
            const parsed = Papa.parse(STANDARD_PRODUCT_TEMPLATE_CSV, { header: true, skipEmptyLines: true });
            assert.equal(parsed.errors.length, 0);
            assert.ok(parsed.data.length >= 2);
            const { groups } = groupCsvRows(parsed.data as any[]);
            assert.equal(groups.length, 2);
        });

        it("CSV-034: Variants template must be valid CSV and group multi-row combinations", () => {
            const parsed = Papa.parse(VARIANTS_PRODUCT_TEMPLATE_CSV, { header: true, skipEmptyLines: true });
            assert.equal(parsed.errors.length, 0);
            const { groups } = groupCsvRows(parsed.data as any[]);
            assert.equal(groups.length, 2); // 2 products: tshirt and cushion
            const cushion = groups.find(g => g.handle === "bazaarvilla-square-cushion");
            assert.ok(cushion);
            assert.equal(cushion.variants.length, 4);
            assert.equal(cushion.sizeMode, "dimensions");
        });

        it("CSV-035: Personalized template must be valid CSV and flag customization types", () => {
            const parsed = Papa.parse(PERSONALIZED_PRODUCT_TEMPLATE_CSV, { header: true, skipEmptyLines: true });
            assert.equal(parsed.errors.length, 0);
            const { groups } = groupCsvRows(parsed.data as any[]);
            assert.equal(groups.length, 2);
            for (const g of groups) {
                assert.equal(isCustomizableProduct(g), true);
            }
        });
    });

    // -------------------------------------------------------------------------
    // 9. Production Safety & SSRF Hardening Unit Tests (TASK 030 Extended)
    // -------------------------------------------------------------------------
    describe("9. Production Safety & SSRF Hardening Verification", () => {
        it("CSV-036: isPrivateIp strictly blocks IPv4-mapped IPv6 private & metadata addresses", () => {
            // IPv4-mapped IPv6 loopback
            assert.equal(isPrivateIp("::ffff:127.0.0.1"), true);
            // IPv4-mapped IPv6 cloud metadata
            assert.equal(isPrivateIp("::ffff:169.254.169.254"), true);
            // IPv4-mapped IPv6 RFC 1918 private
            assert.equal(isPrivateIp("::ffff:10.0.0.1"), true);
            assert.equal(isPrivateIp("::ffff:192.168.1.1"), true);
            assert.equal(isPrivateIp("::ffff:172.16.0.1"), true);
            assert.equal(isPrivateIp("0:0:0:0:0:ffff:127.0.0.1"), true);

            // Carrier-grade NAT and benchmark subnets
            assert.equal(isPrivateIp("100.64.0.1"), true);
            assert.equal(isPrivateIp("198.18.0.1"), true);
            assert.equal(isPrivateIp("224.0.0.1"), true); // Multicast
            assert.equal(isPrivateIp("255.255.255.255"), true); // Broadcast

            // Genuine public IPv4-mapped IPv6 must pass
            assert.equal(isPrivateIp("::ffff:8.8.8.8"), false);
            assert.equal(isPrivateIp("::ffff:1.1.1.1"), false);
        });

        it("CSV-037: validateRemoteImageUrl strictly blocks non-443 ports and non-HTTPS protocols", async () => {
            const httpResult = await validateRemoteImageUrl("http://images.unsplash.com/photo-123.jpg");
            assert.equal(httpResult.valid, false);
            assert.match(httpResult.error || "", /only https/i);

            const portResult = await validateRemoteImageUrl("https://images.unsplash.com:8080/photo-123.jpg");
            assert.equal(portResult.valid, false);
            assert.match(portResult.error || "", /prohibited non-standard/i);

            const ftpResult = await validateRemoteImageUrl("ftp://example.com/img.png");
            assert.equal(ftpResult.valid, false);
        });

        it("CSV-038: buildProductPreview rejects missing, zero, or negative base prices for new products", () => {
            // Missing / zero price
            const zeroPriceGroup: any = {
                handle: "free-gift",
                title: "Free Gift",
                basePrice: 0,
                variants: [{ inventory: 10, isActive: true, csvRowNumber: 2 }],
                errors: [],
                warnings: [],
                images: [],
                firstRowNumber: 2,
            };
            const previewZero = buildProductPreview({ group: zeroPriceGroup, mode: "create_only" });
            assert.equal(previewZero.status, "invalid");
            assert.ok(previewZero.errors.some(e => e.field === "price" && e.fatal));

            // Negative price
            const negPriceGroup: any = {
                handle: "neg-product",
                title: "Negative Product",
                basePrice: -100,
                variants: [{ inventory: 10, isActive: true, csvRowNumber: 2 }],
                errors: [],
                warnings: [],
                images: [],
                firstRowNumber: 2,
            };
            const previewNeg = buildProductPreview({ group: negPriceGroup, mode: "create_only" });
            assert.equal(previewNeg.status, "invalid");
            assert.ok(previewNeg.errors.some(e => e.field === "price" && e.fatal));
        });

        it("CSV-039: buildProductPreview rejects negative variant inventory", () => {
            const negStockGroup: any = {
                handle: "cushion-neg-stock",
                title: "Cushion",
                basePrice: 599,
                variants: [{ sku: "CSH-01", inventory: -5, isActive: true, csvRowNumber: 3 }],
                errors: [],
                warnings: [],
                images: [],
                firstRowNumber: 2,
            };
            const preview = buildProductPreview({ group: negStockGroup, mode: "create_and_update" });
            assert.equal(preview.status, "invalid");
            assert.ok(preview.errors.some(e => e.field === "inventory" && e.fatal));
        });

        it("CSV-040: PapaParse cleanly handles UTF-8 BOM, multiline quoted descriptions, and commas", () => {
            const bomCsv = "\uFEFFHandle,Title,Body (HTML),Variant Price\n" +
                '"luxe-candle","Luxe Aromatherapy Candle","<p>Notes of vanilla, sandalwood,\nand amber.</p>",899\n';

            const parsed = Papa.parse(bomCsv, { header: true, skipEmptyLines: "greedy" });
            assert.equal(parsed.errors.length, 0);
            assert.equal(parsed.data.length, 1);
            const row: any = parsed.data[0];
            assert.equal(row["Handle"], "luxe-candle");
            assert.equal(row["Title"], "Luxe Aromatherapy Candle");
            assert.ok(row["Body (HTML)"].includes("vanilla, sandalwood,\nand amber"));
            assert.equal(row["Variant Price"], "899");
        });

        it("CSV-041: sanitizeCsvCellValue strictly escapes all formula trigger characters", () => {
            assert.equal(sanitizeCsvCellValue("=cmd|'/C calc'!A0"), "'=cmd|'/C calc'!A0");
            assert.equal(sanitizeCsvCellValue("+123456"), "'+123456");
            assert.equal(sanitizeCsvCellValue("-100"), "'-100");
            assert.equal(sanitizeCsvCellValue("@SUM(A1:A10)"), "'@SUM(A1:A10)");
            assert.equal(sanitizeCsvCellValue("\tmalicious"), "'\tmalicious");
            assert.equal(sanitizeCsvCellValue("\rmalicious"), "'\rmalicious");

            // Normal text remains untouched
            assert.equal(sanitizeCsvCellValue("Standard Product Title"), "Standard Product Title");
            assert.equal(sanitizeCsvCellValue("100% Cotton"), "100% Cotton");
        });
    });
});
