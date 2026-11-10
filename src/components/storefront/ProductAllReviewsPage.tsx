"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import type { ProductReviewStats, RatingDistribution } from "@/lib/reviews/types";

interface ProductReviewItem {
    id: string;
    productId: string;
    userName: string;
    rating: number;
    title?: string | null;
    comment: string;
    images?: string[];
    createdAt: number;
    verifiedPurchase: boolean;
    sourceType: string;
}

interface ProductAllReviewsPageProps {
    product: {
        id: string;
        name: string;
        slug: string;
        price: number;
        images?: string[];
        reviewCount?: number;
        averageRating?: number;
    };
}

export default function ProductAllReviewsPage({ product }: ProductAllReviewsPageProps) {
    const [reviews, setReviews] = useState<ProductReviewItem[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [stats, setStats] = useState<ProductReviewStats>({
        reviewCount: product.reviewCount || 0,
        averageRating: product.averageRating || 0.0,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });

    const [ratingFilter, setRatingFilter] = useState<string>("ALL");
    const [sortOption, setSortOption] = useState<string>("newest");
    const [page, setPage] = useState<number>(1);
    const [hasMore, setHasMore] = useState<boolean>(false);
    const [totalFiltered, setTotalFiltered] = useState<number>(0);
    const [loadingMore, setLoadingMore] = useState<boolean>(false);

    // Fetch reviews from server API
    async function loadReviews(targetPage = 1, append = false) {
        if (targetPage === 1) setLoading(true);
        else setLoadingMore(true);

        try {
            const queryParams = new URLSearchParams({
                productId: product.id,
                page: String(targetPage),
                limit: "10",
                rating: ratingFilter,
                sort: sortOption,
            });

            const res = await fetch(`/api/reviews?${queryParams.toString()}`);
            if (res.ok) {
                const data = await res.json();
                if (append) {
                    setReviews((prev) => [...prev, ...(data.reviews || [])]);
                } else {
                    setReviews(data.reviews || []);
                }
                if (data.stats) {
                    setStats(data.stats);
                }
                setHasMore(Boolean(data.pagination?.hasMore));
                setTotalFiltered(data.pagination?.total || 0);
                setPage(targetPage);
            }
        } catch (err) {
            console.error("Failed to load reviews:", err);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }

    // Reload when rating filter or sort changes
    useEffect(() => {
        loadReviews(1, false);
    }, [ratingFilter, sortOption, product.id]);

    const handleLoadMore = () => {
        if (!hasMore || loadingMore) return;
        loadReviews(page + 1, true);
    };

    const mainImage = product.images?.[0] || null;

    return (
        <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "24px 16px 80px 16px" }}>
            {/* Breadcrumb / Back Link */}
            <div style={{ marginBottom: "24px" }}>
                <Link
                    href={`/products/${product.slug}`}
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        color: "var(--accent)",
                        textDecoration: "none",
                        fontWeight: 600,
                        fontSize: "0.9rem",
                    }}
                >
                    &larr; Back to {product.name}
                </Link>
            </div>

            {/* Product Summary Header */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    backgroundColor: "var(--bg-secondary)",
                    padding: "16px 20px",
                    borderRadius: "16px",
                    border: "1px solid var(--border-color)",
                    marginBottom: "32px",
                    flexWrap: "wrap",
                }}
            >
                <div style={{ width: "64px", height: "64px", borderRadius: "12px", overflow: "hidden", backgroundColor: "var(--bg-primary)", flexShrink: 0, border: "1px solid var(--border-color)" }}>
                    {mainImage ? (
                        <img src={mainImage} alt={product.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: "0.75rem" }}>No img</div>
                    )}
                </div>

                <div style={{ flex: 1, minWidth: "200px" }}>
                    <h1 style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--text-primary)", margin: "0 0 4px 0", letterSpacing: "-0.01em" }}>
                        Customer Reviews for {product.name}
                    </h1>
                    <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--accent)" }}>
                        ₹{Number(product.price).toLocaleString("en-IN")}
                    </div>
                </div>

                <Link
                    href={`/products/${product.slug}`}
                    style={{
                        padding: "8px 18px",
                        borderRadius: "10px",
                        backgroundColor: "var(--text-primary)",
                        color: "var(--bg-primary)",
                        textDecoration: "none",
                        fontWeight: 600,
                        fontSize: "0.85rem",
                    }}
                >
                    View Product
                </Link>
            </div>

            {/* Rating Breakdown & Stats Card */}
            <div
                style={{
                    backgroundColor: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "20px",
                    padding: "28px",
                    marginBottom: "32px",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.03)",
                }}
            >
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "32px", alignItems: "center" }}>
                    {/* Left: Overall Score */}
                    <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "3.5rem", fontWeight: 900, color: "var(--text-primary)", lineHeight: 1 }}>
                            {stats.averageRating.toFixed(1)}
                        </div>
                        <div style={{ color: "#f59e0b", fontSize: "1.75rem", margin: "8px 0" }}>
                            {"★".repeat(Math.round(stats.averageRating))}{"☆".repeat(Math.max(0, 5 - Math.round(stats.averageRating)))}
                        </div>
                        <div style={{ color: "var(--text-secondary)", fontSize: "0.95rem", fontWeight: 500 }}>
                            Based on <strong>{stats.reviewCount}</strong> authentic customer reviews
                        </div>
                    </div>

                    {/* Right: Star Distribution Bars */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {[5, 4, 3, 2, 1].map((star) => {
                            const count = stats.ratingDistribution[star as keyof RatingDistribution] || 0;
                            const percentage = stats.reviewCount > 0 ? Math.round((count / stats.reviewCount) * 100) : 0;
                            const isSelected = ratingFilter === String(star);

                            return (
                                <button
                                    key={star}
                                    type="button"
                                    onClick={() => setRatingFilter(isSelected ? "ALL" : String(star))}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "10px",
                                        background: isSelected ? "var(--accent-light)" : "none",
                                        border: "none",
                                        padding: "4px 8px",
                                        borderRadius: "6px",
                                        cursor: "pointer",
                                        fontFamily: "inherit",
                                        textAlign: "left",
                                    }}
                                    title={`Filter by ${star} star reviews (${count} reviews)`}
                                >
                                    <span style={{ fontSize: "0.85rem", fontWeight: 600, width: "36px", color: isSelected ? "var(--accent)" : "var(--text-primary)" }}>
                                        {star} ★
                                    </span>
                                    <div style={{ flex: 1, height: "10px", backgroundColor: "var(--bg-secondary)", borderRadius: "999px", overflow: "hidden" }}>
                                        <div
                                            style={{
                                                width: `${percentage}%`,
                                                height: "100%",
                                                backgroundColor: isSelected ? "var(--accent)" : "#f59e0b",
                                                borderRadius: "999px",
                                                transition: "width 0.4s ease",
                                            }}
                                        />
                                    </div>
                                    <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", width: "40px", textAlign: "right" }}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Filter Pills & Sort Row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px", marginBottom: "24px" }}>
                {/* Rating Filter Pills */}
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                    <button
                        type="button"
                        onClick={() => setRatingFilter("ALL")}
                        style={{
                            padding: "6px 14px",
                            borderRadius: "999px",
                            border: `1px solid ${ratingFilter === "ALL" ? "var(--accent)" : "var(--border-color)"}`,
                            backgroundColor: ratingFilter === "ALL" ? "var(--accent-light)" : "var(--bg-primary)",
                            color: ratingFilter === "ALL" ? "var(--accent)" : "var(--text-primary)",
                            fontWeight: 600,
                            fontSize: "0.85rem",
                            cursor: "pointer",
                        }}
                    >
                        All ({stats.reviewCount})
                    </button>
                    {[5, 4, 3, 2, 1].map((s) => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => setRatingFilter(String(s))}
                            style={{
                                padding: "6px 14px",
                                borderRadius: "999px",
                                border: `1px solid ${ratingFilter === String(s) ? "var(--accent)" : "var(--border-color)"}`,
                                backgroundColor: ratingFilter === String(s) ? "var(--accent-light)" : "var(--bg-primary)",
                                color: ratingFilter === String(s) ? "var(--accent)" : "var(--text-primary)",
                                fontWeight: 600,
                                fontSize: "0.85rem",
                                cursor: "pointer",
                            }}
                        >
                            {s} ★ ({stats.ratingDistribution[s as keyof RatingDistribution] || 0})
                        </button>
                    ))}
                </div>

                {/* Sort Dropdown */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <label htmlFor="sort-select" style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                        Sort by:
                    </label>
                    <select
                        id="sort-select"
                        value={sortOption}
                        onChange={(e) => setSortOption(e.target.value)}
                        style={{
                            padding: "6px 12px",
                            borderRadius: "8px",
                            border: "1px solid var(--border-color)",
                            backgroundColor: "var(--bg-primary)",
                            color: "var(--text-primary)",
                            fontSize: "0.85rem",
                            fontFamily: "inherit",
                            cursor: "pointer",
                        }}
                    >
                        <option value="newest">Newest First</option>
                        <option value="oldest">Oldest First</option>
                        <option value="highest">Highest Rating</option>
                        <option value="lowest">Lowest Rating</option>
                    </select>
                </div>
            </div>

            {/* REVIEWS LIST */}
            {loading ? (
                <div style={{ padding: "64px 0", textAlign: "center", color: "var(--text-secondary)" }}>
                    Loading reviews...
                </div>
            ) : reviews.length === 0 ? (
                <div
                    style={{
                        padding: "56px 24px",
                        textAlign: "center",
                        backgroundColor: "var(--bg-secondary)",
                        borderRadius: "16px",
                        border: "1px dashed var(--border-color)",
                    }}
                >
                    <p style={{ color: "var(--text-secondary)", fontSize: "1rem", margin: "0 0 12px 0" }}>
                        {ratingFilter !== "ALL"
                            ? `No ${ratingFilter}-star reviews found.`
                            : "No reviews published for this product yet."}
                    </p>
                    {ratingFilter !== "ALL" && (
                        <button
                            type="button"
                            onClick={() => setRatingFilter("ALL")}
                            style={{
                                padding: "8px 16px",
                                borderRadius: "8px",
                                border: "1px solid var(--border-color)",
                                backgroundColor: "var(--bg-primary)",
                                color: "var(--text-primary)",
                                fontWeight: 600,
                                fontSize: "0.85rem",
                                cursor: "pointer",
                            }}
                        >
                            View All Reviews
                        </button>
                    )}
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                    {reviews.map((review) => (
                        <div
                            key={review.id}
                            style={{
                                backgroundColor: "var(--bg-primary)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "16px",
                                padding: "24px",
                                boxShadow: "0 1px 4px rgba(0,0,0,0.02)",
                            }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px", flexWrap: "wrap", gap: "10px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                    <div
                                        style={{
                                            width: "42px",
                                            height: "42px",
                                            borderRadius: "50%",
                                            backgroundColor: "var(--accent-light)",
                                            color: "var(--accent)",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            fontWeight: 800,
                                            fontSize: "1.1rem",
                                            flexShrink: 0,
                                        }}
                                    >
                                        {review.userName ? review.userName.charAt(0).toUpperCase() : "C"}
                                    </div>
                                    <div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                            <span style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text-primary)" }}>
                                                {review.userName}
                                            </span>
                                            {review.verifiedPurchase && (
                                                <span
                                                    style={{
                                                        fontSize: "0.72rem",
                                                        padding: "2px 8px",
                                                        backgroundColor: "rgba(34, 197, 94, 0.1)",
                                                        color: "#16a34a",
                                                        borderRadius: "4px",
                                                        fontWeight: 700,
                                                    }}
                                                >
                                                    ✓ Verified Buyer
                                                </span>
                                            )}
                                            {review.sourceType === "offline-customer-feedback" && (
                                                <span
                                                    style={{
                                                        fontSize: "0.72rem",
                                                        padding: "2px 8px",
                                                        backgroundColor: "rgba(0, 107, 60, 0.08)",
                                                        color: "var(--accent)",
                                                        borderRadius: "4px",
                                                        fontWeight: 700,
                                                    }}
                                                >
                                                    Verified Customer Feedback
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                                            {new Date(review.createdAt).toLocaleDateString("en-IN", {
                                                year: "numeric",
                                                month: "short",
                                                day: "numeric",
                                            })}
                                        </div>
                                    </div>
                                </div>

                                <div style={{ color: "#f59e0b", fontSize: "1.2rem" }}>
                                    {"★".repeat(review.rating)}{"☆".repeat(Math.max(0, 5 - review.rating))}
                                </div>
                            </div>

                            {review.title && (
                                <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 6px 0" }}>
                                    {review.title}
                                </h3>
                            )}

                            <p style={{ margin: 0, color: "var(--text-primary)", fontSize: "0.92rem", lineHeight: 1.6, wordBreak: "break-word" }}>
                                {review.comment}
                            </p>

                            {review.images && review.images.length > 0 && (
                                <div style={{ display: "flex", gap: "10px", marginTop: "16px", overflowX: "auto", paddingBottom: "4px" }}>
                                    {review.images.map((img, idx) => (
                                        <a
                                            key={idx}
                                            href={img}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{
                                                display: "block",
                                                width: "90px",
                                                height: "90px",
                                                borderRadius: "10px",
                                                overflow: "hidden",
                                                border: "1px solid var(--border-color)",
                                                flexShrink: 0,
                                            }}
                                        >
                                            <img src={img} alt="customer photo" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                        </a>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}

                    {/* LOAD MORE BUTTON */}
                    {hasMore && (
                        <div style={{ textAlign: "center", marginTop: "20px" }}>
                            <button
                                type="button"
                                onClick={handleLoadMore}
                                disabled={loadingMore}
                                style={{
                                    padding: "12px 32px",
                                    borderRadius: "12px",
                                    backgroundColor: "var(--bg-primary)",
                                    color: "var(--text-primary)",
                                    border: "1px solid var(--border-color)",
                                    fontWeight: 700,
                                    fontSize: "0.95rem",
                                    cursor: loadingMore ? "not-allowed" : "pointer",
                                    boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                                }}
                            >
                                {loadingMore ? "Loading more..." : `Load More Reviews (${reviews.length} of ${totalFiltered})`}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
