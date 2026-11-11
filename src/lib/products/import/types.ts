/**
 * Bazaarvilla Shopify-Compatible CSV Bulk Product Import & Catalog Safety (TASK 030)
 * Core Type Definitions & Interfaces
 */

import type { SizeDimension, SizeMode, ProductVariant, SizeOption, ColorOption } from "../variants.ts";

export type CsvFormatType =
    | "shopify_standard"
    | "shopify_legacy"
    | "bazaarvilla_template"
    | "custom";

export type ImportMode = "create_only" | "update_only" | "create_and_update";

export type ImportBatchStatus =
    | "staged"
    | "validating"
    | "previewed"
    | "in_progress"
    | "importing"
    | "completed"
    | "partially_failed"
    | "failed"
    | "cancelled";

export interface RawCsvRow {
    [key: string]: string;
}

export interface ColumnMappingItem {
    sourceColumn: string;
    targetField: string | null;
    confidence: "exact" | "alias" | "manual" | "unsupported";
    sampleValue?: string;
    transformation?: string;
    isIgnored?: boolean;
    unsupportedReason?: string;
}

export interface ColumnMappingResult {
    formatDetected: CsvFormatType;
    mappings: ColumnMappingItem[];
    unsupportedHeaders: Array<{ header: string; reason: string }>;
    recognizedHeaders: string[];
    missingRequiredHeaders: string[];
    hasThirdOption: boolean;
    thirdOptionName?: string;
}

export interface ParsedImageRow {
    url: string;
    position?: number;
    altText?: string;
    csvRowNumber: number;
}

export interface ParsedVariantRow {
    csvRowNumber: number;
    sizeName?: string;
    sizeDimensions?: SizeDimension;
    colorName?: string;
    colorHex?: string;
    sku?: string;
    price?: number | null;
    compareAtPrice?: number | null;
    inventory: number;
    imageUrl?: string;
    option3?: { name: string; value: string };
    isActive: boolean;
}

export interface ImportValidationError {
    rowNumber: number;
    handle?: string;
    field: string;
    providedValue: string;
    message: string;
    suggestedCorrection: string;
    fatal: boolean;
}

export interface ImportValidationWarning {
    rowNumber: number;
    handle?: string;
    field: string;
    providedValue: string;
    message: string;
}

export interface ParsedProductGroup {
    handle: string;
    title: string;
    description: string;
    vendor?: string;
    category?: string;
    tags: string[];
    isVisible: boolean; // Safe publishing default: false (draft)
    isCustomized: boolean;
    customizationType: "requires_name" | "requires_picture" | null;
    basePrice: number;
    compareAtPrice?: number | null;
    images: ParsedImageRow[];
    variants: ParsedVariantRow[];
    isSimpleProduct: boolean; // "Default Title" or 0 variant attributes
    hasExplicitInventory: boolean;
    hasExplicitPrice: boolean;
    hasVariantColumns: boolean;
    sizeMode: SizeMode;
    sizesList: SizeOption[];
    colors: ColorOption[];
    firstRowNumber: number;
    allRowNumbers: number[];
    errors: ImportValidationError[];
    warnings: ImportValidationWarning[];
    unsupportedColumns: Array<{ column: string; value: string; reason: string }>;
}

export interface ProductFieldDiff {
    field: string;
    label: string;
    oldValue: any;
    newValue: any;
    action: "create" | "update" | "preserve" | "conflict";
    warning?: string;
}

export interface ProductImportPreview {
    handle: string;
    title: string;
    status: "new" | "existing_update" | "conflict" | "invalid" | "skipped";
    existingProductId?: string;
    existingProductSnapshot?: any;
    diffs: ProductFieldDiff[];
    priceChange?: { from: number; to: number };
    inventoryChange?: { from: number; to: number; sellableDelta: number };
    personalizationChange?: {
        from: { isCustomized: boolean; customizationType: string | null };
        to: { isCustomized: boolean; customizationType: string | null };
    };
    variantCount: number;
    imagesCount: number;
    expectedR2Uploads: number;
    errors: ImportValidationError[];
    warnings: ImportValidationWarning[];
    parsedGroup: ParsedProductGroup;
}

export interface ImportPreviewSummary {
    totalRows: number;
    totalProducts: number;
    newProducts: number;
    existingProducts: number;
    conflictingProducts: number;
    invalidProducts: number;
    totalVariants: number;
    totalImages: number;
    expectedR2Transfers: number;
    errorCount: number;
    warningCount: number;
    priceChangeCount: number;
    inventoryChangeCount: number;
    personalizationChangeCount: number;
    draftCount: number;
    publishedCount: number;
    productPreviews: ProductImportPreview[];
    unsupportedHeaders: Array<{ header: string; reason: string }>;
    detectedFormat: CsvFormatType;
    canProceedWithImport: boolean;
}

export interface ProductImportResult {
    handle: string;
    productId: string;
    status: "created" | "updated" | "failed" | "skipped";
    title: string;
    variantsCreatedOrUpdated: number;
    imagesIngested: number;
    imagesFailed: number;
    error?: string;
}

export interface ImportConfirmationOptions {
    confirmedNotice: boolean;
    confirmPriceChanges?: boolean;
    confirmInventoryChanges?: boolean;
    confirmExistingProductUpdates?: boolean;
    confirmPersonalizationChanges?: boolean;
    allowPublishNewProducts?: boolean;
}

export interface ProductImportBatchRecord {
    id: string; // Stable UUID
    adminUid: string;
    adminEmail?: string;
    sourceFileName: string;
    sourceFileChecksum: string;
    importMode: ImportMode;
    formatDetected: CsvFormatType;
    totalRows: number;
    totalProducts: number;
    createdCount: number;
    updatedCount: number;
    failedCount: number;
    skippedCount: number;
    processedCount?: number;
    processedHandles?: string[];
    status: ImportBatchStatus;
    createdAt: number;
    expiresAt?: number;
    startedAt?: number;
    completedAt?: number;
    lastProcessedAt?: number;
    confirmations?: ImportConfirmationOptions;
    lockedUntil?: number | null;
    lockedBy?: string | null;
    itemsSubcollection?: boolean;
    groups?: ParsedProductGroup[];
    existingSnapshots?: Array<{
        handle: string;
        existingProductId?: string;
        snapUpdatedAt: number;
        existingPrice?: number;
        existingInventory?: number;
        isCustomized?: boolean;
        customizationType?: string | null;
        hasVariants?: boolean;
    }>;
    previewSummary?: ImportPreviewSummary;
    errorSummary?: string[];
    results?: ProductImportResult[];
}

export interface ProductImportBatchItemDoc {
    id: string; // Document ID: "item_00000"
    itemIndex: number;
    handle: string;
    group: ParsedProductGroup;
    existingSnapshot?: {
        handle: string;
        existingProductId?: string;
        snapUpdatedAt: number;
        existingPrice?: number;
        existingInventory?: number;
        isCustomized?: boolean;
        customizationType?: string | null;
        hasVariants?: boolean;
    } | null;
    status: "pending" | "processing" | "completed" | "failed" | "skipped";
    completedAt?: number | null;
    productId?: string | null;
    result?: ProductImportResult | null;
    error?: string | null;
    stagedImageKeys?: string[];
}

export interface ImportChunkCommitResult {
    success: boolean;
    batchId: string;
    status: ImportBatchStatus;
    processedCount: number;
    totalProducts: number;
    remainingCount: number;
    hasMore: boolean;
    isIdempotentReplay?: boolean;
    batchRecord: ProductImportBatchRecord;
    error?: string;
}
