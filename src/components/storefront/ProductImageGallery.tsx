"use client";

import { useState } from "react";

interface ProductImageGalleryProps {
    images: string[];
    productName: string;
}

export default function ProductImageGallery({ images, productName }: ProductImageGalleryProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    if (images.length === 0) return null;

    return (
        <div className="pig-container">
            {/* Thumbnail Column (left side on desktop) */}
            {images.length > 1 && (
                <div className="pig-thumbs">
                    {images.map((img, idx) => (
                        <button
                            key={idx}
                            onClick={() => setSelectedIndex(idx)}
                            className={`pig-thumb ${selectedIndex === idx ? 'pig-thumb-active' : ''}`}
                        >
                            <img
                                src={img}
                                alt={`${productName} thumbnail ${idx + 1}`}
                            />
                        </button>
                    ))}
                </div>
            )}

            {/* Main Image */}
            <div className="pig-main">
                <img
                    src={images[selectedIndex]}
                    alt={`${productName} - Image ${selectedIndex + 1}`}
                    className="pig-main-img"
                />
                {/* Image counter */}
                <span className="pig-counter">
                    {selectedIndex + 1} / {images.length}
                </span>
            </div>
        </div>
    );
}
