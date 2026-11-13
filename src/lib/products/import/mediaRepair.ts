/**
 * Bazaarvilla Media Repair & Reconciliation Engine (TASK 036)
 *
 * Implements a safe, admin-controlled media recovery workflow for products
 * affected by CSV image ingestion failures or broken storage references:
 * - Scans Firestore catalog and identifies products with missing or broken media
 * - Checks Cloudflare R2 object existence and content integrity (anti-false-positive)
 * - Identifies original source URLs from durable import batches or reference CSV
 * - Re-ingests missing images to R2 with deterministic content-addressable keys
 * - Reconstructs gallery and thumbnails in Firestore
 * - Strictly verifies all assets (non-empty bytes, binary MIME, magic bytes, not SVG)
 * - Strict non-destructive idempotency: ZERO changes to prices, stock, descriptions,
 *   categories, variants, reviews, orders, or customer data
 * - Enforces separate explicit administrator confirmation gate for dry-run vs apply
 */

import crypto from "crypto";
import Papa from "papaparse";
import { adminDb } from "../../firebase/admin.ts";
import { ingestRemoteProductImage } from "./imageIngestion.ts";
import { verifyStoredMedia } from "../../storage/mediaVerification.ts";
import { groupCsvRows } from "./grouping.ts";
import type { RawCsvRow } from "./types.ts";

export interface ProductMediaAuditEntry {
    productId: string;
    slug: string;
    title: string;
    category: string;
    price: number;
    isVisible: boolean;
    currentImages: string[];
    currentImageUrl: string | null;
    needsRepair: boolean;
    reasons: string[];
    sourceImageUrls: string[];
    proposedAction: "reingest_to_r2" | "relink_existing_r2" | "no_source_images_found" | "healthy";
}

export interface MediaRepairReport {
    totalAudited: number;
    healthyCount: number;
    affectedCount: number;
    repairedCount: number;
    failedCount: number;
    dryRun: boolean;
    auditEntries: ProductMediaAuditEntry[];
    repairManifest: Array<{
        productId: string;
        slug: string;
        title: string;
        status: "repaired" | "failed" | "skipped";
        imagesBefore: string[];
        imagesAfter: string[];
        details: string;
    }>;
}

/**
 * Extracts reference images mapped by handle from CSV text or raw rows.
 */
export function extractSourceImagesFromCsv(csvText: string): Map<string, string[]> {
    const handleToImages = new Map<string, string[]>();
    if (!csvText || !csvText.trim()) return handleToImages;

    try {
        const parsed = Papa.parse<RawCsvRow>(csvText, {
            header: true,
            skipEmptyLines: "greedy",
            transformHeader: (h) => h.trim(),
        });

        const rawRows = parsed.data || [];
        const { groups } = groupCsvRows(rawRows);

        for (const g of groups) {
            const urls = g.images.map((img) => img.url).filter(Boolean);
            if (urls.length > 0) {
                handleToImages.set(g.handle, urls);
            }
        }
    } catch (err) {
        console.error("[MediaRepair] Error parsing reference CSV:", err);
    }

    return handleToImages;
}

/**
 * Scans catalog for products with missing or broken image references.
 */
