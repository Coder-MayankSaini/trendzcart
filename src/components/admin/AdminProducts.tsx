"use client";

import { useEffect, useState, useMemo } from "react";
import Image from "next/image";
import { collection, onSnapshot, doc, setDoc, deleteDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";
import imageCompression from "browser-image-compression";
import AdminPageHeader from "./ui/AdminPageHeader";
import AdminBadge from "./ui/AdminBadge";

async function uploadFileToR2(file: File, folder: string, subId?: string): Promise<string> {
    const user = auth.currentUser;
    const idToken = user ? await user.getIdToken() : "";
    const authRes = await fetch("/api/uploads/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
            folder,
            subId,
            contentType: file.type || "image/jpeg",
            sizeBytes: file.size,
            originalName: file.name,
        }),
    });
    if (!authRes.ok) {
        const err = await authRes.json().catch(() => ({}));
        throw new Error(err.error || "Failed to authorize upload");
    }
    const { uploadUrl, key, sessionId, publicUrl, headers: presignedHeaders } = await authRes.json();
    await fetch(uploadUrl, {
        method: "PUT",
        headers: (presignedHeaders && typeof presignedHeaders === "object") ? presignedHeaders : { "Content-Type": file.type || "image/jpeg" },
        body: file,
    });
    await fetch("/api/uploads/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ sessionId, key }),
    });
    return publicUrl || `/api/media/public/${key}`;
}

export interface GalleryItem {
    id: string;
    src: string;
    file?: File;
    isExisting: boolean;
    existingThumb?: string;
}

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
    sizes?: string[];
    createdAt: number;
}

interface CategoryOption {
    id: string;
    name: string;
}

