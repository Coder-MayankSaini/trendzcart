import { adminDb } from "@/lib/firebase/admin";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import ProductCustomizer from "@/components/storefront/ProductCustomizer";
import ProductImageGallery from "@/components/storefront/ProductImageGallery";
import ProductReviews from "@/components/storefront/ProductReviews";
import ProductAllReviewsPage from "@/components/storefront/ProductAllReviewsPage";
import ProductPurchaseActivity from "@/components/storefront/ProductPurchaseActivity";
import { calculateAndPersistProductPurchaseActivity, CACHE_TTL_MS } from "@/lib/orders/purchaseActivity";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string | string[] }>;
}

async function getProductBySlug(slug: string) {
  if (!adminDb) return null;
  const snapshot = await adminDb
    .collection("products")
    .where("slug", "==", slug)
    .where("isVisible", "==", true)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  const data = doc.data();

  // Exclude synthetic test fixtures and non-commercial products
  if (
    doc.id.startsWith("task") ||
    data?.category === "Testing" ||
    data?.isTestFixture === true ||
    data?.purchasable === false ||
    data?.isArchived === true
  ) {
    return null;
  }

  // Hourly bounded refresh for purchase activity counter
  if (
    adminDb &&
    (!data?.purchaseActivity ||
      typeof data.purchaseActivity.lastCalculatedAt !== "number" ||
      Date.now() - data.purchaseActivity.lastCalculatedAt > CACHE_TTL_MS)
  ) {
    try {
      const freshActivity = await calculateAndPersistProductPurchaseActivity(adminDb, doc.id);
      data.purchaseActivity = freshActivity;
    } catch (refreshErr) {
      // Non-blocking fallback: continue with existing data
      console.warn(`[PDP Purchase Activity Refresh] Warning for ${doc.id}:`, refreshErr);
    }
  }

  return { id: doc.id, ...data } as any;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const resolvedParams = await params;
  const slugArray = resolvedParams.slug;
  const segments = Array.isArray(slugArray) ? slugArray.map(decodeURIComponent) : [decodeURIComponent(slugArray)];
  const isReviewsSubroute = segments.length > 1 && segments[segments.length - 1] === "reviews";
  const baseSlug = isReviewsSubroute ? segments.slice(0, -1).join('/') : segments.join('/');
  const product = await getProductBySlug(baseSlug);

  if (!product) return { title: "Product Not Found" };

  if (isReviewsSubroute) {
    return {
      title: `Customer Reviews for ${product.name} | Bazaarvilla`,
      description: `Read authentic customer reviews, star ratings, and feedback for ${product.name}.`,
      openGraph: {
        images: product.images ? [product.images[0]] : [],
      },
    };
  }

  return {
    title: `${product.name} | Bazaarvilla`,
    description: product.description,
    openGraph: {
      images: product.images ? [product.images[0]] : [],
    },
  };
}

export default async function ProductDetailsPage({ params }: Props) {
  const resolvedParams = await params;
  const slugArray = resolvedParams.slug;
  const segments = Array.isArray(slugArray) ? slugArray.map(decodeURIComponent) : [decodeURIComponent(slugArray)];
  const isReviewsSubroute = segments.length > 1 && segments[segments.length - 1] === "reviews";
  const baseSlug = isReviewsSubroute ? segments.slice(0, -1).join('/') : segments.join('/');
  const product = await getProductBySlug(baseSlug);

  if (!product) {
    notFound();
  }

  if (isReviewsSubroute) {
    return <ProductAllReviewsPage product={product} />;
  }

  const images: string[] = product.images || [];
  const mainImage = images.length > 0 ? images[0] : null;

  return (
    <div className="pdp-container">
      <div className="pdp-layout">
        {/* Left: Image Gallery */}
        <div className="pdp-gallery-col">
          {images.length > 0 ? (
            <ProductImageGallery images={images} productName={product.name} />
          ) : (
            <div className="placeholder-image">No Image</div>
          )}
        </div>

        {/* Right: Product Info */}
        <div className="pdp-info-col">
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

          {product.isCustomized && (
            <span className="pdp-badge-custom">Customizable</span>
          )}

          <h1 className="pdp-title">{product.name}</h1>

          <div className="pdp-price-row">
            <span className="pdp-price">₹{Number(product.price).toLocaleString("en-IN")}</span>
            <span className="pdp-tax-note">Inclusive of all taxes</span>
          </div>
          <div style={{ marginTop: '4px', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {product.isCustomized ? (
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

          <ProductCustomizer product={{
            id: product.id,
            name: product.name,
            price: product.price,
            image: mainImage || "",
            isCustomized: product.isCustomized,
            customizationType: product.customizationType || null,
            sizes: product.sizes || []
          }} />

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

      <div className="pdp-layout" style={{ marginTop: '24px' }}>
        <div style={{ width: '100%' }}>
          <ProductReviews productId={product.id} productSlug={product.slug || baseSlug} />
        </div>
      </div>
    </div>
  );
}
