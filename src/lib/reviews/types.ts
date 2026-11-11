export type ReviewPublicationStatus = "published" | "unpublished" | "rejected" | "archived";

export type ReviewSourceType =
    | "storefront"
    | "offline-customer-feedback"
    | "external-marketplace"
    | "csv-json-import"
    | "editorial"
    | "simulated-test";

export interface ReviewItemInput {
    externalReviewId: string;
    reviewerDisplayName: string;
    rating: number;
    title?: string;
    body: string;
    reviewedAt: string;
    source: ReviewSourceType;
    sourceReference?: string;
    customerConsentConfirmed?: boolean;
    images?: string[];
}

export interface ReviewBatchImportPayload {
    productId: string;
    reviews: ReviewItemInput[];
}

export interface ReviewValidationEntry {
    itemIndex: number;
    externalReviewId: string;
    reviewerDisplayName: string;
    rating: number;
    title?: string;
    body: string;
    reviewedAt: string;
    source: ReviewSourceType;
    sourceReference?: string;
    customerConsentConfirmed: boolean;
    images: string[];
    valid: boolean;
    eligibleForPublication: boolean;
    errors: string[];
    warnings: string[];
    isDuplicate?: boolean;
    isSimulation?: boolean;
    isTemplatePlaceholder?: boolean;
}

export interface ReviewBatchValidationResult {
    valid: boolean;
    productId: string;
    productName?: string;
    totalSubmitted: number;
    validCount: number;
    invalidCount: number;
    duplicateCount: number;
    eligibleCount: number;
    entries: ReviewValidationEntry[];
}

export interface StoredReview {
    id: string;
    productId: string;
    userId: string | null;
    userName: string;
    rating: number;
    title?: string | null;
    comment: string;
    images: string[];
    createdAt: number;
    isFake: boolean;
    verifiedPurchase: boolean;
    publicationStatus: ReviewPublicationStatus;
    sourceType: ReviewSourceType;
    sourceReference?: string | null;
    externalReviewId?: string | null;
    customerConsentConfirmed: boolean;
    editorialNote: boolean;
    publishedAt?: number | null;
    importedAt?: number | null;
    importedBy?: string | null;
    importBatchId?: string | null;
    updatedAt?: number | null;
}

export interface RatingDistribution {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
}

export interface ProductReviewStats {
    reviewCount: number;
    averageRating: number;
    ratingDistribution: RatingDistribution;
}

export interface ReviewImportBatchAudit {
    batchId: string;
    productId: string;
    productName: string;
    adminUid: string;
    adminEmail?: string;
    createdAt: number;
    totalSubmitted: number;
    validEntries: number;
    rejectedEntries: number;
    publishedEntries: number;
    duplicateEntries: number;
    status: "preview" | "published" | "partially_published" | "rejected";
    errorSummary: string[];
    idempotencyKey?: string;
}
