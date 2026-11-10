"use client";

import React from "react";

const FALLBACK_DATA_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400' fill='none'%3E%3Crect width='400' height='400' fill='%23f1f5f9'/%3E%3Ctext x='200' y='210' text-anchor='middle' fill='%2394a3b8' font-family='system-ui' font-size='16'%3EBazaarvilla Image%3C/text%3E%3C/svg%3E";

interface ProductCardImageProps {
    src: string;
    alt: string;
    className?: string;
}

export function ProductCardImage({ src, alt, className }: ProductCardImageProps) {
    return (
        <img
            src={src}
            alt={alt}
            className={className}
            onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = FALLBACK_DATA_URI;
            }}
        />
    );
}
