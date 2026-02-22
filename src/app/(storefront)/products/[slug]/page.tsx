import { adminDb } from "@/lib/firebase/admin";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import ProductCustomizer from "@/components/storefront/ProductCustomizer";
import ProductImageGallery from "@/components/storefront/ProductImageGallery";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
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
  return { id: doc.id, ...doc.data() } as any;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) return { title: "Product Not Found" };

  return {
    title: `${product.name} | TrendKartz`,
    description: product.description,
    openGraph: {
      images: product.images ? [product.images[0]] : [],
    },
  };
}

export default async function ProductDetailsPage({ params }: Props) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) {
    notFound();
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
          {/* Category tag */}
          {product.category && (
            <span className="pdp-category">{product.category}</span>
          )}

          {product.isCustomized && (
            <span className="pdp-badge-custom">Customizable</span>
          )}

          <h1 className="pdp-title">{product.name}</h1>

          <div className="pdp-price-row">
            <span className="pdp-price">₹{Number(product.price).toLocaleString("en-IN")}</span>
            <span className="pdp-tax-note">Inclusive of all taxes</span>
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
            customizationType: product.customizationType || null
          }} />

          {/* Trust Badges */}
          <div className="pdp-trust-badges">
            <div className="pdp-trust-item">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
              <div>
                <strong>Free Shipping</strong>
                <span>On orders over ₹1,000</span>
              </div>
            </div>
            <div className="pdp-trust-item">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
              <div>
                <strong>Easy Returns</strong>
                <span>30-day return policy</span>
              </div>
            </div>
            <div className="pdp-trust-item">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
              <div>
                <strong>Secure Payment</strong>
                <span>100% protected checkout</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
