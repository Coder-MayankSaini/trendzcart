"use client";

import { useState } from "react";
import { useCart } from "@/context/CartContext";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase/config";
import { v4 as uuidv4 } from "uuid";

interface ProductProps {
    id: string;
    name: string;
    price: number;
    image: string;
    isCustomized: boolean;
    customizationType: "requires_name" | "requires_picture" | null;
    sizes?: string[];
}

export default function ProductCustomizer({ product }: { product: ProductProps }) {
    const { addToCart } = useCart();
    const [quantity, setQuantity] = useState(1);
    const [selectedSize, setSelectedSize] = useState("");
    const [customName, setCustomName] = useState("");
    const [customFile, setCustomFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [addedToCart, setAddedToCart] = useState(false);

    const handleAddToCart = async (isBuyNow = false) => {
        if (product.sizes && product.sizes.length > 0 && !selectedSize) {
            alert("Please select a size.");
            return false;
        }

        if (product.isCustomized) {
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

        if (product.isCustomized && product.customizationType === "requires_picture" && customFile) {
            setIsUploading(true);
            const fileExt = customFile.name.split('.').pop();
            const fileName = `customizations/${uuidv4()}.${fileExt}`;
            const storageRef = ref(storage, fileName);

            try {
                const uploadTask = uploadBytesResumable(storageRef, customFile);

                await new Promise((resolve, reject) => {
                    uploadTask.on(
                        "state_changed",
                        (snapshot) => {
                            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                            setUploadProgress(progress);
                        },
                        (error) => reject(error),
                        () => resolve(uploadTask.snapshot.ref)
                    );
                });

                pictureUrl = await getDownloadURL(storageRef);
            } catch (error) {
                console.error("Upload failed", error);
                alert("Failed to upload image. Please try again.");
                setIsUploading(false);
                return false;
            }
            setIsUploading(false);
        }

        const customizationData = product.isCustomized ? {
            ...(product.customizationType === "requires_name" && { name: customName }),
            ...(product.customizationType === "requires_picture" && { pictureUrl }),
        } : undefined;

        addToCart({
            id: uuidv4(),
            productId: product.id,
            name: product.name,
            price: product.price,
            quantity,
            image: product.image,
            size: selectedSize || undefined,
            isCustomized: product.isCustomized,
            customizationData
        });

        if (isBuyNow) {
            // Handled by the caller
            return true;
        }

        setAddedToCart(true);
        setTimeout(() => setAddedToCart(false), 2000);
        setCustomName("");
        setCustomFile(null);
        setSelectedSize("");
        setUploadProgress(0);
        return true;
    };

    const handleBuyNow = async () => {
        const success = await handleAddToCart(true);
        if (success) {
            window.location.href = "/cart"; // redirect to cart page seamlessly
        }
    };

    return (
        <div className="pc-container">
            {/* Size Selector */}
            {product.sizes && product.sizes.length > 0 && (
                <div className="pc-custom-section" style={{ marginBottom: '24px' }}>
                    <h4 className="pc-custom-title">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></svg>
                        Size
                    </h4>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        {product.sizes.map((s, index) => (
                            <button
                                key={index}
                                onClick={() => setSelectedSize(s)}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: '8px',
                                    border: `1px solid ${selectedSize === s ? 'var(--text-primary)' : 'var(--border-color)'}`,
                                    backgroundColor: selectedSize === s ? 'var(--text-primary)' : 'var(--bg-primary)',
                                    color: selectedSize === s ? 'var(--bg-primary)' : 'var(--text-primary)',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    fontFamily: 'inherit'
                                }}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Customization Options */}
            {product.isCustomized && (
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
                            <label htmlFor="customPicture" className="pc-label">Upload your picture</label>
                            <label className="pc-file-upload">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                                {customFile ? customFile.name : 'Choose a file'}
                                <input
                                    type="file"
                                    id="customPicture"
                                    accept="image/*"
                                    onChange={(e) => setCustomFile(e.target.files?.[0] || null)}
                                    style={{ display: 'none' }}
                                />
                            </label>
                            {isUploading && (
                                <div className="pc-progress-bar">
                                    <div className="pc-progress-fill" style={{ width: `${uploadProgress}%` }} />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Quantity + Add to Cart */}
            <div className="pc-actions">
                <div className="pc-qty">
                    <button
                        className="pc-qty-btn"
                        onClick={() => setQuantity(q => Math.max(1, q - 1))}
                        aria-label="Decrease quantity"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    </button>
                    <span className="pc-qty-value">{quantity}</span>
                    <button
                        className="pc-qty-btn"
                        onClick={() => setQuantity(q => q + 1)}
                        aria-label="Increase quantity"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    </button>
                </div>

                <div style={{ display: 'flex', gap: '12px', flex: 1 }}>
                    <button
                        onClick={() => handleAddToCart(false)}
                        disabled={isUploading}
                        className={`pc-add-btn ${addedToCart ? 'pc-added' : ''}`}
                        style={{ flex: 1, backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                    >
                        {isUploading ? (
                            "Uploading..."
                        ) : addedToCart ? (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                Added to Cart
                            </>
                        ) : (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
                                Add to Cart
                            </>
                        )}
                    </button>

                    <button
                        onClick={handleBuyNow}
                        disabled={isUploading || addedToCart}
                        className="pc-add-btn"
                        style={{ flex: 1, border: '1px solid var(--text-primary)' }}
                    >
                        {isUploading ? "..." : "Buy Now"}
                    </button>
                </div>
            </div>
        </div>
    );
}
