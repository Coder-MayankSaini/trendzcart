import { Metadata } from "next";

export const metadata: Metadata = {
    title: "About Us | TrendKartz",
    description: "Learn about our mission to provide elevated everyday style.",
};

export default function AboutPage() {
    return (
        <div className="page-container" style={{ maxWidth: '800px' }}>
            <div className="catalog-header" style={{ marginBottom: '64px', textAlign: 'left' }}>
                <h1 style={{ fontSize: '3.5rem', fontWeight: 800, letterSpacing: '-0.04em', marginBottom: '24px' }}>Our Story</h1>
                <p style={{ fontSize: '1.25rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    TrendKartz was built on a simple premise: everyday essentials shouldn't be boring.
                    We believe in merging minimalist aesthetics with premium fabrics to create clothing and accessories that elevate your daily life.
                </p>
            </div>

            <div className="about-content" style={{ display: 'flex', flexDirection: 'column', gap: '48px' }}>
                <img
                    src="https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&auto=format&fit=crop&q=80"
                    alt="Our Studio"
                    style={{ width: '100%', height: 'auto', borderRadius: '16px' }}
                />

                <div>
                    <h2 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '16px' }}>Quality First</h2>
                    <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                        We source our materials meticulously, ensuring that every product feels as good as it looks.
                        From the weight of our signature hoodies to the print clarity on our custom mugs, we never compromise on quality.
                    </p>
                </div>

                <div>
                    <h2 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '16px' }}>The Custom Experience</h2>
                    <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                        What truly sets TrendKartz apart is our seamless integration of personalization. We built our
                        storefront to allow you to easily attach your name or upload your favorite pictures to our
                        base products, creating something that is uniquely yours.
                    </p>
                </div>
            </div>
        </div>
    );
}
