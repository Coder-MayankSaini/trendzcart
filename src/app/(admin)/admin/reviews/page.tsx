"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { collection, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";
import AdminPageHeader from "@/components/admin/ui/AdminPageHeader";
import AdminBadge from "@/components/admin/ui/AdminBadge";
import type {
    ReviewValidationEntry,
    ReviewBatchValidationResult,
    StoredReview,
    ProductReviewStats,
} from "@/lib/reviews/types";

interface ProductOption {
    id: string;
    name: string;
    price: number;
    images?: string[];
    reviewCount?: number;
    averageRating?: number;
    inventory?: number;
}

export default function AdminReviewsPageWrapper() {
    return (
        <Suspense fallback={<div style={{ padding: "48px", textAlign: "center", color: "var(--text-secondary)" }}>Loading review management...</div>}>
            <AdminReviewsPage />
        </Suspense>
    );
}

function AdminReviewsPage() {
    const searchParams = useSearchParams();
    const initialProductId = searchParams.get("productId") || "";

    const [products, setProducts] = useState<ProductOption[]>([]);
    const [selectedProductId, setSelectedProductId] = useState<string>(initialProductId);
    const [activeTab, setActiveTab] = useState<"import" | "manage">("import");

    // Import State
    const [importMode, setImportMode] = useState<"paste" | "upload">("paste");
    const [jsonInput, setJsonInput] = useState<string>("");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [validating, setValidating] = useState<boolean>(false);
    const [validationResult, setValidationResult] = useState<ReviewBatchValidationResult | null>(null);
    const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
    const [previewMode, setPreviewMode] = useState<"admin" | "storefront">("admin");
    const [publishing, setPublishing] = useState<boolean>(false);
    const [publishSuccess, setPublishSuccess] = useState<string | null>(null);
    const [publishError, setPublishError] = useState<string | null>(null);
    const [showPublishModal, setShowPublishModal] = useState<boolean>(false);

    // Existing Reviews State
    const [existingReviews, setExistingReviews] = useState<StoredReview[]>([]);
    const [loadingReviews, setLoadingReviews] = useState<boolean>(false);
    const [reviewFilter, setReviewFilter] = useState<"ALL" | "published" | "unpublished" | "storefront" | "imported">("ALL");
    const [searchQuery, setSearchQuery] = useState<string>("");
    const [selectedReviewForProvenance, setSelectedReviewForProvenance] = useState<StoredReview | null>(null);
    const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
    const [actionMessage, setActionMessage] = useState<string | null>(null);
    const [recalculating, setRecalculating] = useState<boolean>(false);

    // 1. Fetch products catalog for the dropdown selector
    useEffect(() => {
        const unsub = onSnapshot(collection(db, "products"), (snapshot) => {
            const prods = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            })) as ProductOption[];
            setProducts(prods);

            if (!selectedProductId && prods.length > 0) {
                setSelectedProductId(prods[0].id);
            }
        });

        return () => unsub();
    }, []);

    // 2. Fetch existing reviews when selected product changes
    useEffect(() => {
        if (!selectedProductId) return;

        async function fetchReviews() {
            setLoadingReviews(true);
            try {
                const user = auth.currentUser;
                const idToken = user ? await user.getIdToken() : "";
                const res = await fetch(`/api/admin/reviews?productId=${encodeURIComponent(selectedProductId)}&limit=100`, {
                    headers: { Authorization: `Bearer ${idToken}` },
                });
                if (res.ok) {
                    const data = await res.json();
                    setExistingReviews(data.reviews || []);
                }
            } catch (err) {
                console.error("Failed to load existing reviews:", err);
            } finally {
                setLoadingReviews(false);
            }
        }

        fetchReviews();
        // Reset validation when product changes
        setValidationResult(null);
        setPublishSuccess(null);
        setPublishError(null);
        setExcludedIds(new Set());
    }, [selectedProductId]);

    const selectedProduct = useMemo(() => {
        return products.find((p) => p.id === selectedProductId) || null;
    }, [products, selectedProductId]);

    // Calculate live KPIs for the selected product
    const stats = useMemo(() => {
        const published = existingReviews.filter(
            (r) => r.publicationStatus === "published" || (!r.publicationStatus && r.isFake !== true)
        );
        const unpublished = existingReviews.filter(
            (r) => r.publicationStatus === "unpublished" || r.isFake === true
        );
        const imported = existingReviews.filter((r) => r.sourceType && r.sourceType !== "storefront");

        const sum = published.reduce((acc, r) => acc + (r.rating || 0), 0);
        const avg = published.length > 0 ? (sum / published.length).toFixed(1) : "0.0";

        return {
            totalPublished: published.length,
            averageRating: avg,
            totalUnpublished: unpublished.length,
            totalImported: imported.length,
        };
    }, [existingReviews]);

    // Sample Data Generators
    const handleLoadSample38 = () => {
        if (!selectedProductId) return;

        const customerNames = [
            "Aarav Sharma", "Priya Nair", "Rohan Mehta", "Ananya Verma", "Vikram Malhotra",
            "Sneha Patel", "Kabir Roy", "Divya Iyer", "Siddharth Rao", "Pooja Deshmukh",
            "Arjun Reddy", "Meera Kulkarni", "Karan Joshi", "Neha Kapoor", "Aditya Bose",
            "Tanvi Sen", "Rahul Saxena", "Ishita Bhatt", "Manish Choudhary", "Rhea Singhania",
            "Varun Bajaj", "Shreya Das", "Nikhil Chopra", "Anushka Chawla", "Harsh Vardhan",
            "Kavita Menon", "Deepak Pillai", "Simran Gill", "Gaurav Agarwal", "Swati Mishra",
            "Tarun Goel", "Alia Merchant", "Yashwant Rao", "Komal Sethi", "Pranav Dubey",
            "Sunita Pandey", "Abhishek Tiwari", "Radhika Mathur"
        ];

        const ratingsDistribution = [
            5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, // 20x 5-star
            4, 4, 4, 4, 4, 4, 4, 4, 4, 4,                                 // 10x 4-star
            3, 3, 3, 3, 3,                                                 // 5x 3-star
            2, 2,                                                          // 2x 2-star
            1                                                              // 1x 1-star
        ];

        const sampleComments = [
            "Absolutely loved the premium fabric and tailoring. Wears exceptionally well throughout the day.",
            "High quality stitching and fast delivery to New Delhi. True to size and matches photos perfectly.",
            "Great texture and comfortable fit. Washed it twice and colors held up vibrant without fading.",
            "Super cozy material, looks smart and clean. Will definitely order in another colorway.",
            "Surpassed my expectations. The packaging was neat and eco-friendly as well.",
            "Very pleased with the purchase. Good value for money compared to mall retail brands.",
            "Good product overall. Sizing runs slightly relaxed which worked well for my casual wardrobe.",
            "Comfortable daily wear. Customer support was also helpful when I inquired about sizing."
        ];

        const reviews = customerNames.map((name, i) => {
            const dateOffset = (i * 2) % 60;
            const reviewDate = new Date(Date.now() - dateOffset * 86400000).toISOString().split("T")[0];
            return {
                externalReviewId: `bv-simulated-rev-${String(i + 1).padStart(3, "0")}`,
                reviewerDisplayName: `[Simulation] ${name}`,
                rating: ratingsDistribution[i],
                title: ratingsDistribution[i] >= 4 ? "Simulated: Excellent Quality & Fit" : "Simulated: Decent Fabric",
                body: `[SIMULATED DEMO REVIEW — NOT FOR PUBLIC DISPLAY] ${sampleComments[i % sampleComments.length]}`,
                reviewedAt: reviewDate,
                source: "simulated-test",
                sourceReference: `DEMO-SIMULATION-REC-${1000 + i}`,
                customerConsentConfirmed: false,
            };
        });

        const sampleBatch = {
            productId: selectedProductId,
            reviews,
        };

        setJsonInput(JSON.stringify(sampleBatch, null, 2));
        setImportMode("paste");
        setValidationResult(null);
        setPublishSuccess(null);
        setPublishError(null);
    };

    const handleLoadSampleInvalid = () => {
        if (!selectedProductId) return;

        const invalidBatch = {
            productId: selectedProductId,
            reviews: [
                {
                    externalReviewId: "demo-valid-01",
                    reviewerDisplayName: "Rajesh Kumar",
                    rating: 5,
                    title: "Genuine Feedback",
                    body: "Authentic offline store purchase feedback with confirmed consent.",
                    reviewedAt: "2026-10-15",
                    source: "offline-customer-feedback",
                    sourceReference: "OFFLINE-REC-441",
                    customerConsentConfirmed: true,
                },
                {
                    externalReviewId: "demo-invalid-rating",
                    reviewerDisplayName: "Tester",
                    rating: 6, // OUT OF BOUNDS
                    title: "Invalid Star Count",
                    body: "This entry will fail validation due to rating 6.",
                    reviewedAt: "2026-10-15",
                    source: "offline-customer-feedback",
                    sourceReference: "OFFLINE-REC-442",
                    customerConsentConfirmed: true,
                },
                {
                    externalReviewId: "demo-no-consent",
                    reviewerDisplayName: "Private Customer",
                    rating: 5,
                    title: "No Consent Given",
                    body: "Structurally valid review, but customerConsentConfirmed is false. Will be rejected from public publication.",
                    reviewedAt: "2026-10-15",
                    source: "offline-customer-feedback",
                    sourceReference: "OFFLINE-REC-443",
                    customerConsentConfirmed: false,
                },
                {
                    externalReviewId: "demo-simulation-entry",
                    reviewerDisplayName: "Simulated Tester",
                    rating: 5,
                    title: "Synthetic Test Entry",
                    body: "This is marked with source 'simulated-test' for private preview testing only. System strictly forbids public publication.",
                    reviewedAt: "2026-10-15",
                    source: "simulated-test",
                    customerConsentConfirmed: true,
                },
            ],
        };

        setJsonInput(JSON.stringify(invalidBatch, null, 2));
        setImportMode("paste");
        setValidationResult(null);
        setPublishSuccess(null);
        setPublishError(null);
    };

    // File Upload Handler
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setSelectedFile(file);
        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            setJsonInput(content);
        };
        reader.readAsText(file);
    };

    // Run Server-Authoritative Validation
    const handleValidate = async () => {
        if (!selectedProductId) {
            setPublishError("Please select a target product first.");
            return;
        }

        if (!jsonInput.trim()) {
            setPublishError("Please paste or upload a JSON payload.");
            return;
        }

        let parsed: any;
        try {
            parsed = JSON.parse(jsonInput);
        } catch (jsonErr: any) {
            setPublishError(`Malformed JSON syntax: ${jsonErr.message}`);
            return;
        }

        if (!parsed.productId) {
            parsed.productId = selectedProductId;
        } else if (parsed.productId !== selectedProductId) {
            parsed.productId = selectedProductId;
        }

        setValidating(true);
        setPublishError(null);
        setPublishSuccess(null);

        try {
            const user = auth.currentUser;
            const idToken = user ? await user.getIdToken() : "";
            const res = await fetch("/api/admin/reviews/validate", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify(parsed),
            });

            const data = await res.json();
            if (!res.ok) {
                setPublishError(data.error || "Validation failed.");
            } else {
                setValidationResult(data);
                setExcludedIds(new Set());
            }
        } catch (err: any) {
            setPublishError(err.message || "Failed to communicate with validation service.");
        } finally {
            setValidating(false);
        }
    };

    // Exclude / Include item toggle
    const toggleExclude = (extId: string) => {
        setExcludedIds((prev) => {
            const updated = new Set(prev);
            if (updated.has(extId)) {
                updated.delete(extId);
            } else {
                updated.add(extId);
            }
            return updated;
        });
    };

    // Calculate eligible entries for publication considering exclusions
    const activePublishableEntries = useMemo(() => {
        if (!validationResult) return [];
        return validationResult.entries.filter(
            (e) => e.eligibleForPublication && !excludedIds.has(e.externalReviewId)
        );
    }, [validationResult, excludedIds]);

    // Publish Approved Batch
    const handlePublishBatch = async () => {
        if (!selectedProductId || !validationResult || activePublishableEntries.length === 0) return;

        setPublishing(true);
        setPublishError(null);
        setPublishSuccess(null);

        try {
            const user = auth.currentUser;
            const idToken = user ? await user.getIdToken() : "";

            const payloadToPublish = {
                productId: selectedProductId,
                reviews: activePublishableEntries.map((e) => ({
                    externalReviewId: e.externalReviewId,
                    reviewerDisplayName: e.reviewerDisplayName,
                    rating: e.rating,
                    title: e.title,
                    body: e.body,
                    reviewedAt: e.reviewedAt,
                    source: e.source,
                    sourceReference: e.sourceReference,
                    customerConsentConfirmed: e.customerConsentConfirmed,
                    images: e.images,
                })),
            };

            const res = await fetch("/api/admin/reviews/publish-batch", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify(payloadToPublish),
            });

            const data = await res.json();
            if (!res.ok) {
                setPublishError(data.error || "Failed to publish review batch.");
            } else {
                setPublishSuccess(
                    `Successfully imported and published ${data.publishedCount} customer reviews! Batch ID: ${data.batchId}`
                );
                setShowPublishModal(false);
                setValidationResult(null);
                setJsonInput("");
                setSelectedFile(null);

                // Refresh existing reviews list
                const refreshed = await fetch(
                    `/api/admin/reviews?productId=${encodeURIComponent(selectedProductId)}&limit=100`,
                    { headers: { Authorization: `Bearer ${idToken}` } }
                );
                if (refreshed.ok) {
                    const refData = await refreshed.json();
                    setExistingReviews(refData.reviews || []);
                }
            }
        } catch (err: any) {
            setPublishError(err.message || "Failed to publish batch.");
        } finally {
            setPublishing(false);
        }
    };

    // Toggle Review Publication Status
    const handleToggleStatus = async (review: StoredReview) => {
        const newStatus = review.publicationStatus === "published" ? "unpublished" : "published";
        setActionLoadingId(review.id);
        setActionMessage(null);

        try {
            const user = auth.currentUser;
            const idToken = user ? await user.getIdToken() : "";
            const res = await fetch("/api/admin/reviews", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    reviewId: review.id,
                    publicationStatus: newStatus,
                }),
            });

            const data = await res.json();
            if (res.ok) {
                setExistingReviews((prev) =>
                    prev.map((r) => (r.id === review.id ? { ...r, publicationStatus: newStatus } : r))
                );
                setActionMessage(`Review marked as ${newStatus}. Product stats updated.`);
            } else {
                alert(data.error || "Failed to update review status.");
            }
        } catch (err: any) {
            alert(err.message || "Network error.");
        } finally {
            setActionLoadingId(null);
        }
    };

    // Delete Review
    const handleDeleteReview = async (reviewId: string) => {
        if (!confirm("Are you sure you want to permanently delete this review?")) return;

        setActionLoadingId(reviewId);
        try {
            const user = auth.currentUser;
            const idToken = user ? await user.getIdToken() : "";
            const res = await fetch(`/api/admin/reviews?reviewId=${encodeURIComponent(reviewId)}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${idToken}` },
            });

            if (res.ok) {
                setExistingReviews((prev) => prev.filter((r) => r.id !== reviewId));
                setActionMessage("Review deleted and rating aggregates recalculated.");
            } else {
                const data = await res.json();
                alert(data.error || "Failed to delete review.");
            }
        } catch (err: any) {
            alert(err.message || "Network error.");
        } finally {
            setActionLoadingId(null);
        }
    };

    // Authoritative Recalculate Aggregates
    const handleRecalculateStats = async () => {
        if (!selectedProductId) return;
        setRecalculating(true);
        setActionMessage(null);

        try {
            const user = auth.currentUser;
            const idToken = user ? await user.getIdToken() : "";
            const res = await fetch("/api/admin/reviews/recalculate", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({ productId: selectedProductId }),
            });

            const data = await res.json();
            if (res.ok) {
                setActionMessage(`Recalculated successfully: ${data.stats.reviewCount} published reviews, average rating ${data.stats.averageRating}.`);
            } else {
                alert(data.error || "Recalculation failed.");
            }
        } catch (err: any) {
            alert(err.message || "Network error.");
        } finally {
            setRecalculating(false);
        }
    };

    // Filter existing reviews
    const filteredExistingReviews = useMemo(() => {
        return existingReviews.filter((r) => {
            if (reviewFilter === "published" && r.publicationStatus !== "published" && (r.publicationStatus || r.isFake)) return false;
            if (reviewFilter === "unpublished" && r.publicationStatus === "published") return false;
            if (reviewFilter === "storefront" && r.sourceType && r.sourceType !== "storefront") return false;
            if (reviewFilter === "imported" && r.sourceType === "storefront") return false;

            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const matchName = (r.userName || "").toLowerCase().includes(q);
                const matchComment = (r.comment || "").toLowerCase().includes(q);
                const matchTitle = (r.title || "").toLowerCase().includes(q);
                return matchName || matchComment || matchTitle;
            }

            return true;
        });
    }, [existingReviews, reviewFilter, searchQuery]);

    return (
        <div className="animate-fade-in" style={{ paddingBottom: "64px" }}>
            <AdminPageHeader
                title="Product Review Management"
                subtitle="Bulk JSON import, validation preview, provenance audit, and moderation controls."
            >
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <Link href="/admin/products" className="admin-btn admin-btn-secondary admin-btn-sm" style={{ textDecoration: "none" }}>
                        &larr; Products
                    </Link>
                    <button
                        type="button"
                        onClick={handleRecalculateStats}
                        className="admin-btn admin-btn-secondary admin-btn-sm"
                        disabled={recalculating}
                        title="Reconcile and authoritatively recalculate rating aggregates from database"
                    >
                        {recalculating ? "Syncing..." : "Sync Aggregates"}
                    </button>
                </div>
            </AdminPageHeader>

            {/* PRODUCT SELECTOR & SUMMARY CARD */}
            <div className="admin-card" style={{ marginBottom: "24px" }}>
                <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap", marginBottom: "20px" }}>
                    <div style={{ flex: 1, minWidth: "260px" }}>
                        <label htmlFor="product-select" style={{ display: "block", fontSize: "0.85rem", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "6px" }}>
                            Select Product to Manage Reviews:
                        </label>
                        <select
                            id="product-select"
                            className="admin-form-select"
                            value={selectedProductId}
                            onChange={(e) => setSelectedProductId(e.target.value)}
                        >
                            {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name} (₹{p.price})
                                </option>
                            ))}
                        </select>
                    </div>

                    {selectedProduct && (
                        <div style={{ display: "flex", gap: "12px", alignItems: "center", backgroundColor: "var(--bg-secondary)", padding: "10px 16px", borderRadius: "12px", border: "1px solid var(--border-color)" }}>
                            <div style={{ width: "48px", height: "48px", borderRadius: "8px", overflow: "hidden", backgroundColor: "var(--bg-primary)", flexShrink: 0 }}>
                                {selectedProduct.images?.[0] ? (
                                    <img src={selectedProduct.images[0]} alt={selectedProduct.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                ) : (
                                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", color: "var(--text-secondary)" }}>No img</div>
                                )}
                            </div>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--text-primary)" }}>{selectedProduct.name}</div>
                                <div style={{ fontSize: "0.8rem", color: "var(--accent)", fontWeight: 700 }}>₹{selectedProduct.price}</div>
                            </div>
                        </div>
                    )}
                </div>

                {/* 4-KPI SUMMARY GRID */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px" }}>
                    <div style={{ backgroundColor: "var(--bg-secondary)", padding: "14px 16px", borderRadius: "12px", border: "1px solid var(--border-color)" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 600, display: "block" }}>Published Reviews</span>
                        <span style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--accent)" }}>{stats.totalPublished}</span>
                    </div>

                    <div style={{ backgroundColor: "var(--bg-secondary)", padding: "14px 16px", borderRadius: "12px", border: "1px solid var(--border-color)" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 600, display: "block" }}>Average Rating</span>
                        <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                            <span style={{ fontSize: "1.4rem", fontWeight: 800, color: "#d97706" }}>{stats.averageRating}</span>
                            <span style={{ color: "#f59e0b", fontSize: "1rem" }}>★</span>
                        </div>
                    </div>

                    <div style={{ backgroundColor: "var(--bg-secondary)", padding: "14px 16px", borderRadius: "12px", border: "1px solid var(--border-color)" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 600, display: "block" }}>Unpublished / Draft</span>
                        <span style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--text-primary)" }}>{stats.totalUnpublished}</span>
                    </div>

                    <div style={{ backgroundColor: "var(--bg-secondary)", padding: "14px 16px", borderRadius: "12px", border: "1px solid var(--border-color)" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 600, display: "block" }}>Imported Reviews</span>
                        <span style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--text-primary)" }}>{stats.totalImported}</span>
                    </div>
                </div>

                {actionMessage && (
                    <div style={{ marginTop: "16px", padding: "10px 14px", backgroundColor: "var(--accent-light)", color: "var(--accent)", borderRadius: "8px", fontSize: "0.85rem", fontWeight: 600 }}>
                        {actionMessage}
                    </div>
                )}
            </div>

            {/* TAB SELECTOR: IMPORT VS MANAGE */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "20px", borderBottom: "1px solid var(--border-color)", paddingBottom: "8px" }}>
                <button
                    type="button"
                    onClick={() => setActiveTab("import")}
                    className={`admin-filter-pill ${activeTab === "import" ? "active" : ""}`}
                    style={{ fontSize: "0.95rem", padding: "8px 18px" }}
                >
                    📥 Bulk JSON Importer
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab("manage")}
                    className={`admin-filter-pill ${activeTab === "manage" ? "active" : ""}`}
                    style={{ fontSize: "0.95rem", padding: "8px 18px" }}
                >
                    ⭐ Manage Existing Reviews ({existingReviews.length})
                </button>
            </div>

            {/* TAB 1: BULK JSON IMPORTER */}
            {activeTab === "import" && (
                <div>
                    {/* Input Controls Card */}
                    <div className="admin-card" style={{ marginBottom: "24px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
                            <div style={{ display: "flex", gap: "8px" }}>
                                <button
                                    type="button"
                                    onClick={() => setImportMode("paste")}
                                    className={`admin-btn admin-btn-sm ${importMode === "paste" ? "admin-btn-primary" : "admin-btn-secondary"}`}
                                >
                                    Paste JSON Text
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setImportMode("upload")}
                                    className={`admin-btn admin-btn-sm ${importMode === "upload" ? "admin-btn-primary" : "admin-btn-secondary"}`}
                                >
                                    Upload .json File
                                </button>
                            </div>

                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                <button
                                    type="button"
                                    onClick={handleLoadSample38}
                                    className="admin-btn admin-btn-secondary admin-btn-sm"
                                    title="Load 38 simulated demo reviews for preview testing only (publication strictly blocked)"
                                >
                                    Load Simulation Preview (38 Reviews)
                                </button>
                                <button
                                    type="button"
                                    onClick={handleLoadSampleInvalid}
                                    className="admin-btn admin-btn-secondary admin-btn-sm"
                                    title="Load a mixed sample with validation errors and simulated entries"
                                >
                                    Load Error/Sim Sample
                                </button>
                                {jsonInput && (
                                    <button
                                        type="button"
                                        onClick={() => { setJsonInput(""); setValidationResult(null); setSelectedFile(null); }}
                                        className="admin-btn admin-btn-secondary admin-btn-sm"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>

                        {importMode === "upload" && (
                            <div style={{ border: "2px dashed var(--border-color)", padding: "32px 16px", borderRadius: "12px", textAlign: "center", backgroundColor: "var(--bg-secondary)", marginBottom: "16px" }}>
                                <input
                                    type="file"
                                    accept=".json,application/json"
                                    id="review-json-file"
                                    onChange={handleFileUpload}
                                    style={{ display: "none" }}
                                />
                                <label htmlFor="review-json-file" className="admin-btn admin-btn-primary" style={{ cursor: "pointer", display: "inline-block" }}>
                                    {selectedFile ? `Selected: ${selectedFile.name}` : "Choose JSON File"}
                                </label>
                                <p style={{ marginTop: "8px", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                                    Upload a structured .json file containing customer reviews.
                                </p>
                            </div>
                        )}

                        <div className="admin-form-group" style={{ marginBottom: "16px" }}>
                            <label htmlFor="json-textarea">JSON Review Payload *</label>
                            <textarea
                                id="json-textarea"
                                rows={10}
                                className="admin-form-textarea"
                                value={jsonInput}
                                onChange={(e) => setJsonInput(e.target.value)}
                                placeholder={`{\n  "productId": "${selectedProductId || "PROD_ID"}",\n  "reviews": [\n    {\n      "externalReviewId": "offline-001",\n      "reviewerDisplayName": "Customer Name",\n      "rating": 5,\n      "title": "Great Product",\n      "body": "Detailed feedback...",\n      "reviewedAt": "2026-10-15",\n      "source": "offline-customer-feedback",\n      "sourceReference": "REC-9981",\n      "customerConsentConfirmed": true\n    }\n  ]\n}`}
                                style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
                            />
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
                            <button
                                type="button"
                                onClick={handleValidate}
                                className="admin-btn admin-btn-primary"
                                disabled={validating || !jsonInput.trim()}
                            >
                                {validating ? "Validating Entries..." : "Validate Review Batch"}
                            </button>
                        </div>

                        {publishError && (
                            <div style={{ marginTop: "16px", padding: "12px 16px", backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#ef4444", borderRadius: "10px", fontSize: "0.9rem", border: "1px solid rgba(239, 68, 68, 0.2)" }}>
                                {publishError}
                            </div>
                        )}

                        {publishSuccess && (
                            <div style={{ marginTop: "16px", padding: "12px 16px", backgroundColor: "var(--accent-light)", color: "var(--accent)", borderRadius: "10px", fontSize: "0.9rem", fontWeight: 600, border: "1px solid var(--accent)" }}>
                                {publishSuccess}
                            </div>
                        )}
                    </div>

                    {/* VALIDATION PREVIEW DASHBOARD */}
                    {validationResult && (
                        <div className="admin-card animate-fade-in" style={{ marginBottom: "32px" }}>
                            {/* Dashboard Summary Header */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px", marginBottom: "20px", borderBottom: "1px solid var(--border-color)", paddingBottom: "16px" }}>
                                <div>
                                    <h3 style={{ fontSize: "1.2rem", fontWeight: 800, color: "var(--text-primary)", margin: 0 }}>
                                        Validation Preview: {validationResult.totalSubmitted} Reviews Detected
                                    </h3>
                                    <div style={{ display: "flex", gap: "12px", marginTop: "6px", flexWrap: "wrap", fontSize: "0.85rem" }}>
                                        <span style={{ color: "var(--accent)", fontWeight: 700 }}>✓ {validationResult.validCount} Valid</span>
                                        {validationResult.invalidCount > 0 && (
                                            <span style={{ color: "#ef4444", fontWeight: 700 }}>✗ {validationResult.invalidCount} Invalid</span>
                                        )}
                                        {validationResult.duplicateCount > 0 && (
                                            <span style={{ color: "#ca8a04", fontWeight: 700 }}>⚠ {validationResult.duplicateCount} Duplicates</span>
                                        )}
                                        <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>
                                            🎯 {activePublishableEntries.length} Eligible to Publish
                                        </span>
                                    </div>
                                </div>

                                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                    <div style={{ display: "flex", backgroundColor: "var(--bg-secondary)", padding: "4px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                                        <button
                                            type="button"
                                            onClick={() => setPreviewMode("admin")}
                                            style={{
                                                padding: "4px 12px", borderRadius: "6px", border: "none", cursor: "pointer",
                                                fontWeight: 600, fontSize: "0.78rem",
                                                backgroundColor: previewMode === "admin" ? "var(--accent)" : "transparent",
                                                color: previewMode === "admin" ? "white" : "var(--text-secondary)"
                                            }}
                                        >
                                            Audit Cards
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPreviewMode("storefront")}
                                            style={{
                                                padding: "4px 12px", borderRadius: "6px", border: "none", cursor: "pointer",
                                                fontWeight: 600, fontSize: "0.78rem",
                                                backgroundColor: previewMode === "storefront" ? "var(--accent)" : "transparent",
                                                color: previewMode === "storefront" ? "white" : "var(--text-secondary)"
                                            }}
                                        >
                                            Storefront Look
                                        </button>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => setShowPublishModal(true)}
                                        className="admin-btn admin-btn-primary"
                                        disabled={activePublishableEntries.length === 0}
                                    >
                                        Publish Approved Batch ({activePublishableEntries.length})
                                    </button>
                                </div>
                            </div>

                            {/* ITEM LISTING */}
                            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                                {validationResult.entries.map((entry) => {
                                    const isExcluded = excludedIds.has(entry.externalReviewId);

                                    if (previewMode === "storefront") {
                                        // RENDER STOREFRONT PREVIEW CARD (WATERMARKED)
                                        return (
                                            <div
                                                key={entry.externalReviewId}
                                                style={{
                                                    position: "relative",
                                                    backgroundColor: "var(--bg-primary)",
                                                    border: "1px solid var(--border-color)",
                                                    borderRadius: "14px",
                                                    padding: "20px",
                                                    opacity: isExcluded ? 0.4 : 1,
                                                }}
                                            >
                                                <div style={{ position: "absolute", top: "10px", right: "12px", backgroundColor: "rgba(0,0,0,0.06)", color: "var(--text-secondary)", fontSize: "0.65rem", fontWeight: 800, padding: "2px 8px", borderRadius: "4px", letterSpacing: "0.05em" }}>
                                                    PRIVATE ADMIN PREVIEW — NOT PUBLISHED
                                                </div>

                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                                        <div style={{ width: "36px", height: "36px", borderRadius: "50%", backgroundColor: "var(--accent-light)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.95rem" }}>
                                                            {entry.reviewerDisplayName ? entry.reviewerDisplayName.charAt(0).toUpperCase() : "?"}
                                                        </div>
                                                        <div>
                                                            <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>
                                                                {entry.reviewerDisplayName}
                                                                <span style={{ marginLeft: "8px", fontSize: "0.7rem", padding: "2px 6px", background: "rgba(0, 107, 60, 0.08)", color: "var(--accent)", borderRadius: "4px", fontWeight: 700 }}>
                                                                    Verified Offline Customer
                                                                </span>
                                                            </div>
                                                            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{entry.reviewedAt}</div>
                                                        </div>
                                                    </div>
                                                    <div style={{ color: "#f59e0b", fontSize: "1.1rem" }}>
                                                        {"★".repeat(entry.rating)}{"☆".repeat(Math.max(0, 5 - entry.rating))}
                                                    </div>
                                                </div>

                                                {entry.title && (
                                                    <h4 style={{ margin: "8px 0 4px 0", fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)" }}>
                                                        {entry.title}
                                                    </h4>
                                                )}
                                                <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                                                    {entry.body}
                                                </p>
                                            </div>
                                        );
                                    }

                                    // AUDIT CARD VIEW
                                    return (
                                        <div
                                            key={entry.externalReviewId}
                                            style={{
                                                backgroundColor: entry.valid ? "var(--bg-secondary)" : "rgba(239, 68, 68, 0.04)",
                                                border: `1px solid ${!entry.valid ? "#ef4444" : isExcluded ? "var(--border-color)" : "var(--accent)"}`,
                                                borderRadius: "12px",
                                                padding: "16px 20px",
                                                opacity: isExcluded ? 0.5 : 1,
                                            }}
                                        >
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "8px" }}>
                                                <div>
                                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                                        <span style={{ fontSize: "0.75rem", fontWeight: 800, color: "var(--text-secondary)" }}>
                                                            #{entry.itemIndex} [{entry.externalReviewId}]
                                                        </span>
                                                        <strong style={{ fontSize: "0.95rem", color: "var(--text-primary)" }}>
                                                            {entry.reviewerDisplayName || "Missing Name"}
                                                        </strong>
                                                        <span style={{ color: "#d97706", fontWeight: 800, fontSize: "0.9rem" }}>
                                                            {"★".repeat(entry.rating)} ({entry.rating}/5)
                                                        </span>
                                                    </div>

                                                    <div style={{ display: "flex", gap: "8px", marginTop: "4px", flexWrap: "wrap", fontSize: "0.78rem" }}>
                                                        <span style={{ color: "var(--text-secondary)" }}>Date: {entry.reviewedAt || "—"}</span>
                                                        <span style={{ color: "var(--text-secondary)" }}>Source: <code>{entry.source}</code></span>
                                                        {entry.sourceReference && (
                                                            <span style={{ color: "var(--text-secondary)" }}>Ref: {entry.sourceReference}</span>
                                                        )}
                                                    </div>
                                                </div>

                                                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                                    {entry.eligibleForPublication ? (
                                                        <span style={{ fontSize: "0.72rem", padding: "3px 8px", borderRadius: "6px", backgroundColor: "var(--accent-light)", color: "var(--accent)", fontWeight: 700 }}>
                                                            ✓ Eligible
                                                        </span>
                                                    ) : entry.isSimulation ? (
                                                        <span style={{ fontSize: "0.72rem", padding: "3px 8px", borderRadius: "6px", backgroundColor: "rgba(100, 116, 139, 0.15)", color: "#475569", fontWeight: 700 }}>
                                                            Simulation Only
                                                        </span>
                                                    ) : (
                                                        <span style={{ fontSize: "0.72rem", padding: "3px 8px", borderRadius: "6px", backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#ef4444", fontWeight: 700 }}>
                                                            ✗ Ineligible
                                                        </span>
                                                    )}

                                                    {entry.eligibleForPublication && (
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleExclude(entry.externalReviewId)}
                                                            className={`admin-btn admin-btn-sm ${isExcluded ? "admin-btn-secondary" : "admin-btn-secondary"}`}
                                                            style={{ fontSize: "0.75rem", padding: "3px 8px" }}
                                                        >
                                                            {isExcluded ? "+ Include" : "Exclude"}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {entry.title && (
                                                <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "4px" }}>
                                                    {entry.title}
                                                </div>
                                            )}

                                            <p style={{ margin: "4px 0", fontSize: "0.85rem", color: "var(--text-primary)", lineHeight: 1.4 }}>
                                                {entry.body}
                                            </p>

                                            {/* Errors and Warnings */}
                                            {entry.errors.length > 0 && (
                                                <div style={{ marginTop: "8px", fontSize: "0.8rem", color: "#ef4444", backgroundColor: "rgba(239, 68, 68, 0.08)", padding: "6px 10px", borderRadius: "6px" }}>
                                                    <strong>Errors:</strong> {entry.errors.join("; ")}
                                                </div>
                                            )}

                                            {entry.warnings.length > 0 && (
                                                <div style={{ marginTop: "4px", fontSize: "0.8rem", color: "#ca8a04", backgroundColor: "rgba(202, 138, 4, 0.08)", padding: "6px 10px", borderRadius: "6px" }}>
                                                    <strong>Notes:</strong> {entry.warnings.join("; ")}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* TAB 2: MANAGE EXISTING REVIEWS */}
            {activeTab === "manage" && (
                <div className="admin-card">
                    {/* Filters and Search Bar */}
                    <div className="admin-filter-bar">
                        <div className="admin-search-wrapper">
                            <svg className="admin-search-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                            <input
                                type="search"
                                className="admin-search-input"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search by customer name or review text..."
                                aria-label="Search reviews"
                            />
                        </div>

                        <div className="admin-filter-pills">
                            <button
                                type="button"
                                className={`admin-filter-pill ${reviewFilter === "ALL" ? "active" : ""}`}
                                onClick={() => setReviewFilter("ALL")}
                            >
                                All ({existingReviews.length})
                            </button>
                            <button
                                type="button"
                                className={`admin-filter-pill ${reviewFilter === "published" ? "active" : ""}`}
                                onClick={() => setReviewFilter("published")}
                            >
                                Published
                            </button>
                            <button
                                type="button"
                                className={`admin-filter-pill ${reviewFilter === "unpublished" ? "active" : ""}`}
                                onClick={() => setReviewFilter("unpublished")}
                            >
                                Unpublished
                            </button>
                            <button
                                type="button"
                                className={`admin-filter-pill ${reviewFilter === "storefront" ? "active" : ""}`}
                                onClick={() => setReviewFilter("storefront")}
                            >
                                Storefront Buyers
                            </button>
                            <button
                                type="button"
                                className={`admin-filter-pill ${reviewFilter === "imported" ? "active" : ""}`}
                                onClick={() => setReviewFilter("imported")}
                            >
                                Imported
                            </button>
                        </div>
                    </div>

                    {loadingReviews ? (
                        <div style={{ padding: "48px", textAlign: "center", color: "var(--text-secondary)" }}>
                            Loading stored reviews...
                        </div>
                    ) : filteredExistingReviews.length === 0 ? (
                        <div style={{ padding: "48px", textAlign: "center", color: "var(--text-secondary)", backgroundColor: "var(--bg-secondary)", borderRadius: "12px" }}>
                            No reviews match your filters for this product.
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                            {filteredExistingReviews.map((rev) => {
                                const isPublished = rev.publicationStatus === "published" || (!rev.publicationStatus && rev.isFake !== true);
                                const isActionLoading = actionLoadingId === rev.id;

                                return (
                                    <div
                                        key={rev.id}
                                        style={{
                                            backgroundColor: "var(--bg-primary)",
                                            border: "1px solid var(--border-color)",
                                            borderRadius: "12px",
                                            padding: "16px 20px",
                                        }}
                                    >
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "8px" }}>
                                            <div>
                                                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                                                    <strong style={{ fontSize: "1rem", color: "var(--text-primary)" }}>{rev.userName}</strong>
                                                    <span style={{ color: "#f59e0b", fontSize: "0.95rem" }}>
                                                        {"★".repeat(rev.rating)}{"☆".repeat(Math.max(0, 5 - rev.rating))}
                                                    </span>

                                                    {rev.verifiedPurchase && (
                                                        <span style={{ fontSize: "0.7rem", padding: "2px 6px", borderRadius: "4px", backgroundColor: "rgba(34, 197, 94, 0.1)", color: "#16a34a", fontWeight: 700 }}>
                                                            ✓ Verified Buyer
                                                        </span>
                                                    )}

                                                    {rev.sourceType && rev.sourceType !== "storefront" && (
                                                        <span style={{ fontSize: "0.7rem", padding: "2px 6px", borderRadius: "4px", backgroundColor: "var(--accent-light)", color: "var(--accent)", fontWeight: 700 }}>
                                                            {rev.sourceType === "offline-customer-feedback" ? "Offline Feedback" : rev.sourceType}
                                                        </span>
                                                    )}

                                                    <span style={{
                                                        fontSize: "0.7rem", padding: "2px 6px", borderRadius: "4px", fontWeight: 700,
                                                        backgroundColor: isPublished ? "var(--accent-light)" : "rgba(239, 68, 68, 0.1)",
                                                        color: isPublished ? "var(--accent)" : "#ef4444"
                                                    }}>
                                                        {isPublished ? "Published" : "Unpublished"}
                                                    </span>
                                                </div>

                                                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                                                    Date: {new Date(rev.createdAt).toLocaleDateString()}
                                                    {rev.externalReviewId && ` • Ref: ${rev.externalReviewId}`}
                                                </div>
                                            </div>

                                            {/* Action Controls */}
                                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleToggleStatus(rev)}
                                                    className={`admin-btn admin-btn-sm ${isPublished ? "admin-btn-secondary" : "admin-btn-primary"}`}
                                                    disabled={isActionLoading}
                                                >
                                                    {isPublished ? "Unpublish" : "Publish"}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedReviewForProvenance(rev)}
                                                    className="admin-btn admin-btn-secondary admin-btn-sm"
                                                    title="View audit provenance and batch metadata"
                                                >
                                                    Provenance
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteReview(rev.id)}
                                                    className="admin-btn admin-btn-danger admin-btn-sm"
                                                    disabled={isActionLoading}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>

                                        {rev.title && (
                                            <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--text-primary)", marginBottom: "4px" }}>
                                                {rev.title}
                                            </div>
                                        )}

                                        <p style={{ margin: "4px 0", fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                                            {rev.comment}
                                        </p>

                                        {rev.images && rev.images.length > 0 && (
                                            <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                                                {rev.images.map((img, i) => (
                                                    <a key={i} href={img} target="_blank" rel="noopener noreferrer" style={{ width: "60px", height: "60px", borderRadius: "8px", overflow: "hidden", display: "inline-block", border: "1px solid var(--border-color)" }}>
                                                        <img src={img} alt="review attachment" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* CONFIRMATION PUBLISH MODAL */}
            {showPublishModal && (
                <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
                    <div className="admin-card animate-fade-in" style={{ maxWidth: "500px", width: "100%", padding: "28px" }}>
                        <h3 style={{ fontSize: "1.25rem", fontWeight: 800, color: "var(--text-primary)", marginBottom: "12px" }}>
                            Confirm Review Publication
                        </h3>
                        <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: "20px" }}>
                            You are about to publish <strong>{activePublishableEntries.length} verified customer reviews</strong> for <strong>{selectedProduct?.name}</strong>.
                            These reviews will immediately be visible on the public storefront and will authoritatively update the product&apos;s star rating and published count.
                        </p>
                        <div style={{ backgroundColor: "var(--bg-secondary)", padding: "14px", borderRadius: "10px", marginBottom: "24px", fontSize: "0.85rem" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                                <span>Target Product:</span>
                                <strong>{selectedProduct?.name}</strong>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                                <span>Total Reviews to Publish:</span>
                                <strong>{activePublishableEntries.length}</strong>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span>Provenance Preserved:</span>
                                <strong>Yes (audit batch recorded)</strong>
                            </div>
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
                            <button
                                type="button"
                                onClick={() => setShowPublishModal(false)}
                                className="admin-btn admin-btn-secondary"
                                disabled={publishing}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handlePublishBatch}
                                className="admin-btn admin-btn-primary"
                                disabled={publishing}
                            >
                                {publishing ? "Publishing Batch..." : "Confirm & Publish"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* PROVENANCE INSPECTION MODAL */}
            {selectedReviewForProvenance && (
                <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
                    <div className="admin-card animate-fade-in" style={{ maxWidth: "560px", width: "100%", padding: "28px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                            <h3 style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0 }}>Review Provenance & Audit Info</h3>
                            <button
                                type="button"
                                onClick={() => setSelectedReviewForProvenance(null)}
                                style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "var(--text-secondary)" }}
                            >
                                ×
                            </button>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "0.85rem", backgroundColor: "var(--bg-secondary)", padding: "16px", borderRadius: "12px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "var(--text-secondary)" }}>Internal Document ID:</span>
                                <code>{selectedReviewForProvenance.id}</code>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "var(--text-secondary)" }}>External Review ID:</span>
                                <code>{selectedReviewForProvenance.externalReviewId || "N/A (Storefront native)"}</code>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "var(--text-secondary)" }}>Source Type:</span>
                                <strong>{selectedReviewForProvenance.sourceType || "storefront"}</strong>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "var(--text-secondary)" }}>Internal Source Evidence Ref:</span>
                                <code>{selectedReviewForProvenance.sourceReference || "N/A (Storefront verified order)"}</code>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "var(--text-secondary)" }}>Import Batch ID:</span>
                                <code>{selectedReviewForProvenance.importBatchId || "N/A"}</code>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "var(--text-secondary)" }}>Imported By (Admin UID):</span>
                                <code>{selectedReviewForProvenance.importedBy || "N/A"}</code>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "var(--text-secondary)" }}>Customer Consent Confirmed:</span>
                                <strong>{selectedReviewForProvenance.customerConsentConfirmed ? "Yes (Authoritative)" : "No"}</strong>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "var(--text-secondary)" }}>In-App Delivered Purchase:</span>
                                <strong>{selectedReviewForProvenance.verifiedPurchase ? "Yes (Delivered Order)" : "No (External/Offline Channel)"}</strong>
                            </div>
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "20px" }}>
                            <button
                                type="button"
                                onClick={() => setSelectedReviewForProvenance(null)}
                                className="admin-btn admin-btn-primary admin-btn-sm"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