export default function AdminProducts() {
    const [products, setProducts] = useState<Product[]>([]);
    const [categories, setCategories] = useState<CategoryOption[]>([]);
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState<Partial<Product>>({});
    const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
    const [featuredImageId, setFeaturedImageId] = useState<string>("");
    const [uploadProgress, setUploadProgress] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isAddingNewCategory, setIsAddingNewCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState("");

    // Search and filter states
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("ALL");
    const [selectedVisibility, setSelectedVisibility] = useState<"ALL" | "VISIBLE" | "HIDDEN">("ALL");

    // Fake review states
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

    useEffect(() => {
        const unsub = onSnapshot(collection(db, "categories"), (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, name: (doc.data() as any).name })) as CategoryOption[];
            setCategories(data);
        });
        return () => unsub();
    }, []);

    // Filtered products list
    const filteredProducts = useMemo(() => {
        return products.filter((p) => {
            const matchesSearch = !searchQuery.trim() ||
                p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                p.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (p.categories || []).some(c => c.toLowerCase().includes(searchQuery.toLowerCase()));

            const matchesCategory = selectedCategory === "ALL" ||
                p.category === selectedCategory ||
                (p.categories || []).includes(selectedCategory);

            const matchesVisibility = selectedVisibility === "ALL" ||
                (selectedVisibility === "VISIBLE" && p.isVisible) ||
                (selectedVisibility === "HIDDEN" && !p.isVisible);

            return matchesSearch && matchesCategory && matchesVisibility;
        });
    }, [products, searchQuery, selectedCategory, selectedVisibility]);

    const cleanupGalleryBlobUrls = (items: GalleryItem[]) => {
        items.forEach(item => {
            if (!item.isExisting && item.src.startsWith("blob:")) {
                try {
                    URL.revokeObjectURL(item.src);
                } catch {}
            }
        });
    };

    const handleCloseEdit = () => {
        cleanupGalleryBlobUrls(galleryItems);
        setGalleryItems([]);
        setFeaturedImageId("");
        setUploadProgress(null);
        setUploadError(null);
        setIsEditing(false);
    };

    const handleAddNew = () => {
        cleanupGalleryBlobUrls(galleryItems);
        setFormData({
            id: crypto.randomUUID(),
            name: "",
            slug: "",
            description: "",
            price: 0,
            images: [],
            thumbnails: [],
            category: "",
            categories: [],
            tags: [],
            inventory: 10,
            isVisible: true,
            isCustomized: false,
            isFeatured: false,
            sizes: [],
            customizationType: null,
            createdAt: Date.now(),
        });
        setGalleryItems([]);
        setFeaturedImageId("");
        setUploadProgress(null);
        setUploadError(null);
        setIsAddingNewCategory(false);
        setNewCategoryName("");
        setIsEditing(true);
    };

    const handleEdit = (prod: Product) => {
        cleanupGalleryBlobUrls(galleryItems);
        setFormData({ ...prod });
        const existingImages = Array.isArray(prod.images) ? prod.images : (prod.images ? [prod.images] : []);
        const existingThumbnails = Array.isArray(prod.thumbnails) ? prod.thumbnails : [];
        const items: GalleryItem[] = existingImages.map((url, i) => ({
            id: `existing-${i}-${url}`,
            src: url,
            isExisting: true,
            existingThumb: existingThumbnails[i] || url,
        }));
        setGalleryItems(items);
        setFeaturedImageId(items.length > 0 ? items[0].id : "");
        setUploadProgress(null);
        setUploadError(null);
        setIsAddingNewCategory(false);
        setNewCategoryName("");
        setIsEditing(true);
    };

    const handleDelete = async (id: string) => {
        if (confirm("Are you sure you want to delete this product?")) {
            try {
                await deleteDoc(doc(db, "products", id));
            } catch (err) {
                console.error(err);
                alert("Failed to delete product.");
            }
        }
    };

    const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        setUploadError(null);

        const validItems: GalleryItem[] = [];
        const invalidErrors: string[] = [];
        const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

        for (const file of files) {
            if (file.size > 10 * 1024 * 1024) {
                invalidErrors.push(`"${file.name}" exceeds 10MB limit (${(file.size / (1024 * 1024)).toFixed(1)}MB)`);
                continue;
            }
            if (!allowedTypes.includes(file.type.toLowerCase())) {
                invalidErrors.push(`"${file.name}" has unsupported format '${file.type || "unknown"}'. Only JPEG, PNG, and WebP are allowed.`);
                continue;
            }
            validItems.push({
                id: `new-${crypto.randomUUID()}`,
                src: URL.createObjectURL(file),
                file,
                isExisting: false,
            });
        }

        if (invalidErrors.length > 0) {
            setUploadError(invalidErrors.join("; "));
        }

        if (validItems.length > 0) {
            setGalleryItems(prev => {
                const combined = [...prev, ...validItems];
                if (!featuredImageId && combined.length > 0) {
                    setFeaturedImageId(combined[0].id);
                }
                return combined;
            });
        }

        // Reset the file input so selecting the same file again fires onChange
        e.target.value = "";
    };

    const removeGalleryItem = (id: string) => {
        setGalleryItems(prev => {
            const itemToRemove = prev.find(item => item.id === id);
            if (itemToRemove && !itemToRemove.isExisting && itemToRemove.src.startsWith("blob:")) {
                try {
                    URL.revokeObjectURL(itemToRemove.src);
                } catch {}
            }
            const filtered = prev.filter(item => item.id !== id);
            if (featuredImageId === id) {
                setFeaturedImageId(filtered.length > 0 ? filtered[0].id : "");
            }
            return filtered;
        });
    };

    const moveGalleryItem = (index: number, direction: "left" | "right") => {
        setGalleryItems(prev => {
            const targetIndex = direction === "left" ? index - 1 : index + 1;
            if (targetIndex < 0 || targetIndex >= prev.length) return prev;
            const updated = [...prev];
            const [moved] = updated.splice(index, 1);
            updated.splice(targetIndex, 0, moved);
            return updated;
        });
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setUploading(true);
        setUploadError(null);
        setUploadProgress(null);

        try {
            const productId = formData.id || crypto.randomUUID();

            // 1. Process and upload any new image files
            const newFilesToUpload = galleryItems.filter(item => !item.isExisting && item.file);
            const totalToUpload = newFilesToUpload.length;
            const uploadedMap = new Map<string, { fullUrl: string; thumbUrl: string }>();

            let uploadedCount = 0;
            for (const item of newFilesToUpload) {
                uploadedCount++;
                setUploadProgress(`Optimizing & uploading image ${uploadedCount} of ${totalToUpload}...`);

                const file = item.file!;
                const optionsFull = { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true };
                const compressedFile = await imageCompression(file, optionsFull);

                const optionsThumb = { maxSizeMB: 0.1, maxWidthOrHeight: 600, useWebWorker: true };
                const thumbFile = await imageCompression(file, optionsThumb);

                const fullUrl = await uploadFileToR2(compressedFile, "products", productId);
                const thumbUrl = await uploadFileToR2(thumbFile, "products", productId);

                uploadedMap.set(item.id, { fullUrl, thumbUrl });
            }

            // 2. Build final ordered image arrays with 1-to-1 thumbnail synchronization
            // Locate the featured item and place it at index 0
            const finalOrderedItems = [...galleryItems];
            const heroIdx = finalOrderedItems.findIndex(item => item.id === featuredImageId);
            if (heroIdx > 0) {
                const [heroItem] = finalOrderedItems.splice(heroIdx, 1);
                finalOrderedItems.unshift(heroItem);
            }

            const allImages: string[] = [];
            const allThumbnails: string[] = [];

            for (const item of finalOrderedItems) {
                if (item.isExisting) {
                    allImages.push(item.src);
                    allThumbnails.push(item.existingThumb || item.src);
                } else if (uploadedMap.has(item.id)) {
                    const uploaded = uploadedMap.get(item.id)!;
                    allImages.push(uploaded.fullUrl);
                    allThumbnails.push(uploaded.thumbUrl);
                }
            }

            let finalCategory = formData.category || "";
            let finalCategories = formData.categories ? [...formData.categories] : [];

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
                id: productId,
                images: allImages,
                thumbnails: allThumbnails,
                category: finalCategory,
                categories: finalCategories,
                slug: formData.slug || formData.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, ''),
                updatedAt: Date.now(),
            };

            await setDoc(doc(db, "products", productId), payload, { merge: true });

            cleanupGalleryBlobUrls(galleryItems);
            setIsEditing(false);
            setGalleryItems([]);
            setFeaturedImageId("");
            setUploadProgress(null);
        } catch (err: any) {
            console.error("AdminProducts handleSave error:", err);
            setUploadError(err.message || "Failed to save product. Please check network connection and try again.");
            alert("Failed to save product: " + (err.message || "Unknown error"));
        } finally {
            setUploading(false);
            setUploadProgress(null);
        }
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
                const url = await uploadFileToR2(compressedFile, "reviews", addingReviewForProduct);
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
            alert("Review added successfully!");
        } catch (err) {
            console.error(err);
            alert("Failed to add review.");
        } finally {
            setFakeReviewUploading(false);
        }
    };

    // =========================================================================
    // PRODUCT EDIT / CREATION FORM VIEW
    // =========================================================================
    if (isEditing) {
        return (
            <div className="animate-fade-in" style={{ maxWidth: "800px", margin: "0 auto" }}>
                <AdminPageHeader
                    title={formData.name ? `Edit: ${formData.name}` : "Create New Product"}
                    subtitle="Configure product catalog information, stock inventory, and media gallery."
                >
                    <button
                        type="button"
                        onClick={handleCloseEdit}
                        className="admin-btn admin-btn-secondary admin-btn-sm"
                        disabled={uploading}
                    >
                        &larr; Back to Products
                    </button>
                </AdminPageHeader>

                <form onSubmit={handleSave} className="admin-form-card">
                    {/* SECTION 1: BASIC DETAILS */}
                    <div style={{ marginBottom: "24px" }}>
                        <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ display: "inline-flex", width: "24px", height: "24px", borderRadius: "50%", backgroundColor: "var(--accent-light)", color: "var(--accent)", fontSize: "0.8rem", alignItems: "center", justifyContent: "center" }}>1</span>
                            Product Information
                        </h3>

                        <div className="admin-form-group">
                            <label htmlFor="prod-name">Product Name *</label>
                            <input
                                id="prod-name"
                                type="text"
                                required
                                className="admin-form-input"
                                value={formData.name || ""}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="e.g. Bazaarvilla Signature Green Hoodie"
                            />
                        </div>

                        <div className="admin-form-group">
                            <label htmlFor="prod-slug">Slug (URL Endpoint)</label>
                            <input
                                id="prod-slug"
                                type="text"
                                className="admin-form-input"
                                value={formData.slug || ""}
                                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                                placeholder="auto-generated-from-name"
                            />
                        </div>

                        <div className="admin-form-group">
                            <label htmlFor="prod-desc">Description</label>
                            <textarea
                                id="prod-desc"
                                rows={4}
                                className="admin-form-textarea"
                                value={formData.description || ""}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder="Describe the materials, fit, care instructions, and highlights..."
                            />
                        </div>
                    </div>

                    {/* SECTION 2: PRICING, INVENTORY & SIZES */}
                    <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "24px", marginBottom: "24px" }}>
                        <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ display: "inline-flex", width: "24px", height: "24px", borderRadius: "50%", backgroundColor: "var(--accent-light)", color: "var(--accent)", fontSize: "0.8rem", alignItems: "center", justifyContent: "center" }}>2</span>
                            Pricing & Stock Inventory
                        </h3>

                        <div className="admin-form-grid-2">
                            <div className="admin-form-group">
                                <label htmlFor="prod-price">Price (₹ INR) *</label>
                                <input
                                    id="prod-price"
                                    type="number"
                                    inputMode="decimal"
                                    step="1"
                                    min="0"
                                    required
                                    className="admin-form-input"
                                    value={formData.price ?? 0}
                                    onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                                />
                            </div>

                            <div className="admin-form-group">
                                <label htmlFor="prod-inventory">Inventory Count *</label>
                                <input
                                    id="prod-inventory"
                                    type="number"
                                    inputMode="numeric"
                                    step="1"
                                    min="0"
                                    required
                                    className="admin-form-input"
                                    value={formData.inventory ?? 0}
                                    onChange={(e) => setFormData({ ...formData, inventory: Number(e.target.value) })}
                                />
                            </div>
                        </div>

                        <div className="admin-form-group">
                            <label htmlFor="prod-sizes">Available Sizes (Comma-separated)</label>
                            <input
                                id="prod-sizes"
                                type="text"
                                className="admin-form-input"
                                value={(formData.sizes || []).join(", ")}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    const newSizes = val.split(",").map(s => s.trim()).filter(s => s !== "");
                                    setFormData({ ...formData, sizes: newSizes });
                                }}
                                placeholder="S, M, L, XL, XXL"
                            />
                            <div style={{ display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" }}>
                                {["S", "M", "L", "XL", "XXL", "Free Size"].map((preset) => {
                                    const hasSize = (formData.sizes || []).includes(preset);
                                    return (
                                        <button
                                            key={preset}
                                            type="button"
                                            className={`admin-filter-pill ${hasSize ? "active" : ""}`}
                                            style={{ minHeight: "32px", fontSize: "0.75rem", padding: "4px 10px" }}
                                            onClick={() => {
                                                const current = new Set(formData.sizes || []);
                                                if (current.has(preset)) current.delete(preset);
                                                else current.add(preset);
                                                setFormData({ ...formData, sizes: Array.from(current) });
                                            }}
                                        >
                                            {preset}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* SECTION 3: CATEGORY SELECTION */}
                    <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "24px", marginBottom: "24px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
                                <span style={{ display: "inline-flex", width: "24px", height: "24px", borderRadius: "50%", backgroundColor: "var(--accent-light)", color: "var(--accent)", fontSize: "0.8rem", alignItems: "center", justifyContent: "center" }}>3</span>
                                Categories
                            </h3>
                            <button
                                type="button"
                                onClick={() => setIsAddingNewCategory(!isAddingNewCategory)}
                                className="admin-btn admin-btn-secondary admin-btn-sm"
                            >
                                {isAddingNewCategory ? "Cancel" : "+ New Category"}
                            </button>
                        </div>

                        {isAddingNewCategory ? (
                            <div className="admin-form-group">
                                <label htmlFor="new-cat-name">New Category Name</label>
                                <input
                                    id="new-cat-name"
                                    type="text"
                                    className="admin-form-input"
                                    value={newCategoryName}
                                    onChange={(e) => setNewCategoryName(e.target.value)}
                                    placeholder="Enter category name (e.g. Winterwear)..."
                                    required={isAddingNewCategory}
                                />
                            </div>
                        ) : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "14px", borderRadius: "14px", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-primary)" }}>
                                {categories.length === 0 && (
                                    <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                                        No categories found. Click &quot;+ New Category&quot; above to create one.
                                    </span>
                                )}
                                {categories.map((cat) => {
                                    const isSelected = (formData.categories || []).includes(cat.name) || formData.category === cat.name;
                                    return (
                                        <button
                                            key={cat.id}
                                            type="button"
                                            className={`admin-filter-pill ${isSelected ? "active" : ""}`}
                                            onClick={() => {
                                                const current = new Set([...(formData.categories || [])]);
                                                if (formData.category) current.add(formData.category);

                                                if (isSelected) {
                                                    current.delete(cat.name);
                                                    const newArr = Array.from(current);
                                                    setFormData({
                                                        ...formData,
                                                        categories: newArr,
                                                        category: newArr.length > 0 ? newArr[0] : "",
                                                    });
                                                } else {
                                                    current.add(cat.name);
                                                    setFormData({
                                                        ...formData,
                                                        categories: Array.from(current),
                                                        category: formData.category || cat.name,
                                                    });
                                                }
                                            }}
                                        >
                                            {isSelected && "✓ "}
                                            {cat.name}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* SECTION 4: PRODUCT IMAGES (CLOUDFLARE R2) */}
                    <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "24px", marginBottom: "24px" }}>
                        <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ display: "inline-flex", width: "24px", height: "24px", borderRadius: "50%", backgroundColor: "var(--accent-light)", color: "var(--accent)", fontSize: "0.8rem", alignItems: "center", justifyContent: "center" }}>4</span>
                            Product Media Gallery ({galleryItems.length})
                        </h3>
                        <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginBottom: "16px" }}>
                            Upload product images via Cloudflare R2. Tap &quot;Set Hero&quot; to pick the main storefront thumbnail. Use arrows to reorder.
                        </p>

                        {uploadError && (
                            <div style={{ backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#ef4444", padding: "12px 16px", borderRadius: "12px", marginBottom: "16px", fontSize: "0.85rem", border: "1px solid rgba(239, 68, 68, 0.2)" }}>
                                {uploadError}
                            </div>
                        )}

                        {uploadProgress && (
                            <div style={{ backgroundColor: "rgba(0, 107, 60, 0.1)", color: "var(--accent)", padding: "12px 16px", borderRadius: "12px", marginBottom: "16px", fontSize: "0.88rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "10px", border: "1px solid rgba(0, 107, 60, 0.2)" }}>
                                <div className="co-spinner" style={{ width: 18, height: 18 }} />
                                {uploadProgress}
                            </div>
                        )}

                        {/* Image previews grid */}
                        {galleryItems.length > 0 && (
                            <div className="admin-image-preview-grid">
                                {galleryItems.map((item, index) => {
                                    const isHero = featuredImageId ? item.id === featuredImageId : index === 0;
                                    return (
                                        <div
                                            key={item.id}
                                            className={`admin-image-preview-card ${isHero ? "hero" : ""}`}
                                        >
                                            <img src={item.src} alt={`Product gallery image ${index + 1}`} />

                                            {isHero && (
                                                <span style={{
                                                    position: "absolute", top: "6px", left: "6px",
                                                    padding: "3px 8px", borderRadius: "6px",
                                                    backgroundColor: "var(--accent)", color: "#ffffff",
                                                    fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase"
                                                }}>
                                                    Hero
                                                </span>
                                            )}

                                            <div className="admin-image-card-actions">
                                                {!isHero && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setFeaturedImageId(item.id)}
                                                        className="admin-image-card-btn"
                                                        style={{ backgroundColor: "#ffffff", color: "#000000" }}
                                                        title="Set as featured product image"
                                                    >
                                                        Set Hero
                                                    </button>
                                                )}
                                                {index > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => moveGalleryItem(index, "left")}
                                                        className="admin-image-card-btn"
                                                        style={{ backgroundColor: "#ffffff", color: "#000000", padding: "4px 8px" }}
                                                        title="Move earlier in gallery"
                                                    >
                                                        ←
                                                    </button>
                                                )}
                                                {index < galleryItems.length - 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => moveGalleryItem(index, "right")}
                                                        className="admin-image-card-btn"
                                                        style={{ backgroundColor: "#ffffff", color: "#000000", padding: "4px 8px" }}
                                                        title="Move later in gallery"
                                                    >
                                                        →
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => removeGalleryItem(item.id)}
                                                    className="admin-image-card-btn"
                                                    style={{ backgroundColor: "#ef4444", color: "#ffffff" }}
                                                    title="Remove image from gallery"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* File input label / upload button */}
                        <label style={{
                            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                            padding: "24px 16px", borderRadius: "14px", border: "2px dashed var(--border-color)",
                            backgroundColor: "var(--bg-primary)", cursor: uploading ? "not-allowed" : "pointer", gap: "8px", textAlign: "center",
                            transition: "border-color 0.2s ease", opacity: uploading ? 0.6 : 1
                        }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)" }}>
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                <circle cx="8.5" cy="8.5" r="1.5" />
                                <polyline points="21 15 16 10 5 21" />
                            </svg>
                            <span style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text-primary)" }}>
                                {galleryItems.length === 0 ? "Tap to select photo library or camera" : "+ Add more images"}
                            </span>
                            <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                                Supports JPEG, PNG, WebP (up to 10MB per file, auto-optimized before R2 upload)
                            </span>
                            <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                multiple
                                disabled={uploading}
                                style={{ display: "none" }}
                                onChange={handleFilesSelected}
                            />
                        </label>
                    </div>

                    {/* SECTION 5: OPTIONS & VISIBILITY */}
                    <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "24px", marginBottom: "24px" }}>
                        <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ display: "inline-flex", width: "24px", height: "24px", borderRadius: "50%", backgroundColor: "var(--accent-light)", color: "var(--accent)", fontSize: "0.8rem", alignItems: "center", justifyContent: "center" }}>5</span>
                            Visibility & Customization
                        </h3>

                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "0.92rem", fontWeight: 600, color: "var(--text-primary)" }}>
                                <input
                                    type="checkbox"
                                    checked={formData.isVisible || false}
                                    onChange={(e) => setFormData({ ...formData, isVisible: e.target.checked })}
                                    style={{ width: "20px", height: "20px", accentColor: "var(--accent)" }}
                                />
                                Visible on Storefront (publicly purchasable)
                            </label>

                            <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "0.92rem", fontWeight: 600, color: "var(--text-primary)" }}>
                                <input
                                    type="checkbox"
                                    checked={formData.isFeatured || false}
                                    onChange={(e) => setFormData({ ...formData, isFeatured: e.target.checked })}
                                    style={{ width: "20px", height: "20px", accentColor: "var(--accent)" }}
                                />
                                Feature on Homepage (&quot;Most Popular Picks&quot;)
                            </label>

                            <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "0.92rem", fontWeight: 600, color: "var(--text-primary)" }}>
                                <input
                                    type="checkbox"
                                    checked={formData.isCustomized || false}
                                    onChange={(e) => setFormData({ ...formData, isCustomized: e.target.checked })}
                                    style={{ width: "20px", height: "20px", accentColor: "var(--accent)" }}
                                />
                                Customizable Product (engraving / photo printing)
                            </label>

                            {formData.isCustomized && (
                                <div style={{ marginLeft: "28px", padding: "12px 16px", borderRadius: "12px", backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-color)", display: "flex", flexDirection: "column", gap: "8px" }}>
                                    <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.88rem", color: "var(--text-primary)", cursor: "pointer" }}>
                                        <input
                                            type="radio"
                                            name="customType"
                                            checked={formData.customizationType === "requires_name"}
                                            onChange={() => setFormData({ ...formData, customizationType: "requires_name" })}
                                            style={{ accentColor: "var(--accent)" }}
                                        />
                                        Requires Name / Text Engraving
                                    </label>
                                    <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.88rem", color: "var(--text-primary)", cursor: "pointer" }}>
                                        <input
                                            type="radio"
                                            name="customType"
                                            checked={formData.customizationType === "requires_picture"}
                                            onChange={() => setFormData({ ...formData, customizationType: "requires_picture" })}
                                            style={{ accentColor: "var(--accent)" }}
                                        />
                                        Requires Customer Photo Upload
                                    </label>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Desktop Actions */}
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", paddingTop: "16px", borderTop: "1px solid var(--border-color)" }}>
                        <button
                            type="button"
                            onClick={handleCloseEdit}
                            className="admin-btn admin-btn-secondary"
                            disabled={uploading}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="admin-btn admin-btn-primary"
                            disabled={uploading}
                        >
                            {uploading ? (uploadProgress || "Saving Product...") : "Save Product"}
                        </button>
                    </div>

                    {/* Mobile Sticky Actions Bar */}
                    <div className="admin-mobile-sticky-actions">
                        <button
                            type="button"
                            onClick={handleCloseEdit}
                            className="admin-btn admin-btn-secondary"
                            disabled={uploading}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="admin-btn admin-btn-primary"
                            disabled={uploading}
                        >
                            {uploading ? (uploadProgress || "Saving...") : "Save Product"}
                        </button>
                    </div>
                </form>
            </div>
        );
    }

    // =========================================================================
    // PRODUCT LIST VIEW
    // =========================================================================
    return (
        <div className="animate-fade-in" style={{ position: "relative" }}>
            {/* Fake review modal */}
            {addingReviewForProduct && (
                <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
                    <div className="admin-card" style={{ width: "100%", maxWidth: "480px", maxHeight: "90vh", overflowY: "auto", margin: 0, padding: "24px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                            <h3 style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0, color: "var(--text-primary)" }}>Add Seed Review</h3>
                            <button
                                type="button"
                                onClick={() => setAddingReviewForProduct(null)}
                                style={{ fontSize: "1.5rem", color: "var(--text-secondary)", lineHeight: 1 }}
                            >
                                &times;
                            </button>
                        </div>
                        <form onSubmit={handleFakeReviewSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                            <div className="admin-form-group" style={{ marginBottom: 0 }}>
                                <label>Reviewer Name</label>
                                <input
                                    type="text"
                                    className="admin-form-input"
                                    value={fakeReviewForm.userName}
                                    onChange={(e) => setFakeReviewForm({ ...fakeReviewForm, userName: e.target.value })}
                                    placeholder="e.g. John Doe"
                                    required
                                />
                            </div>
                            <div className="admin-form-group" style={{ marginBottom: 0 }}>
                                <label>Rating (1 to 5 Stars)</label>
                                <select
                                    className="admin-form-select"
                                    value={fakeReviewForm.rating}
                                    onChange={(e) => setFakeReviewForm({ ...fakeReviewForm, rating: Number(e.target.value) })}
                                >
                                    <option value={5}>★★★★★ (5 Stars)</option>
                                    <option value={4}>★★★★☆ (4 Stars)</option>
                                    <option value={3}>★★★☆☆ (3 Stars)</option>
                                    <option value={2}>★★☆☆☆ (2 Stars)</option>
                                    <option value={1}>★☆☆☆☆ (1 Star)</option>
                                </select>
                            </div>
                            <div className="admin-form-group" style={{ marginBottom: 0 }}>
                                <label>Comment</label>
                                <textarea
                                    className="admin-form-textarea"
                                    rows={3}
                                    value={fakeReviewForm.comment}
                                    onChange={(e) => setFakeReviewForm({ ...fakeReviewForm, comment: e.target.value })}
                                    placeholder="Customer feedback on quality, sizing, and shipping..."
                                    required
                                />
                            </div>
                            <div className="admin-form-group" style={{ marginBottom: 0 }}>
                                <label>Review Photos (Optional)</label>
                                <input
                                    type="file"
                                    multiple
                                    accept="image/*"
                                    onChange={(e) => setFakeReviewImages(Array.from(e.target.files || []))}
                                    className="admin-form-input"
                                    style={{ padding: "8px" }}
                                />
                            </div>
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
                                <button
                                    type="button"
                                    onClick={() => setAddingReviewForProduct(null)}
                                    className="admin-btn admin-btn-secondary admin-btn-sm"
                                    disabled={fakeReviewUploading}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="admin-btn admin-btn-primary admin-btn-sm"
                                    disabled={fakeReviewUploading}
                                >
                                    {fakeReviewUploading ? "Uploading..." : "Publish Review"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <AdminPageHeader
                title="Product Catalog"
                subtitle={`Manage your store inventory (${products.length} total products)`}
            >
                <button
                    type="button"
                    onClick={handleAddNew}
                    className="admin-btn admin-btn-primary"
                    aria-label="Add new product to catalog"
                >
                    + Add Product
                </button>
            </AdminPageHeader>

            {error && (
                <div style={{ backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#ef4444", padding: "16px 20px", borderRadius: "16px", marginBottom: "24px", fontSize: "0.9rem", fontWeight: 500, border: "1px solid rgba(239, 68, 68, 0.2)" }}>
                    {error}
                </div>
            )}

            {/* Product Card Container */}
            <div className="admin-card">
                {/* Search & Filter Bar */}
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
                            placeholder="Search by product name or category..."
                            aria-label="Search products"
                        />
                    </div>

                    <div className="admin-filter-pills">
                        <button
                            type="button"
                            className={`admin-filter-pill ${selectedVisibility === "ALL" ? "active" : ""}`}
                            onClick={() => setSelectedVisibility("ALL")}
                        >
                            All ({products.length})
                        </button>
                        <button
                            type="button"
                            className={`admin-filter-pill ${selectedVisibility === "VISIBLE" ? "active" : ""}`}
                            onClick={() => setSelectedVisibility("VISIBLE")}
                        >
                            Visible
                        </button>
                        <button
                            type="button"
                            className={`admin-filter-pill ${selectedVisibility === "HIDDEN" ? "active" : ""}`}
                            onClick={() => setSelectedVisibility("HIDDEN")}
                        >
                            Hidden
                        </button>
                        {categories.map((cat) => (
                            <button
                                key={cat.id}
                                type="button"
                                className={`admin-filter-pill ${selectedCategory === cat.name ? "active" : ""}`}
                                onClick={() => setSelectedCategory(selectedCategory === cat.name ? "ALL" : cat.name)}
                            >
                                {cat.name}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Desktop View: Table (>= 768px) */}
                <div className="admin-table-container">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th style={{ width: "64px" }}>Media</th>
                                <th>Product Name</th>
                                <th>Category</th>
                                <th>Price</th>
                                <th>Stock</th>
                                <th>Status</th>
                                <th style={{ textAlign: "right" }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredProducts.length === 0 && (
                                <tr>
                                    <td colSpan={7} style={{ padding: "48px 20px", textAlign: "center", color: "var(--text-secondary)" }}>
                                        No products match your search or filters.
                                    </td>
                                </tr>
                            )}
                            {filteredProducts.map((product) => (
                                <tr key={product.id}>
                                    <td>
                                        <div style={{ width: "48px", height: "48px", backgroundColor: "var(--bg-primary)", borderRadius: "10px", overflow: "hidden", border: "1px solid var(--border-color)", position: "relative" }}>
                                            {product.images?.[0] ? (
                                                <img src={product.images[0]} alt={product.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                            ) : (
                                                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: "0.7rem" }}>No img</div>
                                            )}
                                        </div>
                                    </td>
                                    <td>
                                        <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{product.name}</div>
                                        <div style={{ display: "flex", gap: "6px", marginTop: "2px" }}>
                                            {product.isCustomized && (
                                                <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", backgroundColor: "var(--text-primary)", color: "var(--bg-primary)" }}>
                                                    Custom
                                                </span>
                                            )}
                                            {product.isFeatured && (
                                                <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", backgroundColor: "var(--accent-light)", color: "var(--accent)" }}>
                                                    Featured
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                                        {product.category || (product.categories && product.categories[0]) || "—"}
                                    </td>
                                    <td style={{ fontWeight: 700, color: "var(--accent)" }}>
                                        ₹{(product.price || 0).toLocaleString("en-IN")}
                                    </td>
                                    <td>
                                        <span style={{
                                            fontWeight: 600,
                                            color: product.inventory <= 0 ? "#ef4444" : product.inventory < 5 ? "#ca8a04" : "var(--text-primary)"
                                        }}>
                                            {product.inventory} units
                                        </span>
                                    </td>
                                    <td>
                                        <AdminBadge variant={product.isVisible ? "visible" : "hidden"}>
                                            {product.isVisible ? "Visible" : "Hidden"}
                                        </AdminBadge>
                                    </td>
                                    <td style={{ textAlign: "right" }}>
                                        <button
                                            type="button"
                                            onClick={() => setAddingReviewForProduct(product.id)}
                                            className="admin-btn admin-btn-secondary admin-btn-sm"
                                            style={{ marginRight: "6px" }}
                                        >
                                            + Review
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleEdit(product)}
                                            className="admin-btn admin-btn-primary admin-btn-sm"
                                            style={{ marginRight: "6px" }}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(product.id)}
                                            className="admin-btn admin-btn-danger admin-btn-sm"
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Mobile View: Responsive Product Cards (< 768px) */}
                <div className="admin-mobile-cards-list">
                    {filteredProducts.length === 0 && (
                        <div style={{ padding: "36px 16px", textAlign: "center", color: "var(--text-secondary)" }}>
                            No products match your search or filters.
                        </div>
                    )}
                    {filteredProducts.map((product) => (
                        <div key={product.id} className="admin-mobile-item-card">
                            <div className="admin-mobile-card-top">
                                <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                                    <div style={{ width: "64px", height: "64px", borderRadius: "12px", overflow: "hidden", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-primary)", flexShrink: 0 }}>
                                        {product.images?.[0] ? (
                                            <img src={product.images[0]} alt={product.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                        ) : (
                                            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: "0.75rem" }}>No image</div>
                                        )}
                                    </div>
                                    <div>
                                        <h4 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)", margin: 0, lineHeight: 1.3 }}>
                                            {product.name}
                                        </h4>
                                        <div style={{ display: "flex", gap: "6px", marginTop: "4px", flexWrap: "wrap", alignItems: "center" }}>
                                            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                                                {product.category || (product.categories && product.categories[0]) || "General"}
                                            </span>
                                            {product.isCustomized && (
                                                <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", backgroundColor: "var(--text-primary)", color: "var(--bg-primary)" }}>
                                                    Custom
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <AdminBadge variant={product.isVisible ? "visible" : "hidden"}>
                                    {product.isVisible ? "Visible" : "Hidden"}
                                </AdminBadge>
                            </div>

                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
                                <div>
                                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block" }}>Stock</span>
                                    <span style={{
                                        fontSize: "0.9rem",
                                        fontWeight: 700,
                                        color: product.inventory <= 0 ? "#ef4444" : product.inventory < 5 ? "#ca8a04" : "var(--text-primary)"
                                    }}>
                                        {product.inventory} available
                                    </span>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block" }}>Price</span>
                                    <span style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--accent)" }}>
                                        ₹{(product.price || 0).toLocaleString("en-IN")}
                                    </span>
                                </div>
                            </div>

                            <div className="admin-mobile-card-actions">
                                <button
                                    type="button"
                                    onClick={() => handleEdit(product)}
                                    className="admin-btn admin-btn-primary admin-btn-sm"
                                    style={{ flex: 2 }}
                                >
                                    Edit Product
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAddingReviewForProduct(product.id)}
                                    className="admin-btn admin-btn-secondary admin-btn-sm"
                                    style={{ flex: 1 }}
                                >
                                    + Review
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDelete(product.id)}
                                    className="admin-btn admin-btn-danger admin-btn-sm"
                                    style={{ padding: "6px 10px" }}
                                    aria-label={`Delete ${product.name}`}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
