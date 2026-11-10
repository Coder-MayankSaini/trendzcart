"use client";

import { useState } from "react";

const FALLBACK_DATA_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400' fill='none'%3E%3Crect width='400' height='400' fill='%23f1f5f9'/%3E%3Ctext x='200' y='210' text-anchor='middle' fill='%2394a3b8' font-family='system-ui' font-size='16'%3EBazaarvilla Image%3C/text%3E%3C/svg%3E";

interface ProductImageGalleryProps {
    images: string[];
    productName: string;
}

export default function ProductImageGallery({ images, productName }: ProductImageGalleryProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    if (!images || images.length === 0) return null;

    const safeIndex = selectedIndex < images.length ? selectedIndex : 0;

    return (
        <div className="pig-container">
            {/* Thumbnail Column (left side on desktop, bottom scroll on mobile) */}
            {images.length > 1 && (
                <div className="pig-thumbs">
                    {images.map((img, idx) => (
                        <button
                            key={`thumb-${idx}-${img}`}
                            type="button"
                            onClick={() => setSelectedIndex(idx)}
                            className={`pig-thumb ${safeIndex === idx ? 'pig-thumb-active' : ''}`}
                            aria-label={`View ${productName} image ${idx + 1}`}
                        >
                            <img
                                src={img}
                                alt={`${productName} thumbnail ${idx + 1}`}
                                onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_DATA_URI; }}
                            />
                        </button>
                    ))}
                </div>
            )}

            {/* Main Featured Display Image */}
            <div className="pig-main">
                <img
                    src={images[safeIndex]}
                    alt={`${productName} - Image ${safeIndex + 1}`}
                    className="pig-main-img"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_DATA_URI; }}
                />
                {/* Image counter indicator */}
                {images.length > 1 && (
                    <span className="pig-counter">
                        {safeIndex + 1} / {images.length}
                    </span>
                )}
            </div>
        </div>
    );
}
