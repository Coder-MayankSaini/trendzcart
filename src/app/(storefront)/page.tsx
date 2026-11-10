import Link from "next/link";
import Image from "next/image";
import { adminDb } from "@/lib/firebase/admin";

export const revalidate = 60;

const marqueeItems = [
  "DELIVERY ACROSS INDIA",
  "CASH ON DELIVERY AVAILABLE",
  "SECURE PAYMENTS VIA RAZORPAY",
  "CURATED LIFESTYLE ESSENTIALS",
  "7-DAY SUPPORT ASSISTANCE",
  "QUALITY ASSURED",
];

const features = [
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </svg>
    ),
    title: "Cash on Delivery",
    desc: "Available on eligible orders across India",
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="15" height="13" />
        <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
    title: "Pan-India Delivery",
    desc: "Fast, tracked shipping to your doorstep",
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
    title: "Secure Checkout",
    desc: "100% encrypted UPI, Cards & Netbanking",
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    ),
    title: "Customer Support",
    desc: "Direct assistance via WhatsApp & email",
  },
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
    return snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as HomeCategory))
      .filter((cat: any) => !cat.isArchived && !cat.archived && cat.status !== "inactive");
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
    return snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as HomeProduct))
      .filter((p: any) => !p.archived && p.isVisible !== false);
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
      {/* ===== HERO SECTION ===== */}
      <section className="hp-hero-refresh">
        <div className="hp-container">
          {/* Desktop Banner Hero */}
          <div className="hp-hero-desktop">
            <div className="hp-hero-copy">
              <span className="hp-hero-badge">✨ Curated Essentials &amp; Custom Picks</span>
              <h1 className="hp-hero-title">
                Discover something <span>you&apos;ll love</span>.
              </h1>
              <p className="hp-hero-subtitle">
                Everyday finds, thoughtful gifts, and more — all at Bazaarvilla.
              </p>
              <div className="hp-hero-actions">
                <Link href="/products" className="hp-btn-primary">
                  Shop Now →
                </Link>
                <Link href="/categories" className="hp-btn-outline">
                  Browse Categories
                </Link>
              </div>
            </div>

            <div className="hp-hero-banner-container">
              <Image
                src="/brand/bazaarvilla-banner-desktop.webp"
                alt="Bazaarvilla official shopping banner — Cash On Delivery, Easy Returns, Fast Delivery"
                width={1600}
                height={609}
                priority
                sizes="(max-width: 1280px) 100vw, 1280px"
                className="hp-hero-banner-img"
              />
            </div>
          </div>

          {/* Mobile Hero */}
          <div className="hp-hero-mobile">
            <div className="hp-hero-mobile-mascot-box">
              <Image
                src="/brand/bazaarvilla-mascot.webp"
                alt="Bazaarvilla Mascot"
                width={220}
                height={178}
                priority
                className="hp-hero-mobile-mascot-img"
              />
            </div>
            <div className="hp-hero-mobile-content">
              <span className="hp-hero-badge">Welcome to Bazaarvilla</span>
              <h1 className="hp-hero-title-mobile">
                Discover something <span>you&apos;ll love</span>.
              </h1>
              <p className="hp-hero-subtitle-mobile">
                Everyday finds, thoughtful gifts, and more — all at Bazaarvilla.
              </p>
              <div className="hp-hero-actions-mobile">
                <Link href="/products" className="hp-btn-primary hp-btn-full">
                  Shop Now →
                </Link>
                <Link href="/categories" className="hp-btn-outline hp-btn-full">
                  Browse Categories
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== MARQUEE TICKER ===== */}
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

      {/* ===== SHOPPING BENEFITS & TRUST SECTION ===== */}
      <section className="hp-features" aria-label="Shopping Benefits">
        <div className="hp-container" style={{ padding: "0 24px" }}>
          <div className="hp-features-grid">
            {features.map((feat, idx) => (
              <div className="hp-feature" key={idx}>
                <div className="hp-feature-icon" aria-hidden="true">
                  {feat.icon}
                </div>
                <h3 className="hp-feature-title">{feat.title}</h3>
                <p className="hp-feature-desc">{feat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

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
                    <Image
                      src={cat.image}
                      alt={cat.name}
                      width={500}
                      height={600}
                      className="hp-category-img"
                      style={{ objectFit: "cover" }}
                      unoptimized={cat.image.startsWith("/")}
                    />
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
        <section className="hp-section" style={{ backgroundColor: "var(--bg-secondary)" }}>
          <div className="hp-container">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "48px", flexWrap: "wrap", gap: "20px" }}>
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
                        <Image
                          src={mainImage}
                          alt={product.name}
                          width={400}
                          height={500}
                          className="hp-product-img"
                          style={{ objectFit: "cover" }}
                          unoptimized={typeof mainImage === "string" && mainImage.startsWith("/")}
                        />
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
    </div>
  );
}
