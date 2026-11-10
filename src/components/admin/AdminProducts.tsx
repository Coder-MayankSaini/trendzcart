"use client";

import { useEffect, useState, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { collection, onSnapshot, doc, setDoc, deleteDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";
import imageCompression from "browser-image-compression";
import AdminPageHeader from "./ui/AdminPageHeader";
import AdminBadge from "./ui/AdminBadge";
import ProductPurchaseActivity from "@/components/storefront/ProductPurchaseActivity";
import type { PurchaseActivityPeriod } from "@/lib/orders/purchaseActivityTypes";
import { isCustomizableProduct } from "@/lib/orders/customizationEligibility";

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

const FALLBACK_DATA_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400' fill='none'%3E%3Crect width='400' height='400' fill='%23f1f5f9'/%3E%3Ctext x='200' y='210' text-anchor='middle' fill='%2394a3b8' font-family='system-ui' font-size='16'%3EBazaarvilla Image%3C/text%3E%3C/svg%3E";

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
    reviewCount?: number;
    averageRating?: number;
    ratingDistribution?: Record<number, number>;
    purchaseActivity?: {
        enabled?: boolean;
        periodDays?: PurchaseActivityPeriod;
        displayThreshold?: number;
        unitsSold?: number;
        countsByPeriod?: Record<PurchaseActivityPeriod, number>;
        qualifyingOrdersCount?: number;
        uniquePurchasersCount?: number;
        lastCalculatedAt?: number;
    };
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

    // Purchase activity simulation and recalculation states (TASK 023)
    const [simulatedUnitsSold, setSimulatedUnitsSold] = useState<number>(24);
    const [simulatedPeriod, setSimulatedPeriod] = useState<PurchaseActivityPeriod>(30);
    const [isRecalculatingActivity, setIsRecalculatingActivity] = useState(false);
    const [activityMessage, setActivityMessage] = useState<string | null>(null);

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
            purchaseActivity: {
                enabled: true,
                periodDays: 30,
                displayThreshold: 5,
                unitsSold: 0,
                countsByPeriod: { 7: 0, 30: 0, 90: 0 },
                lastCalculatedAt: 0,
            },
            createdAt: Date.now(),
        });
        setGalleryItems([]);
        setFeaturedImageId("");
        setUploadProgress(null);
        setUploadError(null);
        setActivityMessage(null);
        setIsAddingNewCategory(false);
        setNewCategoryName("");
        setIsEditing(true);
    };

    const handleEdit = (prod: Product) => {
        cleanupGalleryBlobUrls(galleryItems);
        setFormData({
            ...prod,
            isCustomized: isCustomizableProduct(prod),
            purchaseActivity: prod.purchaseActivity || {
                enabled: true,
                periodDays: 30,
                displayThreshold: 5,
                unitsSold: 0,
                countsByPeriod: { 7: 0, 30: 0, 90: 0 },
                lastCalculatedAt: 0,
            },
        });
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
        setActivityMessage(null);
        setIsAddingNewCategory(false);
        setNewCategoryName("");
        setIsEditing(true);
    };

    const handleRecalculateActivity = async () => {
        if (!formData.id) return;
        setIsRecalculatingActivity(true);
        setActivityMessage(null);
        try {
            const user = auth.currentUser;
            const token = user ? await user.getIdToken() : "";
            const res = await fetch(`/api/admin/products/${encodeURIComponent(formData.id)}/purchase-activity`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    enabled: formData.purchaseActivity?.enabled ?? true,
                    periodDays: formData.purchaseActivity?.periodDays ?? 30,
                    displayThreshold: formData.purchaseActivity?.displayThreshold ?? 5,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to recalculate purchase activity");
            }
            if (data.activity) {
                setFormData(prev => ({
                    ...prev,
                    purchaseActivity: data.activity,
                }));
                setActivityMessage(`Refreshed: ${data.activity.unitsSold} units verified across rolling ${data.activity.periodDays}d.`);
            }
        } catch (err: any) {
            console.error("Recalculate activity failed:", err);
            setActivityMessage(`Error: ${err?.message || "Recalculation failed"}`);
        } finally {
            setIsRecalculatingActivity(false);
        }
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

                const optionsThumb = { maxSizeMB: 0.5, maxWidthOrHeight: 800, useWebWorker: true };
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
                            Upload product images via Cloudflare R2. The primary image is marked with a HERO badge and used as the storefront thumbnail. Use arrows to reorder.
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

                        {/* Image Previews Grid */}
                        {galleryItems.length > 0 && (
                            <div className="admin-gallery-grid" data-testid="admin-gallery-grid">
                                {galleryItems.map((item, index) => {
                                    const isHero = featuredImageId ? item.id === featuredImageId : index === 0;
                                    return (
                                        <div
                                            key={item.id}
                                            className={`admin-gallery-card ${isHero ? "is-hero" : ""}`}
                                            data-testid={`gallery-card-${index}`}
                                        >
                                            {/* 1. Preview Area (1:1 Ratio) */}
                                            <div className="admin-gallery-preview-wrapper">
                                                <img
                                                    src={item.src}
                                                    alt={`Product gallery image ${index + 1}`}
                                                    className="admin-gallery-preview-img"
                                                    onError={(e) => {
                                                        (e.currentTarget as HTMLImageElement).src = FALLBACK_DATA_URI;
                                                    }}
                                                />

                                                {/* Optional HERO Badge */}
                                                {isHero && (
                                                    <span className="admin-gallery-hero-badge" aria-label="Hero Image">
                                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                                                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                                        </svg>
                                                        HERO
                                                    </span>
                                                )}

                                                {/* Position Index Chip */}
                                                <span className="admin-gallery-index-chip" aria-hidden="true">
                                                    #{index + 1}
                                                </span>
                                            </div>

                                            {/* 2. Action Controls Footer beneath Preview */}
                                            <div className="admin-gallery-card-footer">
                                                <button
                                                    type="button"
                                                    onClick={() => setFeaturedImageId(item.id)}
                                                    disabled={isHero}
                                                    className={`admin-gallery-btn admin-gallery-btn-hero ${isHero ? "active" : ""}`}
                                                    title={isHero ? "Currently selected storefront hero image" : "Set as primary storefront hero image"}
                                                    aria-label={isHero ? `Image ${index + 1} is featured hero` : `Set image ${index + 1} as featured hero`}
                                                >
                                                    {isHero ? (
                                                        <>
                                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                                                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                                            </svg>
                                                            Featured Hero
                                                        </>
                                                    ) : (
                                                        <>
                                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                                            </svg>
                                                            Set as Hero
                                                        </>
                                                    )}
                                                </button>

                                                <div className="admin-gallery-btn-group">
                                                    <button
                                                        type="button"
                                                        onClick={() => moveGalleryItem(index, "left")}
                                                        disabled={index === 0}
                                                        className="admin-gallery-btn admin-gallery-btn-nav"
                                                        title="Move earlier in gallery"
                                                        aria-label={`Move image ${index + 1} earlier`}
                                                    >
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                            <polyline points="15 18 9 12 15 6" />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => moveGalleryItem(index, "right")}
                                                        disabled={index === galleryItems.length - 1}
                                                        className="admin-gallery-btn admin-gallery-btn-nav"
                                                        title="Move later in gallery"
                                                        aria-label={`Move image ${index + 1} later`}
                                                    >
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                            <polyline points="9 18 15 12 9 6" />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeGalleryItem(item.id)}
                                                        className="admin-gallery-btn admin-gallery-btn-remove"
                                                        title="Remove image from gallery"
                                                        aria-label={`Remove image ${index + 1} from gallery`}
                                                    >
                                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <polyline points="3 6 5 6 21 6" />
                                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                                        </svg>
                                                        <span>Remove</span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Add More Images Dropzone */}
                        <label
                            className={`admin-gallery-dropzone ${uploading ? "disabled" : ""}`}
                            tabIndex={uploading ? -1 : 0}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    const input = e.currentTarget.querySelector("input[type=file]") as HTMLInputElement | null;
                                    if (input) input.click();
                                }
                            }}
                        >
                            <div className="admin-gallery-dropzone-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="17 8 12 3 7 8" />
                                    <line x1="12" y1="3" x2="12" y2="15" />
                                </svg>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px", alignItems: "center" }}>
                                <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)" }}>
                                    {galleryItems.length === 0 ? "Upload Product Photos" : "Add More Images"}
                                </span>
                                <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                                    JPEG, PNG, WebP · Max 10MB per file · Auto-optimized before R2 upload
                                </span>
                            </div>
                            <span className="admin-gallery-dropzone-btn">
                                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                    <circle cx="8.5" cy="8.5" r="1.5" />
                                    <polyline points="21 15 16 10 5 21" />
                                </svg>
                                {galleryItems.length === 0 ? "Select Product Photos" : "Browse More Files"}
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
                                    <div style={{ fontSize: "0.78rem", color: "#6b7280", marginTop: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                                        Cash on Delivery (COD) will be automatically disabled at checkout for orders containing this product.
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* SECTION 6: PRODUCT PURCHASE ACTIVITY COUNTER */}
                    <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "24px", marginBottom: "24px" }} data-testid="section-purchase-activity">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
                            <div>
                                <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
                                    <span style={{ display: "inline-flex", width: "24px", height: "24px", borderRadius: "50%", backgroundColor: "var(--accent-light)", color: "var(--accent)", fontSize: "0.8rem", alignItems: "center", justifyContent: "center" }}>6</span>
                                    Purchase Activity Counter
                                </h3>
                                <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: "4px", marginBottom: 0 }}>
                                    Configure genuine purchase activity indicators derived strictly from commercial orders.
                                </p>
                            </div>
                            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--accent)", background: "var(--accent-light)", padding: "4px 8px", borderRadius: "6px" }}>
                                Commercial Authenticity Protected
                            </span>
                        </div>

                        {/* Visibility Toggle */}
                        <div style={{ marginBottom: "16px" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "0.92rem", fontWeight: 600, color: "var(--text-primary)" }}>
                                <input
                                    type="checkbox"
                                    checked={formData.purchaseActivity?.enabled ?? true}
                                    onChange={(e) => setFormData({
                                        ...formData,
                                        purchaseActivity: {
                                            ...(formData.purchaseActivity || { periodDays: 30, displayThreshold: 5, unitsSold: 0 }),
                                            enabled: e.target.checked,
                                        },
                                    })}
                                    style={{ width: "20px", height: "20px", accentColor: "var(--accent)" }}
                                />
                                Enable Purchase Activity Display on Storefront
                            </label>
                            <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginLeft: "30px", marginTop: "2px" }}>
                                When enabled, product detail pages display an authentic sales badge (e.g. &quot;24 units sold in the past 30 days&quot;) if genuine sales meet the threshold.
                            </p>
                        </div>

                        {/* Configuration Controls (Period & Threshold) */}
                        <div className="admin-form-grid-2" style={{ marginBottom: "16px" }}>
                            <div className="admin-form-group">
                                <label htmlFor="activity-period" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    Reporting Period (Rolling Window)
                                </label>
                                <select
                                    id="activity-period"
                                    className="admin-form-input"
                                    value={formData.purchaseActivity?.periodDays || 30}
                                    onChange={(e) => {
                                        const period = Number(e.target.value) as PurchaseActivityPeriod;
                                        setFormData({
                                            ...formData,
                                            purchaseActivity: {
                                                ...(formData.purchaseActivity || { enabled: true, displayThreshold: 5, unitsSold: 0 }),
                                                periodDays: period,
                                                unitsSold: formData.purchaseActivity?.countsByPeriod?.[period] ?? formData.purchaseActivity?.unitsSold ?? 0,
                                            },
                                        });
                                    }}
                                >
                                    <option value={7}>Past 7 days (rolling)</option>
                                    <option value={30}>Past 30 days (rolling - recommended)</option>
                                    <option value={90}>Past 90 days (rolling)</option>
                                </select>
                                <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                                    Calculates units sold in the rolling past {formData.purchaseActivity?.periodDays || 30} days.
                                </span>
                            </div>

                            <div className="admin-form-group">
                                <label htmlFor="activity-threshold" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    Display Threshold
                                </label>
                                <select
                                    id="activity-threshold"
                                    className="admin-form-input"
                                    value={formData.purchaseActivity?.displayThreshold ?? 5}
                                    onChange={(e) => {
                                        const threshold = Number(e.target.value);
                                        setFormData({
                                            ...formData,
                                            purchaseActivity: {
                                                ...(formData.purchaseActivity || { enabled: true, periodDays: 30, unitsSold: 0 }),
                                                displayThreshold: threshold,
                                            },
                                        });
                                    }}
                                >
                                    <option value={0}>Always show genuine count (0+ units)</option>
                                    <option value={5}>Show only when at least 5 units sold (recommended)</option>
                                    <option value={10}>Show only when at least 10 units sold</option>
                                    <option value={25}>Show only when at least 25 units sold</option>
                                </select>
                                <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                                    Controls visibility only; never inflates reported numbers.
                                </span>
                            </div>
                        </div>

                        {/* Verified Demand & Recalculate Box */}
                        <div
                            style={{
                                padding: "16px",
                                borderRadius: "12px",
                                background: "var(--bg-primary)",
                                border: "1px solid var(--border-color)",
                                marginBottom: "20px",
                            }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "12px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text-primary)" }}>
                                        Authoritative Verified Demand
                                    </span>
                                    <span style={{ fontSize: "0.75rem", padding: "2px 8px", borderRadius: "4px", backgroundColor: "#EAF8EE", color: "#006B3C", fontWeight: 600 }}>
                                        Live Orders Only
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleRecalculateActivity}
                                    className="admin-btn admin-btn-secondary admin-btn-sm"
                                    disabled={isRecalculatingActivity || !formData.id}
                                    style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                                >
                                    {isRecalculatingActivity ? (
                                        <>
                                            <div className="co-spinner" style={{ width: 14, height: 14 }} />
                                            Recalculating...
                                        </>
                                    ) : (
                                        <>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="23 4 23 10 17 10" />
                                                <polyline points="1 20 1 14 7 14" />
                                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                                            </svg>
                                            Recalculate Counts
                                        </>
                                    )}
                                </button>
                            </div>

                            {activityMessage && (
                                <div style={{ fontSize: "0.82rem", fontWeight: 600, color: activityMessage.startsWith("Error") ? "#ef4444" : "#15803d", marginBottom: "10px", padding: "6px 10px", borderRadius: "6px", backgroundColor: activityMessage.startsWith("Error") ? "rgba(239, 68, 68, 0.1)" : "rgba(34, 197, 94, 0.1)" }}>
                                    {activityMessage}
                                </div>
                            )}

                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px" }}>
                                <div style={{ padding: "10px", borderRadius: "8px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", textAlign: "center" }}>
                                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 500 }}>Past 7 Days</div>
                                    <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", marginTop: "2px" }}>
                                        {formData.purchaseActivity?.countsByPeriod?.[7] ?? 0} <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--text-secondary)" }}>units</span>
                                    </div>
                                </div>
                                <div style={{ padding: "10px", borderRadius: "8px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", textAlign: "center" }}>
                                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 500 }}>Past 30 Days</div>
                                    <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--accent)", marginTop: "2px" }}>
                                        {formData.purchaseActivity?.countsByPeriod?.[30] ?? formData.purchaseActivity?.unitsSold ?? 0} <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--text-secondary)" }}>units</span>
                                    </div>
                                </div>
                                <div style={{ padding: "10px", borderRadius: "8px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", textAlign: "center" }}>
                                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 500 }}>Past 90 Days</div>
                                    <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", marginTop: "2px" }}>
                                        {formData.purchaseActivity?.countsByPeriod?.[90] ?? 0} <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--text-secondary)" }}>units</span>
                                    </div>
                                </div>
                            </div>
                            <div style={{ marginTop: "10px", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                                Last verified: {formData.purchaseActivity?.lastCalculatedAt ? new Date(formData.purchaseActivity.lastCalculatedAt).toLocaleString("en-IN") : "Pending calculation upon first order"}
                            </div>
                        </div>

                        {/* Private Simulation Preview Box (Section 6.E) */}
                        <div
                            style={{
                                padding: "16px",
                                borderRadius: "12px",
                                background: "#fffbeb",
                                border: "1.5px solid #fde68a",
                            }}
                            data-testid="purchase-activity-simulation-panel"
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "8px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <span style={{ fontSize: "0.88rem", fontWeight: 700, color: "#92400e" }}>
                                        Private Simulation Preview
                                    </span>
                                    <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", backgroundColor: "#ca8a04", color: "#ffffff", letterSpacing: "0.03em" }}>
                                        ADMIN PREVIEW ONLY
                                    </span>
                                </div>
                                <span style={{ fontSize: "0.75rem", color: "#b45309" }}>
                                    Never saved to storefront data
                                </span>
                            </div>
                            <p style={{ fontSize: "0.78rem", color: "#92400e", marginBottom: "12px" }}>
                                Test how different unit counts and rolling periods appear in the visual design system.
                            </p>

                            {/* Simulation Controls */}
                            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <label htmlFor="sim-count" style={{ fontSize: "0.8rem", fontWeight: 600, color: "#92400e" }}>
                                        Simulated Units:
                                    </label>
                                    <input
                                        id="sim-count"
                                        type="number"
                                        min="0"
                                        max="9999"
                                        value={simulatedUnitsSold}
                                        onChange={(e) => setSimulatedUnitsSold(Math.max(0, Number(e.target.value) || 0))}
                                        className="admin-form-input"
                                        style={{ width: "90px", padding: "4px 8px", fontSize: "0.85rem", height: "32px", minHeight: "32px" }}
                                    />
                                </div>

                                <div style={{ display: "flex", gap: "4px" }}>
                                    {[1, 8, 24, 75, 150].map((sampleVal) => (
                                        <button
                                            key={sampleVal}
                                            type="button"
                                            onClick={() => setSimulatedUnitsSold(sampleVal)}
                                            className="admin-filter-pill"
                                            style={{
                                                fontSize: "0.75rem",
                                                padding: "2px 8px",
                                                minHeight: "28px",
                                                background: simulatedUnitsSold === sampleVal ? "#ca8a04" : "#ffffff",
                                                color: simulatedUnitsSold === sampleVal ? "#ffffff" : "#92400e",
                                                borderColor: "#fde68a",
                                            }}
                                        >
                                            {sampleVal}
                                        </button>
                                    ))}
                                </div>

                                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "auto" }}>
                                    <label htmlFor="sim-period" style={{ fontSize: "0.8rem", fontWeight: 600, color: "#92400e" }}>
                                        Period:
                                    </label>
                                    <select
                                        id="sim-period"
                                        value={simulatedPeriod}
                                        onChange={(e) => setSimulatedPeriod(Number(e.target.value) as PurchaseActivityPeriod)}
                                        className="admin-form-input"
                                        style={{ width: "110px", padding: "4px 8px", fontSize: "0.85rem", height: "32px", minHeight: "32px" }}
                                    >
                                        <option value={7}>7 Days</option>
                                        <option value={30}>30 Days</option>
                                        <option value={90}>90 Days</option>
                                    </select>
                                </div>
                            </div>

                            {/* Rendered Live Preview Component */}
                            <ProductPurchaseActivity
                                isSimulated={true}
                                simulatedCount={simulatedUnitsSold}
                                simulatedPeriod={simulatedPeriod}
                            />
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
                                        <div style={{ display: "flex", gap: "6px", marginTop: "2px", alignItems: "center", flexWrap: "wrap" }}>
                                            {isCustomizableProduct(product) && (
                                                <>
                                                    <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", backgroundColor: "var(--text-primary)", color: "var(--bg-primary)" }}>
                                                        Custom
                                                    </span>
                                                    <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", backgroundColor: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" }}>
                                                        Prepaid Only
                                                    </span>
                                                </>
                                            )}
                                            {product.isFeatured && (
                                                <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", backgroundColor: "var(--accent-light)", color: "var(--accent)" }}>
                                                    Featured
                                                </span>
                                            )}
                                            {product.reviewCount && product.reviewCount > 0 ? (
                                                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#d97706", display: "inline-flex", alignItems: "center", gap: "2px" }} title={`${product.reviewCount} published reviews`}>
                                                    ★ {Number(product.averageRating || 0).toFixed(1)} <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>({product.reviewCount})</span>
                                                </span>
                                            ) : null}
                                            {product.purchaseActivity?.unitsSold !== undefined && product.purchaseActivity.unitsSold > 0 ? (
                                                <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", backgroundColor: "#EAF8EE", color: "#006B3C", display: "inline-flex", alignItems: "center", gap: "3px" }} title={`${product.purchaseActivity.unitsSold} units sold in past ${product.purchaseActivity.periodDays || 30} days`}>
                                                    🛒 {product.purchaseActivity.unitsSold} sold
                                                </span>
                                            ) : null}
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
                                        <Link
                                            href={`/admin/reviews?productId=${encodeURIComponent(product.id)}`}
                                            className="admin-btn admin-btn-secondary admin-btn-sm"
                                            style={{ marginRight: "6px", textDecoration: "none" }}
                                            title="Manage product reviews and import batches"
                                        >
                                            Reviews {product.reviewCount ? `(${product.reviewCount})` : ""}
                                        </Link>
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
                                            {isCustomizableProduct(product) && (
                                                <>
                                                    <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", backgroundColor: "var(--text-primary)", color: "var(--bg-primary)" }}>
                                                        Custom
                                                    </span>
                                                    <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", backgroundColor: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" }}>
                                                        Prepaid Only
                                                    </span>
                                                </>
                                            )}
                                            {product.reviewCount && product.reviewCount > 0 ? (
                                                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#d97706", display: "inline-flex", alignItems: "center", gap: "2px" }}>
                                                    ★ {Number(product.averageRating || 0).toFixed(1)} ({product.reviewCount})
                                                </span>
                                            ) : null}
                                            {product.purchaseActivity?.unitsSold !== undefined && product.purchaseActivity.unitsSold > 0 ? (
                                                <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", backgroundColor: "#EAF8EE", color: "#006B3C", display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                                    🛒 {product.purchaseActivity.unitsSold} sold
                                                </span>
                                            ) : null}
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
                                <Link
                                    href={`/admin/reviews?productId=${encodeURIComponent(product.id)}`}
                                    className="admin-btn admin-btn-secondary admin-btn-sm"
                                    style={{ flex: 1, textDecoration: "none", textAlign: "center", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                                >
                                    Reviews {product.reviewCount ? `(${product.reviewCount})` : ""}
                                </Link>
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
