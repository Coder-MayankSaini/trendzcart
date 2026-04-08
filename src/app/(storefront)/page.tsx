import Link from "next/link";
import Image from "next/image";
import { adminDb } from "@/lib/firebase/admin";

export const revalidate = 60;

const marqueeItems = [
  "FREE SHIPPING ON ₹999+",
  "NEW ARRIVALS WEEKLY",
  "TRENDING NOW",
  "100% PREMIUM QUALITY",
  "EASY RETURNS",
  "CURATED COLLECTIONS",
];

const features = [
  { icon: "shipping", title: "Free Shipping", desc: "On orders above ₹999" },
  { icon: "returns", title: "Easy Returns", desc: "30-day return policy" },
  { icon: "secure", title: "Secure Payment", desc: "100% protected checkout" },
  { icon: "support", title: "24/7 Support", desc: "We're here to help" },
];

interface HomeCategory {
  id: string;
  name: string;
  description: string;
  image: string;
  order: number;
}

interface HomeProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  images: string[];
  image?: string;
  isCustomized?: boolean;
}

async function getHomeCategories() {
  if (!adminDb) return [];
  try {
    const snap = await adminDb.collection("categories")
      .where("showOnHome", "==", true)
      .orderBy("order", "asc")
      .get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as HomeCategory[];
  } catch (err) {
    console.error("HomeCategories fetch error", err);
    return [];
  }
}

async function getFeaturedProducts() {
  if (!adminDb) return [];
  try {
    const snap = await adminDb.collection("products")
      .where("isFeatured", "==", true)
      .limit(8)
      .get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as HomeProduct[];
  } catch (err) {
    console.error("FeaturedProducts fetch error", err);
    return [];
  }
}

export default async function Home() {
  const [homeCategories, featuredProducts] = await Promise.all([
    getHomeCategories(),
    getFeaturedProducts()
  ]);

  return (
    <div className="home-page">
      {/* ===== HERO ===== */}
      <section className="hp-hero" style={{ position: 'relative' }}>
        <Image
          src="https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?q=80&auto=format&fit=crop"
          alt="Curated premium clothing collections"
          fill
          priority
          sizes="100vw"
          style={{ objectFit: 'cover', zIndex: 0 }}
        />
        <div className="hp-hero-overlay" style={{ zIndex: 1, position: 'absolute', inset: 0 }} />
        <div className="hp-hero-content" style={{ zIndex: 2, position: 'relative' }}>
          <div className="hp-hero-badge">— Spring / Summer 2026</div>
          <h1 className="hp-hero-title">
            Define Your <span>Style</span>
          </h1>
          <p className="hp-hero-subtitle">
            Discover curated collections of premium clothing designed for the modern wardrobe. Elevate every moment.
          </p>
          <div className="hp-hero-actions">
            <Link href="/products" className="hp-btn-primary">
              Shop Now →
            </Link>
            <Link href="/categories" className="hp-btn-outline">
              Explore Categories
            </Link>
          </div>
        </div>
      </section>

      {/* ===== MARQUEE ===== */}
      <div className="hp-marquee">
        <div className="hp-marquee-track">
          {[...marqueeItems, ...marqueeItems].map((item, i) => (
            <span className="hp-marquee-item" key={i}>
              <span className="hp-marquee-dot" />
              {item}
            </span>
          ))}
        </div>
      </div>

      {/* ===== CATEGORIES (from Firestore) ===== */}
      {homeCategories.length > 0 && (
        <section className="hp-section" style={{ backgroundColor: "var(--bg-primary)" }}>
          <div className="hp-container">
            <div className="hp-section-header">
              <span className="hp-section-label">Collections</span>
              <h2 className="hp-section-title">Shop by Category</h2>
              <p className="hp-section-subtitle">Curated selections for every style and occasion.</p>
            </div>
            <div className="hp-categories-grid">
              {homeCategories.map((cat) => (
                <Link href={`/products?category=${encodeURIComponent(cat.name)}`} key={cat.id} className="hp-category-card">
                  {cat.image ? (
                    <Image src={cat.image} alt={cat.name} width={500} height={600} className="hp-category-img" style={{ objectFit: "cover" }} />
                  ) : (
                    <div className="hp-category-img" style={{ backgroundColor: 'var(--bg-secondary)' }} />
                  )}
                  <div className="hp-category-overlay">
                    <h3 className="hp-category-name">{cat.name}</h3>
                    {cat.description && <span className="hp-category-count">{cat.description}</span>}
                  </div>
                  <div className="hp-category-arrow">→</div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ===== MOST POPULAR PICKS (from Firestore) ===== */}
      {featuredProducts.length > 0 && (
        <section className="hp-section" style={{ backgroundColor: "var(--bg-primary)" }}>
          <div className="hp-container">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "64px", flexWrap: "wrap", gap: "20px" }}>
              <div>
                <span className="hp-section-label">Trending Now</span>
                <h2 className="hp-section-title">Most Popular Picks</h2>
              </div>
              <Link href="/products" className="hp-view-all">
                View All Collection →
              </Link>
            </div>
            <div className="hp-trending-grid">
              {featuredProducts.map((product: any) => {
                const mainImage = product.thumbnails?.[0] || product.images?.[0] || product.image || "";
                return (
                  <Link href={`/products/${product.slug}`} key={product.id} className="hp-product-card">
                    <div className="hp-product-img-wrap">
                      {mainImage ? (
                        <Image src={mainImage} alt={product.name} width={400} height={500} className="hp-product-img" style={{ objectFit: "cover" }} />
                      ) : (
                        <div className="hp-product-img" style={{ backgroundColor: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>No Image</div>
                      )}
                      {product.isCustomized && (
                        <span className="hp-product-badge hp-badge-new">Customizable</span>
                      )}
                    </div>
                    <div className="hp-product-details">
                      <h3 className="hp-product-name">{product.name}</h3>
                      <div className="hp-product-price-row">
                        <p className="hp-product-price">₹{Number(product.price).toLocaleString("en-IN")}</p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ===== FEATURES ===== */}
      <section className="hp-section hp-features">
        <div className="hp-container">
          <div className="hp-features-grid">
            {features.map((f) => (
              <div className="hp-feature" key={f.title}>
                <div className="hp-feature-icon">
                  {f.icon === "shipping" && <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>}
                  {f.icon === "returns" && <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>}
                  {f.icon === "secure" && <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>}
                  {f.icon === "support" && <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>}
                </div>
                <h4 className="hp-feature-title">{f.title}</h4>
                <p className="hp-feature-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


    </div>
  );
}
