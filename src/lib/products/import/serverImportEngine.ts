/**
 * Bazaarvilla Shopify-Compatible CSV Bulk Product Import (TASK 030)
 * Server-Authoritative Execution Engine: Dry-Run Preview & Atomic Batch Commit
 */

import crypto from "crypto";
import { adminDb } from "../../firebase/admin.ts";
import {
    buildCombinationId,
    generateVariantSku,
    reconcileProductInventoryOnSave,
    calculateVariantStockBreakdown,
} from "../variants.ts";
import type { ProductVariant } from "../variants.ts";
import { isCustomizableProduct } from "../../orders/customizationEligibility.ts";
import { ingestRemoteProductImage } from "./imageIngestion.ts";
import { buildProductPreview, buildPreviewSummary } from "./validation.ts";
import { sanitizeProductPayload } from "./sanitizer.ts";
import type {
    ParsedProductGroup,
    ImportMode,
    ProductImportPreview,
    ImportPreviewSummary,
    ProductImportBatchRecord,
    ProductImportResult,
} from "./types.ts";

/**
 * Server-side dry-run preview generator.
 * Inspects Cloud Firestore catalog, identifies new vs existing products by normalized handle
 * or Bazaarvilla ID, and generates non-mutating preview summaries.
 * Zero database writes.
 */
export async function generateDryRunPreview(options: {
    groups: ParsedProductGroup[];
    totalRows: number;
    unsupportedHeaders: Array<{ header: string; reason: string }>;
    detectedFormat: any;
    mode: ImportMode;
}): Promise<ImportPreviewSummary> {
    const { groups, totalRows, unsupportedHeaders, detectedFormat, mode } = options;

    if (!adminDb) {
        throw new Error("Cloud Firestore database service unavailable");
    }
    const db = adminDb;

    const previews: ProductImportPreview[] = [];

    // Look up products by handle in Firestore
    for (const group of groups) {
        let existingDocData: any = null;

        // Query by slug/handle
        const snap = await db.collection("products").where("slug", "==", group.handle).limit(1).get();
        if (!snap.empty) {
            existingDocData = { id: snap.docs[0].id, ...snap.docs[0].data() };
        }

        const preview = buildProductPreview({
            group,
            existingProduct: existingDocData,
            mode,
        });

        previews.push(preview);
    }

    return buildPreviewSummary({
        previews,
        totalRows,
        unsupportedHeaders,
        detectedFormat,
    });
}

export interface CommitBatchProgress {
    batchId: string;
    total: number;
    processed: number;
    created: number;
    updated: number;
    failed: number;
    skipped: number;
    currentProduct?: string;
    results: ProductImportResult[];
}

/**
 * Executes a controlled, bounded batch import of confirmed products.
 * Handles image ingestion to R2, transaction-safe product writes with TASK 029
 * inventory reconciliation, and immutable audit record generation in productImportBatches.
 */
