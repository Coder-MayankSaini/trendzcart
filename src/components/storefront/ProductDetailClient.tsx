"use client";

import { useState } from "react";
import Link from "next/link";
import ProductImageGallery from "@/components/storefront/ProductImageGallery";
import ProductCustomizer from "@/components/storefront/ProductCustomizer";
import ProductPurchaseActivity from "@/components/storefront/ProductPurchaseActivity";
import { isCustomizableProduct } from "@/lib/orders/customizationEligibility";
import type { ProductVariant } from "@/lib/products/variants";

export default function ProductDetailClient({ product }: { product: any }) {
    const [activeVariant, setActiveVariant] = useState<ProductVariant | null>(null);

    const images: string[] = product.images || [];
    const mainImage = images.length > 0 ? images[0] : null;

    // Server-authoritative fallback price updated with active variant price override
    const currentPrice = (product.hasVariants && activeVariant && typeof activeVariant.price === "number" && activeVariant.price >= 0)
        ? activeVariant.price
        : Number(product.price) || 0;

    return (
        <div className="pdp-layout" data-testid="pdp-layout">
            {/* Left: Image Gallery */}
            <div className="pdp-gallery-col" data-testid="pdp-gallery-col">
                {images.length > 0 ? (
                    <ProductImageGallery
                        images={images}
                        productName={product.name}
                        activeImage={activeVariant?.image}
                    />
                ) : (
                    <div className="placeholder-image">No Image</div>
                )}
            </div>

            {/* Right: Product Info */}
            <div className="pdp-info-col" data-testid="pdp-info-col">
                {/* Category tags */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {(product.categories && product.categories.length > 0 ? product.categories : (product.category ? [product.category] : [])).map((cat: string) => (
                        <Link
                            key={cat}
                            href={`/products?category=${encodeURIComponent(cat)}`}
                            className="pdp-category"
                            style={{ display: 'inline-block', textDecoration: 'none', cursor: 'pointer', transition: 'opacity 0.2s' }}
                        >
                            {cat}
                        </Link>
                    ))}
                </div>

                {isCustomizableProduct(product) && (
                    <span className="pdp-badge-custom">Customizable</span>
                )}

                <h1 className="pdp-title">{product.name}</h1>

                <div className="pdp-price-row">
                    <span className="pdp-price">₹{currentPrice.toLocaleString("en-IN")}</span>
                    <span className="pdp-tax-note">Inclusive of all taxes</span>
                </div>

                <div style={{ marginTop: '4px', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {isCustomizableProduct(product) ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 600, color: '#0369a1', background: 'rgba(14, 165, 233, 0.1)', padding: '4px 10px', borderRadius: '4px', width: 'fit-content' }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                            Prepaid Only (Personalized Item)
                        </span>
                    ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 600, color: '#16a34a', background: 'rgba(34, 197, 94, 0.1)', padding: '4px 10px', borderRadius: '4px', width: 'fit-content' }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" /><line x1="12" y1="22" x2="12" y2="7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg>
                            Cash on Delivery Available
                        </span>
                    )}
                    <ProductPurchaseActivity activity={product.purchaseActivity} />
                </div>

                <div className="pdp-divider" />

                {product.description && (
                    <div className="pdp-description">
                        <p>{product.description}</p>
                    </div>
                )}

                <ProductCustomizer
                    product={{
                        id: product.id,
                        name: product.name,
                        price: product.price,
                        image: mainImage || "",
                        inventory: product.inventory,
                        isCustomized: isCustomizableProduct(product),
                        customizationType: product.customizationType || null,
                        customizable: product.customizable,
                        isPersonalized: product.isPersonalized,
                        sizes: product.sizes || [],
                        hasVariants: product.hasVariants,
                        sizeMode: product.sizeMode,
                        sizesList: product.sizesList || [],
                        colors: product.colors || [],
                        variants: product.variants || [],
                        onVariantChange: setActiveVariant,
                    }}
                />

                {/* Trust Badges */}
                <div className="pdp-trust-badges">
                    <div className="pdp-trust-item">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
                        <div>
                            <strong>Free Shipping</strong>
                            <span>On all products</span>
                        </div>
                    </div>
                    <div className="pdp-trust-item">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                        <div>
                            <strong>Easy Returns</strong>
                            <span>7-day return policy</span>
                        </div>
                    </div>
                    <div className="pdp-trust-item">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                        <div>
                            <strong>Secure Payment</strong>
                            <span>100% protected checkout</span>
                        </div>
                    </div>
                    <div className="pdp-trust-item">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M16 12h.01" /><path d="M12 12h.01" /><path d="M8 12h.01" /></svg>
                        <div>
                            <strong>Cash on Delivery</strong>
                            <span>Pay when you receive</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
