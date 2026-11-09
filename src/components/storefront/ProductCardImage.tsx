"use client";

import React from "react";

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
                (e.currentTarget as HTMLImageElement).src = '/api/media/public';
            }}
        />
    );
}