export async function executeBatchImport(options: {
    batchId: string;
    adminUid: string;
    adminEmail?: string;
    sourceFileName: string;
    fileChecksum: string;
    importMode: ImportMode;
    formatDetected: any;
    totalRows: number;
    previews: ProductImportPreview[];
}): Promise<ProductImportBatchRecord> {
    const {
        batchId,
        adminUid,
        adminEmail,
        sourceFileName,
        fileChecksum,
        importMode,
        formatDetected,
        totalRows,
        previews,
    } = options;

    if (!adminDb) {
        throw new Error("Cloud Firestore database service unavailable");
    }
    const db = adminDb;

    const batchRef = db.collection("productImportBatches").doc(batchId);

    // Initial audit log record in Firestore
    const initialBatchRecord: ProductImportBatchRecord = {
        id: batchId,
        adminUid,
        adminEmail,
        sourceFileName,
        sourceFileChecksum: fileChecksum,
        importMode,
        formatDetected,
        totalRows,
        totalProducts: previews.length,
        createdCount: 0,
        updatedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        status: "importing",
        createdAt: Date.now(),
        results: [],
        errorSummary: [],
    };

    await batchRef.set(initialBatchRecord);

    const results: ProductImportResult[] = [];
    const errorSummary: string[] = [];
    const knownImageHashes = new Map<string, string>(); // SHA-256 -> Public R2 URL

    let createdCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const preview of previews) {
        const group = preview.parsedGroup;

        // Skip items that are invalid or flagged as skipped
        if (preview.status === "invalid") {
            failedCount++;
            results.push({
                handle: group.handle,
                productId: preview.existingProductId || "unknown",
                status: "failed",
                title: group.title,
                variantsCreatedOrUpdated: 0,
                imagesIngested: 0,
                imagesFailed: 0,
                error: preview.errors.map(e => e.message).join("; "),
            });
            continue;
        }

        if (preview.status === "skipped" || preview.status === "conflict") {
            skippedCount++;
            results.push({
                handle: group.handle,
                productId: preview.existingProductId || "skipped",
                status: "skipped",
                title: group.title,
                variantsCreatedOrUpdated: 0,
                imagesIngested: 0,
                imagesFailed: 0,
                error: preview.warnings.map(w => w.message).join("; "),
            });
            continue;
        }

        try {
            // Determine Product ID (existing or new UUID)
            const productId = preview.existingProductId || crypto.randomUUID();

            // 1. Ingest Remote Images to Cloudflare R2
            const ingestedImages: string[] = [];
            let imagesFailed = 0;

            for (const img of group.images) {
                const ingestResult = await ingestRemoteProductImage({
                    url: img.url,
                    productId,
                    knownHashes: knownImageHashes,
                });

                if (ingestResult.success && ingestResult.publicUrl) {
                    ingestedImages.push(ingestResult.publicUrl);
                } else {
                    imagesFailed++;
                    errorSummary.push(
                        `Product '${group.title}' image failed to ingest: ${ingestResult.error || "Unknown error"}`
                    );
                }
            }

            // 2. Transactional Product Commit with TASK 029 Inventory Reconciliation
            await db.runTransaction(async (transaction) => {
                const productRef = db.collection("products").doc(productId);
                const liveSnap = await transaction.get(productRef);
                const liveProduct = liveSnap.exists ? (liveSnap.data() as any) : null;

                // Stale-preview conflict check for existing products
                if (liveProduct && preview.existingProductSnapshot) {
                    const snapUpdatedAt = preview.existingProductSnapshot.updatedAt || 0;
                    const liveUpdatedAt = liveProduct.updatedAt || 0;
                    if (liveUpdatedAt > snapUpdatedAt) {
                        throw new Error(
                            `Catalog Conflict: Product '${group.title}' was modified by another user since preview was generated. Re-validation required.`
                        );
                    }
                }

                // Prepare Variants List
                const isLiveVariantProduct = Boolean(
                    liveProduct?.hasVariants && Array.isArray(liveProduct?.variants) && liveProduct.variants.length > 0
                );
                const isCsvVariantProduct = !group.isSimpleProduct && group.variants.length > 0 && group.hasVariantColumns;
                const isVariantManaged = isCsvVariantProduct || isLiveVariantProduct;
                let finalVariants: ProductVariant[] = [];

                if (isCsvVariantProduct) {
                    const existingVariants: ProductVariant[] = liveProduct?.variants || [];
                    const existingVarMap = new Map<string, ProductVariant>();
                    for (const ev of existingVariants) {
                        existingVarMap.set(ev.id, ev);
                        existingVarMap.set(buildCombinationId(ev.sizeId, ev.colorId), ev);
                        if (ev.sku) existingVarMap.set(ev.sku.toUpperCase(), ev);
                    }

                    for (const pv of group.variants) {
                        const sizeId = pv.sizeName ? `size_${pv.sizeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : undefined;
                        const colorId = pv.colorName ? `col_${pv.colorName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : undefined;
                        const comboId = buildCombinationId(sizeId, colorId);

                        const existing = existingVarMap.get(comboId) || (pv.sku ? existingVarMap.get(pv.sku.toUpperCase()) : undefined);
                        const variantInventory = group.hasExplicitInventory
                            ? pv.inventory
                            : (existing?.inventory ?? 0);

                        finalVariants.push({
                            id: existing?.id || comboId,
                            sizeId,
                            sizeName: pv.sizeName,
                            colorId,
                            colorName: pv.colorName,
                            sku: pv.sku || existing?.sku || generateVariantSku(group.handle, pv.sizeName, pv.colorName),
                            price: pv.price !== null && pv.price !== undefined ? pv.price : (existing?.price ?? null),
                            inventory: variantInventory,
                            isActive: existing?.isActive !== undefined ? existing.isActive : pv.isActive,
                            image: pv.imageUrl || existing?.image || undefined,
                            dimensions: pv.sizeDimensions || existing?.dimensions,
                            createdAt: existing?.createdAt || Date.now(),
                        });
                    }

                    // Preserve existing variants not in CSV to prevent data loss
                    if (liveProduct && Array.isArray(liveProduct.variants)) {
                        const newIds = new Set(finalVariants.map(v => v.id));
                        for (const oldV of liveProduct.variants) {
                            if (!newIds.has(oldV.id)) {
                                finalVariants.push(oldV);
                            }
                        }
                    }
                } else if (isLiveVariantProduct) {
                    // Existing product has variants, but CSV omitted variant columns (updating title/price only)
                    finalVariants = [...(liveProduct.variants || [])];
                }

                // Reconcile Inventory using TASK 029 authoritative logic
                let formInventoryToReconcile = group.hasExplicitInventory
                    ? (group.variants[0]?.inventory || 0)
                    : (liveProduct?.inventory ?? 0);

                let loadedProductForReconcile = preview.existingProductSnapshot || null;
                if (!group.hasExplicitInventory && liveProduct) {
                    formInventoryToReconcile = liveProduct.inventory;
                }

                const reconciled = reconcileProductInventoryOnSave({
                    formHasVariants: isVariantManaged,
                    formVariants: finalVariants,
                    formInventory: formInventoryToReconcile,
                    loadedProduct: loadedProductForReconcile,
                    liveProduct,
                });

                // Personalization Preservation: if product was customizable, preserve unless explicitly altered
                const oldIsCustom = liveProduct ? isCustomizableProduct(liveProduct) : false;
                const finalIsCustomized = group.isCustomized || (oldIsCustom && !group.isCustomized && !group.customizationType);
                const finalCustomizationType = group.customizationType || (oldIsCustom ? liveProduct?.customizationType : null);

                // Safe Publishing Default: new products default to draft (isVisible: false)
                // Existing products retain visibility unless CSV explicitly specifies a valid state
                const finalVisibility = liveProduct
                    ? (group.isVisible !== undefined ? group.isVisible : liveProduct.isVisible)
                    : Boolean(group.isVisible);

                // Build Final Product Payload
                const payload: Record<string, any> = {
                    id: productId,
                    name: group.title,
                    slug: group.handle,
                    description: group.description || (liveProduct?.description || ""),
                    vendor: group.vendor || (liveProduct?.vendor || "Bazaarvilla"),
                    category: group.category || (liveProduct?.category || "General"),
                    tags: group.tags.length > 0 ? group.tags : (liveProduct?.tags || []),
                    price: group.basePrice > 0 ? group.basePrice : (liveProduct?.price || 0),
                    compareAtPrice: group.compareAtPrice ?? (liveProduct?.compareAtPrice ?? null),
                    inventory: reconciled.inventory,
                    totalPhysicalInventory: reconciled.totalPhysicalInventory,
                    isVisible: finalVisibility,
                    isCustomized: finalIsCustomized,
                    customizationType: finalCustomizationType,
                    hasVariants: isVariantManaged,
                    sizeMode: isVariantManaged ? (group.hasVariantColumns ? group.sizeMode : (liveProduct?.sizeMode || "none")) : "none",
                    sizesList: isVariantManaged ? (group.hasVariantColumns ? group.sizesList : (liveProduct?.sizesList || [])) : [],
                    colors: isVariantManaged ? (group.hasVariantColumns ? group.colors : (liveProduct?.colors || [])) : [],
                    variants: isVariantManaged ? (reconciled.variants || finalVariants) : [],
                    images: ingestedImages.length > 0 ? ingestedImages : (liveProduct?.images || []),
                    thumbnails: ingestedImages.length > 0 ? ingestedImages : (liveProduct?.thumbnails || []),
                    createdAt: liveProduct?.createdAt || Date.now(),
                    updatedAt: Date.now(),
                };

                const cleanPayload = sanitizeProductPayload(payload);
                transaction.set(productRef, cleanPayload, { merge: true });
            });

            if (preview.existingProductId) {
                updatedCount++;
                results.push({
                    handle: group.handle,
                    productId,
                    status: "updated",
                    title: group.title,
                    variantsCreatedOrUpdated: group.variants.length,
                    imagesIngested: ingestedImages.length,
                    imagesFailed,
                });
            } else {
                createdCount++;
                results.push({
                    handle: group.handle,
                    productId,
                    status: "created",
                    title: group.title,
                    variantsCreatedOrUpdated: group.variants.length,
                    imagesIngested: ingestedImages.length,
                    imagesFailed,
                });
            }
        } catch (err: any) {
            failedCount++;
            const msg = `Product '${group.title}' commit failed: ${err.message || "Unknown error"}`;
            errorSummary.push(msg);
            results.push({
                handle: group.handle,
                productId: preview.existingProductId || "failed",
                status: "failed",
                title: group.title,
                variantsCreatedOrUpdated: 0,
                imagesIngested: 0,
                imagesFailed: 0,
                error: err.message || "Commit failed",
            });
        }
    }

    // Determine final status
    const finalStatus =
        failedCount === 0
            ? "completed"
            : createdCount > 0 || updatedCount > 0
            ? "partially_failed"
            : "failed";

    const completedRecord: ProductImportBatchRecord = {
        ...initialBatchRecord,
        createdCount,
        updatedCount,
        failedCount,
        skippedCount,
        status: finalStatus,
        completedAt: Date.now(),
        results,
        errorSummary,
    };

    await batchRef.set(completedRecord, { merge: true });

    return completedRecord;
}
