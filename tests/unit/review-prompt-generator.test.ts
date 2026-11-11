import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import {
    generateReviewJsonTemplate,
    generateReviewAiPrompt,
} from "../../src/lib/reviews/promptGenerator.ts";
import {
    isTemplatePlaceholderReview,
    validateSingleReviewItem,
    validateReviewImportPayload,
    isPubliclyPublishedReview,
} from "../../src/lib/reviews/validation.ts";

describe("Product-Specific Review JSON & AI Prompt Generator Unit Tests (TASK 032)", () => {
    const sampleProductId = "prod_bazaar_hoodie_99";
    const sampleProductName = "Bazaarvilla Signature Oversized Hoodie";

    // 1. Template Generation & Product ID Insertion
    it("GEN-001: should generate template with accurate product ID and exact requested capacity (default 5)", () => {
        const template = generateReviewJsonTemplate(sampleProductId, sampleProductName, 5);

        assert.equal(template.productId, sampleProductId);
        assert.ok(Array.isArray(template.reviews));
        assert.equal(template.reviews.length, 5);

        for (let i = 0; i < template.reviews.length; i++) {
            const rev = template.reviews[i];
            const padded = String(i + 1).padStart(2, "0");
            assert.ok(rev.externalReviewId.includes(sampleProductId.slice(0, 16)));
            assert.ok(rev.externalReviewId.endsWith(padded));
            assert.equal(rev.rating, 5);
            assert.equal(rev.source, "offline-customer-feedback");
            assert.ok(rev.body.includes(sampleProductName));
            assert.ok(rev.reviewerDisplayName.includes(`Placeholder ${i + 1}`));
        }
    });

    // 2. Review Count Bounds Clamping
    it("GEN-002: should clamp review count between 1 and 50 entries", () => {
        const templateZero = generateReviewJsonTemplate(sampleProductId, sampleProductName, 0);
        assert.equal(templateZero.reviews.length, 1, "Count < 1 must clamp to 1");

        const templateNegative = generateReviewJsonTemplate(sampleProductId, sampleProductName, -10);
        assert.equal(templateNegative.reviews.length, 1, "Negative count must clamp to 1");

        const templateFifty = generateReviewJsonTemplate(sampleProductId, sampleProductName, 50);
        assert.equal(templateFifty.reviews.length, 50, "Count 50 must generate exactly 50");

        const templateOversized = generateReviewJsonTemplate(sampleProductId, sampleProductName, 120);
        assert.equal(templateOversized.reviews.length, 50, "Count > 50 must clamp to 50");

        const templateFloat = generateReviewJsonTemplate(sampleProductId, sampleProductName, 7.8);
        assert.equal(templateFloat.reviews.length, 8, "Float count must be rounded safely");
    });

    // 3. Schema Conformance & Valid JSON Parsing
    it("GEN-003: should generate valid parseable JSON conforming strictly to TASK 022 schema", () => {
        const template = generateReviewJsonTemplate(sampleProductId, sampleProductName, 3);
        const jsonString = JSON.stringify(template, null, 2);

        // Verify parseable JSON
        assert.doesNotThrow(() => {
            const parsed = JSON.parse(jsonString);
            assert.equal(parsed.productId, sampleProductId);
            assert.equal(parsed.reviews.length, 3);
        });

        // Required schema fields presence on every item
        for (const item of template.reviews) {
            assert.equal(typeof item.externalReviewId, "string");
            assert.equal(typeof item.reviewerDisplayName, "string");
            assert.equal(typeof item.rating, "number");
            assert.equal(typeof item.body, "string");
            assert.equal(typeof item.reviewedAt, "string");
            assert.equal(typeof item.source, "string");
            assert.equal(typeof item.sourceReference, "string");
            assert.equal(typeof item.customerConsentConfirmed, "boolean");
        }
    });

    // 4. Unique External IDs
    it("GEN-004: should generate unique external review IDs for every placeholder entry", () => {
        const count = 25;
        const template = generateReviewJsonTemplate(sampleProductId, sampleProductName, count);
        const externalIds = template.reviews.map((r) => r.externalReviewId);
        const uniqueSet = new Set(externalIds);

        assert.equal(uniqueSet.size, count, "All placeholder externalReviewIds must be distinct");
    });

    // 5. Placeholder Identification & Rejection
    it("GEN-005: should clearly mark generated review objects as non-publishable placeholders", () => {
        const template = generateReviewJsonTemplate(sampleProductId, sampleProductName, 3);

        for (const rev of template.reviews) {
            assert.ok(
                isTemplatePlaceholderReview(rev),
                "Every generated placeholder must be flagged by isTemplatePlaceholderReview"
            );
        }
    });

    // 6. AI Formatting Prompt — Core Metadata
    it("GEN-006: should generate AI prompt containing Bazaarvilla store name, URL, exact product ID, and title", () => {
        const prompt = generateReviewAiPrompt({
            productId: sampleProductId,
            productName: sampleProductName,
            count: 7,
        });

        assert.ok(prompt.includes("Bazaarvilla"), "Prompt must contain store name Bazaarvilla");
        assert.ok(prompt.includes("https://bazaarvilla.com"), "Prompt must contain canonical URL");
        assert.ok(prompt.includes(sampleProductId), "Prompt must include authoritative product ID");
        assert.ok(prompt.includes(sampleProductName), "Prompt must include product title");
        assert.ok(prompt.includes("7"), "Prompt must include requested review count");
    });

    // 7. Factual Description Cleaning & HTML Stripping
    it("GEN-007: should format concise factual product description and strip HTML tags", () => {
        const dirtyDescription = "<p>Super soft <strong>100% Cotton</strong> fleece. <script>alert('xss')</script> Perfect for winter.</p>";
        const prompt = generateReviewAiPrompt({
            productId: sampleProductId,
            productName: sampleProductName,
            productDescription: dirtyDescription,
            count: 5,
        });

        assert.ok(!prompt.includes("<p>"), "Prompt must not contain HTML <p> tags");
        assert.ok(!prompt.includes("<strong>"), "Prompt must not contain <strong> tags");
        assert.ok(!prompt.includes("<script>"), "Prompt must not contain <script> tags");
        assert.ok(prompt.includes("Super soft 100% Cotton fleece. alert('xss') Perfect for winter."));
    });

    // 8. Product Attributes Formatting
    it("GEN-008: should extract and format relevant product attributes (price, category, sizes, colors, tags)", () => {
        const prompt = generateReviewAiPrompt({
            productId: sampleProductId,
            productName: sampleProductName,
            price: 1999,
            category: "Apparel",
            sizes: ["S", "M", "L", "XL"],
            colors: [{ name: "Forest Green", hex: "#1B4D3E" }, { name: "Onyx Black", hex: "#000000" }],
            tags: ["Winter", "Cozy", "Unisex"],
            count: 5,
        });

        assert.ok(prompt.includes("Price: ₹1999"), "Must include formatted price");
        assert.ok(prompt.includes("Category: Apparel"), "Must include category");
        assert.ok(prompt.includes("Sizes: S, M, L, XL"), "Must format available sizes");
        assert.ok(prompt.includes("Colors: Forest Green, Onyx Black"), "Must format available colors");
        assert.ok(prompt.includes("Tags: Winter, Cozy, Unisex"), "Must format product tags");
    });

    // 9. Strict Truthfulness Guardrails
    it("GEN-009: should include strict truthfulness & integrity rules forbidding fabricated feedback or simulated consent", () => {
        const prompt = generateReviewAiPrompt({
            productId: sampleProductId,
            productName: sampleProductName,
            count: 5,
        });

        assert.ok(prompt.includes("DO NOT invent, fabricate, hallucinate, or simulate customer experiences"));
        assert.ok(prompt.includes("Only process genuine customer feedback provided below"));
        assert.ok(prompt.includes(`The product ID MUST remain EXACTLY "${sampleProductId}"`));
        assert.ok(prompt.includes("customerConsentConfirmed set to true ONLY IF confirmed"));
        assert.ok(prompt.includes("Return ONLY valid, parseable JSON with NO markdown code fences"));
    });

    // 10. Output Sizing Rule When Supply < Capacity
    it("GEN-010: should instruct LLM to format only provided reviews if fewer than requested capacity", () => {
        const prompt = generateReviewAiPrompt({
            productId: sampleProductId,
            productName: sampleProductName,
            count: 15,
        });

        assert.ok(prompt.includes("If the administrator provides fewer reviews than the requested capacity (15)"));
        assert.ok(prompt.includes("format ONLY the reviews provided. Never generate synthetic filler reviews."));
    });

    // 11. Customization Options for Admin
    it("GEN-011: should provide customization instructions for language, tone, length, and star ratings", () => {
        const prompt = generateReviewAiPrompt({
            productId: sampleProductId,
            productName: sampleProductName,
            count: 5,
        });

        assert.ok(prompt.includes("Language: English, Hindi, Hinglish"));
        assert.ok(prompt.includes("Formatting & Tone"));
        assert.ok(prompt.includes("Review Length"));
        assert.ok(prompt.includes("Star Ratings"));
        assert.ok(prompt.includes("PASTE RAW CUSTOMER FEEDBACK BELOW THIS LINE"));
    });

    // 12. Placeholder Detection Logic
    it("GEN-012: should detect template placeholder entries via isTemplatePlaceholderReview", () => {
        // Various placeholder styles
        const p1 = { externalReviewId: "TEMPLATE-prod-01", body: "Real text", reviewerDisplayName: "User" };
        const p2 = { externalReviewId: "ext-1", body: "[Template Placeholder: Replace with feedback]", reviewerDisplayName: "User" };
        const p3 = { externalReviewId: "ext-2", body: "Real feedback", reviewerDisplayName: "[Customer Name Placeholder]" };
        const p4 = { externalReviewId: "ext-3", body: "Real feedback", sourceReference: "ORDER-REF-PLACEHOLDER-01" };
        const genuine = {
            externalReviewId: "WA-REC-4412",
            reviewerDisplayName: "Rohan Varma",
            body: "Great fabric and quick delivery. Loved the product!",
            sourceReference: "INV-9921",
        };

        assert.equal(isTemplatePlaceholderReview(p1), true);
        assert.equal(isTemplatePlaceholderReview(p2), true);
        assert.equal(isTemplatePlaceholderReview(p3), true);
        assert.equal(isTemplatePlaceholderReview(p4), true);
        assert.equal(isTemplatePlaceholderReview(genuine), false);
    });

    // 13. Rejection of Template Placeholders from Publication Eligibility
    it("GEN-013: should mark template placeholders as invalid and ineligible for publication in validateSingleReviewItem", () => {
        const placeholderTemplate = generateReviewJsonTemplate(sampleProductId, sampleProductName, 1);
        const item = placeholderTemplate.reviews[0];

        const seen = new Set<string>();
        const existing = new Set<string>();
        const result = validateSingleReviewItem(item, 0, seen, existing);

        assert.equal(result.valid, false, "Placeholder item must NOT be valid");
        assert.equal(result.eligibleForPublication, false, "Placeholder item must NOT be eligible for publication");
        assert.equal(result.isTemplatePlaceholder, true, "isTemplatePlaceholder flag must be true");
        assert.ok(result.errors.some((e) => e.includes("template placeholder data")));
    });

    // 14. Batch Product Mismatch Rejection
    it("GEN-014: should reject batch validation when payload productId mismatches expected product ID", () => {
        const payload = {
            productId: "wrong-product-id",
            reviews: [
                {
                    externalReviewId: "genuine-01",
                    reviewerDisplayName: "Kavita",
                    rating: 5,
                    body: "Authentic customer comment.",
                    reviewedAt: "2026-11-10",
                    source: "offline-customer-feedback",
                    sourceReference: "REC-11",
                    customerConsentConfirmed: true,
                },
            ],
        };

        const result = validateReviewImportPayload(payload, {
            productExists: true,
            expectedProductId: "expected-product-id",
        });

        assert.equal(result.valid, false);
        assert.ok(result.entries[0].errors.some((e) => e.includes("does not match target product")));
    });

    // 15. Item-Level Product Mismatch Rejection
    it("GEN-015: should reject single review item when item-level productId mismatches expected product ID", () => {
        const itemWithMismatch = {
            productId: "conflicting-product-id",
            externalReviewId: "genuine-02",
            reviewerDisplayName: "Priya",
            rating: 5,
            body: "Great item.",
            reviewedAt: "2026-11-10",
            source: "offline-customer-feedback",
            sourceReference: "REC-12",
            customerConsentConfirmed: true,
        };

        const seen = new Set<string>();
        const existing = new Set<string>();
        const result = validateSingleReviewItem(itemWithMismatch, 0, seen, existing, "expected-product-id");

        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.includes("does not match expected product ID")));
    });

    // 16. Safeguard Against Simulated / Placeholder Public Display
    it("GEN-016: isPubliclyPublishedReview strictly rejects template placeholders from public display and stats", () => {
        const placeholderReview = {
            id: "rev_placeholder",
            productId: sampleProductId,
            rating: 5,
            comment: "[Template Placeholder: Replace with feedback]",
            publicationStatus: "published",
            isTemplatePlaceholder: true,
        };

        assert.equal(
            isPubliclyPublishedReview(placeholderReview),
            false,
            "Template placeholder must never pass isPubliclyPublishedReview"
        );
    });

    // 17. Admin UI Markup Verification
    it("GEN-017: Admin review management page source verifies presence of product search, count configurator, and copy buttons", () => {
        const pagePath = path.join(process.cwd(), "src", "app", "(admin)", "admin", "reviews", "page.tsx");
        const pageSource = fs.readFileSync(pagePath, "utf-8");

        assert.ok(pageSource.includes("product-search"), "Page must include product-search input");
        assert.ok(pageSource.includes("review-count-input"), "Page must include review-count-input numeric stepper");
        assert.ok(pageSource.includes("Copy JSON Template"), "Page must include 'Copy JSON Template' action");
        assert.ok(pageSource.includes("Copy AI Prompt"), "Page must include 'Copy AI Prompt' action");
        assert.ok(pageSource.includes("handleSelectProduct"), "Page must sync product selection with URL query param");
        assert.ok(pageSource.includes("showPromptModal"), "Page must support AI prompt preview modal");
    });
});