export async function auditCatalogMedia(options?: {
    db?: any;
    referenceCsvText?: string;
    specificProductId?: string;
}): Promise<{
    auditEntries: ProductMediaAuditEntry[];
    affectedProducts: ProductMediaAuditEntry[];
    handleToImages: Map<string, string[]>;
}> {
    const db = options?.db || adminDb;
    if (!db) throw new Error("Firestore database service unavailable");

    const handleToImages = options?.referenceCsvText
        ? extractSourceImagesFromCsv(options.referenceCsvText)
        : new Map<string, string[]>();

    let productsQuery = db.collection("products");
    const snap = options?.specificProductId
        ? await db.collection("products").doc(options.specificProductId).get().then((d: any) => ({ docs: d.exists ? [d] : [], size: d.exists ? 1 : 0 }))
        : await productsQuery.get();

    const auditEntries: ProductMediaAuditEntry[] = [];

    // Also load recent import batches to discover source URLs if reference CSV wasn't provided
    const batchHandleMap = new Map<string, string[]>();
    if (handleToImages.size === 0) {
        try {
            const batchesSnap = await db.collection("productImportBatches").limit(20).get();
            for (const bDoc of batchesSnap.docs) {
                const itemsSnap = await bDoc.ref.collection("items").get();
                for (const itDoc of itemsSnap.docs) {
                    const it = itDoc.data();
                    if (it.handle && it.group?.images && Array.isArray(it.group.images)) {
                        const urls = it.group.images.map((img: any) => img.url).filter(Boolean);
                        if (urls.length > 0 && !batchHandleMap.has(it.handle)) {
                            batchHandleMap.set(it.handle, urls);
                        }
                    }
                }
            }
        } catch (err) {
            console.error("[MediaRepair] Error reading batch metadata:", err);
        }
    }

    for (const doc of snap.docs) {
        const p = doc.data();
        const images: string[] = Array.isArray(p.images) ? p.images : (p.images ? [p.images] : []);
        const imageUrl: string | null = p.imageUrl || (images.length > 0 ? images[0] : null);

        const reasons: string[] = [];
        let needsRepair = false;

        // 1. Check for empty media
        if (images.length === 0 || !imageUrl) {
            needsRepair = true;
            reasons.push("Product has empty or missing images array and imageUrl.");
        } else {
            // 2. Check for broken R2 references or SVG fallback
            for (const imgUrl of images) {
                if (imgUrl.startsWith("/api/media/public/products/")) {
                    const ver = await verifyStoredMedia(imgUrl);
                    if (!ver.isValid) {
                        needsRepair = true;
                        reasons.push(`Stored reference is invalid: ${ver.error || "R2 object missing"}`);
                    }
                } else if (imgUrl.startsWith("http://") || imgUrl.startsWith("https://")) {
                    // Stored URL is external CDN (un-ingested Shopify/supplier URL)
                    needsRepair = true;
                    reasons.push(`External remote URL not ingested into Cloudflare R2: ${imgUrl}`);
                }
            }
        }

        // Find candidate source URLs
        const slug = p.slug || p.handle || "";
        let sourceUrls = handleToImages.get(slug) || batchHandleMap.get(slug) || [];
        if (sourceUrls.length === 0 && p.handle) {
            sourceUrls = handleToImages.get(p.handle) || batchHandleMap.get(p.handle) || [];
        }

        let proposedAction: ProductMediaAuditEntry["proposedAction"] = "healthy";
        if (needsRepair) {
            if (sourceUrls.length > 0) {
                proposedAction = "reingest_to_r2";
            } else {
                proposedAction = "no_source_images_found";
            }
        }

        auditEntries.push({
            productId: doc.id,
            slug,
            title: p.title || p.name || slug,
            category: p.category || "General",
            price: p.price || 0,
            isVisible: p.isVisible !== false,
            currentImages: images,
            currentImageUrl: imageUrl,
            needsRepair,
            reasons,
            sourceImageUrls: sourceUrls,
            proposedAction,
        });
    }

    const affectedProducts = auditEntries.filter((e) => e.needsRepair);
    return { auditEntries, affectedProducts, handleToImages };
}

/**
 * Executes or dry-runs the media repair reconciliation workflow.
 */
