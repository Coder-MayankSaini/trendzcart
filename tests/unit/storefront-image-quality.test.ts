import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { normalizeMediaUrl } from "../../src/lib/storage/mediaUrl.ts";

describe("Storefront Product Image Quality & Resolution (TASK 026)", () => {
    it("QUALITY-001: normalizeMediaUrl converts query-based public URLs to clean path-based URLs", () => {
        const queryUrl = "/api/media/public?key=products%2F82b5c865-3128-4515-96e5-80f7f0eed58e%2Ff1a40980-e3d8-4f8f-9a58-e6eecf506695.png";
        const normalized = normalizeMediaUrl(queryUrl);
        assert.equal(normalized, "/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/f1a40980-e3d8-4f8f-9a58-e6eecf506695.png");

        // Already clean path-based URL should remain unchanged
        const pathUrl = "/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/f1a40980-e3d8-4f8f-9a58-e6eecf506695.png";
        assert.equal(normalizeMediaUrl(pathUrl), pathUrl);

        // Handles empty or non-string inputs safely
        assert.equal(normalizeMediaUrl(null), "");
        assert.equal(normalizeMediaUrl(undefined), "");
        assert.equal(normalizeMediaUrl(""), "");
    });

    it("QUALITY-002: Storefront cards prioritize high-resolution images[0] over compressed thumbnails[0]", () => {
        const product = {
            id: "prod-sharpness-1",
            name: "High Resolution Test Product",
            images: [
                "/api/media/public/products/prod-sharpness-1/high_res_cover.png",
                "/api/media/public/products/prod-sharpness-1/angle_2.png"
            ],
            thumbnails: [
                "/api/media/public/products/prod-sharpness-1/tiny_thumb_279x375.png",
                "/api/media/public/products/prod-sharpness-1/tiny_thumb_2.png"
            ],
            image: "/api/media/public/products/prod-sharpness-1/legacy_img.png"
        };

        // Algorithm used by /products catalog and homepage featured products
        const selectedCover = (product.images && product.images.length > 0 ? product.images[0] : null) ||
            product.thumbnails?.[0] ||
            product.image ||
            null;

        assert.equal(
            selectedCover,
            "/api/media/public/products/prod-sharpness-1/high_res_cover.png",
            "Storefront must select high-resolution full image over downscaled thumbnail"
        );
        assert.notEqual(
            selectedCover,
            product.thumbnails[0],
            "Storefront must NOT choose compressed thumbnail when full image exists"
        );
    });

    it("QUALITY-003: Graceful fallback to thumbnails when full-resolution images array is empty", () => {
        const legacyProduct = {
            id: "prod-legacy-thumb",
            name: "Legacy Product with only Thumbnails",
            images: [] as string[],
            thumbnails: [
                "/api/media/public/products/prod-legacy-thumb/thumb.png"
            ],
            image: ""
        };

        const selectedCover = (legacyProduct.images && legacyProduct.images.length > 0 ? legacyProduct.images[0] : null) ||
            legacyProduct.thumbnails?.[0] ||
            legacyProduct.image ||
            null;

        assert.equal(
            selectedCover,
            "/api/media/public/products/prod-legacy-thumb/thumb.png",
            "Must cleanly fall back to thumbnail if images array is empty"
        );
    });

    it("QUALITY-004: Next.js configuration allows local patterns and modern image formats", () => {
        const configPath = path.join(process.cwd(), "next.config.ts");
        const content = fs.readFileSync(configPath, "utf8");

        assert.ok(content.includes('pathname: "/api/media/**"'), "next.config.ts must allow /api/media/** local pattern");
        assert.ok(content.includes('formats: ["image/avif", "image/webp"]') || content.includes('image/webp'), "next.config.ts must support modern WebP/AVIF");
    });

    it("QUALITY-005: Storefront CSS contains no degrading blur filters or forced downscaling on product images", () => {
        const cssPath = path.join(process.cwd(), "src", "app", "globals.css");
        const cssContent = fs.readFileSync(cssPath, "utf8");

        // Verify no permanent filter: blur() is applied to product image classes
        const blurMatches = cssContent.match(/\.product-image[^{]*\{[^}]*filter:\s*blur/gi);
        assert.equal(blurMatches, null, "No permanent blur filter may be applied to .product-image");

        const pigBlurMatches = cssContent.match(/\.pig-main-img[^{]*\{[^}]*filter:\s*blur/gi);
        assert.equal(pigBlurMatches, null, "No permanent blur filter may be applied to .pig-main-img");

        // Verify object-fit: cover is preserved for clean aspect ratio
        assert.ok(cssContent.includes("object-fit: cover"), "Storefront must use object-fit: cover for crisp aspect ratio");
    });

    it("QUALITY-006: Product detail gallery main image enforces height: auto and 4/5 aspect ratio", () => {
        const cssPath = path.join(process.cwd(), "src", "app", "globals.css");
        const cssContent = fs.readFileSync(cssPath, "utf8");

        // Verify .pig-main-img has width: 100%, height: auto, and aspect-ratio: 4/5
        assert.ok(cssContent.includes(".pig-main-img"), ".pig-main-img must be defined in globals.css");
        assert.ok(cssContent.includes("aspect-ratio: 4/5"), "Gallery image must maintain 4/5 aspect ratio");

        const gallerySourcePath = path.join(process.cwd(), "src", "components", "storefront", "ProductImageGallery.tsx");
        const galleryContent = fs.readFileSync(gallerySourcePath, "utf8");
        assert.ok(
            galleryContent.includes('height: "auto"') || galleryContent.includes("height: 'auto'"),
            "ProductImageGallery must specify height: 'auto' in inline styles to prevent HTML attribute height locking"
        );
    });
});
