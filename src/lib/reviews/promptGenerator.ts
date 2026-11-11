import type { ReviewBatchImportPayload, ReviewItemInput } from "./types";

export interface ReviewAiPromptOptions {
    productId: string;
    productName: string;
    productDescription?: string;
    price?: number;
    category?: string;
    tags?: string[];
    sizes?: string[];
    colors?: Array<{ name: string; hex?: string }>;
    count: number;
}

/**
 * Generates an authoritative TASK 022 JSON template populated with the target product ID
 * and exactly the requested count (1–50) of placeholder review items.
 *
 * Each placeholder item is clearly marked so it cannot be mistakenly published as genuine feedback.
 */
export function generateReviewJsonTemplate(
    productId: string,
    productName: string = "Product",
    count: number = 5
): ReviewBatchImportPayload {
    const numericCount = typeof count === "number" && !isNaN(count) ? Math.round(count) : 5;
    const safeCount = Math.max(1, Math.min(50, numericCount));
    const today = new Date().toISOString().split("T")[0];
    const safeName = (productName || "Product").trim();
    const cleanId = (productId || "product-id").trim();

    const reviews: ReviewItemInput[] = [];
    for (let i = 1; i <= safeCount; i++) {
        const paddedIndex = String(i).padStart(2, "0");
        reviews.push({
            externalReviewId: `TEMPLATE-${cleanId.slice(0, 16)}-${paddedIndex}`,
            reviewerDisplayName: `[Customer Name Placeholder ${i}]`,
            rating: 5,
            title: `[Review Headline Placeholder ${i}]`,
            body: `[Template Placeholder ${i}: Replace this with authentic customer feedback for ${safeName} before importing]`,
            reviewedAt: today,
            source: "offline-customer-feedback",
            sourceReference: `ORDER-REF-PLACEHOLDER-${paddedIndex}`,
            customerConsentConfirmed: true,
        });
    }

    return {
        productId: cleanId,
        reviews,
    };
}

/**
 * Generates a comprehensive AI formatting prompt instructing an LLM to transform
 * raw, authentic customer feedback provided by the administrator into valid TASK 022 JSON.
 *
 * Strict integrity guardrails prohibit synthetic hallucinations, simulated identities,
 * or fabricated star ratings.
 */
