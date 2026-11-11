"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { collection, onSnapshot, doc, setDoc, deleteDoc, runTransaction } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";
import imageCompression from "browser-image-compression";
import AdminPageHeader from "./ui/AdminPageHeader";
import AdminBadge from "./ui/AdminBadge";
import ProductPurchaseActivity from "@/components/storefront/ProductPurchaseActivity";
import ProductImportModal from "./ProductImportModal";
import type { PurchaseActivityPeriod, PurchaseActivityDisplayMode } from "@/lib/orders/purchaseActivityTypes";
import { MAX_CONFIGURED_UNITS } from "@/lib/orders/purchaseActivityTypes";
import { isCustomizableProduct } from "@/lib/orders/customizationEligibility";
import {
    SizeMode,
    DimensionUnit,
    SizeDimension,
    SizeOption,
    ColorOption,
    ProductVariant,
    STANDARD_APPAREL_SIZES,
    MAX_VARIANT_LIMIT,
    formatDimensions,
    formatSizeDisplay,
    generateVariantMatrix,
    generateVariantSku,
    calculateVariantStockBreakdown,
    validateVariantConfiguration,
    reconcileProductInventoryOnSave,
} from "@/lib/products/variants";

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
    hasVariants?: boolean;
    sizeMode?: SizeMode;
    sizesList?: SizeOption[];
    colors?: ColorOption[];
    variants?: ProductVariant[];
    reviewCount?: number;
    averageRating?: number;
    ratingDistribution?: Record<number, number>;
    purchaseActivity?: {
        enabled?: boolean;
        periodDays?: PurchaseActivityPeriod;
        displayThreshold?: number;
        displayMode?: PurchaseActivityDisplayMode;
        customUnitsSold?: number;
        unitsSold?: number;
        orderUnitsSold?: number;
        countsByPeriod?: Record<PurchaseActivityPeriod, number>;
        qualifyingOrdersCount?: number;
        uniquePurchasersCount?: number;
        lastOrderSyncAt?: number;
        lastCalculatedAt?: number;
        isCustomCount?: boolean;
    };
    createdAt: number;
}

interface CategoryOption {
    id: string;
    name: string;
}

