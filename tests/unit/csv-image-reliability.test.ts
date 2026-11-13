/**
 * Unit Tests for CSV Image Production Reliability, Anti-False-Positive Verification,
 * and Shopify-to-Bazaarvilla Canonical Conversion (TASK 036)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
    validateRemoteImageUrl,
    detectImageMagicBytes,
} from "../../src/lib/products/import/imageIngestion.ts";
import {
    verifyMediaBuffer,
    isPlaceholderSvg,
} from "../../src/lib/storage/mediaVerification.ts";
import {
    convertShopifyToBazaarvillaCsv,
} from "../../src/lib/products/import/converter.ts";
import {
    BAZAARVILLA_TEMPLATES,
    BAZAARVILLA_CANONICAL_TEMPLATE_CSV,
} from "../../src/lib/products/import/templates.ts";
import { extractStorageKey } from "../../src/lib/storage/r2.ts";

describe("TASK 036 — CSV Image Production Reliability & Verification", () => {
    describe("1. DNS & Network Route Failover (IPv4 Prioritization)", () => {
        it("IMG-UNIT-001: validateRemoteImageUrl prioritizes IPv4 over IPv6 to prevent ENETUNREACH in serverless environments", async () => {
            const validation = await validateRemoteImageUrl("https://cdn.shopify.com/s/files/1/0663/7253/4491/files/batman.jpg");
            assert.equal(validation.valid, true);
            assert.ok(validation.pinnedIp, "pinnedIp must be populated");
            assert.ok(validation.allPinnedIps && validation.allPinnedIps.length > 0, "allPinnedIps must be populated");

            // Verify that the chosen pinnedIp is an IPv4 address (family 4)
            const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(validation.pinnedIp!);
            assert.equal(isIpv4, true, `Expected pinnedIp ${validation.pinnedIp} to be IPv4`);

            // Verify IPv4 candidates are sorted ahead of any IPv6 candidates
            if (validation.allPinnedIps.length > 1) {
                const firstIp = validation.allPinnedIps[0];
                assert.equal(/^(\d{1,3}\.){3}\d{1,3}$/.test(firstIp), true, "First candidate IP must be IPv4");
            }
        });

        it("IMG-UNIT-002: validateRemoteImageUrl strictly blocks private IPv4 and IPv6 loopback / LAN ranges (SSRF defense)", async () => {
            const privateUrls = [
                "http://127.0.0.1/secret.jpg",
                "http://localhost:8080/image.png",
                "http://169.254.169.254/latest/meta-data/",
                "http://10.0.0.5/admin.jpg",
                "http://192.168.1.1/config.jpg",
                "http://[::1]/private.jpg",
            ];

            for (const url of privateUrls) {
                const res = await validateRemoteImageUrl(url);
                assert.equal(res.valid, false, `Expected ${url} to be rejected by SSRF guard`);
                assert.ok(res.error, `Expected failure reason for ${url}`);
            }
        });
    });

    describe("2. False-Positive Image Verification & Magic Byte Detection", () => {
        it("IMG-UNIT-003: isPlaceholderSvg correctly flags SVG content and placeholder signatures", () => {
            const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><text>Placeholder</text></svg>`;
            const svgBuffer = Buffer.from(svgContent, "utf8");

            assert.equal(isPlaceholderSvg(svgBuffer), true);
            assert.equal(isPlaceholderSvg(Buffer.from("<svg>bazaarvilla image</svg>")), true);
            assert.equal(isPlaceholderSvg(Buffer.from("")), false);
        });

        it("IMG-UNIT-004: verifyMediaBuffer strictly rejects SVG placeholders from being counted as valid product media", () => {
            const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect fill="#eee"/><text>No Image</text></svg>`;
            const svgBuffer = Buffer.from(svgContent, "utf8");

            const verification = verifyMediaBuffer(svgBuffer, "image/svg+xml");
            assert.equal(verification.isValid, false);
            assert.equal(verification.isSvgFallback, true);
            assert.ok(verification.reason?.includes("SVG placeholder"), `Expected placeholder rejection reason, got: ${verification.reason}`);
        });

        it("IMG-UNIT-005: verifyMediaBuffer accepts authentic binary JPEG, PNG, and WebP buffers with valid magic bytes", () => {
            // Authentic JPEG magic bytes: FF D8 FF (at least 12 bytes)
            const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60]);
            const jpegResult = verifyMediaBuffer(jpegBuffer, "image/jpeg");
            assert.equal(jpegResult.isValid, true);
            assert.equal(jpegResult.contentType, "image/jpeg");

            // Authentic PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A (at least 12 bytes)
            const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52]);
            const pngResult = verifyMediaBuffer(pngBuffer, "image/png");
            assert.equal(pngResult.isValid, true);
            assert.equal(pngResult.contentType, "image/png");

            // Authentic WebP magic bytes: RIFF....WEBP (at least 12 bytes)
            const webpBuffer = Buffer.from([
                0x52, 0x49, 0x46, 0x46, // "RIFF"
                0x24, 0x00, 0x00, 0x00, // file length
                0x57, 0x45, 0x42, 0x50, // "WEBP"
                0x56, 0x50, 0x38, 0x20  // "VP8 "
            ]);
            const webpResult = verifyMediaBuffer(webpBuffer, "image/webp");
            assert.equal(webpResult.isValid, true);
            assert.equal(webpResult.contentType, "image/webp");
        });

        it("IMG-UNIT-006: verifyMediaBuffer rejects empty 0-byte buffers, text error pages, and corrupted streams", () => {
            const emptyResult = verifyMediaBuffer(Buffer.from([]), "image/jpeg");
            assert.equal(emptyResult.isValid, false);
            assert.equal(emptyResult.reason, "Empty media payload (0 bytes)");

            const htmlError = Buffer.from("<html><body><h1>404 Not Found</h1></body></html>", "utf8");
            const htmlResult = verifyMediaBuffer(htmlError, "image/jpeg");
            assert.equal(htmlResult.isValid, false);
            assert.ok(htmlResult.reason?.includes("HTML or SVG response detected"));

            const randomNoise = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c]);
            const noiseResult = verifyMediaBuffer(randomNoise, "image/jpeg");
            assert.equal(noiseResult.isValid, false);
            assert.equal(noiseResult.reason, "Unsupported or unrecognized binary image format");
        });
    });

    describe("3. Canonical Bazaarvilla Template & Shopify-to-Bazaarvilla Converter", () => {
        it("IMG-UNIT-007: BAZAARVILLA_TEMPLATES exports canonical template with 4-image example product", () => {
            const canonicalTemplate = BAZAARVILLA_TEMPLATES.bazaarvilla;
            assert.ok(canonicalTemplate, "bazaarvilla template must exist");
            assert.equal(canonicalTemplate.filename, "bazaarvilla-product-import-canonical-template.csv");

            // Check that CSV contains 4-image example product
            assert.ok(BAZAARVILLA_CANONICAL_TEMPLATE_CSV.includes("plastic-design-lamp-heng-balance-white-68173"));
            assert.ok(BAZAARVILLA_CANONICAL_TEMPLATE_CSV.includes("Image Src"));
            assert.ok(BAZAARVILLA_CANONICAL_TEMPLATE_CSV.includes("Image Position"));
            assert.ok(BAZAARVILLA_CANONICAL_TEMPLATE_CSV.includes("Compare At Price"));
        });

        it("IMG-UNIT-008: convertShopifyToBazaarvillaCsv converts Gillkart CSV into canonical format with 28 products and 60 images", () => {
            const referenceCsvPath = path.join(process.cwd(), "shopify_products_www-gillkart-com.csv");
            if (!fs.existsSync(referenceCsvPath)) {
                return; // Skip if file not present in local test runner
            }

            const rawCsv = fs.readFileSync(referenceCsvPath, "utf8");
            const result = convertShopifyToBazaarvillaCsv(rawCsv);

            assert.ok(result.convertedCsv, "convertedCsv must be returned");
            assert.equal(result.summary.totalProducts, 28, "Expected exactly 28 products converted");
            assert.equal(result.summary.totalImages, 60, "Expected exactly 60 images preserved");

            // Verify the 4-image lamp product is preserved in the converted CSV
            assert.ok(result.convertedCsv.includes("plastic-design-lamp-heng-balance-white-68173"));
            assert.ok(result.convertedCsv.includes("Plastic Design Lamp"));

            // Verify compare-at price is preserved in the converted CSV
            assert.ok(result.convertedCsv.includes("1299") || result.convertedCsv.includes("1310"), "Compare-at price should be preserved");
        });
    });

    describe("4. Storage Key Parsing & Proxy Invalidation Prevention", () => {
        it("IMG-UNIT-009: extractStorageKey parses R2 keys from public media URLs and relative paths", () => {
            const key1 = extractStorageKey("https://bazaarvilla.com/api/media/public/products/abc-123/img-1.png");
            assert.equal(key1, "products/abc-123/img-1.png");

            const key2 = extractStorageKey("/api/media/public/products/xyz-456/img-2.webp");
            assert.equal(key2, "products/xyz-456/img-2.webp");

            const key3 = extractStorageKey("products/batman-uuid/batman.png");
            assert.equal(key3, "products/batman-uuid/batman.png");

            const externalUrl = extractStorageKey("https://cdn.shopify.com/s/files/batman.jpg");
            assert.equal(externalUrl, null, "External URLs should not be parsed as local R2 keys");
        });
    });
});