export function generateReviewAiPrompt(options: ReviewAiPromptOptions): string {
    const numericCount = typeof options.count === "number" && !isNaN(options.count) ? Math.round(options.count) : 5;
    const safeCount = Math.max(1, Math.min(50, numericCount));
    const today = new Date().toISOString().split("T")[0];
    const cleanId = (options.productId || "product-id").trim();
    const cleanName = (options.productName || "Bazaarvilla Product").trim();

    // Compile product attributes
    const attributeList: string[] = [];
    if (typeof options.price === "number") {
        attributeList.push(`Price: ₹${options.price}`);
    }
    if (options.category && options.category.trim()) {
        attributeList.push(`Category: ${options.category.trim()}`);
    }
    if (Array.isArray(options.sizes) && options.sizes.length > 0) {
        attributeList.push(`Sizes: ${options.sizes.join(", ")}`);
    }
    if (Array.isArray(options.colors) && options.colors.length > 0) {
        attributeList.push(`Colors: ${options.colors.map((c) => c.name).filter(Boolean).join(", ")}`);
    }
    if (Array.isArray(options.tags) && options.tags.length > 0) {
        attributeList.push(`Tags: ${options.tags.join(", ")}`);
    }
    const attributesText = attributeList.length > 0 ? attributeList.join(" | ") : "Standard Catalog Item";

    // Clean factual description
    const rawDescription = options.productDescription || "";
    const cleanDescription = rawDescription
        .replace(/<[^>]*>?/gm, " ")
        .replace(/\s+/g, " ")
        .trim() || `Authentic ${cleanName} offered by Bazaarvilla.`;

    return `You are a structured data formatting assistant for the Indian e-commerce storefront Bazaarvilla (https://bazaarvilla.com).

The store administrator will provide you with raw, genuine customer feedback (from WhatsApp messages, offline store receipts, emails, customer support tickets, or handwritten feedback cards).
Your task is to transform that authentic feedback into a valid, strictly formatted JSON payload ready for Bazaarvilla's review ingestion system.

================================================================================
CRITICAL TRUTHFULNESS & INTEGRITY RULES (STRICT COMPLIANCE REQUIRED):
================================================================================
1. DO NOT invent, fabricate, hallucinate, or simulate customer experiences, names, star ratings, or consent.
2. Only process genuine customer feedback provided below by the administrator.
3. If the administrator provides fewer reviews than the requested capacity (${safeCount}), format ONLY the reviews provided. Never generate synthetic filler reviews.
4. The product ID MUST remain EXACTLY "${cleanId}". Do NOT alter, trim, or replace this ID.
5. Every review must have customerConsentConfirmed set to true ONLY IF confirmed by the customer, and sourceReference must refer to the genuine source record (e.g., invoice #, ticket #, or order reference).
6. Return ONLY valid, parseable JSON with NO markdown code fences (no \`\`\`json), NO explanation, and NO leading/trailing conversational text.

================================================================================
TARGET PRODUCT CONTEXT:
================================================================================
- Store: Bazaarvilla (https://bazaarvilla.com)
- Target Product ID: ${cleanId}
- Product Title: ${cleanName}
- Relevant Attributes: ${attributesText}
- Factual Description: ${cleanDescription}
- Maximum Requested Review Capacity: ${safeCount} records

================================================================================
EXACT ACCEPTED JSON SCHEMA:
================================================================================
Root object must contain "productId" and an array of "reviews":
{
  "productId": "${cleanId}",
  "reviews": [
    {
      "externalReviewId": "string (unique identifier, e.g. 'OFFLINE-INV-10291' or 'WA-FEEDBACK-01', max 100 chars)",
      "reviewerDisplayName": "string (authentic reviewer display name, 1-80 chars)",
      "rating": number (integer between 1 and 5),
      "title": "string (optional concise headline summarizing the feedback, max 150 chars)",
      "body": "string (the authentic customer feedback text, 2 to 3000 chars)",
      "reviewedAt": "string (ISO date 'YYYY-MM-DD' when the feedback was received, e.g. '${today}', not in future)",
      "source": "offline-customer-feedback" | "external-marketplace" | "csv-json-import" | "editorial" | "storefront",
      "sourceReference": "string (invoice, ticket, or reference identifier, min 3 chars)",
      "customerConsentConfirmed": boolean (must be true for eligible publication)
    }
  ]
}

================================================================================
VALID FORMATTING EXAMPLE:
================================================================================
{
  "productId": "${cleanId}",
  "reviews": [
    {
      "externalReviewId": "FEEDBACK-REC-8921",
      "reviewerDisplayName": "Sunita Verma",
      "rating": 5,
      "title": "Excellent Quality & Fast Delivery",
      "body": "Received my order in 3 days. The fabric is soft, stitching is neat, and it fits comfortably.",
      "reviewedAt": "${today}",
      "source": "offline-customer-feedback",
      "sourceReference": "INV-2026-8921",
      "customerConsentConfirmed": true
    }
  ]
}

================================================================================
ADMINISTRATOR CUSTOMIZATION INSTRUCTIONS:
================================================================================
You may add instructions below regarding:
- Language: English, Hindi, Hinglish, or regional Indian language (preserve original customer sentiment).
- Formatting & Tone: Keep natural, authentic tone without exaggerated marketing speak.
- Review Length: Concise highlights vs. detailed feedback.
- Star Ratings: Map to genuine customer satisfaction (1=Poor, 2=Fair, 3=Average, 4=Good, 5=Excellent).

================================================================================
PASTE RAW CUSTOMER FEEDBACK BELOW THIS LINE:
================================================================================
1. Customer: ... | Rating: ... | Comment: ... | Source/Invoice: ... | Date: ...
`;
}
