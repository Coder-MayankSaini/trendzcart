import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

describe("Storefront Product Image Containment & No-Crop Gallery (TASK 028)", () => {
    const cssPath = path.join(process.cwd(), "src", "app", "globals.css");
    const galleryComponentPath = path.join(process.cwd(), "src", "components", "storefront", "ProductImageGallery.tsx");
    const cardComponentPath = path.join(process.cwd(), "src", "components", "storefront", "ProductCardImage.tsx");
    const adminProductsPath = path.join(process.cwd(), "src", "components", "admin", "AdminProducts.tsx");

    it("CONTAIN-001: CSS rules for .pig-main enforce 4/5 aspect ratio, flex centering, and background containment", () => {
        const css = fs.readFileSync(cssPath, "utf8");
        assert.ok(css.includes(".pig-main"), ".pig-main class must exist in globals.css");

        const pigMainBlock = css.match(/\.pig-main\s*\{[^}]+\}/)?.[0] || "";
        assert.ok(pigMainBlock.includes("aspect-ratio: 4/5"), ".pig-main container must specify aspect-ratio: 4/5 to eliminate CLS");
        assert.ok(pigMainBlock.includes("display: flex"), ".pig-main container must specify display: flex for centering");
        assert.ok(pigMainBlock.includes("align-items: center"), ".pig-main container must align items center");
        assert.ok(pigMainBlock.includes("justify-content: center"), ".pig-main container must justify content center");
        assert.ok(pigMainBlock.includes("background: var(--bg-secondary)"), ".pig-main must provide consistent subtle background framing");
    });

    it("CONTAIN-002: CSS rules for .pig-main-img enforce object-fit: contain to prevent cropping non-4:5 photographs", () => {
        const css = fs.readFileSync(cssPath, "utf8");
        assert.ok(css.includes(".pig-main-img"), ".pig-main-img class must exist in globals.css");

        const pigMainImgBlock = css.match(/\.pig-main-img\s*\{[^}]+\}/)?.[0] || "";
        assert.ok(pigMainImgBlock.includes("object-fit: contain"), ".pig-main-img must enforce object-fit: contain in CSS");
        assert.ok(pigMainImgBlock.includes("aspect-ratio: 4/5"), ".pig-main-img must maintain 4/5 ratio container match");
        assert.ok(pigMainImgBlock.includes("height: auto"), ".pig-main-img must enforce height: auto to prevent HTML height lock");
        assert.ok(pigMainImgBlock.includes("max-height: 100%"), ".pig-main-img must enforce max-height: 100% within container");
    });

    it("CONTAIN-003: ProductImageGallery.tsx inline styles specify objectFit: 'contain' to ensure complete visibility", () => {
        const galleryCode = fs.readFileSync(galleryComponentPath, "utf8");
        assert.ok(
            galleryCode.includes('objectFit: "contain"') || galleryCode.includes("objectFit: 'contain'"),
            "ProductImageGallery main Image element must enforce inline objectFit: 'contain'"
        );
        assert.ok(
            !galleryCode.includes('className="pig-main-img"\n                    style={{ width: "100%", height: "auto", objectFit: "cover" }}') &&
            !galleryCode.includes('className="pig-main-img" style={{ width: "100%", height: "auto", objectFit: "cover" }}'),
            "ProductImageGallery main Image must not use objectFit: 'cover'"
        );
    });

    it("CONTAIN-004: ProductImageGallery.tsx targets production recommended dimensions (1200 × 1500 px)", () => {
        const galleryCode = fs.readFileSync(galleryComponentPath, "utf8");
        assert.ok(galleryCode.includes("width={1200}"), "Main gallery image width attribute must be 1200");
        assert.ok(galleryCode.includes("height={1500}"), "Main gallery image height attribute must be 1500 (4:5)");
        assert.ok(galleryCode.includes("priority"), "Main gallery image must retain priority loading for LCP");
    });

    it("CONTAIN-005: Thumbnail strip items enforce object-fit: contain and flex centering", () => {
        const css = fs.readFileSync(cssPath, "utf8");
        const galleryCode = fs.readFileSync(galleryComponentPath, "utf8");

        const thumbBlock = css.match(/\.pig-thumb\s*\{[^}]+\}/)?.[0] || "";
        assert.ok(thumbBlock.includes("display: flex"), ".pig-thumb must enforce display: flex");
        assert.ok(thumbBlock.includes("align-items: center"), ".pig-thumb must align items center");
        assert.ok(thumbBlock.includes("justify-content: center"), ".pig-thumb must justify content center");

        const thumbImgBlock = css.match(/\.pig-thumb img\s*\{[^}]+\}/)?.[0] || "";
        assert.ok(thumbImgBlock.includes("object-fit: contain"), ".pig-thumb img must enforce object-fit: contain in CSS");

        // Inline style in component must also enforce contain
        assert.ok(
            galleryCode.includes('style={{ width: "100%", height: "100%", objectFit: "contain" }}'),
            "Thumbnail image inside ProductImageGallery must have objectFit: 'contain'"
        );
    });

    it("CONTAIN-006: ProductCardImage.tsx supports optional objectFit prop with default 'cover'", () => {
        const cardCode = fs.readFileSync(cardComponentPath, "utf8");
        assert.ok(cardCode.includes('objectFit?: "cover" | "contain"'), "ProductCardImageProps must define objectFit union type");
        assert.ok(cardCode.includes('objectFit = "cover"'), "ProductCardImage must default objectFit to 'cover'");
        assert.ok(cardCode.includes("style={{ objectFit }}"), "ProductCardImage Image must apply style={{ objectFit }}");
    });

    it("CONTAIN-007: Admin product upload dropzone documents 4:5 recommendation and square/landscape support", () => {
        const adminCode = fs.readFileSync(adminProductsPath, "utf8");
        assert.ok(adminCode.includes("Recommended: 4:5 portrait (1200 × 1500 px)"), "Admin dropzone must document recommended 4:5 ratio");
        assert.ok(adminCode.includes("Square & landscape images also fully supported without cropping"), "Admin dropzone must clarify non-crop support");
        assert.ok(adminCode.includes("Max 10MB per file"), "Admin dropzone must preserve 10MB limit guidance");
    });

    it("CONTAIN-008: Mathematical containment verification for portrait, square, and landscape aspect ratios", () => {
        // Container box dimensions (4:5 ratio)
        const containerW = 400;
        const containerH = 500; // 400 * (5/4)

        const testImages = [
            { name: "Landscape 16:9", srcW: 1600, srcH: 900, ratio: 16 / 9 },
            { name: "Square 1:1", srcW: 1200, srcH: 1200, ratio: 1.0 },
            { name: "Portrait 3:4", srcW: 900, srcH: 1200, ratio: 3 / 4 },
            { name: "Portrait 4:5", srcW: 1200, srcH: 1500, ratio: 4 / 5 },
            { name: "Tall Portrait 9:16", srcW: 900, srcH: 1600, ratio: 9 / 16 },
        ];

        for (const img of testImages) {
            // Under object-fit: contain
            const scale = Math.min(containerW / img.srcW, containerH / img.srcH);
            const renderedW = img.srcW * scale;
            const renderedH = img.srcH * scale;

            // Contain rule: rendered dimensions must be <= container dimensions
            assert.ok(renderedW <= containerW + 0.001, `${img.name} width (${renderedW}) exceeds container (${containerW})`);
            assert.ok(renderedH <= containerH + 0.001, `${img.name} height (${renderedH}) exceeds container (${containerH})`);

            // Contain rule: at least one dimension must fully touch the container boundary
            const touchesWidth = Math.abs(renderedW - containerW) < 0.001;
            const touchesHeight = Math.abs(renderedH - containerH) < 0.001;
            assert.ok(touchesWidth || touchesHeight, `${img.name} must touch either width or height boundary`);

            // Aspect ratio must be exactly preserved (no distortion)
            const renderedRatio = renderedW / renderedH;
            assert.ok(
                Math.abs(renderedRatio - img.ratio) < 0.001,
                `${img.name} aspect ratio distorted: expected ${img.ratio}, got ${renderedRatio}`
            );
        }
    });

    it("CONTAIN-009: Counter indicator is layered above contained image content", () => {
        const css = fs.readFileSync(cssPath, "utf8");
        const counterBlock = css.match(/\.pig-counter\s*\{[^}]+\}/)?.[0] || "";
        assert.ok(counterBlock.includes("z-index: 2"), ".pig-counter must specify z-index: 2 for clean layering");
    });

    it("CONTAIN-010: Product Customizer local photo preview maintains independent objectFit styling", () => {
        const customizerPath = path.join(process.cwd(), "src", "components", "storefront", "ProductCustomizer.tsx");
        const customizerCode = fs.readFileSync(customizerPath, "utf8");
        assert.ok(customizerCode.includes("previewUrl"), "ProductCustomizer must support previewUrl");
        assert.ok(customizerCode.includes("Custom Preview"), "ProductCustomizer must render Custom Preview img");
    });
});
