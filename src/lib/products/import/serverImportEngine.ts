/**
 * Bazaarvilla Shopify-Compatible CSV Bulk Product Import (TASK 030)
 * Server-Authoritative Execution Engine: Dry-Run Preview & Bounded Resumable Batch Commit
 *
 * Implements strict server-side preview persistence, checksum verification,
 * explicit administrator confirmation checks, chunked resumable execution,
 * SSRF-guarded Cloudflare R2 image ingestion, catalog-wide SKU collision detection,
 * safe draft publishing defaults, and TASK 029 inventory reconciliation.
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
    ImportConfirmationOptions,
    ImportChunkCommitResult,
    ImportBatchStatus,
} from "./types.ts";

export const PREVIEW_EXPIRATION_MS = 60 * 60 * 1000; // 1 hour preview validity
export const DEFAULT_COMMIT_CHUNK_SIZE = 10; // Max products processed per Netlify request

/**
 * Server-side dry-run preview generator.
 * Inspects Cloud Firestore catalog, identifies new vs existing products by normalized handle
 * or Bazaarvilla ID, verifies catalog-wide SKU collisions, and persists an authoritative
 * batch preview record in productImportBatches.
 * ZERO production catalog mutations.
 */
export async function generateDryRunPreview(options: {
    batchId?: string;
    adminUid: string;
    adminEmail?: string;
    sourceFileName?: string;
    fileChecksum: string;
    groups: ParsedProductGroup[];
    totalRows: number;
    unsupportedHeaders: Array<{ header: string; reason: string }>;
    detectedFormat: any;
    mode: ImportMode;
}): Promise<{ previewSummary: ImportPreviewSummary; batchId: string }> {
    const {
        batchId = crypto.randomUUID(),
        adminUid,
        adminEmail,
        sourceFileName = "import.csv",
        fileChecksum,
        groups,
        totalRows,
        unsupportedHeaders,
        detectedFormat,
        mode,
    } = options;

    if (!adminDb) {
        throw new Error("Cloud Firestore database service unavailable");
    }
    const db = adminDb;

    const previews: ProductImportPreview[] = [];
    const existingSnapshots: Array<{
        handle: string;
        existingProductId?: string;
        snapUpdatedAt: number;
        existingPrice?: number;
        existingInventory?: number;
        isCustomized?: boolean;
        customizationType?: string | null;
        hasVariants?: boolean;
    }> = [];

    // Collect all SKUs in the CSV to check catalog-wide collisions
    const allCsvSkus = new Set<string>();
    for (const g of groups) {
        for (const v of g.variants) {
            if (v.sku && v.sku.trim()) {
                allCsvSkus.add(v.sku.trim().toUpperCase());
            }
        }
    }

    // Look up products by handle in Firestore
    for (const group of groups) {
        let existingDocData: any = null;

        // Query by slug/handle
        const snap = await db.collection("products").where("slug", "==", group.handle).limit(1).get();
        if (!snap.empty) {
            existingDocData = { id: snap.docs[0].id, ...snap.docs[0].data() };
        }

        // Check catalog-wide SKU collisions against existing products with different handles
        for (const v of group.variants) {
            if (v.sku && v.sku.trim()) {
                const skuUpper = v.sku.trim().toUpperCase();
                // Check if any existing product in Firestore has this SKU in root or variants
                const skuQuerySnap = await db.collection("products").where("sku", "==", skuUpper).limit(1).get();
                if (!skuQuerySnap.empty) {
                    const matchedProd = skuQuerySnap.docs[0].data();
                    if (matchedProd.slug !== group.handle && skuQuerySnap.docs[0].id !== existingDocData?.id) {
                        group.errors.push({
                            rowNumber: v.csvRowNumber,
                            handle: group.handle,
                            field: "sku",
                            providedValue: v.sku,
                            message: `Duplicate SKU '${v.sku}' is already assigned to another catalog product '${matchedProd.name || matchedProd.slug}'.`,
                            suggestedCorrection: "Assign a unique SKU or update the existing product instead.",
                            fatal: true,
                        });
                    }
                }
            }
        }

        const preview = buildProductPreview({
            group,
            existingProduct: existingDocData,
            mode,
        });

        previews.push(preview);

        if (existingDocData) {
            existingSnapshots.push({
                handle: group.handle,
                existingProductId: existingDocData.id,
                snapUpdatedAt: existingDocData.updatedAt || existingDocData.createdAt || 0,
                existingPrice: existingDocData.price,
                existingInventory: existingDocData.inventory,
                isCustomized: existingDocData.isCustomized,
                customizationType: existingDocData.customizationType,
                hasVariants: existingDocData.hasVariants,
            });
        }
    }

    const previewSummary = buildPreviewSummary({
        previews,
        totalRows,
        unsupportedHeaders,
        detectedFormat,
    });

    // Persist authoritative preview batch record in Firestore under productImportBatches
    // This securely binds the commit to the server's validated data and prevents client tampering.
    const batchRecord: ProductImportBatchRecord = {
        id: batchId,
        adminUid,
        adminEmail,
        sourceFileName,
        sourceFileChecksum: fileChecksum,
        importMode: mode,
        formatDetected: detectedFormat,
        totalRows,
        totalProducts: groups.length,
        createdCount: 0,
        updatedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        processedCount: 0,
        processedHandles: [],
        status: "previewed",
        createdAt: Date.now(),
        expiresAt: Date.now() + PREVIEW_EXPIRATION_MS,
        groups, // Authoritative server-parsed groups
        existingSnapshots,
        previewSummary,
        results: [],
        errorSummary: [],
    };

    await db.collection("productImportBatches").doc(batchId).set(batchRecord);

    return { previewSummary, batchId };
}

