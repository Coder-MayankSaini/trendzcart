import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

describe("Storefront Mobile Responsiveness & Compact Homepage Benefits (TASK 031)", () => {
    const cssPath = path.join(process.cwd(), "src", "app", "globals.css");
    const homePagePath = path.join(process.cwd(), "src", "app", "(storefront)", "page.tsx");
    const customizerPath = path.join(process.cwd(), "src", "components", "storefront", "ProductCustomizer.tsx");
    const measurementsPath = path.join(process.cwd(), "docs", "screenshots", "task031", "after", "measurements-after.json");

    it("RESP-001: CSS rules for .pdp-container enforce fluid mobile padding and boundary box sizing", () => {
        const css = fs.readFileSync(cssPath, "utf8");
        assert.ok(css.includes(".pdp-container"), ".pdp-container class must exist in globals.css");

        const pdpContainerBlock = css.match(/\.pdp-container\s*\{[^}]+\}/)?.[0] || "";
        assert.ok(pdpContainerBlock.includes("box-sizing: border-box"), ".pdp-container must enforce border-box sizing");
        assert.ok(pdpContainerBlock.includes("width: 100%"), ".pdp-container must specify width: 100%");

        // Verify mobile media query padding reduction
        assert.ok(css.includes("@media (max-width: 768px)"), "globals.css must specify max-width: 768px responsive breakpoint");
        assert.ok(css.includes("padding: 16px 16px 48px;"), "Mobile pdp-container must reduce horizontal padding to 16px");
        assert.ok(css.includes("padding: 12px 12px 40px;"), "Ultra-narrow (360px) pdp-container must reduce horizontal padding to 12px");
    });

    it("RESP-002: CSS rules for .pdp-layout, .pdp-gallery-col, and .pdp-info-col enforce min-width: 0 and minmax(0, 1fr) grid sizing to prevent content blowout", () => {
        const css = fs.readFileSync(cssPath, "utf8");
        const pdpLayoutBlock = css.match(/\.pdp-layout\s*\{[^}]+\}/)?.[0] || "";

        assert.ok(pdpLayoutBlock.includes("grid-template-columns: minmax(0, 1fr)"), ".pdp-layout must use minmax(0, 1fr) to prevent track blowout");
        assert.ok(pdpLayoutBlock.includes("min-width: 0"), ".pdp-layout must enforce min-width: 0");
        assert.ok(pdpLayoutBlock.includes("max-width: 100%"), ".pdp-layout must enforce max-width: 100%");

        const colsBlock = css.match(/\.pdp-gallery-col,\s*\.pdp-info-col\s*\{[^}]+\}/)?.[0] || "";
        assert.ok(colsBlock.includes("min-width: 0"), ".pdp-gallery-col and .pdp-info-col must enforce min-width: 0");
        assert.ok(colsBlock.includes("width: 100%"), ".pdp-gallery-col and .pdp-info-col must specify width: 100%");
        assert.ok(colsBlock.includes("max-width: 100%"), ".pdp-gallery-col and .pdp-info-col must enforce max-width: 100%");
    });

    it("RESP-003: CSS rules for .pig-container, .pig-thumbs, and .pig-main enforce min-width: 0 and smooth horizontal thumbnail scrolling", () => {
        const css = fs.readFileSync(cssPath, "utf8");

        const pigContainerBlock = css.match(/\.pig-container\s*\{[^}]+\}/)?.[0] || "";
        assert.ok(pigContainerBlock.includes("min-width: 0"), ".pig-container must enforce min-width: 0");
        assert.ok(pigContainerBlock.includes("max-width: 100%"), ".pig-container must enforce max-width: 100%");

        const pigThumbsBlock = css.match(/\.pig-thumbs\s*\{[^}]+\}/)?.[0] || "";
        assert.ok(pigThumbsBlock.includes("overflow-x: auto"), ".pig-thumbs must enforce overflow-x: auto on mobile");
        assert.ok(pigThumbsBlock.includes("-webkit-overflow-scrolling: touch"), ".pig-thumbs must support smooth iOS touch momentum scrolling");
        assert.ok(pigThumbsBlock.includes("min-width: 0"), ".pig-thumbs must enforce min-width: 0 to prevent expanding grid track");
        assert.ok(pigThumbsBlock.includes("max-width: 100%"), ".pig-thumbs must enforce max-width: 100%");

        const pigMainBlock = css.match(/\.pig-main\s*\{[^}]+\}/)?.[0] || "";
        assert.ok(pigMainBlock.includes("aspect-ratio: 4/5"), ".pig-main must maintain 4/5 aspect ratio containment (TASK 028)");
        assert.ok(pigMainBlock.includes("min-width: 0"), ".pig-main must specify min-width: 0");
        assert.ok(pigMainBlock.includes("max-width: 100%"), ".pig-main must specify max-width: 100%");
    });

    it("RESP-004: CSS rules for .pdp-title enforce fluid typography and word breaking for long titles", () => {
        const css = fs.readFileSync(cssPath, "utf8");
        const titleBlock = css.match(/\.pdp-title\s*\{[^}]+\}/)?.[0] || "";

        assert.ok(titleBlock.includes("overflow-wrap: break-word"), ".pdp-title must enforce overflow-wrap: break-word");
        assert.ok(titleBlock.includes("word-break: break-word"), ".pdp-title must enforce word-break: break-word");
        assert.ok(titleBlock.includes("max-width: 100%"), ".pdp-title must constrain max-width to 100%");

        // Check mobile font clamping
        assert.ok(css.includes(".pdp-title {\n    font-size: clamp(1.2rem, 5.5vw, 1.6rem);") ||
                  css.includes("font-size: clamp(1.2rem, 5.5vw, 1.6rem);"),
                  "Mobile pdp-title must use fluid clamp for comfortable reading on small screens");
    });

    it("RESP-005: CSS rules for .pc-actions, .pc-qty-wrapper, .pc-btn-group, and .pc-add-btn enforce full-width buttons and touch target heights", () => {
        const css = fs.readFileSync(cssPath, "utf8");

        const pcActionsBlock = css.match(/\.pc-actions\s*\{[^}]+\}/)?.[0] || "";
        assert.ok(pcActionsBlock.includes("display: flex"), ".pc-actions must be flex container");
        assert.ok(pcActionsBlock.includes("flex-direction: column"), ".pc-actions must default to column layout on mobile");
        assert.ok(pcActionsBlock.includes("max-width: 100%"), ".pc-actions must constrain max-width to 100%");

        const pcQtyBtnBlock = css.match(/\.pc-qty-btn\s*\{[^}]+\}/)?.[0] || "";
        assert.ok(pcQtyBtnBlock.includes("min-height: 44px") || pcQtyBtnBlock.includes("width: 44px"), ".pc-qty-btn must provide at least 44px touch target");

        const pcAddBtnBlock = css.match(/\.pc-add-btn\s*\{[^}]+\}/)?.[0] || "";
        assert.ok(pcAddBtnBlock.includes("min-height: 48px"), ".pc-add-btn must enforce minimum 48px height on mobile");
        assert.ok(pcAddBtnBlock.includes("width: 100%"), ".pc-add-btn must be full width on mobile");

        // Verify desktop side-by-side preservation
        assert.ok(/\.pc-actions\s*\{[^}]*flex-direction:\s*row/s.test(css), "Desktop pc-actions must preserve side-by-side row presentation");
    });

    it("RESP-006: CSS rules for .hp-features, .hp-features-grid, and .hp-feature enforce compact 2×2 mobile cards with 36–40px icon containers", () => {
        const css = fs.readFileSync(cssPath, "utf8");

        // Check mobile features styling
        assert.ok(/\.hp-features\s*\{[^}]*padding:\s*20px 0/s.test(css), "Mobile hp-features must reduce section padding to 20px 0");
        assert.ok(css.includes("grid-template-columns: repeat(2, 1fr);"), "Mobile hp-features-grid must arrange cards in 2-column grid");
        assert.ok(css.includes("gap: 10px;"), "Mobile hp-features-grid must use compact 10px gap");

        const mobileIconMatches = css.match(/\.hp-feature-icon\s*\{[^}]*width:\s*38px;[^}]*height:\s*38px;/s);
        assert.ok(mobileIconMatches, "Mobile hp-feature-icon must use 38px × 38px compact container");

        const mobileSvgMatches = css.match(/\.hp-feature-icon svg\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;/s);
        assert.ok(mobileSvgMatches, "Mobile hp-feature-icon svg must scale to 20px × 20px readable icon");
    });

    it("RESP-007: Homepage features data specifies concise descriptions preserving TASK 027 COD accuracy", () => {
        const homeCode = fs.readFileSync(homePagePath, "utf8");

        assert.ok(homeCode.includes('"Cash on Delivery"'), "Homepage features must include Cash on Delivery");
        assert.ok(homeCode.includes('"On eligible orders"'), "Cash on Delivery description must state 'On eligible orders' per TASK 027");
        assert.ok(homeCode.includes('"Pan-India Delivery"'), "Homepage features must include Pan-India Delivery");
        assert.ok(homeCode.includes('"Tracked shipping"'), "Pan-India Delivery description must state 'Tracked shipping'");
        assert.ok(homeCode.includes('"Secure Checkout"'), "Homepage features must include Secure Checkout");
        assert.ok(homeCode.includes('"UPI, Cards & Netbanking"'), "Secure Checkout description must state 'UPI, Cards & Netbanking'");
        assert.ok(homeCode.includes('"Customer Support"'), "Homepage features must include Customer Support");
        assert.ok(homeCode.includes('"WhatsApp & Email"'), "Customer Support description must state 'WhatsApp & Email'");
    });

    it("RESP-008: CSS rules for .whatsapp-float enforce mobile scaling and safe-area insets", () => {
        const css = fs.readFileSync(cssPath, "utf8");

        const floatBlock = css.match(/\.whatsapp-float\s*\{[^}]+\}/)?.[0] || "";
        assert.ok(floatBlock.includes("position: fixed"), ".whatsapp-float must be position: fixed");
        assert.ok(floatBlock.includes("z-index: 9999"), ".whatsapp-float must specify z-index: 9999");

        assert.ok(css.includes("bottom: max(16px, env(safe-area-inset-bottom, 16px));"), ".whatsapp-float must respect safe-area-inset-bottom on mobile");
        assert.ok(css.includes("right: max(16px, env(safe-area-inset-right, 16px));"), ".whatsapp-float must respect safe-area-inset-right on mobile");
        assert.ok(css.includes("width: 50px;"), ".whatsapp-float must scale to 50px on mobile screens");
        assert.ok(css.includes("height: 50px;"), ".whatsapp-float must scale to 50px height on mobile screens");
    });

    it("RESP-009: ProductCustomizer.tsx provides minimum 44px touch targets for all size and color selectors", () => {
        const customizerCode = fs.readFileSync(customizerPath, "utf8");

        // Verify minHeight 44px on color options
        assert.ok(
            customizerCode.includes('minHeight: "44px"'),
            "Interactive buttons in ProductCustomizer must enforce minHeight: '44px' touch targets"
        );
        // Verify pc-qty-wrapper and pc-btn-group exist
        assert.ok(customizerCode.includes('className="pc-qty-wrapper"'), "ProductCustomizer must render pc-qty-wrapper");
        assert.ok(customizerCode.includes('className="pc-btn-group"'), "ProductCustomizer must render pc-btn-group");
    });

    it("RESP-010: Empirical layout verification confirms zero horizontal overflow across all 8 target viewports", () => {
        assert.ok(fs.existsSync(measurementsPath), "measurements-after.json must exist in docs/screenshots/task031/after/");
        const data = JSON.parse(fs.readFileSync(measurementsPath, "utf8"));
        assert.ok(Array.isArray(data.sweep), "measurements-after.json must contain 8-viewport sweep results");
        assert.equal(data.sweep.length, 8, "Must verify exactly 8 target viewports");

        for (const sweepItem of data.sweep) {
            const vp = sweepItem.viewport;
            const m = sweepItem.measurements;

            // Strict responsive assertion: document scrollWidth <= clientWidth + 1
            assert.ok(
                m.rootScrollWidth <= m.rootClientWidth + 1,
                `Viewport ${vp.name}: rootScrollWidth (${m.rootScrollWidth}) exceeds clientWidth (${m.rootClientWidth})`
            );

            // Strict responsive assertion: body scrollWidth <= clientWidth + 1
            assert.ok(
                m.bodyScrollWidth <= m.bodyClientWidth + 1,
                `Viewport ${vp.name}: bodyScrollWidth (${m.bodyScrollWidth}) exceeds bodyClientWidth (${m.bodyClientWidth})`
            );

            assert.equal(sweepItem.passed, true, `Viewport ${vp.name} must pass zero overflow assertion`);
        }

        // Verify mobile homepage benefits height reduction
        assert.ok(
            data.home_benefits_390px.benefitsHeight <= 320,
            `Homepage benefits height at 390px (${data.home_benefits_390px.benefitsHeight}px) must be <= 320px`
        );
        assert.ok(
            data.home_benefits_320px.benefitsHeight <= 320,
            `Homepage benefits height at 320px (${data.home_benefits_320px.benefitsHeight}px) must be <= 320px`
        );
    });
});
