"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { useAuth } from "@/context/AuthContext";
import imageCompression from "browser-image-compression";
import AuthModal from "./AuthModal";

interface ProductReviewsProps {
    productId: string;
    productSlug?: string;
}

interface Review {
    id: string;
    productId: string;
    userId: string | null;
    userName: string;
    rating: number;
    title?: string | null;
    comment: string;
    images?: string[];
    createdAt: number;
    isFake?: boolean;
    verifiedPurchase?: boolean;
    publicationStatus?: string;
    sourceType?: string;
    editorialNote?: boolean;
}

export default function ProductReviews({ productId, productSlug }: ProductReviewsProps) {
    const { user } = useAuth();
    const [reviews, setReviews] = useState<Review[]>([]);
    const [loading, setLoading] = useState(true);
    const [isEligible, setIsEligible] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [showReviewForm, setShowReviewForm] = useState(false);

    // Form state
    const [rating, setRating] = useState(5);
    const [comment, setComment] = useState("");
    const [imageFiles, setImageFiles] = useState<File[]>([]);
    const [filePreviews, setFilePreviews] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch reviews in real-time
    useEffect(() => {
        const q = query(
            collection(db, "reviews"),
            where("productId", "==", productId)
        );
        const unsub = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Review[];
            data.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            setReviews(data);
            setLoading(false);
        }, (err) => {
            console.error("Failed to load reviews:", err);
            setLoading(false);
        });

        return () => unsub();
    }, [productId]);

    // Check review submission eligibility via server route
    useEffect(() => {
        let isMounted = true;
        async function checkEligibility() {
            if (!user) {
                setIsEligible(false);
                return;
            }
            try {
                const idToken = await user.getIdToken();
                const res = await fetch(`/api/reviews/eligibility?productId=${encodeURIComponent(productId)}`, {
                    headers: {
                        Authorization: `Bearer ${idToken}`,
                    },
                });
                if (res.ok) {
                    const data = await res.json();
                    if (isMounted) setIsEligible(Boolean(data.eligible));
                } else {
                    if (isMounted) setIsEligible(false);
                }
            } catch (err) {
                console.error("Eligibility check failed:", err);
                if (isMounted) setIsEligible(false);
            }
        }

        checkEligibility();
        return () => { isMounted = false; };
    }, [user, productId]);

    const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        setImageFiles(prev => [...prev, ...files]);
        const previews = files.map(f => URL.createObjectURL(f));
        setFilePreviews(prev => [...prev, ...previews]);
    };

    const removeFile = (idx: number) => {
        const newFiles = [...imageFiles];
        const newPreviews = [...filePreviews];
        newFiles.splice(idx, 1);
        URL.revokeObjectURL(newPreviews[idx]);
        newPreviews.splice(idx, 1);
        setImageFiles(newFiles);
        setFilePreviews(newPreviews);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        // Check if user already reviewed
        const alreadyReviewed = reviews.some(r => r.userId === user.uid);
        if (alreadyReviewed) {
            setError("You have already reviewed this product.");
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const idToken = await user.getIdToken();
            const uploadedUrls: string[] = [];
            for (const file of imageFiles) {
                const options = { maxSizeMB: 1, maxWidthOrHeight: 1200, useWebWorker: true };
                const compressedFile = await imageCompression(file, options);

                const authRes = await fetch("/api/uploads/authorize", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${idToken}`,
                    },
                    body: JSON.stringify({
                        folder: "reviews",
                        subId: productId,
                        contentType: compressedFile.type || "image/jpeg",
                        sizeBytes: compressedFile.size,
                        originalName: file.name,
                    }),
                });

                if (!authRes.ok) {
                    const err = await authRes.json().catch(() => ({}));
                    throw new Error(err.error || "Failed to authorize review image upload");
                }

                const { uploadUrl, key, sessionId, publicUrl } = await authRes.json();
                await fetch(uploadUrl, {
                    method: "PUT",
                    headers: { "Content-Type": compressedFile.type || "image/jpeg" },
                    body: compressedFile,
                });

                await fetch("/api/uploads/complete", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${idToken}`,
                    },
                    body: JSON.stringify({ sessionId, key }),
                });

                uploadedUrls.push(publicUrl || `/api/media/public?key=${encodeURIComponent(key)}`);
            }

            const res = await fetch("/api/reviews/submit", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                    productId,
                    rating,
                    comment,
                    images: uploadedUrls,
                    userName: user.displayName || "Verified Buyer",
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to submit review.");
            }

            setShowReviewForm(false);
            setRating(5);
            setComment("");
            setImageFiles([]);
            setFilePreviews([]);
        } catch (err: any) {
            console.error(err);
            setError(err.message || "Failed to submit review.");
        } finally {
            setSubmitting(false);
        }
    };

    // Filter strictly for published genuine customer reviews
    const publishedReviews = useMemo(() => {
        return reviews.filter(r => {
            if (r.editorialNote === true) return false;
            if (r.sourceType === "simulated-test") return false;
            if (r.isFake === true && r.publicationStatus !== "published") return false;
            return r.publicationStatus === "published" || (!r.publicationStatus && r.isFake !== true);
        });
    }, [reviews]);

    // Calculate rating stats
    const stats = useMemo(() => {
        const count = publishedReviews.length;
        const sum = publishedReviews.reduce((acc, r) => acc + (r.rating || 0), 0);
        const avg = count > 0 ? (sum / count).toFixed(1) : "0.0";

        const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        for (const r of publishedReviews) {
            const s = Math.round(r.rating);
            if (s >= 1 && s <= 5) dist[s]++;
        }
        return { count, avg, dist };
    }, [publishedReviews]);

    // Selection of recent 4 reviews
    const displayedReviews = publishedReviews.slice(0, 4);

    return (
        <div className="pr-container" style={{ marginTop: '48px', paddingTop: '32px', borderTop: '1px solid var(--border-color)' }}>
            <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />

            {/* Top Review Summary Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px', flexWrap: 'wrap', gap: '20px' }}>
                <div>
                    <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: '0 0 8px 0' }}>
                        Customer Reviews
                    </h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <div style={{ color: '#f59e0b', fontSize: '1.25rem', letterSpacing: '1px' }}>
                            {'★'.repeat(Math.round(Number(stats.avg)))}{'☆'.repeat(Math.max(0, 5 - Math.round(Number(stats.avg))))}
                        </div>
                        <span style={{ fontWeight: 800, fontSize: '1.2rem', color: 'var(--text-primary)' }}>{stats.avg} / 5</span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            Based on <strong>{stats.count}</strong> customer {stats.count === 1 ? 'review' : 'reviews'}
                        </span>
                    </div>
                </div>

                {!showReviewForm && (
                    <button
                        onClick={() => {
                            if (!user) setIsAuthModalOpen(true);
                            else if (!isEligible) setError("You must purchase and receive this product before reviewing.");
                            else { setShowReviewForm(true); setError(null); }
                        }}
                        style={{
                            padding: '12px 24px', borderRadius: '12px',
                            backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)',
                            fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit'
                        }}
                    >
                        Write a Review
                    </button>
                )}
            </div>

            {/* Rating Breakdown Bar Chart (When Reviews Exist) */}
            {stats.count > 0 && (
                <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '20px 24px', borderRadius: '16px', border: '1px solid var(--border-color)', marginBottom: '32px', maxWidth: '480px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {[5, 4, 3, 2, 1].map(star => {
                            const count = stats.dist[star] || 0;
                            const percentage = stats.count > 0 ? Math.round((count / stats.count) * 100) : 0;
                            return (
                                <div key={star} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem' }}>
                                    <span style={{ width: '28px', fontWeight: 600, color: 'var(--text-primary)' }}>{star} ★</span>
                                    <div style={{ flex: 1, height: '8px', backgroundColor: 'var(--border-color)', borderRadius: '999px', overflow: 'hidden' }}>
                                        <div style={{ width: `${percentage}%`, height: '100%', backgroundColor: '#f59e0b', borderRadius: '999px' }} />
                                    </div>
                                    <span style={{ width: '32px', textAlign: 'right', color: 'var(--text-secondary)' }}>{count}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {error && !showReviewForm && (
                <div style={{ padding: '12px 16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '12px', marginBottom: '24px', fontSize: '0.9rem' }}>
                    {error}
                </div>
            )}

            {/* Review Submission Form (For Eligible Verified Buyers) */}
            {showReviewForm && (
                <form onSubmit={handleSubmit} style={{ backgroundColor: 'var(--bg-secondary)', padding: '24px', borderRadius: '16px', border: '1px solid var(--border-color)', marginBottom: '32px' }}>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '20px' }}>Write your review</h3>

                    {error && <div style={{ color: '#ef4444', marginBottom: '16px', fontSize: '0.9rem' }}>{error}</div>}

                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px' }}>Rating</label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            {[1, 2, 3, 4, 5].map(star => (
                                <button
                                    key={star}
                                    type="button"
                                    onClick={() => setRating(star)}
                                    style={{ background: 'none', border: 'none', fontSize: '1.75rem', cursor: 'pointer', color: rating >= star ? '#f59e0b' : 'var(--border-color)' }}
                                >
                                    ★
                                </button>
                            ))}
                        </div>
                    </div>

                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px' }}>Review</label>
                        <textarea
                            required
                            rows={4}
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder="What did you like or dislike about the product, fit, or materials?"
                            style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit', resize: 'vertical' }}
                        />
                    </div>

                    <div style={{ marginBottom: '24px' }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px' }}>Photos (optional)</label>
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                            {filePreviews.map((src, i) => (
                                <div key={i} style={{ position: 'relative', width: '80px', height: '80px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                                    <img src={src} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    <button type="button" onClick={() => removeFile(i)} style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '4px', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '12px' }}>×</button>
                                </div>
                            ))}
                            <label style={{ width: '80px', height: '80px', borderRadius: '8px', border: '2px dashed var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                                <span style={{ fontSize: '1.5rem' }}>+</span>
                                <input type="file" accept="image/*" multiple onChange={handleFilesSelected} style={{ display: 'none' }} />
                            </label>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                        <button
                            type="button"
                            onClick={() => setShowReviewForm(false)}
                            style={{ padding: '10px 20px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'transparent', fontWeight: 600, cursor: 'pointer' }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            style={{ padding: '10px 20px', borderRadius: '10px', border: 'none', background: 'var(--text-primary)', color: 'var(--bg-primary)', fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}
                        >
                            {submitting ? 'Submitting...' : 'Submit Review'}
                        </button>
                    </div>
                </form>
            )}

            {/* CURATED REVIEWS LIST */}
            {loading ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading reviews...</div>
            ) : stats.count === 0 ? (
                <div style={{ padding: '48px 24px', textAlign: 'center', backgroundColor: 'var(--bg-secondary)', borderRadius: '16px', border: '1px dashed var(--border-color)' }}>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '8px', fontSize: '1rem', fontWeight: 500 }}>
                        No customer reviews yet.
                    </p>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>
                        Be the first verified customer to share feedback on this product!
                    </p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {displayedReviews.map(review => (
                        <div key={review.id} style={{ paddingBottom: '20px', borderBottom: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--accent-light)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '1.05rem', flexShrink: 0 }}>
                                        {review.userName ? review.userName.charAt(0).toUpperCase() : "C"}
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                            {review.userName}
                                            {review.verifiedPurchase && (
                                                <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: 'rgba(34, 197, 94, 0.1)', color: '#16a34a', borderRadius: '4px', fontWeight: 700 }}>
                                                    ✓ Verified Buyer
                                                </span>
                                            )}
                                            {review.sourceType === "offline-customer-feedback" && (
                                                <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: 'rgba(0, 107, 60, 0.08)', color: 'var(--accent)', borderRadius: '4px', fontWeight: 700 }}>
                                                    Verified Feedback
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                            {new Date(review.createdAt).toLocaleDateString("en-IN", {
                                                year: "numeric",
                                                month: "short",
                                                day: "numeric",
                                            })}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ color: '#f59e0b', fontSize: '1.1rem' }}>
                                    {'★'.repeat(review.rating)}{'☆'.repeat(Math.max(0, 5 - review.rating))}
                                </div>
                            </div>

                            {review.title && (
                                <h4 style={{ margin: '8px 0 4px 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                    {review.title}
                                </h4>
                            )}

                            <p style={{ marginTop: '6px', color: 'var(--text-primary)', lineHeight: 1.6, fontSize: '0.9rem' }}>
                                {review.comment}
                            </p>

                            {review.images && review.images.length > 0 && (
                                <div style={{ display: 'flex', gap: '12px', marginTop: '14px', overflowX: 'auto', paddingBottom: '4px' }}>
                                    {review.images.map((img, idx) => (
                                        <a key={idx} href={img} target="_blank" rel="noopener noreferrer" style={{ display: 'block', width: '80px', height: '80px', flexShrink: 0, borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                                            <img src={img} alt="Review attachment" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        </a>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}

                    {/* VIEW ALL REVIEWS LINK */}
                    {stats.count > 0 && (
                        <div style={{ textAlign: 'center', marginTop: '16px' }}>
                            <Link
                                href={`/products/${productSlug || productId}/reviews`}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '12px 28px',
                                    borderRadius: '12px',
                                    backgroundColor: 'var(--accent)',
                                    color: 'white',
                                    fontWeight: 700,
                                    fontSize: '0.95rem',
                                    textDecoration: 'none',
                                    boxShadow: '0 2px 8px rgba(0, 107, 60, 0.15)',
                                    transition: 'opacity 0.2s ease',
                                }}
                            >
                                View All {stats.count} Reviews &rarr;
                            </Link>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
