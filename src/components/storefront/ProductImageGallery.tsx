"use client";

import { useState } from "react";
import Image from "next/image";
import { normalizeMediaUrl } from "@/lib/storage/mediaUrl";

const FALLBACK_DATA_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400' fill='none'%3E%3Crect width='400' height='400' fill='%23f1f5f9'/%3E%3Ctext x='200' y='210' text-anchor='middle' fill='%2394a3b8' font-family='system-ui' font-size='16'%3EBazaarvilla Image%3C/text%3E%3C/svg%3E";

interface ProductImageGalleryProps {
    images: string[];
    productName: string;
}

export default function ProductImageGallery({ images, productName }: ProductImageGalleryProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});

    if (!images || images.length === 0) return null;

    const safeIndex = selectedIndex < images.length ? selectedIndex : 0;
    const rawMainImg = images[safeIndex];
    const isMainFailed = failedImages[safeIndex];
    const mainImgSrc = isMainFailed ? FALLBACK_DATA_URI : normalizeMediaUrl(rawMainImg);

    return (
        <div className="pig-container">
            {/* Thumbnail Column (left side on desktop, bottom scroll on mobile) */}
            {images.length > 1 && (
                <div className="pig-thumbs">
                    {images.map((img, idx) => {
                        const thumbSrc = failedImages[idx] ? FALLBACK_DATA_URI : normalizeMediaUrl(img);
                        return (
                            <button
                                key={`thumb-${idx}-${img}`}
                                type="button"
                                onClick={() => setSelectedIndex(idx)}
                                className={`pig-thumb ${safeIndex === idx ? 'pig-thumb-active' : ''}`}
                                aria-label={`View ${productName} image ${idx + 1}`}
                            >
                                <Image
                                    src={thumbSrc}
                                    alt={`${productName} thumbnail ${idx + 1}`}
                                    width={64}
                                    height={80}
                                    sizes="64px"
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                    unoptimized={thumbSrc.startsWith("data:")}
                                    onError={() => {
                                        setFailedImages(prev => ({ ...prev, [idx]: true }));
                                    }}
                                />
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Main Featured Display Image */}
            <div className="pig-main">
                <Image
                    src={mainImgSrc}
                    alt={`${productName} - Image ${safeIndex + 1}`}
                    width={900}
                    height={1125}
                    priority
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 55vw, 650px"
                    className="pig-main-img"
                    style={{ width: "100%", height: "auto", objectFit: "cover" }}
                    unoptimized={mainImgSrc.startsWith("data:")}
                    onError={() => {
                        setFailedImages(prev => ({ ...prev, [safeIndex]: true }));
                    }}
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
