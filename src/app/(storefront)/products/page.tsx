import { adminDb } from "@/lib/firebase/admin";
import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Shop All Products | TrendKartz",
    description: "Browse our premium collection of customizable and ready-to-wear lifestyle products.",
};

export const dynamic = "force-dynamic";

async function getProducts(category?: string) {
    if (!adminDb) return [];
    try {
        let q = adminDb
            .collection("products")
            .where("isVisible", "==", true);

        if (category) {
            q = q.where("category", "==", category);
        }

        const snapshot = await q.orderBy("createdAt", "desc").get();

        if (snapshot.empty) return [];

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as any[];
    } catch (error) {
        console.error("Error fetching products:", error);
        return [];
    }
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
    const params = await searchParams;
    const category = params.category;
    const products = await getProducts(category);

    return (
        <div className="page-container">
            <div className="catalog-header">
                <h1>{category || "All Products"}</h1>
                <p>Premium essentials for every occasion.</p>
                {category && (
                    <Link href="/products" style={{ display: 'inline-block', marginTop: '12px', fontSize: '0.9rem', color: 'var(--accent)', textDecoration: 'none' }}>
                        ← View All Products
                    </Link>
                )}
            </div>

            {products.length === 0 ? (
                <div className="empty-state">
                    <p>No products available at the moment. Check back soon!</p>
                </div>
            ) : (
                <div className="product-grid">
                    {products.map((product) => (
                        <Link href={`/products/${product.slug}`} key={product.id} className="product-card">
                            <div className="product-image-container">
                                {product.images && product.images.length > 0 ? (
                                    <img src={product.images[0]} alt={product.name} className="product-image" />
                                ) : (
                                    <div className="placeholder-image">No Image</div>
                                )}
                                {product.isCustomized && (
                                    <span className="pdp-badge-custom" style={{ position: 'absolute', top: '12px', left: '12px', zIndex: 2 }}>Customizable</span>
                                )}
                            </div>
                            <div className="product-info" style={{ padding: '8px 0' }}>
                                <h3 className="product-name" style={{ fontSize: '1rem' }}>{product.name}</h3>
                                <p className="product-price">₹{Number(product.price).toLocaleString("en-IN")}</p>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
