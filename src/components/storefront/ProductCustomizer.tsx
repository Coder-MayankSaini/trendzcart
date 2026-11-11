"use client";

import { useState, useEffect, useMemo } from "react";
import { useCart } from "@/context/CartContext";
import { ensureAuthenticatedUser } from "@/lib/auth/guestAuth";
import { isCustomizableProduct } from "@/lib/orders/customizationEligibility";
import { v4 as uuidv4 } from "uuid";
import type {
    SizeDimension,
    SizeMode,
    SizeOption,
    ColorOption,
    ProductVariant,
} from "@/lib/products/variants";
import {
    formatDimensions,
    formatSizeDisplay,
    resolveMatchingVariant,
    getEffectivePrice,
} from "@/lib/products/variants";

interface ProductProps {
    id: string;
    name: string;
    price: number;
    image: string;
    inventory?: number;
    isCustomized?: boolean;
    customizationType?: "requires_name" | "requires_picture" | null | string;
    customizable?: boolean;
    isPersonalized?: boolean;
    sizes?: string[]; // Legacy simple string sizes
    // Flexible variant props (TASK 029)
    hasVariants?: boolean;
    sizeMode?: SizeMode;
    sizesList?: SizeOption[];
    colors?: ColorOption[];
    variants?: ProductVariant[];
    onVariantChange?: (variant: ProductVariant | null) => void;
}

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export default function ProductCustomizer({ product }: { product: ProductProps }) {
    const isCustom = isCustomizableProduct(product);
    const { addToCart } = useCart();
    const [quantity, setQuantity] = useState(1);

    // Legacy simple size state
    const [selectedLegacySize, setSelectedLegacySize] = useState("");

    // Variant attributes state (TASK 029)
    const activeSizes = useMemo(() => {
        return (product.sizesList || []).filter(s => s.isActive !== false);
    }, [product.sizesList]);

    const activeColors = useMemo(() => {
        return (product.colors || []).filter(c => c.isActive !== false);
    }, [product.colors]);

    const [selectedSizeId, setSelectedSizeId] = useState<string>("");
    const [selectedColorId, setSelectedColorId] = useState<string>("");

    // Auto-select initial variant options (e.g. Free Size, single sizes, single colors)
    useEffect(() => {
        if (product.hasVariants) {
            if (activeSizes.length > 0) {
                // Mode C: Free Size auto-select, or single size option auto-select
                if (product.sizeMode === "free_size" || activeSizes.length === 1) {
                    setSelectedSizeId(activeSizes[0].id);
                } else if (!selectedSizeId) {
                    setSelectedSizeId(activeSizes[0].id);
                }
            }
            if (activeColors.length > 0) {
                if (activeColors.length === 1 || !selectedColorId) {
                    setSelectedColorId(activeColors[0].id);
                }
            }
        } else if (product.sizes && product.sizes.length > 0) {
            if (product.sizes.length === 1 || product.sizes[0] === "Free Size") {
                setSelectedLegacySize(product.sizes[0]);
            }
        }
    }, [product.hasVariants, product.sizeMode, activeSizes, activeColors, product.sizes]);

    // Resolve matching variant
    const matchedVariant = useMemo<ProductVariant | null>(() => {
        if (!product.hasVariants || !Array.isArray(product.variants)) {
            return null;
        }
        return resolveMatchingVariant(product.variants, {
            sizeId: selectedSizeId || undefined,
            colorId: selectedColorId || undefined,
        });
    }, [product.hasVariants, product.variants, selectedSizeId, selectedColorId]);

    // Inform parent of resolved variant
    useEffect(() => {
        if (product.hasVariants) {
            product.onVariantChange?.(matchedVariant);
        }
    }, [product.hasVariants, matchedVariant, product.onVariantChange]);

    // Pricing & Availability calculations
    const effectivePrice = useMemo(() => {
        if (product.hasVariants && matchedVariant) {
            return getEffectivePrice(product.price, matchedVariant);
        }
        return Number(product.price) || 0;
    }, [product.hasVariants, product.price, matchedVariant]);

    const isVariantDisabled = product.hasVariants ? (!matchedVariant || matchedVariant.isActive === false) : false;
    const currentStock = product.hasVariants
        ? (matchedVariant ? matchedVariant.inventory : 0)
        : (typeof product.inventory === "number" ? product.inventory : 999);
    const isOutOfStock = currentStock <= 0;

    // Customization states
    const [customName, setCustomName] = useState("");
    const [customFile, setCustomFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [addedToCart, setAddedToCart] = useState(false);

    // Clean up local object URL on unmount or file change
    useEffect(() => {
        return () => {
            if (previewUrl && previewUrl.startsWith("blob:")) {
                URL.revokeObjectURL(previewUrl);
            }
        };
    }, [previewUrl]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;
        if (!file) {
            setCustomFile(null);
            if (previewUrl && previewUrl.startsWith("blob:")) {
                URL.revokeObjectURL(previewUrl);
            }
            setPreviewUrl(null);
            return;
        }

        if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
            alert("Please choose a valid JPG, PNG, or WebP image. SVG and other formats are not supported.");
            e.target.value = "";
            return;
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
            alert("The selected file exceeds the 10MB limit. Please choose a smaller photo.");
            e.target.value = "";
            return;
        }

        if (previewUrl && previewUrl.startsWith("blob:")) {
            URL.revokeObjectURL(previewUrl);
        }

        setCustomFile(file);
        setPreviewUrl(URL.createObjectURL(file));
    };

    const handleAddToCart = async (isBuyNow = false) => {
        // Variant validation
        if (product.hasVariants) {
            if (activeSizes.length > 0 && !selectedSizeId) {
                alert("Please select a size option.");
                return false;
            }
            if (activeColors.length > 0 && !selectedColorId) {
                alert("Please select a color option.");
                return false;
            }
            if (!matchedVariant) {
                alert("This specific combination is not available. Please choose another option.");
                return false;
            }
            if (matchedVariant.isActive === false) {
                alert("The selected variant is currently disabled and unavailable for purchase.");
                return false;
            }
            if (matchedVariant.inventory <= 0) {
                alert("The selected variant is currently out of stock.");
                return false;
            }
        } else if (product.sizes && product.sizes.length > 0 && !selectedLegacySize) {
            alert("Please select a size.");
            return false;
        }

        if (isCustom) {
            if (product.customizationType === "requires_name" && !customName.trim()) {
                alert("Please provide the custom name before adding to cart.");
                return false;
            }
            if (product.customizationType === "requires_picture" && !customFile) {
                alert("Please upload a picture before adding to cart.");
                return false;
            }
        }

        let pictureUrl = "";
        let storagePath = "";
        let ownerUid = "";
        let fileId = "";

        if (isCustom && product.customizationType === "requires_picture" && customFile) {
            setIsUploading(true);
            setUploadProgress(10);

            try {
                const activeUser = await ensureAuthenticatedUser();
                ownerUid = activeUser.uid;
                const idToken = await activeUser.getIdToken();

                let fileToUpload: File = customFile;
                if (customFile.size > 1 * 1024 * 1024) {
                    try {
                        const imageCompression = (await import("browser-image-compression")).default;
                        fileToUpload = await imageCompression(customFile, {
                            maxSizeMB: 2,
                            maxWidthOrHeight: 2048,
                            useWebWorker: true,
                        });
                    } catch (compressionErr) {
                        console.warn("Client compression fell back to original file:", compressionErr);
                        fileToUpload = customFile;
                    }
                }

                const authRes = await fetch("/api/uploads/authorize", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${idToken}`,
                    },
                    body: JSON.stringify({
                        folder: "customizations",
                        contentType: fileToUpload.type || "image/jpeg",
                        sizeBytes: fileToUpload.size,
                        originalName: customFile.name.substring(0, 50),
                    }),
                });

                if (!authRes.ok) {
                    const authErr = await authRes.json().catch(() => ({}));
                    throw new Error(authErr.error || "Failed to authorize upload");
                }

                const authData = await authRes.json();
                const { uploadUrl, key, sessionId, headers: presignedHeaders } = authData;
                storagePath = key;
                fileId = key.split("/").pop() || uuidv4();

                await new Promise<void>((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("PUT", uploadUrl);
                    if (presignedHeaders && typeof presignedHeaders === "object") {
                        Object.entries(presignedHeaders).forEach(([headerName, headerVal]) => {
                            xhr.setRequestHeader(headerName, headerVal as string);
                        });
                    } else {
                        xhr.setRequestHeader("Content-Type", fileToUpload.type || "image/jpeg");
                    }
                    xhr.upload.onprogress = (evt) => {
                        if (evt.lengthComputable) {
                            const percent = Math.round((evt.loaded / evt.total) * 80);
                            setUploadProgress(10 + percent);
                        }
                    };
                    xhr.onload = () => {
                        if (xhr.status >= 200 && xhr.status < 300) {
                            setUploadProgress(95);
                            resolve();
                        } else {
                            reject(new Error(`Upload to storage failed with status ${xhr.status}`));
                        }
                    };
                    xhr.onerror = () => reject(new Error("Network error during direct storage upload"));
                    xhr.send(fileToUpload);
                });

                const completeRes = await fetch("/api/uploads/complete", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${idToken}`,
                    },
                    body: JSON.stringify({ sessionId, key: storagePath }),
                });

                if (!completeRes.ok) {
                    const compErr = await completeRes.json().catch(() => ({}));
                    throw new Error(compErr.error || "Failed to confirm storage upload");
                }

                setUploadProgress(100);
                pictureUrl = `/api/media/download?key=${encodeURIComponent(storagePath)}`;
            } catch (error: any) {
                console.error("Upload failed", error);
                alert(`Failed to upload image: ${error?.message || "Please check your network connection and try again."}`);
                setIsUploading(false);
                setUploadProgress(0);
                return false;
            }
            setIsUploading(false);
        }

        const customizationData = isCustom ? {
            ...(product.customizationType === "requires_name" && { name: customName }),
            ...(product.customizationType === "requires_picture" && {
                pictureUrl,
                storagePath,
                ownerUid,
                fileId,
            }),
        } : undefined;

        if (product.hasVariants && matchedVariant) {
            addToCart({
                id: uuidv4(),
                productId: product.id,
                variantId: matchedVariant.id,
                sku: matchedVariant.sku,
                name: product.name,
                price: effectivePrice,
                quantity,
                image: matchedVariant.image || product.image,
                size: matchedVariant.sizeName || activeSizes.find(s => s.id === selectedSizeId)?.name,
                sizeId: matchedVariant.sizeId || selectedSizeId,
                color: matchedVariant.colorName || activeColors.find(c => c.id === selectedColorId)?.name,
                colorId: matchedVariant.colorId || selectedColorId,
                dimensions: matchedVariant.dimensions,
                isCustomized: isCustom,
                customizationData,
            });
        } else {
            addToCart({
                id: uuidv4(),
                productId: product.id,
                name: product.name,
                price: product.price,
                quantity,
                image: product.image,
                size: selectedLegacySize || undefined,
                isCustomized: isCustom,
                customizationData,
            });
        }

        if (isBuyNow) {
            return true;
        }

        setAddedToCart(true);
        setTimeout(() => setAddedToCart(false), 2000);
        setCustomName("");
        setCustomFile(null);
        if (previewUrl && previewUrl.startsWith("blob:")) {
            URL.revokeObjectURL(previewUrl);
        }
        setPreviewUrl(null);
        setUploadProgress(0);
        return true;
    };

    const handleBuyNow = async () => {
        const success = await handleAddToCart(true);
        if (success) {
            window.location.href = "/cart";
        }
    };

    return (
        <div className="pc-container" data-testid="pc-container">
            {/* TASK 029 Variant Price & Stock Summary on PDP */}
            {product.hasVariants && (
                <div style={{ marginBottom: "16px", padding: "12px 16px", borderRadius: "12px", backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                        <div>
                            <span style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--text-primary)" }}>
                                ₹{effectivePrice.toLocaleString("en-IN")}
                            </span>
                            {matchedVariant?.price !== null && matchedVariant?.price !== undefined && matchedVariant.price !== product.price && (
                                <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", textDecoration: "line-through", marginLeft: "8px" }}>
                                    ₹{Number(product.price).toLocaleString("en-IN")}
                                </span>
                            )}
                        </div>
                        <div>
                            {isVariantDisabled ? (
                                <span style={{ fontSize: "0.8rem", fontWeight: 700, padding: "4px 8px", borderRadius: "6px", backgroundColor: "#fee2e2", color: "#b91c1c" }}>
                                    Unavailable
                                </span>
                            ) : isOutOfStock ? (
                                <span style={{ fontSize: "0.8rem", fontWeight: 700, padding: "4px 8px", borderRadius: "6px", backgroundColor: "#fee2e2", color: "#b91c1c" }}>
                                    Out of Stock
                                </span>
                            ) : currentStock <= 3 ? (
                                <span style={{ fontSize: "0.8rem", fontWeight: 700, padding: "4px 8px", borderRadius: "6px", backgroundColor: "#fef3c7", color: "#b45309" }}>
                                    Only {currentStock} left in stock!
                                </span>
                            ) : (
                                <span style={{ fontSize: "0.8rem", fontWeight: 700, padding: "4px 8px", borderRadius: "6px", backgroundColor: "#dcfce7", color: "#15803d" }}>
                                    In Stock ({currentStock} available)
                                </span>
                            )}
                        </div>
                    </div>
                    {matchedVariant?.sku && (
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                            SKU: <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{matchedVariant.sku}</span>
                        </div>
                    )}
                </div>
            )}

            {/* TASK 029: Color Options Selector */}
            {product.hasVariants && activeColors.length > 0 && (
                <div className="pc-custom-section" style={{ marginBottom: "20px" }} data-testid="pc-color-section">
                    <h4 className="pc-custom-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2z"/></svg>
                            Color
                        </span>
                        {selectedColorId && (
                            <span style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--text-secondary)" }}>
                                {activeColors.find(c => c.id === selectedColorId)?.name}
                            </span>
                        )}
                    </h4>
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", maxWidth: "100%" }}>
                        {activeColors.map((color) => {
                            const isSelected = selectedColorId === color.id;
                            return (
                                <button
                                    key={color.id}
                                    type="button"
                                    onClick={() => setSelectedColorId(color.id)}
                                    aria-pressed={isSelected}
                                    aria-label={`Select color ${color.name}`}
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        padding: "8px 14px",
                                        borderRadius: "999px",
                                        border: isSelected ? "2px solid var(--accent)" : "1px solid var(--border-color)",
                                        backgroundColor: isSelected ? "rgba(0, 107, 60, 0.08)" : "var(--bg-primary)",
                                        color: isSelected ? "var(--accent)" : "var(--text-primary)",
                                        fontWeight: isSelected ? 700 : 500,
                                        fontSize: "0.85rem",
                                        cursor: "pointer",
                                        transition: "all 0.15s ease",
                                        minHeight: "44px",
                                    }}
                                >
                                    {color.hex && (
                                        <span
                                            style={{
                                                width: "16px",
                                                height: "16px",
                                                borderRadius: "50%",
                                                backgroundColor: color.hex,
                                                border: "1px solid rgba(0,0,0,0.2)",
                                                display: "inline-block",
                                                flexShrink: 0,
                                            }}
                                        />
                                    )}
                                    <span>{color.name}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* TASK 029: Sizing Selector (Apparel, Free Size, Dimensions, Custom Labels) */}
            {product.hasVariants && activeSizes.length > 0 && (
                <div className="pc-custom-section" style={{ marginBottom: "24px" }} data-testid="pc-size-section">
                    <h4 className="pc-custom-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></svg>
                            Size
                        </span>
                        {product.sizeMode === "free_size" ? (
                            <span style={{ fontSize: "0.8rem", color: "#16a34a", fontWeight: 600 }}>One Size Fits All</span>
                        ) : selectedSizeId ? (
                            <span style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--text-secondary)" }}>
                                {formatSizeDisplay(activeSizes.find(s => s.id === selectedSizeId), "dash")}
                            </span>
                        ) : null}
                    </h4>

                    {product.sizeMode === "free_size" ? (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "8px 16px", borderRadius: "8px", backgroundColor: "rgba(0, 107, 60, 0.08)", border: "1.5px solid var(--accent)", color: "var(--accent)", fontWeight: 700, fontSize: "0.9rem", minHeight: "44px" }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            Free Size (Universal Fit)
                        </div>
                    ) : (
                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", maxWidth: "100%" }}>
                            {activeSizes.map((size) => {
                                const isSelected = selectedSizeId === size.id;
                                const displayLabel = formatSizeDisplay(size, "parens");

                                return (
                                    <button
                                        key={size.id}
                                        type="button"
                                        onClick={() => setSelectedSizeId(size.id)}
                                        aria-pressed={isSelected}
                                        aria-label={`Select size ${displayLabel}`}
                                        style={{
                                            padding: "8px 16px",
                                            borderRadius: "8px",
                                            border: `1.5px solid ${isSelected ? "var(--text-primary)" : "var(--border-color)"}`,
                                            backgroundColor: isSelected ? "var(--text-primary)" : "var(--bg-primary)",
                                            color: isSelected ? "var(--bg-primary)" : "var(--text-primary)",
                                            fontWeight: 600,
                                            fontSize: "0.85rem",
                                            cursor: "pointer",
                                            transition: "all 0.15s ease",
                                            fontFamily: "inherit",
                                            minHeight: "44px",
                                        }}
                                    >
                                        {displayLabel}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Legacy Simple Size Selector (for backwards-compatibility with un-migrated products) */}
            {!product.hasVariants && product.sizes && product.sizes.length > 0 && (
                <div className="pc-custom-section" style={{ marginBottom: "24px" }}>
                    <h4 className="pc-custom-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></svg>
                        Size
                    </h4>
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", maxWidth: "100%" }}>
                        {product.sizes.map((s, index) => (
                            <button
                                key={index}
                                type="button"
                                onClick={() => setSelectedLegacySize(s)}
                                style={{
                                    padding: "8px 16px",
                                    borderRadius: "8px",
                                    border: `1px solid ${selectedLegacySize === s ? "var(--text-primary)" : "var(--border-color)"}`,
                                    backgroundColor: selectedLegacySize === s ? "var(--text-primary)" : "var(--bg-primary)",
                                    color: selectedLegacySize === s ? "var(--bg-primary)" : "var(--text-primary)",
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    transition: "all 0.2s ease",
                                    fontFamily: "inherit",
                                    minHeight: "44px",
                                }}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Customization Options */}
            {isCustom && (
                <div className="pc-custom-section">
                    <h4 className="pc-custom-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        Customization
                    </h4>

                    {product.customizationType === "requires_name" && (
                        <div className="pc-field">
                            <label htmlFor="customName" className="pc-label">Enter name to be printed</label>
                            <input
                                type="text"
                                id="customName"
                                value={customName}
                                onChange={(e) => setCustomName(e.target.value)}
                                className="pc-input"
                                placeholder="e.g. John Doe"
                            />
                        </div>
                    )}

                    {product.customizationType === "requires_picture" && (
                        <div className="pc-field">
                            <label htmlFor="customPicture" className="pc-label">Upload your picture (JPG, PNG, WebP max 10MB)</label>
                            <label className="pc-file-upload">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                                {customFile ? customFile.name : "Choose a file"}
                                <input
                                    type="file"
                                    id="customPicture"
                                    accept="image/jpeg,image/png,image/webp"
                                    onChange={handleFileSelect}
                                    style={{ display: "none" }}
                                />
                            </label>

                            {/* Local Preview (Preserved for TASK 028 and TASK 008 tests) */}
                            {previewUrl && (
                                <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "12px" }}>
                                    <div style={{ width: "48px", height: "48px", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border-color)" }}>
                                        <img src={previewUrl} alt="Custom Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    </div>
                                    <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                                        {customFile ? `${(customFile.size / 1024 / 1024).toFixed(1)} MB` : ""}
                                    </span>
                                </div>
                            )}

                            {isUploading && (
                                <div className="pc-progress-bar" style={{ marginTop: "12px" }}>
                                    <div className="pc-progress-fill" style={{ width: `${uploadProgress}%` }} />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Quantity + Purchase Actions */}
            <div className="pc-actions" data-testid="pc-actions">
                <div className="pc-qty-wrapper">
                    <span className="pc-qty-label">Quantity</span>
                    <div className="pc-qty">
                        <button
                            className="pc-qty-btn"
                            onClick={() => setQuantity(q => Math.max(1, q - 1))}
                            aria-label="Decrease quantity"
                            type="button"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        </button>
                        <span className="pc-qty-value">{quantity}</span>
                        <button
                            className="pc-qty-btn"
                            onClick={() => setQuantity(q => q + 1)}
                            aria-label="Increase quantity"
                            type="button"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        </button>
                    </div>
                </div>

                <div className="pc-btn-group">
                    <button
                        type="button"
                        onClick={() => handleAddToCart(false)}
                        disabled={isUploading || isVariantDisabled || isOutOfStock}
                        className={`pc-add-btn pc-btn-secondary ${addedToCart ? "pc-added" : ""}`}
                        style={{
                            backgroundColor: (isVariantDisabled || isOutOfStock) ? "var(--bg-secondary)" : "var(--bg-secondary)",
                            color: (isVariantDisabled || isOutOfStock) ? "var(--text-secondary)" : "var(--text-primary)",
                            border: "1px solid var(--border-color)",
                            opacity: (isVariantDisabled || isOutOfStock) ? 0.6 : 1,
                            cursor: (isVariantDisabled || isOutOfStock) ? "not-allowed" : "pointer",
                        }}
                    >
                        {isUploading ? (
                            <span>{`Uploading (${uploadProgress}%)...`}</span>
                        ) : addedToCart ? (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                <span>Added to Cart</span>
                            </>
                        ) : isVariantDisabled ? (
                            <span>Unavailable</span>
                        ) : isOutOfStock ? (
                            <span>Out of Stock</span>
                        ) : (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
                                <span>Add to Cart</span>
                            </>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={handleBuyNow}
                        disabled={isUploading || addedToCart || isVariantDisabled || isOutOfStock}
                        className="pc-add-btn pc-btn-primary"
                        style={{
                            border: "1px solid var(--text-primary)",
                            opacity: (isVariantDisabled || isOutOfStock) ? 0.6 : 1,
                            cursor: (isVariantDisabled || isOutOfStock) ? "not-allowed" : "pointer",
                        }}
                    >
                        <span>{isUploading ? "..." : (isVariantDisabled || isOutOfStock) ? "Unavailable" : "Buy Now"}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
