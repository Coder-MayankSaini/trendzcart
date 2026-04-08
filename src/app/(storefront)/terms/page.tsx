import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Terms of Service | TrendKartz",
    description: "Read our terms and conditions for using the TrendKartz platform.",
};

export default function TermsPage() {
    return (
        <div className="page-container" style={{ maxWidth: '800px' }}>
            <div className="catalog-header" style={{ marginBottom: '64px', textAlign: 'left' }}>
                <h1 style={{ fontSize: '3rem', fontWeight: 800, letterSpacing: '-0.04em', marginBottom: '16px' }}>Terms of Service</h1>
                <p style={{ fontSize: '1.125rem', color: 'var(--text-secondary)' }}>Last updated: October 2026</p>
            </div>

            <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: '32px', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <section>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '16px' }}>1. Introduction</h2>
                    <p>
                        Welcome to TrendKartz. By accessing our website and placing orders, you agree to be bound by
                        these Terms of Service. Please read them carefully.
                    </p>
                </section>

                <section>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '16px' }}>2. Product Customizations</h2>
                    <p>
                        Certain products on our platform are eligible for customization (e.g., adding names or uploading pictures).
                        By uploading an image, you guarantee that you hold the necessary rights to use that image. We reserve the right
                        to reject any customizations that contain offensive or copyrighted material.
                    </p>
                </section>

                <section>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '16px' }}>3. Pricing & Payments</h2>
                    <p>
                        All prices are listed in Indian Rupees (INR). We offer both online payments (via Razorpay) and Cash on Delivery (COD).
                        We highly encourage online payments to enjoy a seamless experience and faster out-for-delivery times.
                    </p>
                </section>

                <section>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '16px' }}>4. Returns & Refunds</h2>
                    <p>
                        We accept returns within 7 days for defective items. Please note that customized products are made specifically
                        for you and are therefore non-refundable unless they arrive damaged.
                    </p>
                </section>
            </div>
        </div>
    );
}
