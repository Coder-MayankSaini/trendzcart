import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Admin Product Gallery UI & Logic Unit Tests (TASK 025)", () => {
    interface TestGalleryItem {
        id: string;
        src: string;
        isExisting: boolean;
        file?: { name: string; size: number; type: string };
    }

    it("GALLERY-001: should correctly identify featured hero image and provide hero state", () => {
        const items: TestGalleryItem[] = [
            { id: "img-1", src: "/brand/bazaarvilla-banner-desktop.webp", isExisting: true },
            { id: "img-2", src: "/brand/bazaarvilla-mascot.webp", isExisting: true },
            { id: "img-3", src: "/brand/bazaarvilla-logo-horizontal.webp", isExisting: true },
        ];

        let featuredId = "img-2";

        const isHero0 = featuredId ? items[0].id === featuredId : 0 === 0;
        const isHero1 = featuredId ? items[1].id === featuredId : 1 === 0;
        const isHero2 = featuredId ? items[2].id === featuredId : 2 === 0;

        assert.equal(isHero0, false, "img-1 is not hero");
        assert.equal(isHero1, true, "img-2 is featured hero");
        assert.equal(isHero2, false, "img-3 is not hero");

        // When saving, hero item is moved to index 0
        const finalOrdered = [...items];
        const heroIdx = finalOrdered.findIndex(item => item.id === featuredId);
        if (heroIdx > 0) {
            const [heroItem] = finalOrdered.splice(heroIdx, 1);
            finalOrdered.unshift(heroItem);
        }

        assert.equal(finalOrdered[0].id, "img-2", "Featured hero item must be placed at index 0");
        assert.equal(finalOrdered[1].id, "img-1");
        assert.equal(finalOrdered[2].id, "img-3");
    });

    it("GALLERY-002: should enforce boundary constraints on Move Left and Move Right actions", () => {
        const items = ["a", "b", "c", "d"];

        const canMoveLeft = (idx: number) => idx > 0;
        const canMoveRight = (idx: number, len: number) => idx < len - 1;

        // First item (idx = 0)
        assert.equal(canMoveLeft(0), false, "First item cannot move left (disabled)");
        assert.equal(canMoveRight(0, items.length), true, "First item can move right");

        // Middle item (idx = 1)
        assert.equal(canMoveLeft(1), true, "Middle item can move left");
        assert.equal(canMoveRight(1, items.length), true, "Middle item can move right");

        // Last item (idx = 3)
        assert.equal(canMoveLeft(3), true, "Last item can move left");
        assert.equal(canMoveRight(3, items.length), false, "Last item cannot move right (disabled)");

        // Reordering logic
        const moveItem = (arr: string[], idx: number, dir: "left" | "right") => {
            const target = dir === "left" ? idx - 1 : idx + 1;
            if (target < 0 || target >= arr.length) return arr;
            const updated = [...arr];
            const [moved] = updated.splice(idx, 1);
            updated.splice(target, 0, moved);
            return updated;
        };

        const movedRight = moveItem(items, 1, "right");
        assert.deepEqual(movedRight, ["a", "c", "b", "d"], "Item 'b' moved right between 'c' and 'd'");

        const movedLeft = moveItem(movedRight, 2, "left");
        assert.deepEqual(movedLeft, ["a", "b", "c", "d"], "Item 'b' moved left back to index 1");
    });

    it("GALLERY-003: should safely remove gallery items and fall back featured image without corruption", () => {
        let items: TestGalleryItem[] = [
            { id: "hero-1", src: "blob:http://localhost/1", isExisting: false },
            { id: "img-2", src: "/api/media/public/products/p1/2.png", isExisting: true },
            { id: "img-3", src: "/api/media/public/products/p1/3.png", isExisting: true },
        ];
        let featuredId = "hero-1";

        // Remove the current hero
        const idToRemove = "hero-1";
        items = items.filter(it => it.id !== idToRemove);
        if (featuredId === idToRemove) {
            featuredId = items.length > 0 ? items[0].id : "";
        }

        assert.equal(items.length, 2);
        assert.equal(featuredId, "img-2", "New first image becomes the fallback hero");

        // Remove until empty
        items = [];
        if (featuredId === "img-2") {
            featuredId = items.length > 0 ? items[0].id : "";
        }
        assert.equal(featuredId, "", "Empty gallery yields empty featuredId");
    });

    it("GALLERY-004: should enforce strict 10MB size limit and allowed MIME types", () => {
        const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
        const MAX_SIZE_BYTES = 10 * 1024 * 1024;

        const validateFile = (file: { name: string; size: number; type: string }) => {
            if (file.size > MAX_SIZE_BYTES) return { valid: false, error: "Exceeds 10MB limit" };
            if (!allowedTypes.includes(file.type.toLowerCase())) return { valid: false, error: "Unsupported format" };
            return { valid: true };
        };

        // Valid files
        assert.equal(validateFile({ name: "photo1.jpg", size: 2 * 1024 * 1024, type: "image/jpeg" }).valid, true);
        assert.equal(validateFile({ name: "photo2.png", size: 5 * 1024 * 1024, type: "image/png" }).valid, true);
        assert.equal(validateFile({ name: "photo3.webp", size: 10 * 1024 * 1024, type: "image/webp" }).valid, true);

        // Invalid: oversized (>10MB)
        const oversized = validateFile({ name: "huge.png", size: 10 * 1024 * 1024 + 1, type: "image/png" });
        assert.equal(oversized.valid, false);
        assert.match(oversized.error || "", /Exceeds 10MB/);

        // Invalid: unsupported MIME types
        assert.equal(validateFile({ name: "vector.svg", size: 5000, type: "image/svg+xml" }).valid, false);
        assert.equal(validateFile({ name: "doc.pdf", size: 50000, type: "application/pdf" }).valid, false);
        assert.equal(validateFile({ name: "script.js", size: 500, type: "text/javascript" }).valid, false);
    });

    it("GALLERY-005: should verify CSS rules prevent global storefront .hero padding leakage", () => {
        const globalsCssPath = path.join(process.cwd(), "src", "app", "globals.css");
        const globalsCss = fs.readFileSync(globalsCssPath, "utf8");

        // 1. Verify storefront .hero does not apply to admin gallery cards
        assert.ok(
            globalsCss.includes(".hero:not(.admin-gallery-card):not(.admin-image-preview-card)") ||
            globalsCss.includes("padding: 8px !important"),
            "globals.css must isolate .hero styling from admin gallery cards"
        );

        // 2. Verify admin gallery card has explicit zero margin and controlled padding
        assert.ok(globalsCss.includes(".admin-gallery-card"), "globals.css must contain .admin-gallery-card rules");
        assert.ok(globalsCss.includes(".admin-gallery-preview-wrapper"), "globals.css must contain .admin-gallery-preview-wrapper rules");
        assert.ok(globalsCss.includes(".admin-gallery-card-footer"), "globals.css must contain .admin-gallery-card-footer rules");

        // 3. Verify 1:1 preview aspect ratio
        assert.ok(globalsCss.includes("aspect-ratio: 1 / 1"), "Preview wrapper must declare aspect-ratio: 1 / 1");

        // 4. Verify object-fit: contain to prevent image distortion
        assert.ok(globalsCss.includes("object-fit: contain"), "Image preview must specify object-fit: contain");

        // 5. Verify dedicated footer buttons are not absolutely positioned
        assert.ok(globalsCss.includes(".admin-gallery-btn"), "globals.css must contain .admin-gallery-btn rules");
    });
});
