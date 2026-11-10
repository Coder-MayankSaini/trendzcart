"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { normalizeMediaUrl } from "@/lib/storage/mediaUrl";

export { normalizeMediaUrl };

const FALLBACK_DATA_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400' fill='none'%3E%3Crect width='400' height='400' fill='%23f1f5f9'/%3E%3Ctext x='200' y='210' text-anchor='middle' fill='%2394a3b8' font-family='system-ui' font-size='16'%3EBazaarvilla Image%3C/text%3E%3C/svg%3E";

interface ProductCardImageProps {
    src: string;
    alt: string;
    className?: string;
    priority?: boolean;
    sizes?: string;
    objectFit?: "cover" | "contain";
}

export function ProductCardImage({
    src,
    alt,
    className = "product-image",
    priority = false,
    sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw",
    objectFit = "cover"
}: ProductCardImageProps) {
    const cleanSrc = normalizeMediaUrl(src);
    const [imgSrc, setImgSrc] = useState(cleanSrc);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
        setImgSrc(normalizeMediaUrl(src));
        setHasError(false);
    }, [src]);

    if (!imgSrc) {
        return (
            <div
                className={className}
                style={{
                    backgroundColor: "var(--bg-secondary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--text-secondary)",
                    fontSize: "0.875rem"
                }}
            >
                No Image
            </div>
        );
    }

    const isDataUri = imgSrc.startsWith("data:");

    return (
        <Image
            src={imgSrc}
            alt={alt}
            fill
            sizes={sizes}
            priority={priority}
            className={className}
            style={{ objectFit }}
            unoptimized={isDataUri}
            onError={() => {
                if (!hasError) {
                    setHasError(true);
                    setImgSrc(FALLBACK_DATA_URI);
                }
            }}
        />
    );
}