export async function executeMediaRepair(options: {
    db?: any;
    dryRun: boolean;
    productIds?: string[];
    referenceCsvText?: string;
    confirmed?: boolean;
}): Promise<MediaRepairReport> {
    const { dryRun = true, productIds, referenceCsvText, confirmed = false } = options;
    const db = options.db || adminDb;
    if (!db) throw new Error("Firestore database service unavailable");

    if (!dryRun && !confirmed) {
        throw new Error(
            "Explicit administrator confirmation required (confirmed: true) to apply production media repairs."
        );
    }

    const { auditEntries, affectedProducts } = await auditCatalogMedia({
        db,
        referenceCsvText,
        specificProductId: productIds && productIds.length === 1 ? productIds[0] : undefined,
    });

    const targetProducts = productIds && productIds.length > 0
        ? affectedProducts.filter((p) => productIds.includes(p.productId))
        : affectedProducts;

    const repairManifest: MediaRepairReport["repairManifest"] = [];
    let repairedCount = 0;
    let failedCount = 0;

    for (const prod of targetProducts) {
        if (prod.proposedAction === "no_source_images_found") {
            repairManifest.push({
                productId: prod.productId,
                slug: prod.slug,
                title: prod.title,
                status: "skipped",
                imagesBefore: prod.currentImages,
                imagesAfter: prod.currentImages,
                details: "No source image URLs could be identified from reference CSV or batch metadata.",
            });
            continue;
        }

        if (dryRun) {
            repairManifest.push({
                productId: prod.productId,
                slug: prod.slug,
                title: prod.title,
                status: "skipped",
                imagesBefore: prod.currentImages,
                imagesAfter: prod.sourceImageUrls.map((_, idx) => `/api/media/public/products/${prod.productId}/[hash_${idx + 1}].ext`),
                details: `[DRY-RUN] Would re-ingest ${prod.sourceImageUrls.length} image(s) from source URLs and link into product gallery.`,
            });
            continue;
        }

        // Live Apply Mode (requires confirmed: true)
        try {
            const ingestedImages: string[] = [];
            const stagedKeys: string[] = [];
            let imagesFailed = 0;

            for (const srcUrl of prod.sourceImageUrls) {
                const ingestResult = await ingestRemoteProductImage({
                    url: srcUrl,
                    productId: prod.productId,
                });

                if (ingestResult.success && ingestResult.publicUrl) {
                    // Authoritatively verify stored media in R2
                    const ver = await verifyStoredMedia(ingestResult.publicUrl);
                    if (ver.isValid) {
                        ingestedImages.push(ingestResult.publicUrl);
                        if (ingestResult.storageKey) stagedKeys.push(ingestResult.storageKey);
                    } else {
                        imagesFailed++;
                    }
                } else {
                    imagesFailed++;
                }
            }

            if (ingestedImages.length === 0) {
                failedCount++;
                repairManifest.push({
                    productId: prod.productId,
                    slug: prod.slug,
                    title: prod.title,
                    status: "failed",
                    imagesBefore: prod.currentImages,
                    imagesAfter: prod.currentImages,
                    details: `Failed to ingest any valid images from ${prod.sourceImageUrls.length} source URLs.`,
                });
                continue;
            }

            // ATOMIC REPAIR: Update ONLY media fields on the Firestore product document
            // Strictly preserves all existing prices, inventory, categories, descriptions, variants, etc.
            const productRef = db.collection("products").doc(prod.productId);
            await productRef.update({
                images: ingestedImages,
                thumbnails: ingestedImages,
                imageUrl: ingestedImages[0],
                hasIncompleteMedia: imagesFailed > 0,
                mediaIngestionStatus: {
                    total: prod.sourceImageUrls.length,
                    ingested: ingestedImages.length,
                    failed: imagesFailed,
                    repairedAt: Date.now(),
                },
                updatedAt: Date.now(),
            });

            repairedCount++;
            repairManifest.push({
                productId: prod.productId,
                slug: prod.slug,
                title: prod.title,
                status: "repaired",
                imagesBefore: prod.currentImages,
                imagesAfter: ingestedImages,
                details: `Successfully ingested and verified ${ingestedImages.length} image(s) in R2 and updated Firestore product references.`,
            });
        } catch (err: any) {
            failedCount++;
            repairManifest.push({
                productId: prod.productId,
                slug: prod.slug,
                title: prod.title,
                status: "failed",
                imagesBefore: prod.currentImages,
                imagesAfter: prod.currentImages,
                details: `Repair execution error: ${err.message || "Unknown error"}`,
            });
        }
    }

    return {
        totalAudited: auditEntries.length,
        healthyCount: auditEntries.length - affectedProducts.length,
        affectedCount: affectedProducts.length,
        repairedCount,
        failedCount,
        dryRun,
        auditEntries,
        repairManifest,
    };
}
