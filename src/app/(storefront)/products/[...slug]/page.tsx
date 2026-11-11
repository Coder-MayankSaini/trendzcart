import { adminDb } from "@/lib/firebase/admin";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import ProductDetailClient from "@/components/storefront/ProductDetailClient";
import ProductReviews from "@/components/storefront/ProductReviews";
import ProductAllReviewsPage from "@/components/storefront/ProductAllReviewsPage";
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

  // Hourly bounded refresh for purchase activity counter (recalculates order stats; preserves custom display settings)
  const isCustomMode = data?.purchaseActivity?.displayMode === "custom" || data?.purchaseActivity?.isCustomCount === true;
  if (
    adminDb &&
    !isCustomMode &&
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

  return (
    <div className="pdp-container">
      <ProductDetailClient product={product} />

      <div className="pdp-layout" style={{ marginTop: '24px' }}>
        <div style={{ width: '100%', minWidth: 0, maxWidth: '100%' }}>
          <ProductReviews productId={product.id} productSlug={product.slug || baseSlug} />
        </div>
      </div>
    </div>
  );
}
