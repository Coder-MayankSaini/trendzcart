"use client";

import { useState, useEffect } from "react";
import { collection, query, where, orderBy, onSnapshot, getDocs, doc, setDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase/config";
import { useAuth } from "@/context/AuthContext";
import imageCompression from "browser-image-compression";
import AuthModal from "./AuthModal";

interface ProductReviewsProps {
    productId: string;
}

interface Review {
    id: string;
    productId: string;
    userId: string | null;
    userName: string;
    rating: number;
    comment: string;
    images: string[];
    createdAt: number;
    isFake: boolean;
}

export default function ProductReviews({ productId }: ProductReviewsProps) {
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

    // Fetch reviews
    useEffect(() => {
        const q = query(
            collection(db, "reviews"),
            where("productId", "==", productId)
        );
        const unsub = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Review[];
            data.sort((a, b) => b.createdAt - a.createdAt);
            setReviews(data);
            setLoading(false);
        }, (err) => {
            console.error("Failed to load reviews:", err);
            // Fallback in case of missing index
            setLoading(false);
        });

        return () => unsub();
    }, [productId]);

    // Check eligibility
    useEffect(() => {
        async function checkEligibility() {
            if (!user) {
                setIsEligible(false);
                return;
            }
            try {
                const q = query(collection(db, "orders"), where("userId", "==", user.uid), where("orderStatus", "==", "Delivered"));
                const snapshot = await getDocs(q);
                let eligible = false;

                for (const orderDoc of snapshot.docs) {
                    const orderData = orderDoc.data();
                    if (orderData.items && orderData.items.some((item: any) => item.id === productId || item.productId === productId)) {
                        eligible = true;
                        break;
                    }
                }
                setIsEligible(eligible);
            } catch (err) {
                console.error("Eligibility check failed:", err);
            }
        }

        checkEligibility();
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

        // Check if use already reviewed
        const alreadyReviewed = reviews.some(r => r.userId === user.uid);
        if (alreadyReviewed) {
            setError("You have already reviewed this product.");
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const uploadedUrls: string[] = [];
            for (const file of imageFiles) {
                const options = { maxSizeMB: 1, maxWidthOrHeight: 1200, useWebWorker: true };
                const compressedFile = await imageCompression(file, options);

                const storageRef = ref(storage, `reviews/${productId}/${user.uid}_${Date.now()}_${file.name}`);
                const uploadTask = await uploadBytesResumable(storageRef, compressedFile);
                const url = await getDownloadURL(uploadTask.ref);
                uploadedUrls.push(url);
            }

            const reviewId = crypto.randomUUID();
            const payload: Review = {
                id: reviewId,
                productId,
                userId: user.uid,
                userName: user.displayName || "Verified Buyer",
                rating,
                comment,
                images: uploadedUrls,
                createdAt: Date.now(),
                isFake: false
            };

            await setDoc(doc(db, "reviews", reviewId), payload);

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

    // Compute stats
    const averageRating = reviews.length > 0 ? (reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1) : "0.0";

    return (
        <div className="pr-container" style={{ marginTop: '48px', paddingTop: '32px', borderTop: '1px solid var(--border-color)' }}>
            <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                    <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: '8px' }}>Customer Reviews</h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ color: '#f59e0b', fontSize: '1.25rem' }}>{'★'.repeat(Math.round(Number(averageRating)))}{'☆'.repeat(5 - Math.round(Number(averageRating)))}</div>
                        <span style={{ fontWeight: 600, fontSize: '1.1rem' }}>{averageRating}</span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>({reviews.length} reviews)</span>
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

            {error && !showReviewForm && (
                <div style={{ padding: '12px 16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '12px', marginBottom: '24px', fontSize: '0.9rem' }}>
                    {error}
                </div>
            )}

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
                            placeholder="What did you like or dislike?"
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

            {loading ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading reviews...</div>
            ) : reviews.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', backgroundColor: 'var(--bg-secondary)', borderRadius: '16px', border: '1px dashed var(--border-color)' }}>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '12px' }}>No reviews yet.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {reviews.map(review => (
                        <div key={review.id} style={{ paddingBottom: '24px', borderBottom: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '1.1rem' }}>
                                        {review.userName.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 600 }}>{review.userName} {review.isFake && <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>(admin)</span>}
                                            {!review.isFake && <span style={{ marginLeft: '8px', fontSize: '0.7rem', padding: '2px 6px', background: 'rgba(34, 197, 94, 0.1)', color: '#16a34a', borderRadius: '4px', fontWeight: 700 }}>Verified</span>}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{new Date(review.createdAt).toLocaleDateString()}</div>
                                    </div>
                                </div>
                                <div style={{ color: '#f59e0b', fontSize: '1.1rem' }}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</div>
                            </div>

                            <p style={{ marginTop: '12px', color: 'var(--text-primary)', lineHeight: 1.6 }}>{review.comment}</p>

                            {review.images && review.images.length > 0 && (
                                <div style={{ display: 'flex', gap: '12px', marginTop: '16px', overflowX: 'auto', paddingBottom: '8px' }}>
                                    {review.images.map((img, idx) => (
                                        <a key={idx} href={img} target="_blank" rel="noopener noreferrer" style={{ display: 'block', width: '100px', height: '100px', flexShrink: 0, borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                                            <img src={img} alt="Review" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        </a>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