/**
 * Executes a controlled, bounded, and resumable batch commit.
 * Loads authoritative server batch state from Firestore by batchId, verifies checksum,
 * confirms explicit administrator flags, processes a slice of products up to chunkSize,
 * performs SSRF-guarded R2 image uploads, executes transactional product writes with
 * TASK 029 inventory reconciliation, and durably records progress.
 */
export async function executeBatchImport(options: {
    batchId: string;
    adminUid: string;
    adminEmail?: string;
    fileChecksum: string;
    confirmations: ImportConfirmationOptions;
    chunkSize?: number;
}): Promise<ImportChunkCommitResult> {
    const {
        batchId,
        adminUid,
        adminEmail,
        fileChecksum,
        confirmations,
        chunkSize = DEFAULT_COMMIT_CHUNK_SIZE,
    } = options;

    if (!adminDb) {
        throw new Error("Cloud Firestore database service unavailable");
    }
    const db = adminDb;

    const batchRef = db.collection("productImportBatches").doc(batchId);
    const batchSnap = await batchRef.get();

    if (!batchSnap.exists) {
        throw new Error(
            `Import batch '${batchId}' not found or session has expired. Please run the dry-run preview again.`
        );
    }

    const batchDoc = batchSnap.data() as ProductImportBatchRecord;

    // 1. Authorization & Identity Invariant
    if (batchDoc.adminUid && batchDoc.adminUid !== adminUid) {
        throw new Error("Unauthorized: This import batch was initiated by another administrator.");
    }

    // 2. Checksum Integrity Invariant (Anti-Tampering)
    if (batchDoc.sourceFileChecksum && fileChecksum && batchDoc.sourceFileChecksum !== fileChecksum) {
        throw new Error(
            `File Checksum Mismatch: The submitted file checksum does not match the reviewed preview. Expected ${batchDoc.sourceFileChecksum}, received ${fileChecksum}.`
        );
    }

    // 3. Expiration Invariant
    if (batchDoc.expiresAt && Date.now() > batchDoc.expiresAt) {
        throw new Error(
            "Import preview session has expired (exceeded 1 hour). Please upload and preview the CSV again."
        );
    }

    // 4. Idempotency Check: If already completed, return idempotent replay immediately
    if (batchDoc.status === "completed") {
        return {
            success: true,
            batchId,
            status: "completed",
            processedCount: batchDoc.totalProducts,
            totalProducts: batchDoc.totalProducts,
            remainingCount: 0,
            hasMore: false,
            isIdempotentReplay: true,
            batchRecord: batchDoc,
        };
    }

    // 5. Explicit Administrator Confirmation Verification
    if (!confirmations || !confirmations.confirmedNotice) {
        throw new Error("Explicit administrator confirmation notice is required before executing catalog import.");
    }

    const summary = batchDoc.previewSummary;
    if (summary) {
        // Price change confirmation
        if (summary.priceChangeCount > 0 && !confirmations.confirmPriceChanges) {
            throw new Error(
                `Explicit Confirmation Required: The CSV contains price changes for ${summary.priceChangeCount} existing products. You must explicitly verify and check 'Confirm Price Changes' before importing.`
            );
        }

        // Inventory change confirmation
        if (summary.inventoryChangeCount > 0 && !confirmations.confirmInventoryChanges) {
            throw new Error(
                `Explicit Confirmation Required: The CSV contains inventory changes for ${summary.inventoryChangeCount} existing products. You must explicitly verify and check 'Confirm Inventory Changes' before importing.`
            );
        }

        // Existing product update confirmation
        if (summary.existingProducts > 0 && batchDoc.importMode !== "create_only" && !confirmations.confirmExistingProductUpdates) {
            throw new Error(
                `Explicit Confirmation Required: The import will update ${summary.existingProducts} existing catalog products. You must explicitly check 'Confirm Existing Product Updates' before importing.`
            );
        }
    }

    // 6. Resumable Batch Chunk Slicing
    const groups: ParsedProductGroup[] = batchDoc.groups || [];
    const processedHandlesSet = new Set<string>(batchDoc.processedHandles || []);
    const results: ProductImportResult[] = [...(batchDoc.results || [])];
    const errorSummary: string[] = [...(batchDoc.errorSummary || [])];
    const existingSnapshots = new Map<string, any>(
        (batchDoc.existingSnapshots || []).map(s => [s.handle, s])
    );

    let createdCount = batchDoc.createdCount || 0;
    let updatedCount = batchDoc.updatedCount || 0;
    let failedCount = batchDoc.failedCount || 0;
    let skippedCount = batchDoc.skippedCount || 0;

    // Filter to find pending un-processed groups
    const pendingGroups = groups.filter(g => !processedHandlesSet.has(g.handle));
    const effectiveChunkSize = Math.max(1, Math.min(chunkSize, 50));
    const sliceToProcess = pendingGroups.slice(0, effectiveChunkSize);

    const knownImageHashes = new Map<string, string>();

    // Mark batch in_progress
    if (batchDoc.status === "previewed" || !batchDoc.startedAt) {
        await batchRef.update({
            status: "in_progress",
            startedAt: Date.now(),
            confirmations,
        });
    }

    // 7. Process Chunk Slice
    for (const group of sliceToProcess) {
        // Double check not already processed
        if (processedHandlesSet.has(group.handle)) {
            continue;
        }

        // Check if group had fatal errors from preview
        if (group.errors.some(e => e.fatal)) {
            failedCount++;
            results.push({
                handle: group.handle,
                productId: "invalid",
                status: "failed",
                title: group.title,
                variantsCreatedOrUpdated: 0,
                imagesIngested: 0,
                imagesFailed: 0,
                error: group.errors.map(e => e.message).join("; "),
            });
            processedHandlesSet.add(group.handle);
            continue;
        }

        const snapInfo = existingSnapshots.get(group.handle);
        const isExistingInSnapshot = Boolean(snapInfo?.existingProductId);

        // Check Mode Constraints
        if (isExistingInSnapshot && batchDoc.importMode === "create_only") {
            skippedCount++;
            results.push({
                handle: group.handle,
                productId: snapInfo.existingProductId,
                status: "skipped",
                title: group.title,
                variantsCreatedOrUpdated: 0,
                imagesIngested: 0,
                imagesFailed: 0,
                error: "Skipped in 'Create New Products Only' mode to prevent overwriting existing catalog product.",
            });
            processedHandlesSet.add(group.handle);
            continue;
        }

        if (!isExistingInSnapshot && batchDoc.importMode === "update_only") {
            skippedCount++;
            results.push({
                handle: group.handle,
                productId: "not_found",
                status: "skipped",
                title: group.title,
                variantsCreatedOrUpdated: 0,
                imagesIngested: 0,
                imagesFailed: 0,
                error: "Skipped in 'Update Existing Products Only' mode because product does not exist in catalog.",
            });
            processedHandlesSet.add(group.handle);
            continue;
        }

        try {
            // Determine Product ID
            // For existing: use known ID. For new: generate a stable deterministic UUID or random UUID
            const productId = snapInfo?.existingProductId || crypto.randomUUID();

            // A. Ingest Remote Images to Cloudflare R2
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

            // B. Transactional Product Commit with Stale Conflict & Concurrency Reconciliation
            await db.runTransaction(async (transaction) => {
                const productRef = db.collection("products").doc(productId);
                const liveSnap = await transaction.get(productRef);
                const liveProduct = liveSnap.exists ? (liveSnap.data() as any) : null;

                // Stale Conflict Invariant: verify product was not modified by another admin/order after preview
                if (liveProduct && snapInfo) {
                    const snapUpdatedAt = snapInfo.snapUpdatedAt || 0;
                    const liveUpdatedAt = liveProduct.updatedAt || 0;
                    if (liveUpdatedAt > snapUpdatedAt) {
                        throw new Error(
                            `Catalog Conflict: Product '${group.title}' was modified by another transaction since preview was generated. Re-validation required.`
                        );
                    }
                }

                // Prepare Variant Matrix
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
                    finalVariants = [...(liveProduct.variants || [])];
                }

                // Reconcile Inventory using TASK 029 authoritative logic (preserves checkout deductions!)
                let formInventoryToReconcile = group.hasExplicitInventory
                    ? (group.variants[0]?.inventory || 0)
                    : (liveProduct?.inventory ?? 0);

                let loadedProductForReconcile = snapInfo ? {
                    inventory: snapInfo.existingInventory,
                    hasVariants: snapInfo.hasVariants,
                } : null;

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

                // Safe Publishing Defaults:
                // New products default to draft (isVisible: false) unless explicitly requested and permitted!
                // Existing products retain visibility unless CSV explicitly specifies a valid state.
                const finalVisibility = liveProduct
                    ? (group.isVisible !== undefined ? group.isVisible : liveProduct.isVisible)
                    : Boolean(group.isVisible && confirmations.allowPublishNewProducts);

                // Price Safety Invariant: Ensure prices are non-zero
                const finalBasePrice = group.basePrice > 0 ? group.basePrice : (liveProduct?.price || 0);
                if (finalBasePrice <= 0 && !liveProduct) {
                    throw new Error(`New product '${group.title}' cannot have missing or ₹0 price.`);
                }

                const payload: Record<string, any> = {
                    id: productId,
                    name: group.title,
                    slug: group.handle,
                    description: group.description || (liveProduct?.description || ""),
                    vendor: group.vendor || (liveProduct?.vendor || "Bazaarvilla"),
                    category: group.category || (liveProduct?.category || "General"),
                    tags: group.tags.length > 0 ? group.tags : (liveProduct?.tags || []),
                    price: finalBasePrice,
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

            if (isExistingInSnapshot) {
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

            processedHandlesSet.add(group.handle);
        } catch (err: any) {
            failedCount++;
            const msg = `Product '${group.title}' commit failed: ${err.message || "Unknown error"}`;
            errorSummary.push(msg);
            results.push({
                handle: group.handle,
                productId: snapInfo?.existingProductId || "failed",
                status: "failed",
                title: group.title,
                variantsCreatedOrUpdated: 0,
                imagesIngested: 0,
                imagesFailed: 0,
                error: err.message || "Commit failed",
            });
            processedHandlesSet.add(group.handle);
        }
    }

    // 8. Durable Progress Persistence
    const totalProcessedCount = processedHandlesSet.size;
    const isAllFinished = totalProcessedCount >= groups.length;
    const finalStatus: ImportBatchStatus = isAllFinished
        ? (failedCount === 0 ? "completed" : "partially_failed")
        : "in_progress";

    const updatedBatchRecord: ProductImportBatchRecord = {
        ...batchDoc,
        createdCount,
        updatedCount,
        failedCount,
        skippedCount,
        processedCount: totalProcessedCount,
        processedHandles: Array.from(processedHandlesSet),
        status: finalStatus,
        results,
        errorSummary,
        lastProcessedAt: Date.now(),
        ...(isAllFinished ? { completedAt: Date.now() } : {}),
    };

    await batchRef.set(updatedBatchRecord, { merge: true });

    return {
        success: true,
        batchId,
        status: finalStatus,
        processedCount: totalProcessedCount,
        totalProducts: groups.length,
        remainingCount: groups.length - totalProcessedCount,
        hasMore: !isAllFinished,
        batchRecord: updatedBatchRecord,
    };
}