const COLOR_PRESETS = [
    { name: "Black", hex: "#000000" },
    { name: "White", hex: "#FFFFFF" },
    { name: "Navy Blue", hex: "#000080" },
    { name: "Red", hex: "#DC2626" },
    { name: "Olive Green", hex: "#556B2F" },
    { name: "Burgundy", hex: "#800020" },
    { name: "Beige", hex: "#F5F5DC" },
];

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
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);

    // Search and filter states
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("ALL");
    const [selectedVisibility, setSelectedVisibility] = useState<"ALL" | "VISIBLE" | "HIDDEN">("ALL");

    // Purchase activity simulation and recalculation states (TASK 023)
    const [simulatedUnitsSold, setSimulatedUnitsSold] = useState<number>(24);
    const [simulatedPeriod, setSimulatedPeriod] = useState<PurchaseActivityPeriod>(30);
    const [isRecalculatingActivity, setIsRecalculatingActivity] = useState(false);
    const [activityMessage, setActivityMessage] = useState<string | null>(null);

    // Flexible Variants Editor State (TASK 029)
    const [newCustomSize, setNewCustomSize] = useState("");
    const [newDimensionSize, setNewDimensionSize] = useState<{
        name: string;
        width: number | "";
        height: number | "";
        depth: number | "";
        unit: DimensionUnit;
    }>({
        name: "",
        width: "",
        height: "",
        depth: "",
        unit: "cm",
    });
    const [newColorName, setNewColorName] = useState("");
    const [newColorHex, setNewColorHex] = useState("#000000");

    // Concurrency protection: preserves loaded product snapshot to prevent stale form overwrites (TASK 029)
    const originalProductRef = useRef<Product | null>(null);

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
        originalProductRef.current = null;
        setGalleryItems([]);
        setFeaturedImageId("");
        setUploadProgress(null);
        setUploadError(null);
        setIsEditing(false);
    };

    const handleAddNew = () => {
        cleanupGalleryBlobUrls(galleryItems);
        originalProductRef.current = null;
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
            hasVariants: false,
            sizeMode: "none",
            sizesList: [],
            colors: [],
            variants: [],
            customizationType: null,
            purchaseActivity: {
                enabled: true,
                periodDays: 30,
                displayThreshold: 5,
                displayMode: "auto",
                customUnitsSold: 0,
                unitsSold: 0,
                orderUnitsSold: 0,
                isCustomCount: false,
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
        setNewCustomSize("");
        setNewDimensionSize({ name: "", width: "", height: "", depth: "", unit: "cm" });
        setNewColorName("");
        setNewColorHex("#000000");
        setIsEditing(true);
    };

    const handleEdit = (prod: Product) => {
        cleanupGalleryBlobUrls(galleryItems);
        originalProductRef.current = JSON.parse(JSON.stringify(prod));
        const existingSizes = Array.isArray(prod.sizes) ? prod.sizes : [];
        const initialSizeMode: SizeMode = prod.sizeMode || (existingSizes.length > 0 ? "apparel" : "none");
        const initialSizesList: SizeOption[] = (Array.isArray(prod.sizesList) && prod.sizesList.length > 0)
            ? prod.sizesList
            : existingSizes.map((s, idx) => ({
                id: `size-${idx}-${s.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
                name: s,
                isActive: true,
                order: idx,
            }));

        setFormData({
            ...prod,
            hasVariants: prod.hasVariants || false,
            sizeMode: initialSizeMode,
            sizesList: initialSizesList,
            colors: prod.colors || [],
            variants: prod.variants || [],
            isCustomized: isCustomizableProduct(prod),
            purchaseActivity: (() => {
                const pa = prod.purchaseActivity;
                const displayMode: PurchaseActivityDisplayMode = pa?.displayMode || (pa?.isCustomCount ? "custom" : "auto");
                const customUnits = typeof pa?.customUnitsSold === "number"
                    ? pa.customUnitsSold
                    : (displayMode === "custom" ? (pa?.unitsSold ?? 0) : 0);
                const period = (pa?.periodDays && [7, 30, 90].includes(pa.periodDays)) ? pa.periodDays : 30;
                const effectiveUnits = displayMode === "custom"
                    ? customUnits
                    : (pa?.countsByPeriod?.[period] ?? pa?.unitsSold ?? 0);
                return {
                    enabled: pa?.enabled ?? true,
                    periodDays: period,
                    displayThreshold: pa?.displayThreshold ?? 5,
                    displayMode,
                    customUnitsSold: customUnits,
                    unitsSold: effectiveUnits,
                    orderUnitsSold: pa?.orderUnitsSold ?? pa?.countsByPeriod?.[period] ?? 0,
                    isCustomCount: displayMode === "custom",
                    countsByPeriod: pa?.countsByPeriod ?? { 7: 0, 30: 0, 90: 0 },
                    qualifyingOrdersCount: pa?.qualifyingOrdersCount ?? 0,
                    uniquePurchasersCount: pa?.uniquePurchasersCount ?? 0,
                    lastOrderSyncAt: pa?.lastOrderSyncAt ?? 0,
                    lastCalculatedAt: pa?.lastCalculatedAt ?? 0,
                };
            })(),
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
        setNewCustomSize("");
        setNewDimensionSize({ name: "", width: "", height: "", depth: "", unit: "cm" });
        setNewColorName("");
        setNewColorHex("#000000");
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
                    displayMode: formData.purchaseActivity?.displayMode || "auto",
                    customUnitsSold: formData.purchaseActivity?.customUnitsSold ?? 0,
                    forceLiveRecalculate: true,
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
                const orderCount = data.activity.orderUnitsSold ?? data.activity.countsByPeriod?.[data.activity.periodDays] ?? 0;
                setActivityMessage(`Refreshed from orders: ${orderCount} units verified across rolling ${data.activity.periodDays}d.`);
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

            const hasVariants = Boolean(formData.hasVariants);
            const variants = formData.variants || [];
            const sizesList = formData.sizesList || [];
            const colors = formData.colors || [];
            const sizeMode = formData.sizeMode || "none";

            // Server-grade validation for variant configuration
            if (hasVariants) {
                const validation = validateVariantConfiguration({
                    hasVariants: true,
                    sizes: sizesList,
                    colors,
                    variants,
                });
                if (!validation.isValid) {
                    alert("Variant Configuration Error:\n- " + validation.errors.join("\n- "));
                    setUploading(false);
                    return;
                }
            }

            // If variants enabled, sync legacy sizes array with active sizesList for backward compatibility
            const legacySizes = hasVariants
                ? sizesList.filter(s => s.isActive !== false).map(s => s.name)
                : (formData.sizes || []);

            // Concurrency Protection & Inventory Reconciliation (TASK 029 Hardening)
            // Use an atomic transaction to ensure admin saves do NOT clobber concurrent
            // customer checkouts or reservations that occurred while the editor was open.
            await runTransaction(db, async (transaction) => {
                const productRef = doc(db, "products", productId);
                const liveSnap = await transaction.get(productRef);
                const liveProduct = liveSnap.exists() ? (liveSnap.data() as Product) : null;

                const reconciled = reconcileProductInventoryOnSave({
                    formHasVariants: hasVariants,
                    formVariants: variants,
                    formInventory: Number(formData.inventory) || 0,
                    loadedProduct: originalProductRef.current,
                    liveProduct,
                });

                const rawPA = formData.purchaseActivity;
                const existingPA = liveProduct?.purchaseActivity;
                const displayMode: PurchaseActivityDisplayMode = rawPA?.displayMode || (rawPA?.isCustomCount ? "custom" : "auto");
                const customUnits = Math.min(MAX_CONFIGURED_UNITS, Math.max(0, Math.floor(Number(rawPA?.customUnitsSold ?? rawPA?.unitsSold) || 0)));
                const period: PurchaseActivityPeriod = (rawPA?.periodDays && [7, 30, 90].includes(rawPA.periodDays)) ? rawPA.periodDays : 30;
                const threshold = Math.min(1000, Math.max(0, Math.floor(Number(rawPA?.displayThreshold) || 5)));
                const countsByPeriod = existingPA?.countsByPeriod || rawPA?.countsByPeriod || { 7: 0, 30: 0, 90: 0 };
                const orderUnits = existingPA?.countsByPeriod?.[period] ?? existingPA?.orderUnitsSold ?? rawPA?.orderUnitsSold ?? countsByPeriod[period] ?? 0;
                const effectiveUnits = displayMode === "custom" ? customUnits : orderUnits;

                const sanitizedPurchaseActivity = {
                    enabled: rawPA?.enabled ?? true,
                    periodDays: period,
                    displayThreshold: threshold,
                    displayMode,
                    customUnitsSold: customUnits,
                    unitsSold: effectiveUnits,
                    orderUnitsSold: orderUnits,
                    isCustomCount: displayMode === "custom",
                    countsByPeriod,
                    qualifyingOrdersCount: existingPA?.qualifyingOrdersCount ?? rawPA?.qualifyingOrdersCount ?? 0,
                    uniquePurchasersCount: existingPA?.uniquePurchasersCount ?? rawPA?.uniquePurchasersCount ?? 0,
                    lastOrderSyncAt: existingPA?.lastOrderSyncAt ?? rawPA?.lastOrderSyncAt ?? 0,
                    lastCalculatedAt: Date.now(),
                };

                const payload = {
                    ...formData,
                    id: productId,
                    images: allImages,
                    thumbnails: allThumbnails,
                    category: finalCategory,
                    categories: finalCategories,
                    slug: formData.slug || formData.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, ''),
                    inventory: reconciled.inventory,
                    totalPhysicalInventory: reconciled.totalPhysicalInventory,
                    sizes: legacySizes,
                    hasVariants,
                    sizeMode,
                    sizesList,
                    colors,
                    variants: reconciled.variants || variants,
                    purchaseActivity: sanitizedPurchaseActivity,
                    updatedAt: Date.now(),
                };

                transaction.set(productRef, payload, { merge: true });
            });

            originalProductRef.current = null;
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
    // FLEXIBLE VARIANTS HELPERS (TASK 029)
    // =========================================================================
    const handleToggleApparelSize = (sizeName: string) => {
        const currentSizes = formData.sizesList || [];
        const exists = currentSizes.find(s => s.name.toUpperCase() === sizeName.toUpperCase());
        if (exists) {
            const updated = currentSizes.filter(s => s.id !== exists.id);
            setFormData(prev => ({ ...prev, sizesList: updated }));
        } else {
            const newOption: SizeOption = {
                id: `size-${sizeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
                name: sizeName,
                isActive: true,
                order: currentSizes.length,
            };
            setFormData(prev => ({ ...prev, sizesList: [...currentSizes, newOption] }));
        }
    };

    const handleAddCustomSize = () => {
        if (!newCustomSize.trim()) return;
        const name = newCustomSize.trim();
        const currentSizes = formData.sizesList || [];
        if (currentSizes.some(s => s.name.toLowerCase() === name.toLowerCase())) {
            alert("A size with this name already exists.");
            return;
        }
        const newOption: SizeOption = {
            id: `size-${Date.now()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
            name,
            isActive: true,
            order: currentSizes.length,
        };
        setFormData(prev => ({ ...prev, sizesList: [...currentSizes, newOption] }));
        setNewCustomSize("");
    };

    const handleAddDimensionSize = () => {
        if (!newDimensionSize.name.trim()) {
            alert("Please enter a size name (e.g. Small, Medium, Large).");
            return;
        }
        const w = Number(newDimensionSize.width) || 0;
        const h = Number(newDimensionSize.height) || 0;
        const d = newDimensionSize.depth !== "" ? Number(newDimensionSize.depth) : undefined;
        if (w <= 0 || h <= 0) {
            alert("Please enter positive numbers for width and height.");
            return;
        }

        const currentSizes = formData.sizesList || [];
        const newOption: SizeOption = {
            id: `size-dim-${Date.now()}-${newDimensionSize.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
            name: newDimensionSize.name.trim(),
            dimensions: {
                width: w,
                height: h,
                depth: d,
                unit: newDimensionSize.unit,
            },
            isActive: true,
            order: currentSizes.length,
        };
        setFormData(prev => ({ ...prev, sizesList: [...currentSizes, newOption] }));
        setNewDimensionSize({ name: "", width: "", height: "", depth: "", unit: "cm" });
    };

    const handleRemoveSizeOption = (id: string) => {
        if (!confirm("Are you sure you want to remove this size option? Any variants referencing this size may need to be refreshed.")) return;
        setFormData(prev => ({
            ...prev,
            sizesList: (prev.sizesList || []).filter(s => s.id !== id),
        }));
    };

    const handleMoveSizeOption = (index: number, direction: "up" | "down") => {
        const sizes = [...(formData.sizesList || [])];
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= sizes.length) return;
        const [item] = sizes.splice(index, 1);
        sizes.splice(targetIndex, 0, item);
        setFormData(prev => ({ ...prev, sizesList: sizes }));
    };

    const handleAddColor = (name: string, hex?: string) => {
        const colorName = name.trim();
        if (!colorName) return;
        const currentColors = formData.colors || [];
        if (currentColors.some(c => c.name.toLowerCase() === colorName.toLowerCase())) {
            alert("A color with this name already exists.");
            return;
        }
        const newCol: ColorOption = {
            id: `col-${Date.now()}-${colorName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
            name: colorName,
            hex: hex || "#000000",
            isActive: true,
        };
        setFormData(prev => ({ ...prev, colors: [...currentColors, newCol] }));
        setNewColorName("");
        setNewColorHex("#000000");
    };

    const handleRemoveColor = (id: string) => {
        if (!confirm("Are you sure you want to remove this color? Any variants referencing this color may need to be refreshed.")) return;
        setFormData(prev => ({
            ...prev,
            colors: (prev.colors || []).filter(c => c.id !== id),
        }));
    };

    const handleGenerateMatrix = () => {
        const sizes = (formData.sizesList || []).filter(s => s.isActive !== false);
        const colors = (formData.colors || []).filter(c => c.isActive !== false);

        if (sizes.length === 0 && colors.length === 0) {
            alert("Please configure at least one active size or color before generating combinations.");
            return;
        }

        const baseSku = formData.slug || formData.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "PROD";
        const { variants: newMatrix, exceededLimit, error, requestedCount, limit } = generateVariantMatrix(sizes, colors, {
            existingVariants: formData.variants || [],
            baseSku,
            basePrice: formData.price || 0,
            defaultStock: 0, // Conservative default stock
            maxLimit: MAX_VARIANT_LIMIT,
        });

        // TASK 029 Hardening: If limit exceeded, preserve existing matrix and inform admin
        if (exceededLimit) {
            alert(error || `Cannot generate variants: ${requestedCount} combinations were requested, which exceeds the supported limit of ${limit}. Existing variants were preserved.`);
            return;
        }

        const breakdown = calculateVariantStockBreakdown(newMatrix);

        setFormData(prev => ({
            ...prev,
            variants: newMatrix,
            inventory: breakdown.sellableStock,
            totalPhysicalInventory: breakdown.totalPhysicalStock,
        }));
    };

    const handleUpdateVariant = (index: number, updates: Partial<ProductVariant>) => {
        const updated = [...(formData.variants || [])];
        updated[index] = { ...updated[index], ...updates };
        const breakdown = calculateVariantStockBreakdown(updated);
        setFormData(prev => ({
            ...prev,
            variants: updated,
            inventory: breakdown.sellableStock,
            totalPhysicalInventory: breakdown.totalPhysicalStock,
        }));
    };

    const handleDeleteVariant = (index: number) => {
        if (!confirm("Warning: Deleting or disabling this variant will permanently remove it from available purchasing options. Proceed?")) return;
        const updated = [...(formData.variants || [])];
        updated.splice(index, 1);
        const breakdown = calculateVariantStockBreakdown(updated);
        setFormData(prev => ({
            ...prev,
            variants: updated,
            inventory: breakdown.sellableStock,
            totalPhysicalInventory: breakdown.totalPhysicalStock,
        }));
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

                    {/* SECTION 2: PRICING, INVENTORY & FLEXIBLE VARIANTS (TASK 029) */}
                    <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "24px", marginBottom: "24px" }} data-testid="section-pricing-variants">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
                            <div>
                                <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
                                    <span style={{ display: "inline-flex", width: "24px", height: "24px", borderRadius: "50%", backgroundColor: "var(--accent-light)", color: "var(--accent)", fontSize: "0.8rem", alignItems: "center", justifyContent: "center" }}>2</span>
                                    Pricing, Stock & Variants
                                </h3>
                                <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: "4px", marginBottom: 0 }}>
                                    Configure base pricing, stock inventory, and multi-attribute variant matrix (sizes, dimensions & colors).
                                </p>
                            </div>
                        </div>

                        {/* Base Price and Stock Grid */}
                        <div className="admin-form-grid-2" style={{ marginBottom: "20px" }}>
                            <div className="admin-form-group">
                                <label htmlFor="prod-price">Base Price (₹ INR) *</label>
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
                                <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                                    Default price for product or variants without explicit price overrides.
                                </span>
                            </div>

                            <div className="admin-form-group">
                                <label htmlFor="prod-inventory">
                                    {formData.hasVariants ? "Total Inventory (Aggregated across variants)" : "Inventory Count *"}
                                </label>
                                <input
                                    id="prod-inventory"
                                    type="number"
                                    inputMode="numeric"
                                    step="1"
                                    min="0"
                                    required
                                    disabled={formData.hasVariants}
                                    className="admin-form-input"
                                    value={formData.inventory ?? 0}
                                    onChange={(e) => setFormData({ ...formData, inventory: Number(e.target.value) })}
                                    style={formData.hasVariants ? { backgroundColor: "var(--bg-secondary)", opacity: 0.85, cursor: "not-allowed" } : {}}
                                />
                                <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                                    {formData.hasVariants
                                        ? "Automatically computed from the sum of active variant stock."
                                        : "Direct product-level stock count."}
                                </span>
                            </div>
                        </div>

                        {/* Variants Toggle Card */}
                        <div style={{
                            padding: "16px",
                            borderRadius: "14px",
                            backgroundColor: formData.hasVariants ? "rgba(0, 107, 60, 0.04)" : "var(--bg-primary)",
                            border: formData.hasVariants ? "1.5px solid var(--accent)" : "1px solid var(--border-color)",
                            marginBottom: "20px",
                            transition: "all 0.2s ease"
                        }}>
                            <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)" }}>
                                <input
                                    type="checkbox"
                                    checked={formData.hasVariants || false}
                                    onChange={(e) => {
                                        const checked = e.target.checked;
                                        setFormData(prev => ({
                                            ...prev,
                                            hasVariants: checked,
                                            sizeMode: prev.sizeMode || "apparel",
                                        }));
                                    }}
                                    style={{ width: "20px", height: "20px", accentColor: "var(--accent)" }}
                                />
                                <span>Enable Product Variants (Sizes & Colors)</span>
                            </label>
                            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginLeft: "30px", marginTop: "4px", marginBottom: 0 }}>
                                Support apparel sizes, free size, physical dimensions (e.g. 26×26 cm), custom labels, and color swatches with variant-specific SKUs, prices, stock, and images.
                            </p>
                        </div>

                        {/* IF VARIANTS ARE NOT ENABLED: RENDER LEGACY SIZES INPUT */}
                        {!formData.hasVariants && (
                            <div className="admin-form-group">
                                <label htmlFor="prod-sizes">Available Sizes (Legacy Comma-separated)</label>
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
                        )}

                        {/* IF VARIANTS ARE ENABLED: RENDER FULL CONFIGURATION SYSTEM */}
                        {formData.hasVariants && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }} data-testid="variants-config-container">
                                {/* SUBSECTION A: SIZE CONFIGURATION MODE */}
                                <div style={{ padding: "16px", borderRadius: "14px", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-primary)" }}>
                                    <h4 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                                        <span>📏 Sizing Configuration Mode</span>
                                    </h4>
                                    <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginBottom: "14px" }}>
                                        Select how product sizing is structured for storefront selection.
                                    </p>

                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px", marginBottom: "16px" }}>
                                        {[
                                            { mode: "none", label: "Mode A: No Size", desc: "No size options" },
                                            { mode: "apparel", label: "Mode B: Apparel", desc: "XS, S, M, L, XL..." },
                                            { mode: "free_size", label: "Mode C: Free Size", desc: "Auto-selected" },
                                            { mode: "dimensions", label: "Mode D: Dimensions", desc: "Small (20×20 cm)" },
                                            { mode: "custom", label: "Mode E: Custom", desc: "Mini, King, A4..." },
                                        ].map(item => {
                                            const isSelected = (formData.sizeMode || "apparel") === item.mode;
                                            return (
                                                <button
                                                    key={item.mode}
                                                    type="button"
                                                    onClick={() => {
                                                        const targetMode = item.mode as SizeMode;
                                                        let newSizes = formData.sizesList || [];
                                                        if (targetMode === "free_size") {
                                                            newSizes = [{ id: "size-free-size", name: "Free Size", isActive: true }];
                                                        } else if (targetMode === "none") {
                                                            newSizes = [];
                                                        }
                                                        setFormData(prev => ({
                                                            ...prev,
                                                            sizeMode: targetMode,
                                                            sizesList: newSizes,
                                                        }));
                                                    }}
                                                    className={`admin-filter-pill ${isSelected ? "active" : ""}`}
                                                    style={{
                                                        padding: "10px 8px",
                                                        height: "auto",
                                                        minHeight: "52px",
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        textAlign: "center",
                                                        lineHeight: 1.2
                                                    }}
                                                >
                                                    <span style={{ fontWeight: 700, fontSize: "0.82rem" }}>{item.label}</span>
                                                    <span style={{ fontSize: "0.68rem", opacity: 0.8, marginTop: "2px" }}>{item.desc}</span>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* MODE B: APPAREL SIZES CONTROLS */}
                                    {formData.sizeMode === "apparel" && (
                                        <div>
                                            <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)", display: "block", marginBottom: "6px" }}>
                                                Select Available Apparel Sizes:
                                            </label>
                                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
                                                {STANDARD_APPAREL_SIZES.map(preset => {
                                                    const isChecked = (formData.sizesList || []).some(s => s.name.toUpperCase() === preset.toUpperCase() && s.isActive !== false);
                                                    return (
                                                        <button
                                                            key={preset}
                                                            type="button"
                                                            onClick={() => handleToggleApparelSize(preset)}
                                                            className={`admin-filter-pill ${isChecked ? "active" : ""}`}
                                                            style={{ minWidth: "48px", minHeight: "36px", fontSize: "0.85rem", fontWeight: 600 }}
                                                        >
                                                            {isChecked && "✓ "}
                                                            {preset}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* MODE C: FREE SIZE CONTROLS */}
                                    {formData.sizeMode === "free_size" && (
                                        <div style={{ padding: "12px 14px", borderRadius: "10px", backgroundColor: "rgba(0, 107, 60, 0.08)", border: "1px solid rgba(0, 107, 60, 0.2)", fontSize: "0.85rem", color: "var(--accent)" }}>
                                            <strong>Free Size Configured:</strong> A universal &quot;Free Size&quot; option is automatically assigned. Storefront PDP will auto-select it seamlessly for customers.
                                        </div>
                                    )}

                                    {/* MODE D: NAMED SIZES WITH PHYSICAL DIMENSIONS */}
                                    {formData.sizeMode === "dimensions" && (
                                        <div>
                                            <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)", display: "block", marginBottom: "8px" }}>
                                                Add Named Size with Physical Dimensions (e.g. Small — 20 × 20 cm):
                                            </label>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "8px", alignItems: "flex-end", marginBottom: "12px" }}>
                                                <div>
                                                    <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", display: "block", marginBottom: "2px" }}>Name *</span>
                                                    <input
                                                        type="text"
                                                        placeholder="e.g. Small"
                                                        value={newDimensionSize.name}
                                                        onChange={(e) => setNewDimensionSize({ ...newDimensionSize, name: e.target.value })}
                                                        className="admin-form-input"
                                                        style={{ height: "36px", minHeight: "36px", fontSize: "0.82rem" }}
                                                    />
                                                </div>
                                                <div>
                                                    <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", display: "block", marginBottom: "2px" }}>Width *</span>
                                                    <input
                                                        type="number"
                                                        placeholder="20"
                                                        value={newDimensionSize.width}
                                                        onChange={(e) => setNewDimensionSize({ ...newDimensionSize, width: e.target.value === "" ? "" : Number(e.target.value) })}
                                                        className="admin-form-input"
                                                        style={{ height: "36px", minHeight: "36px", fontSize: "0.82rem" }}
                                                    />
                                                </div>
                                                <div>
                                                    <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", display: "block", marginBottom: "2px" }}>Height *</span>
                                                    <input
                                                        type="number"
                                                        placeholder="20"
                                                        value={newDimensionSize.height}
                                                        onChange={(e) => setNewDimensionSize({ ...newDimensionSize, height: e.target.value === "" ? "" : Number(e.target.value) })}
                                                        className="admin-form-input"
                                                        style={{ height: "36px", minHeight: "36px", fontSize: "0.82rem" }}
                                                    />
                                                </div>
                                                <div>
                                                    <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", display: "block", marginBottom: "2px" }}>Depth (opt)</span>
                                                    <input
                                                        type="number"
                                                        placeholder="5"
                                                        value={newDimensionSize.depth}
                                                        onChange={(e) => setNewDimensionSize({ ...newDimensionSize, depth: e.target.value === "" ? "" : Number(e.target.value) })}
                                                        className="admin-form-input"
                                                        style={{ height: "36px", minHeight: "36px", fontSize: "0.82rem" }}
                                                    />
                                                </div>
                                                <div>
                                                    <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", display: "block", marginBottom: "2px" }}>Unit</span>
                                                    <select
                                                        value={newDimensionSize.unit}
                                                        onChange={(e) => setNewDimensionSize({ ...newDimensionSize, unit: e.target.value as DimensionUnit })}
                                                        className="admin-form-input"
                                                        style={{ height: "36px", minHeight: "36px", fontSize: "0.82rem" }}
                                                    >
                                                        <option value="cm">cm</option>
                                                        <option value="mm">mm</option>
                                                        <option value="inch">inches</option>
                                                        <option value="m">m</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <button
                                                        type="button"
                                                        onClick={handleAddDimensionSize}
                                                        className="admin-btn admin-btn-primary"
                                                        style={{ width: "100%", height: "36px", minHeight: "36px", fontSize: "0.82rem", padding: "0 10px" }}
                                                    >
                                                        + Add
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Configured Dimension Sizes List */}
                                            {(formData.sizesList || []).length > 0 && (
                                                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                                    {(formData.sizesList || []).map((s, idx) => (
                                                        <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 12px", borderRadius: "8px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", fontSize: "0.85rem" }}>
                                                            <div>
                                                                <strong>{s.name}</strong>
                                                                {s.dimensions && (
                                                                    <span style={{ marginLeft: "8px", color: "var(--text-secondary)", fontSize: "0.8rem" }}>
                                                                        ({formatDimensions(s.dimensions)})
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div style={{ display: "flex", gap: "6px" }}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleRemoveSizeOption(s.id)}
                                                                    className="admin-btn admin-btn-danger admin-btn-sm"
                                                                    style={{ padding: "2px 8px", fontSize: "0.75rem", minHeight: "26px" }}
                                                                >
                                                                    Remove
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* MODE E: CUSTOM SIZE LABELS */}
                                    {formData.sizeMode === "custom" && (
                                        <div>
                                            <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)", display: "block", marginBottom: "6px" }}>
                                                Add Custom Size Label (e.g. Mini, Regular, King, 8-inch, A4):
                                            </label>
                                            <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                                                <input
                                                    type="text"
                                                    placeholder="Enter custom size label..."
                                                    value={newCustomSize}
                                                    onChange={(e) => setNewCustomSize(e.target.value)}
                                                    className="admin-form-input"
                                                    style={{ height: "36px", minHeight: "36px", fontSize: "0.85rem" }}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleAddCustomSize}
                                                    className="admin-btn admin-btn-primary"
                                                    style={{ height: "36px", minHeight: "36px", fontSize: "0.85rem", whiteSpace: "nowrap" }}
                                                >
                                                    + Add Size
                                                </button>
                                            </div>

                                            {/* Configured Custom Sizes List */}
                                            {(formData.sizesList || []).length > 0 && (
                                                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                                    {(formData.sizesList || []).map((s, idx) => (
                                                        <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 12px", borderRadius: "8px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", fontSize: "0.85rem" }}>
                                                            <span><strong>{s.name}</strong></span>
                                                            <div style={{ display: "flex", gap: "4px" }}>
                                                                <button
                                                                    type="button"
                                                                    disabled={idx === 0}
                                                                    onClick={() => handleMoveSizeOption(idx, "up")}
                                                                    className="admin-btn admin-btn-secondary admin-btn-sm"
                                                                    style={{ padding: "2px 6px", fontSize: "0.75rem", minHeight: "26px" }}
                                                                >
                                                                    ▲
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    disabled={idx === (formData.sizesList || []).length - 1}
                                                                    onClick={() => handleMoveSizeOption(idx, "down")}
                                                                    className="admin-btn admin-btn-secondary admin-btn-sm"
                                                                    style={{ padding: "2px 6px", fontSize: "0.75rem", minHeight: "26px" }}
                                                                >
                                                                    ▼
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleRemoveSizeOption(s.id)}
                                                                    className="admin-btn admin-btn-danger admin-btn-sm"
                                                                    style={{ padding: "2px 8px", fontSize: "0.75rem", minHeight: "26px" }}
                                                                >
                                                                    Remove
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* MODE A: NO SIZES */}
                                    {formData.sizeMode === "none" && (
                                        <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontStyle: "italic" }}>
                                            No size options configured. Variants can be color-only, or leave colors empty for single product inventory.
                                        </div>
                                    )}
                                </div>

                                {/* SUBSECTION B: COLOR VARIANTS */}
                                <div style={{ padding: "16px", borderRadius: "14px", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-primary)" }}>
                                    <h4 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                                        <span>🎨 Product Color Swatches</span>
                                    </h4>
                                    <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginBottom: "12px" }}>
                                        Add optional color selections with visual swatches and associated gallery photos.
                                    </p>

                                    {/* Preset Swatches Quick-Add */}
                                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "14px" }}>
                                        {COLOR_PRESETS.map(preset => {
                                            const isAdded = (formData.colors || []).some(c => c.name.toLowerCase() === preset.name.toLowerCase());
                                            return (
                                                <button
                                                    key={preset.name}
                                                    type="button"
                                                    onClick={() => !isAdded && handleAddColor(preset.name, preset.hex)}
                                                    className={`admin-filter-pill ${isAdded ? "active" : ""}`}
                                                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "0.78rem", padding: "4px 10px", minHeight: "32px", opacity: isAdded ? 0.6 : 1 }}
                                                >
                                                    <span style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: preset.hex, border: "1px solid rgba(0,0,0,0.2)" }} />
                                                    {preset.name} {isAdded && "✓"}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* Add Custom Color Form */}
                                    <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "16px", flexWrap: "wrap" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                            <input
                                                type="color"
                                                value={newColorHex}
                                                onChange={(e) => setNewColorHex(e.target.value)}
                                                style={{ width: "38px", height: "38px", padding: "0", border: "1px solid var(--border-color)", borderRadius: "8px", cursor: "pointer" }}
                                                title="Pick color"
                                            />
                                            <input
                                                type="text"
                                                value={newColorHex}
                                                onChange={(e) => setNewColorHex(e.target.value)}
                                                className="admin-form-input"
                                                style={{ width: "85px", height: "36px", minHeight: "36px", fontSize: "0.82rem", textTransform: "uppercase" }}
                                                placeholder="#HEX"
                                            />
                                        </div>
                                        <div style={{ flex: 1, minWidth: "140px" }}>
                                            <input
                                                type="text"
                                                placeholder="Color Name (e.g. Royal Blue)..."
                                                value={newColorName}
                                                onChange={(e) => setNewColorName(e.target.value)}
                                                className="admin-form-input"
                                                style={{ height: "36px", minHeight: "36px", fontSize: "0.85rem" }}
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleAddColor(newColorName, newColorHex)}
                                            className="admin-btn admin-btn-primary"
                                            style={{ height: "36px", minHeight: "36px", fontSize: "0.85rem" }}
                                        >
                                            + Add Color
                                        </button>
                                    </div>

                                    {/* Configured Colors List */}
                                    {(formData.colors || []).length > 0 && (
                                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                            {(formData.colors || []).map((col) => (
                                                <div key={col.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: "10px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", flexWrap: "wrap", gap: "8px" }}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                                        <span style={{ width: "20px", height: "20px", borderRadius: "50%", backgroundColor: col.hex || "#ccc", border: "1px solid rgba(0,0,0,0.2)" }} />
                                                        <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>{col.name}</span>
                                                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>({col.hex || "no swatch"})</span>
                                                    </div>
                                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                                        {/* Optional Associated Gallery Image */}
                                                        <select
                                                            value={col.image || ""}
                                                            onChange={(e) => {
                                                                const img = e.target.value || undefined;
                                                                setFormData(prev => ({
                                                                    ...prev,
                                                                    colors: (prev.colors || []).map(c => c.id === col.id ? { ...c, image: img } : c)
                                                                }));
                                                            }}
                                                            className="admin-form-input"
                                                            style={{ height: "30px", minHeight: "30px", fontSize: "0.75rem", padding: "2px 8px", width: "160px" }}
                                                        >
                                                            <option value="">No Color Photo</option>
                                                            {galleryItems.map((item, idx) => (
                                                                <option key={item.id} value={item.src}>Photo {idx + 1} {featuredImageId === item.id ? "(HERO)" : ""}</option>
                                                            ))}
                                                        </select>

                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveColor(col.id)}
                                                            className="admin-btn admin-btn-danger admin-btn-sm"
                                                            style={{ padding: "2px 8px", fontSize: "0.75rem", minHeight: "28px" }}
                                                        >
                                                            Remove
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* SUBSECTION C: COMBINATION MATRIX GENERATOR */}
                                <div style={{ padding: "16px", borderRadius: "14px", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-primary)" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "12px" }}>
                                        <div>
                                            <h4 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
                                                ⚡ Variant Combination Matrix
                                            </h4>
                                            <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "2px", marginBottom: 0 }}>
                                                Active Sizes: {(formData.sizesList || []).filter(s => s.isActive !== false).length} &nbsp;|&nbsp; Active Colors: {(formData.colors || []).filter(c => c.isActive !== false).length} &nbsp;|&nbsp; Current Combinations: {(formData.variants || []).length} (Max {MAX_VARIANT_LIMIT})
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleGenerateMatrix}
                                            className="admin-btn admin-btn-primary admin-btn-sm"
                                            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                                            Generate / Refresh Matrix
                                        </button>
                                    </div>

                                    {/* Notice about SKU and Price persistence */}
                                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                                        Clicking &quot;Generate / Refresh Matrix&quot; creates all enabled combinations while preserving any custom SKUs, prices, stock, and photo associations you have already configured.
                                    </div>

                                    {/* Empty Matrix State */}
                                    {(!formData.variants || formData.variants.length === 0) && (
                                        <div style={{ padding: "24px 16px", textAlign: "center", backgroundColor: "var(--bg-secondary)", borderRadius: "10px", border: "1px dashed var(--border-color)", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                                            No variant combinations generated yet. Select your sizing mode and colors above, then click &quot;Generate / Refresh Matrix&quot;.
                                        </div>
                                    )}

                                    {/* Desktop Matrix Table (>= 768px) */}
                                    {formData.variants && formData.variants.length > 0 && (
                                        <div className="admin-table-container" style={{ maxHeight: "380px", overflowY: "auto", border: "1px solid var(--border-color)", borderRadius: "10px", marginBottom: "12px" }}>
                                            <table className="admin-table" style={{ fontSize: "0.82rem" }}>
                                                <thead>
                                                    <tr>
                                                        <th style={{ width: "36px" }}>Active</th>
                                                        <th>Option Combination</th>
                                                        <th>SKU</th>
                                                        <th>Price (₹) Override</th>
                                                        <th>Stock Count</th>
                                                        <th>Photo</th>
                                                        <th style={{ textAlign: "right" }}>Action</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {formData.variants.map((v, vIdx) => {
                                                        const labelParts: string[] = [];
                                                        if (v.sizeName) labelParts.push(v.sizeName);
                                                        if (v.colorName) labelParts.push(v.colorName);
                                                        const comboLabel = labelParts.length > 0 ? labelParts.join(" / ") : "Default";

                                                        return (
                                                            <tr key={v.id || vIdx} style={{ opacity: v.isActive === false ? 0.5 : 1 }}>
                                                                <td>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={v.isActive !== false}
                                                                        onChange={(e) => handleUpdateVariant(vIdx, { isActive: e.target.checked })}
                                                                        style={{ width: "16px", height: "16px", accentColor: "var(--accent)" }}
                                                                        title="Enable/disable this variant"
                                                                    />
                                                                </td>
                                                                <td>
                                                                    <div style={{ fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
                                                                        {comboLabel}
                                                                    </div>
                                                                </td>
                                                                <td>
                                                                    <input
                                                                        type="text"
                                                                        value={v.sku || ""}
                                                                        onChange={(e) => handleUpdateVariant(vIdx, { sku: e.target.value })}
                                                                        className="admin-form-input"
                                                                        style={{ height: "28px", minHeight: "28px", fontSize: "0.78rem", padding: "2px 6px", width: "120px" }}
                                                                        placeholder="SKU"
                                                                    />
                                                                </td>
                                                                <td>
                                                                    <input
                                                                        type="number"
                                                                        value={typeof v.price === "number" ? v.price : ""}
                                                                        onChange={(e) => handleUpdateVariant(vIdx, { price: e.target.value === "" ? null : Number(e.target.value) })}
                                                                        className="admin-form-input"
                                                                        style={{ height: "28px", minHeight: "28px", fontSize: "0.78rem", padding: "2px 6px", width: "95px" }}
                                                                        placeholder={`₹${formData.price || 0}`}
                                                                    />
                                                                </td>
                                                                <td>
                                                                    <input
                                                                        type="number"
                                                                        min="0"
                                                                        value={v.inventory ?? 0}
                                                                        onChange={(e) => handleUpdateVariant(vIdx, { inventory: Math.max(0, Number(e.target.value) || 0) })}
                                                                        className="admin-form-input"
                                                                        style={{ height: "28px", minHeight: "28px", fontSize: "0.78rem", padding: "2px 6px", width: "70px" }}
                                                                    />
                                                                </td>
                                                                <td>
                                                                    <select
                                                                        value={v.image || ""}
                                                                        onChange={(e) => handleUpdateVariant(vIdx, { image: e.target.value || undefined })}
                                                                        className="admin-form-input"
                                                                        style={{ height: "28px", minHeight: "28px", fontSize: "0.75rem", padding: "2px 6px", width: "105px" }}
                                                                    >
                                                                        <option value="">Default Hero</option>
                                                                        {galleryItems.map((item, idx) => (
                                                                            <option key={item.id} value={item.src}>Photo {idx + 1}</option>
                                                                        ))}
                                                                    </select>
                                                                </td>
                                                                <td style={{ textAlign: "right" }}>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleDeleteVariant(vIdx)}
                                                                        className="admin-btn admin-btn-danger admin-btn-sm"
                                                                        style={{ padding: "2px 6px", fontSize: "0.75rem", minHeight: "26px" }}
                                                                        title="Delete variant combination"
                                                                    >
                                                                        ✕
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    {/* Mobile Responsive Cards for Matrix (< 768px) */}
                                    {formData.variants && formData.variants.length > 0 && (
                                        <div className="admin-mobile-cards-list" style={{ marginTop: "12px" }}>
                                            {formData.variants.map((v, vIdx) => {
                                                const labelParts: string[] = [];
                                                if (v.sizeName) labelParts.push(v.sizeName);
                                                if (v.colorName) labelParts.push(v.colorName);
                                                const comboLabel = labelParts.length > 0 ? labelParts.join(" / ") : "Default";

                                                return (
                                                    <div key={v.id || vIdx} className="admin-mobile-item-card" style={{ padding: "12px", border: "1px solid var(--border-color)", opacity: v.isActive === false ? 0.6 : 1 }}>
                                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                                                            <strong style={{ fontSize: "0.9rem" }}>{comboLabel}</strong>
                                                            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.75rem", cursor: "pointer" }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={v.isActive !== false}
                                                                    onChange={(e) => handleUpdateVariant(vIdx, { isActive: e.target.checked })}
                                                                    style={{ accentColor: "var(--accent)" }}
                                                                />
                                                                Active
                                                            </label>
                                                        </div>

                                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                                                            <div>
                                                                <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", display: "block" }}>SKU</span>
                                                                <input
                                                                    type="text"
                                                                    value={v.sku || ""}
                                                                    onChange={(e) => handleUpdateVariant(vIdx, { sku: e.target.value })}
                                                                    className="admin-form-input"
                                                                    style={{ height: "30px", minHeight: "30px", fontSize: "0.78rem" }}
                                                                    placeholder="SKU"
                                                                />
                                                            </div>
                                                            <div>
                                                                <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", display: "block" }}>Price Override (₹)</span>
                                                                <input
                                                                    type="number"
                                                                    value={typeof v.price === "number" ? v.price : ""}
                                                                    onChange={(e) => handleUpdateVariant(vIdx, { price: e.target.value === "" ? null : Number(e.target.value) })}
                                                                    className="admin-form-input"
                                                                    style={{ height: "30px", minHeight: "30px", fontSize: "0.78rem" }}
                                                                    placeholder={`Base (₹${formData.price || 0})`}
                                                                />
                                                            </div>
                                                        </div>

                                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", alignItems: "center" }}>
                                                            <div>
                                                                <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", display: "block" }}>Stock Count</span>
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    value={v.inventory ?? 0}
                                                                    onChange={(e) => handleUpdateVariant(vIdx, { inventory: Math.max(0, Number(e.target.value) || 0) })}
                                                                    className="admin-form-input"
                                                                    style={{ height: "30px", minHeight: "30px", fontSize: "0.78rem" }}
                                                                />
                                                            </div>
                                                            <div style={{ display: "flex", gap: "4px", alignItems: "flex-end" }}>
                                                                <div style={{ flex: 1 }}>
                                                                    <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", display: "block" }}>Photo</span>
                                                                    <select
                                                                        value={v.image || ""}
                                                                        onChange={(e) => handleUpdateVariant(vIdx, { image: e.target.value || undefined })}
                                                                        className="admin-form-input"
                                                                        style={{ height: "30px", minHeight: "30px", fontSize: "0.72rem", padding: "2px 4px" }}
                                                                    >
                                                                        <option value="">Default</option>
                                                                        {galleryItems.map((item, idx) => (
                                                                            <option key={item.id} value={item.src}>Photo {idx + 1}</option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDeleteVariant(vIdx)}
                                                                    className="admin-btn admin-btn-danger admin-btn-sm"
                                                                    style={{ height: "30px", minHeight: "30px", padding: "0 8px" }}
                                                                >
                                                                    ✕
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Total Stock Across Variants Summary */}
                                    {formData.variants && formData.variants.length > 0 && (
                                        <div style={{ marginTop: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: "8px", backgroundColor: "var(--bg-secondary)", fontSize: "0.85rem", fontWeight: 600 }}>
                                            <span style={{ color: "var(--text-secondary)" }}>Total Stock Across Active Variants:</span>
                                            <span style={{ color: "var(--accent)", fontSize: "0.95rem", fontWeight: 700 }}>
                                                {formData.variants.filter(v => v.isActive !== false).reduce((sum, v) => sum + (Number(v.inventory) || 0), 0)} units
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
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
                                <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)", textAlign: "center" }}>
                                    Recommended: 4:5 portrait (1200 × 1500 px). Square, landscape, and other image ratios are supported. The complete image will be shown on the product detail page.
                                </span>
                                <span style={{ fontSize: "0.73rem", color: "var(--text-secondary)", textAlign: "center" }}>
                                    Catalog cards use a cropped cover preview for a consistent grid layout · JPEG, PNG, WebP · Max 10MB · Auto-optimized to R2
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
                                    Configure the live purchasing activity badge displayed on the storefront product detail page.
                                </p>
                            </div>
                            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--accent)", background: "var(--accent-light)", padding: "4px 8px", borderRadius: "6px" }}>
                                    Storefront Live Counter
                                </span>
                                {formData.purchaseActivity?.displayMode === "custom" || formData.purchaseActivity?.isCustomCount ? (
                                    <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "#0369a1", background: "rgba(14, 165, 233, 0.12)", padding: "4px 8px", borderRadius: "6px" }}>
                                        Admin Configured
                                    </span>
                                ) : (
                                    <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "#15803d", background: "#EAF8EE", padding: "4px 8px", borderRadius: "6px" }}>
                                        Order Derived
                                    </span>
                                )}
                            </div>
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
                                When enabled, product detail pages display the live purchase badge (e.g. &quot;24 units sold in the past 30 days&quot;) if sales meet the display threshold.
                            </p>
                        </div>

                        {/* Mode Selection: Automatic vs Manual */}
                        <div style={{ marginBottom: "18px" }}>
                            <label style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-primary)", display: "block", marginBottom: "8px" }}>
                                Sales Metric Calculation Mode
                            </label>
                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setFormData(prev => {
                                            const pa = prev.purchaseActivity || { enabled: true, periodDays: 30, displayThreshold: 5, customUnitsSold: 0 };
                                            const period = pa.periodDays || 30;
                                            const orderUnits = pa.orderUnitsSold ?? pa.countsByPeriod?.[period] ?? 0;
                                            return {
                                                ...prev,
                                                purchaseActivity: {
                                                    ...pa,
                                                    displayMode: "auto",
                                                    isCustomCount: false,
                                                    unitsSold: orderUnits,
                                                },
                                            };
                                        });
                                    }}
                                    className={`admin-filter-pill ${(!formData.purchaseActivity?.displayMode || formData.purchaseActivity?.displayMode === "auto") ? "active" : ""}`}
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "6px",
                                        padding: "6px 14px",
                                        fontSize: "0.85rem",
                                        fontWeight: 600,
                                        borderRadius: "8px",
                                        cursor: "pointer",
                                    }}
                                >
                                    ⚡ Automatic (Live Orders)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setFormData(prev => {
                                            const pa = prev.purchaseActivity || { enabled: true, periodDays: 30, displayThreshold: 5, customUnitsSold: 0 };
                                            const customUnits = typeof pa.customUnitsSold === "number" ? pa.customUnitsSold : (pa.unitsSold ?? 24);
                                            return {
                                                ...prev,
                                                purchaseActivity: {
                                                    ...pa,
                                                    displayMode: "custom",
                                                    isCustomCount: true,
                                                    customUnitsSold: customUnits,
                                                    unitsSold: customUnits,
                                                },
                                            };
                                        });
                                    }}
                                    className={`admin-filter-pill ${formData.purchaseActivity?.displayMode === "custom" ? "active" : ""}`}
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "6px",
                                        padding: "6px 14px",
                                        fontSize: "0.85rem",
                                        fontWeight: 600,
                                        borderRadius: "8px",
                                        cursor: "pointer",
                                    }}
                                >
                                    ✏️ Manual (Admin Configured)
                                </button>
                            </div>
                        </div>

                        {/* Mode-Specific Panel: Custom vs Auto */}
                        {formData.purchaseActivity?.displayMode === "custom" ? (
                            <div style={{ padding: "16px", borderRadius: "12px", background: "var(--bg-primary)", border: "1.5px solid var(--accent)", marginBottom: "16px" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "8px" }}>
                                    <label htmlFor="live-units-sold" style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
                                        ✏️ Configured Units Sold (Storefront Display Count)
                                    </label>
                                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                                        Saves directly to live product page
                                    </span>
                                </div>
                                <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "12px" }}>
                                    Specify the active sales count to render on the customer-facing storefront. Choose a preset or enter any integer from 0 to {MAX_CONFIGURED_UNITS.toLocaleString()}.
                                </p>

                                <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", marginBottom: "12px" }}>
                                    <input
                                        id="live-units-sold"
                                        type="number"
                                        min="0"
                                        max={MAX_CONFIGURED_UNITS}
                                        value={formData.purchaseActivity?.customUnitsSold ?? formData.purchaseActivity?.unitsSold ?? 0}
                                        onChange={(e) => {
                                            const count = Math.min(MAX_CONFIGURED_UNITS, Math.max(0, Math.floor(Number(e.target.value) || 0)));
                                            setFormData(prev => ({
                                                ...prev,
                                                purchaseActivity: {
                                                    ...(prev.purchaseActivity || { enabled: true, periodDays: 30, displayThreshold: 5 }),
                                                    displayMode: "custom",
                                                    isCustomCount: true,
                                                    customUnitsSold: count,
                                                    unitsSold: count,
                                                },
                                            }));
                                        }}
                                        className="admin-form-input"
                                        style={{ width: "130px", fontSize: "1.1rem", fontWeight: 700, height: "40px", textAlign: "center", borderColor: "var(--accent)" }}
                                    />

                                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                                        <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-secondary)" }}>Quick Presets:</span>
                                        {[0, 8, 18, 24, 50, 100, 250].map((sampleVal) => {
                                            const currentVal = formData.purchaseActivity?.customUnitsSold ?? formData.purchaseActivity?.unitsSold ?? 0;
                                            const isSelected = currentVal === sampleVal;
                                            return (
                                                <button
                                                    key={sampleVal}
                                                    type="button"
                                                    onClick={() => {
                                                        setFormData(prev => ({
                                                            ...prev,
                                                            purchaseActivity: {
                                                                ...(prev.purchaseActivity || { enabled: true, periodDays: 30, displayThreshold: 5 }),
                                                                displayMode: "custom",
                                                                isCustomCount: true,
                                                                customUnitsSold: sampleVal,
                                                                unitsSold: sampleVal,
                                                            },
                                                        }));
                                                    }}
                                                    className="admin-filter-pill"
                                                    style={{
                                                        fontSize: "0.8rem",
                                                        fontWeight: 600,
                                                        padding: "4px 10px",
                                                        minHeight: "30px",
                                                        background: isSelected ? "var(--accent)" : "var(--bg-secondary)",
                                                        color: isSelected ? "#ffffff" : "var(--text-primary)",
                                                        borderColor: isSelected ? "var(--accent)" : "var(--border-color)",
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    {sampleVal} {sampleVal === 1 ? "unit" : "units"}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div style={{ padding: "14px 16px", borderRadius: "12px", background: "rgba(34, 197, 94, 0.06)", border: "1.5px solid #86efac", marginBottom: "16px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                                    <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "#15803d" }}>
                                        ⚡ Automatic Order-Derived Sales Count
                                    </span>
                                    <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: "4px", backgroundColor: "#EAF8EE", color: "#006B3C", fontWeight: 600 }}>
                                        Active Mode
                                    </span>
                                </div>
                                <p style={{ fontSize: "0.82rem", color: "#166534", margin: 0 }}>
                                    Storefront automatically displays verified units sold calculated from genuine completed orders in Firestore over the rolling {formData.purchaseActivity?.periodDays || 30}-day window.
                                    Current active order count: <strong>{formData.purchaseActivity?.orderUnitsSold ?? formData.purchaseActivity?.countsByPeriod?.[formData.purchaseActivity?.periodDays || 30] ?? 0} units</strong>.
                                </p>
                            </div>
                        )}

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
                                        setFormData(prev => {
                                            const pa = prev.purchaseActivity || { enabled: true, displayThreshold: 5, unitsSold: 0 };
                                            const isCustom = pa.displayMode === "custom";
                                            const orderUnits = pa.countsByPeriod?.[period] ?? pa.orderUnitsSold ?? 0;
                                            const customUnits = pa.customUnitsSold ?? 0;
                                            return {
                                                ...prev,
                                                purchaseActivity: {
                                                    ...pa,
                                                    periodDays: period,
                                                    unitsSold: isCustom ? customUnits : orderUnits,
                                                    orderUnitsSold: orderUnits,
                                                },
                                            };
                                        });
                                    }}
                                >
                                    <option value={7}>Past 7 days (rolling)</option>
                                    <option value={30}>Past 30 days (rolling - recommended)</option>
                                    <option value={90}>Past 90 days (rolling)</option>
                                </select>
                                <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                                    Displays as &quot;X units sold in the past {formData.purchaseActivity?.periodDays || 30} days&quot;.
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
                                        setFormData(prev => ({
                                            ...prev,
                                            purchaseActivity: {
                                                ...(prev.purchaseActivity || { enabled: true, periodDays: 30, unitsSold: 0 }),
                                                displayThreshold: threshold,
                                            },
                                        }));
                                    }}
                                >
                                    <option value={0}>Always show count (0+ units)</option>
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
                                padding: "14px 16px",
                                borderRadius: "12px",
                                background: "var(--bg-primary)",
                                border: "1px solid var(--border-color)",
                                marginBottom: "16px",
                            }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "8px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-primary)" }}>
                                        Authoritative Genuine Order Sync
                                    </span>
                                    <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: "4px", backgroundColor: "#EAF8EE", color: "#006B3C", fontWeight: 600 }}>
                                        Firestore Orders
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleRecalculateActivity}
                                    className="admin-btn admin-btn-secondary admin-btn-sm"
                                    disabled={isRecalculatingActivity || !formData.id}
                                    style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                                    title="Query actual commercial orders in Firestore"
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
                                            Fetch from Genuine Orders
                                        </>
                                    )}
                                </button>
                            </div>

                            {activityMessage && (
                                <div style={{ fontSize: "0.82rem", fontWeight: 600, color: activityMessage.startsWith("Error") ? "#ef4444" : "#15803d", marginBottom: "8px", padding: "6px 10px", borderRadius: "6px", backgroundColor: activityMessage.startsWith("Error") ? "rgba(239, 68, 68, 0.1)" : "rgba(34, 197, 94, 0.1)" }}>
                                    {activityMessage}
                                </div>
                            )}

                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px" }}>
                                <div style={{ padding: "8px", borderRadius: "6px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", textAlign: "center" }}>
                                    <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontWeight: 500 }}>7 Days (Orders)</div>
                                    <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)" }}>
                                        {formData.purchaseActivity?.countsByPeriod?.[7] ?? 0} <span style={{ fontSize: "0.72rem", fontWeight: 500, color: "var(--text-secondary)" }}>units</span>
                                    </div>
                                </div>
                                <div style={{ padding: "8px", borderRadius: "6px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", textAlign: "center" }}>
                                    <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontWeight: 500 }}>30 Days (Orders)</div>
                                    <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--accent)" }}>
                                        {formData.purchaseActivity?.countsByPeriod?.[30] ?? formData.purchaseActivity?.orderUnitsSold ?? 0} <span style={{ fontSize: "0.72rem", fontWeight: 500, color: "var(--text-secondary)" }}>units</span>
                                    </div>
                                </div>
                                <div style={{ padding: "8px", borderRadius: "6px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", textAlign: "center" }}>
                                    <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontWeight: 500 }}>90 Days (Orders)</div>
                                    <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)" }}>
                                        {formData.purchaseActivity?.countsByPeriod?.[90] ?? 0} <span style={{ fontSize: "0.72rem", fontWeight: 500, color: "var(--text-secondary)" }}>units</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Storefront Live Preview Card */}
                        {(() => {
                            const isEnabled = formData.purchaseActivity?.enabled ?? true;
                            const isCustomMode = formData.purchaseActivity?.displayMode === "custom";
                            const period = formData.purchaseActivity?.periodDays || 30;
                            const orderUnits = formData.purchaseActivity?.orderUnitsSold ?? formData.purchaseActivity?.countsByPeriod?.[period] ?? 0;
                            const customUnits = formData.purchaseActivity?.customUnitsSold ?? 0;
                            const currentUnits = isCustomMode ? customUnits : orderUnits;
                            const threshold = formData.purchaseActivity?.displayThreshold ?? 5;
                            const isBelowThreshold = currentUnits < threshold;
                            const isVisibleOnPdp = isEnabled && !isBelowThreshold && currentUnits > 0;

                            return (
                                <div
                                    style={{
                                        padding: "16px",
                                        borderRadius: "12px",
                                        background: isVisibleOnPdp ? "#f0fdf4" : (isEnabled ? "#fffbeb" : "#fef2f2"),
                                        border: `1.5px solid ${isVisibleOnPdp ? "#86efac" : (isEnabled ? "#fde68a" : "#fca5a5")}`,
                                    }}
                                    data-testid="purchase-activity-simulation-panel"
                                >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "8px" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                            <span style={{ fontSize: "0.88rem", fontWeight: 700, color: isVisibleOnPdp ? "#15803d" : (isEnabled ? "#92400e" : "#b91c1c") }}>
                                                👁️ Storefront Live Preview
                                            </span>
                                            {isVisibleOnPdp ? (
                                                <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px", borderRadius: "4px", backgroundColor: "#15803d", color: "#ffffff", letterSpacing: "0.03em" }}>
                                                    ACTIVE ON STOREFRONT
                                                </span>
                                            ) : isEnabled ? (
                                                <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px", borderRadius: "4px", backgroundColor: "#ca8a04", color: "#ffffff", letterSpacing: "0.03em" }}>
                                                    HIDDEN (BELOW THRESHOLD)
                                                </span>
                                            ) : (
                                                <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px", borderRadius: "4px", backgroundColor: "#dc2626", color: "#ffffff", letterSpacing: "0.03em" }}>
                                                    DISPLAY DISABLED
                                                </span>
                                            )}
                                        </div>
                                        <span style={{ fontSize: "0.75rem", color: isVisibleOnPdp ? "#166534" : (isEnabled ? "#b45309" : "#991b1b") }}>
                                            Renders below price on product detail page
                                        </span>
                                    </div>

                                    <p style={{ fontSize: "0.78rem", color: isVisibleOnPdp ? "#166534" : (isEnabled ? "#92400e" : "#7f1d1d"), marginBottom: "12px" }}>
                                        {isVisibleOnPdp
                                            ? `This active badge (${currentUnits} units sold in past ${period} days) will appear for all customers on https://bazaarvilla.com/products/[slug] once saved.`
                                            : isEnabled
                                                ? `The badge is currently hidden because sales (${currentUnits}) is less than display threshold (${threshold}). Select "Always show count (0+ units)" above to make it visible now.`
                                                : "The purchase activity badge is turned off. Check \"Enable Purchase Activity Display\" above to make it visible."
                                        }
                                    </p>

                                    {/* Render the actual badge */}
                                    <div style={{ padding: "8px 0" }}>
                                        {isVisibleOnPdp ? (
                                            <ProductPurchaseActivity
                                                activity={{
                                                    enabled: isEnabled,
                                                    periodDays: period,
                                                    displayThreshold: threshold,
                                                    unitsSold: currentUnits,
                                                    lastCalculatedAt: formData.purchaseActivity?.lastCalculatedAt,
                                                }}
                                            />
                                        ) : (
                                            <div style={{ display: "inline-flex", flexDirection: "column", gap: "4px" }}>
                                                <ProductPurchaseActivity
                                                    isSimulated={true}
                                                    simulatedCount={currentUnits || 24}
                                                    simulatedPeriod={period}
                                                />
                                                <span style={{ fontSize: "0.72rem", color: isEnabled ? "#b45309" : "#dc2626", fontStyle: "italic" }}>
                                                    (Preview only — this badge will be hidden on live storefront with current settings)
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}
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
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                    <button
                        type="button"
                        onClick={() => setIsImportModalOpen(true)}
                        className="admin-btn admin-btn-secondary"
                        aria-label="Import products from CSV"
                        style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Import CSV
                    </button>
                    <button
                        type="button"
                        onClick={handleAddNew}
                        className="admin-btn admin-btn-primary"
                        aria-label="Add new product to catalog"
                    >
                        + Add Product
                    </button>
                </div>
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
                                            {product.hasVariants && Array.isArray(product.variants) && product.variants.length > 0 && (
                                                <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", backgroundColor: "#f3e8ff", color: "#7e22ce", border: "1px solid #e9d5ff" }}>
                                                    {product.variants.length} Variants
                                                </span>
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
                                            {product.hasVariants && Array.isArray(product.variants) && product.variants.length > 0 && (
                                                <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", backgroundColor: "#f3e8ff", color: "#7e22ce", border: "1px solid #e9d5ff" }}>
                                                    {product.variants.length} Variants
                                                </span>
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

            {/* Bulk Product Importer Modal (TASK 030) */}
            <ProductImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
            />
        </div>
    );
}
