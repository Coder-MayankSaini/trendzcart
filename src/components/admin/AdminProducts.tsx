"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase/config";
import imageCompression from "browser-image-compression";

interface Product {
    id: string;
    name: string;
    slug: string;
    description: string;
    price: number;
    images: string[];
    thumbnails?: string[];
    category: string;
    categories?: string[];
    tags: string[];
    inventory: number;
    isVisible: boolean;
    isCustomized: boolean;
    isFeatured: boolean;
    customizationType: "requires_name" | "requires_picture" | null;
    sizes?: string[]; // Array of sizes e.g. ["S", "M", "L", "XL"]
    createdAt: number;
}

interface CategoryOption {
    id: string;
    name: string;
}

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: '12px',
    border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)', fontSize: '0.9rem', fontFamily: 'inherit',
    outline: 'none', transition: 'border-color 0.2s ease',
};

const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '0.8rem', fontWeight: 600,
    color: 'var(--text-secondary)', marginBottom: '6px',
    textTransform: 'uppercase', letterSpacing: '0.04em',
};

export default function AdminProducts() {
    const [products, setProducts] = useState<Product[]>([]);
    const [categories, setCategories] = useState<CategoryOption[]>([]);
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState<Partial<Product>>({});
    const [imageFiles, setImageFiles] = useState<File[]>([]);
    const [heroIndex, setHeroIndex] = useState(0);
    const [newFilePreviews, setNewFilePreviews] = useState<string[]>([]);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isAddingNewCategory, setIsAddingNewCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState("");

    const [addingReviewForProduct, setAddingReviewForProduct] = useState<string | null>(null);
    const [fakeReviewForm, setFakeReviewForm] = useState({ userName: "", rating: 5, comment: "" });
    const [fakeReviewImages, setFakeReviewImages] = useState<File[]>([]);
    const [fakeReviewUploading, setFakeReviewUploading] = useState(false);

    useEffect(() => {
        try {
            const unsub = onSnapshot(collection(db, "products"), (snapshot) => {
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Product[];
                setProducts(data);
                setError(null);
            }, (err) => {
                console.error("AdminProducts: Firestore error", err);
                setError("Failed to load products. Check your Firestore Security Rules.");
            });
            return () => unsub();
        } catch (err: any) {
            setError(err.message);
        }
    }, []);

    // Fetch categories for the dropdown
    useEffect(() => {
        const unsub = onSnapshot(collection(db, "categories"), (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, name: (doc.data() as any).name })) as CategoryOption[];
            setCategories(data);
        });
        return () => unsub();
    }, []);

    const handleAddNew = () => {
        setFormData({
            id: crypto.randomUUID(), name: "", slug: "", description: "",
            price: 0, images: [], thumbnails: [], category: "", categories: [], tags: [],
            inventory: 10, isVisible: true, isCustomized: false,
            isFeatured: false,
            sizes: [],
            customizationType: null, createdAt: Date.now(),
        });
        setImageFiles([]);
        setNewFilePreviews([]);
        setHeroIndex(0);
        setIsAddingNewCategory(false);
        setNewCategoryName("");
        setIsEditing(true);
    };

    const handleEdit = (prod: Product) => {
        setFormData(prod);
        setImageFiles([]);
        setNewFilePreviews([]);
        setHeroIndex(0); // hero is always images[0]
        setIsAddingNewCategory(false);
        setNewCategoryName("");
        setIsEditing(true);
    };

    const handleDelete = async (id: string) => {
        if (confirm("Are you sure you want to delete this product?")) {
            try { await deleteDoc(doc(db, "products", id)); }
            catch (err) { console.error(err); alert("Failed to delete product."); }
        }
    };

    const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        setImageFiles(prev => [...prev, ...files]);
        // Generate previews for the new files
        const previews = files.map(f => URL.createObjectURL(f));
        setNewFilePreviews(prev => [...prev, ...previews]);
    };

    const removeExistingImage = (idx: number) => {
        const updated = [...(formData.images || [])];
        updated.splice(idx, 1);

        const upThumb = formData.thumbnails ? [...formData.thumbnails] : undefined;
        if (upThumb && upThumb.length > idx) {
            upThumb.splice(idx, 1);
        }

        setFormData({ ...formData, images: updated, thumbnails: upThumb });
        // Adjust hero index if needed
        const totalExisting = updated.length;
        if (heroIndex >= totalExisting + newFilePreviews.length) {
            setHeroIndex(0);
        }
    };

    const removeNewFile = (idx: number) => {
        const updatedFiles = [...imageFiles];
        const updatedPreviews = [...newFilePreviews];
        updatedFiles.splice(idx, 1);
        URL.revokeObjectURL(updatedPreviews[idx]);
        updatedPreviews.splice(idx, 1);
        setImageFiles(updatedFiles);
        setNewFilePreviews(updatedPreviews);
        // Adjust hero index
        const existingCount = (formData.images || []).length;
        const total = existingCount + updatedPreviews.length;
        if (heroIndex >= total) setHeroIndex(0);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setUploading(true);
        try {
            // Upload all new files
            const newUrls: string[] = [];
            const newThumbUrls: string[] = [];
            for (const file of imageFiles) {
                // Compress full image
                const optionsFull = { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true };
                const compressedFile = await imageCompression(file, optionsFull);

                // Compress thumbnail
                const optionsThumb = { maxSizeMB: 0.1, maxWidthOrHeight: 600, useWebWorker: true };
                const thumbFile = await imageCompression(file, optionsThumb);

                // Upload high quality
                const storageRef = ref(storage, `products/${formData.id}/${Date.now()}_${file.name}`);
                const uploadTask = await uploadBytesResumable(storageRef, compressedFile);
                const url = await getDownloadURL(uploadTask.ref);
                newUrls.push(url);

                // Upload thumbnail
                const thumbRef = ref(storage, `products/${formData.id}/thumb_${Date.now()}_${file.name}`);
                const thumbTask = await uploadBytesResumable(thumbRef, thumbFile);
                const thumbUrl = await getDownloadURL(thumbTask.ref);
                newThumbUrls.push(thumbUrl);
            }

            // Combine existing images + newly uploaded
            const allImages = [...(formData.images || []), ...newUrls];
            const allThumbnails = [...(formData.thumbnails || []), ...newThumbUrls];

            // Reorder: move hero image to index 0
            if (heroIndex > 0 && heroIndex < allImages.length) {
                const [hero] = allImages.splice(heroIndex, 1);
                allImages.unshift(hero);
            }
            if (heroIndex > 0 && heroIndex < allThumbnails.length) {
                const [heroThumb] = allThumbnails.splice(heroIndex, 1);
                allThumbnails.unshift(heroThumb);
            }

            let finalCategory = formData.category || "";
            let finalCategories = formData.categories ? [...formData.categories] : [];

            // Re-sync single category into categories array if it exists but wasn't in the array
            if (finalCategory && !finalCategories.includes(finalCategory)) {
                finalCategories.push(finalCategory);
            }

            if (isAddingNewCategory && newCategoryName.trim()) {
                finalCategory = newCategoryName.trim();
                if (!finalCategories.includes(finalCategory)) {
                    finalCategories.push(finalCategory);
                }
                const newCatRef = doc(collection(db, "categories"));
                await setDoc(newCatRef, {
                    name: finalCategory,
                    createdAt: Date.now()
                });
            } else if (finalCategories.length > 0 && !finalCategory) {
                finalCategory = finalCategories[0];
            }

            const payload = {
                ...formData,
                images: allImages,
                thumbnails: allThumbnails,
                category: finalCategory,
                categories: finalCategories,
                slug: formData.slug || formData.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, ''),
                updatedAt: Date.now(),
            };
            if (!payload.id) return;
            await setDoc(doc(db, "products", payload.id), payload, { merge: true });
            setIsEditing(false);
            setImageFiles([]);
            setNewFilePreviews([]);
            setHeroIndex(0);
        } catch (err) {
            console.error(err);
            alert("Failed to save product.");
        } finally {
            setUploading(false);
        }
    };

    // Get all preview items for display (existing URLs + new file previews)
    const getAllPreviews = () => {
        const existing = (formData.images || []).map((url, i) => ({
            src: url, isExisting: true, index: i
        }));
        const newPrev = newFilePreviews.map((url, i) => ({
            src: url, isExisting: false, index: i
        }));
        return [...existing, ...newPrev];
    };

    const handleFakeReviewSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!addingReviewForProduct) return;
        setFakeReviewUploading(true);
        try {
            const uploadedUrls: string[] = [];
            for (const file of fakeReviewImages) {
                const options = { maxSizeMB: 1, maxWidthOrHeight: 1200, useWebWorker: true };
                const compressedFile = await imageCompression(file, options);
                const storageRef = ref(storage, `reviews/${addingReviewForProduct}/fake_${Date.now()}_${file.name}`);
                const uploadTask = await uploadBytesResumable(storageRef, compressedFile);
                const url = await getDownloadURL(uploadTask.ref);
                uploadedUrls.push(url);
            }
            const reviewId = crypto.randomUUID();
            await setDoc(doc(db, "reviews", reviewId), {
                id: reviewId,
                productId: addingReviewForProduct,
                userId: null,
                userName: fakeReviewForm.userName || "Verified Buyer",
                rating: fakeReviewForm.rating,
                comment: fakeReviewForm.comment,
                images: uploadedUrls,
                createdAt: Date.now(),
                isFake: true
            });
            setAddingReviewForProduct(null);
            setFakeReviewForm({ userName: "", rating: 5, comment: "" });
            setFakeReviewImages([]);
            alert("Fake review added successfully!");
        } catch (err) {
            console.error(err);
            alert("Failed to add fake review.");
        } finally {
            setFakeReviewUploading(false);
        }
    };

    // ====================== EDIT / ADD FORM ======================
    if (isEditing) {
        const previews = getAllPreviews();

        return (
            <div className="animate-fade-in" style={{ maxWidth: '720px' }}>
                <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '32px' }}>
                    {formData.name ? 'Edit Product' : 'Add New Product'}
                </h2>
                <form onSubmit={handleSave} style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: '24px', border: '1px solid var(--border-color)', padding: '32px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div>
                        <label style={labelStyle}>Product Name</label>
                        <input type="text" required style={inputStyle} value={formData.name || ""} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                    </div>
                    <div>
                        <label style={labelStyle}>Slug (URL endpoint)</label>
                        <input type="text" style={{ ...inputStyle, color: 'var(--text-secondary)' }} value={formData.slug || ""} onChange={e => setFormData({ ...formData, slug: e.target.value })} placeholder="auto-generated-from-name" />
                    </div>
                    <div>
                        <label style={labelStyle}>Description</label>
                        <textarea rows={4} style={{ ...inputStyle, resize: 'vertical' }} value={formData.description || ""} onChange={e => setFormData({ ...formData, description: e.target.value })} />
                    </div>
                    <div>
                        <label style={labelStyle}>Sizes (Comma separated e.g. S, M, L, XL)</label>
                        <input type="text" style={inputStyle} value={(formData.sizes || []).join(", ")} onChange={e => {
                            const val = e.target.value;
                            const newSizes = val.split(",").map(s => s.trim()).filter(s => s !== "");
                            setFormData({ ...formData, sizes: newSizes });
                        }} placeholder="S, M, L, XL" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={labelStyle}>Price (₹)</label>
                            <input type="number" required style={inputStyle} value={formData.price || 0} onChange={e => setFormData({ ...formData, price: Number(e.target.value) })} />
                        </div>
                        <div>
                            <label style={labelStyle}>Inventory Count</label>
                            <input type="number" required style={inputStyle} value={formData.inventory || 0} onChange={e => setFormData({ ...formData, inventory: Number(e.target.value) })} />
                        </div>
                    </div>
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <label style={{ ...labelStyle, marginBottom: 0 }}>Category</label>
                            <button
                                type="button"
                                onClick={() => setIsAddingNewCategory(!isAddingNewCategory)}
                                style={{ fontSize: '0.75rem', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                            >
                                {isAddingNewCategory ? "Select Existing" : "+ New Category"}
                            </button>
                        </div>
                        {isAddingNewCategory ? (
                            <input
                                type="text"
                                style={inputStyle}
                                value={newCategoryName}
                                onChange={e => setNewCategoryName(e.target.value)}
                                placeholder="Enter new category name..."
                                required={isAddingNewCategory}
                            />
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px', padding: '12px', border: '1px solid var(--border-color)', borderRadius: '12px', backgroundColor: 'var(--bg-primary)' }}>
                                {categories.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>No categories found</span>}
                                {categories.map(cat => (
                                    <label key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                        <input
                                            type="checkbox"
                                            checked={(formData.categories || []).includes(cat.name) || formData.category === cat.name}
                                            onChange={(e) => {
                                                const current = new Set([...(formData.categories || [])]);
                                                if (formData.category) current.add(formData.category);

                                                if (e.target.checked) {
                                                    current.add(cat.name);
                                                    setFormData({ ...formData, categories: Array.from(current), category: formData.category || cat.name });
                                                } else {
                                                    current.delete(cat.name);
                                                    const newArr = Array.from(current);
                                                    setFormData({ ...formData, categories: newArr, category: newArr.length > 0 ? newArr[0] : "" });
                                                }
                                            }}
                                            style={{ accentColor: 'var(--accent)' }}
                                        />
                                        {cat.name}
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                    <div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-primary)', marginTop: '8px' }}>
                            <input type="checkbox" checked={formData.isFeatured || false} onChange={e => setFormData({ ...formData, isFeatured: e.target.checked })} style={{ width: '18px', height: '18px', accentColor: 'var(--accent)' }} />
                            Feature on Home Page ("Most Popular Picks")
                        </label>
                    </div>

                    {/* ===== MULTI-IMAGE UPLOAD SECTION ===== */}
                    <div>
                        <label style={labelStyle}>Product Images</label>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                            Upload multiple images. Click &quot;Set as Hero&quot; to choose the main thumbnail image.
                        </p>

                        {/* Image previews grid */}
                        {previews.length > 0 && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                                {previews.map((item, globalIdx) => (
                                    <div key={globalIdx} style={{
                                        position: 'relative',
                                        borderRadius: '12px',
                                        overflow: 'hidden',
                                        border: heroIndex === globalIdx ? '3px solid var(--accent)' : '1px solid var(--border-color)',
                                        aspectRatio: '1',
                                        background: 'var(--bg-primary)',
                                    }}>
                                        <img
                                            src={item.src}
                                            alt={`Product image ${globalIdx + 1}`}
                                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                        />
                                        {/* Hero badge */}
                                        {heroIndex === globalIdx && (
                                            <span style={{
                                                position: 'absolute', top: '6px', left: '6px',
                                                padding: '2px 8px', borderRadius: '6px',
                                                backgroundColor: 'var(--accent)', color: '#fff',
                                                fontSize: '0.65rem', fontWeight: 700,
                                                letterSpacing: '0.04em', textTransform: 'uppercase',
                                            }}>
                                                Hero
                                            </span>
                                        )}
                                        {/* Actions overlay */}
                                        <div style={{
                                            position: 'absolute', bottom: 0, left: 0, right: 0,
                                            display: 'flex', gap: '4px', padding: '6px',
                                            background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                                        }}>
                                            {heroIndex !== globalIdx && (
                                                <button
                                                    type="button"
                                                    onClick={() => setHeroIndex(globalIdx)}
                                                    style={{
                                                        flex: 1, padding: '4px 6px', borderRadius: '6px',
                                                        backgroundColor: 'rgba(255,255,255,0.9)', color: '#0f172a',
                                                        fontSize: '0.65rem', fontWeight: 700, border: 'none',
                                                        cursor: 'pointer', fontFamily: 'inherit',
                                                    }}
                                                >
                                                    Set Hero
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => item.isExisting ? removeExistingImage(item.index) : removeNewFile(item.index)}
                                                style={{
                                                    padding: '4px 8px', borderRadius: '6px',
                                                    backgroundColor: 'rgba(239,68,68,0.9)', color: '#fff',
                                                    fontSize: '0.65rem', fontWeight: 700, border: 'none',
                                                    cursor: 'pointer', fontFamily: 'inherit',
                                                }}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* File input for adding more images */}
                        <label style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            padding: '24px', borderRadius: '12px',
                            border: '2px dashed var(--border-color)',
                            backgroundColor: 'var(--bg-primary)',
                            cursor: 'pointer', transition: 'border-color 0.2s ease',
                            color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 500,
                            gap: '8px',
                        }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                            {previews.length === 0 ? 'Click to upload product images' : 'Add more images'}
                            <input
                                type="file"
                                accept="image/*"
                                multiple
                                style={{ display: 'none' }}
                                onChange={handleFilesSelected}
                            />
                        </label>
                    </div>

                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                        <p style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>Advanced Options</p>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--text-primary)', fontWeight: 500, cursor: 'pointer' }}>
                            <input type="checkbox" checked={formData.isVisible || false} onChange={e => setFormData({ ...formData, isVisible: e.target.checked })} />
                            Visible on Storefront
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: 'var(--text-primary)', fontWeight: 500, cursor: 'pointer' }}>
                            <input type="checkbox" checked={formData.isCustomized || false} onChange={e => setFormData({ ...formData, isCustomized: e.target.checked })} />
                            Customizable Product?
                        </label>
                        {formData.isCustomized && (
                            <div style={{ marginLeft: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                                    <input type="radio" name="customType" checked={formData.customizationType === "requires_name"} onChange={() => setFormData({ ...formData, customizationType: "requires_name" })} />
                                    Requires Text/Name
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                                    <input type="radio" name="customType" checked={formData.customizationType === "requires_picture"} onChange={() => setFormData({ ...formData, customizationType: "requires_picture" })} />
                                    Requires Picture Upload
                                </label>
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', paddingTop: '16px' }}>
                        <button type="button" onClick={() => { setIsEditing(false); setImageFiles([]); setNewFilePreviews([]); }} style={{ padding: '12px 24px', borderRadius: '14px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                            Cancel
                        </button>
                        <button type="submit" disabled={uploading} style={{ padding: '12px 24px', borderRadius: '14px', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: 'none', opacity: uploading ? 0.6 : 1 }}>
                            {uploading ? "Uploading..." : "Save Product"}
                        </button>
                    </div>
                </form>
            </div>
        );
    }

    // ====================== PRODUCT LIST ======================
    return (
        <div className="animate-fade-in" style={{ position: 'relative' }}>
            {addingReviewForProduct && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ backgroundColor: 'var(--bg-primary)', padding: '24px', borderRadius: '16px', width: '90%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto' }}>
                        <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '16px' }}>Add Fake Review</h3>
                        <form onSubmit={handleFakeReviewSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={labelStyle}>Reviewer Name</label>
                                <input type="text" style={inputStyle} value={fakeReviewForm.userName} onChange={e => setFakeReviewForm({ ...fakeReviewForm, userName: e.target.value })} placeholder="e.g. John Doe" />
                            </div>
                            <div>
                                <label style={labelStyle}>Rating (1-5)</label>
                                <input type="number" min="1" max="5" style={inputStyle} value={fakeReviewForm.rating} onChange={e => setFakeReviewForm({ ...fakeReviewForm, rating: Number(e.target.value) })} />
                            </div>
                            <div>
                                <label style={labelStyle}>Comment</label>
                                <textarea style={{ ...inputStyle, resize: 'vertical' }} rows={3} value={fakeReviewForm.comment} onChange={e => setFakeReviewForm({ ...fakeReviewForm, comment: e.target.value })}></textarea>
                            </div>
                            <div>
                                <label style={labelStyle}>Images (Optional)</label>
                                <input type="file" multiple accept="image/*" onChange={e => setFakeReviewImages(Array.from(e.target.files || []))} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                                <button type="button" onClick={() => setAddingReviewForProduct(null)} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', cursor: 'pointer' }}>Cancel</button>
                                <button type="submit" disabled={fakeReviewUploading} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'var(--text-primary)', color: 'var(--bg-primary)', fontWeight: 600, cursor: 'pointer' }}>
                                    {fakeReviewUploading ? 'Uploading...' : 'Submit'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <h1 style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Products</h1>
                <button onClick={handleAddNew} style={{ padding: '12px 24px', borderRadius: '999px', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: 'none', transition: 'all 0.2s ease' }}>
                    + Add Product
                </button>
            </div>

            {error && (
                <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '16px 20px', borderRadius: '12px', marginBottom: '24px', fontSize: '0.9rem', fontWeight: 500, border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                    {error}
                </div>
            )}

            <div style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: '24px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            <tr>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Image</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Name</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Price</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Stock</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Images</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Status</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody style={{ fontSize: '0.9rem' }}>
                            {products.length === 0 && (
                                <tr>
                                    <td colSpan={7} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                        No products found. Add one to get started.
                                    </td>
                                </tr>
                            )}
                            {products.map(product => (
                                <tr key={product.id} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background-color 0.2s ease' }} onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-primary)'} onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                                    <td style={{ padding: '16px 24px' }}>
                                        <div style={{ width: '48px', height: '48px', backgroundColor: 'var(--bg-primary)', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                                            {product.images?.[0] ? <img src={product.images[0]} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                                        </div>
                                    </td>
                                    <td style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                        {product.name}
                                        {product.isCustomized && <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700, backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)' }}>Custom</span>}
                                    </td>
                                    <td style={{ padding: '16px 24px', color: 'var(--text-primary)' }}>₹{product.price}</td>
                                    <td style={{ padding: '16px 24px', color: 'var(--text-primary)' }}>{product.inventory}</td>
                                    <td style={{ padding: '16px 24px', color: 'var(--text-secondary)' }}>{product.images?.length || 0}</td>
                                    <td style={{ padding: '16px 24px' }}>
                                        <span style={{ padding: '4px 12px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, backgroundColor: product.isVisible ? 'rgba(34, 197, 94, 0.1)' : 'var(--border-color)', color: product.isVisible ? '#16a34a' : 'var(--text-secondary)' }}>
                                            {product.isVisible ? 'Visible' : 'Hidden'}
                                        </span>
                                    </td>
                                    <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                                        <button onClick={() => setAddingReviewForProduct(product.id)} style={{ color: '#10b981', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', marginRight: '16px', fontFamily: 'inherit' }}>+ Review</button>
                                        <button onClick={() => handleEdit(product)} style={{ color: 'var(--accent)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', marginRight: '16px', fontFamily: 'inherit' }}>Edit</button>
                                        <button onClick={() => handleDelete(product.id)} style={{ color: '#ef4444', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Delete</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
