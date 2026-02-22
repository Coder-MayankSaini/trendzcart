import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Privacy Policy | TrendKartz",
    description: "Learn how we collect, use, and protect your data.",
};

export default function PrivacyPage() {
    return (
        <div className="page-container" style={{ maxWidth: '800px' }}>
            <div className="catalog-header" style={{ marginBottom: '64px', textAlign: 'left' }}>
                <h1 style={{ fontSize: '3rem', fontWeight: 800, letterSpacing: '-0.04em', marginBottom: '16px' }}>Privacy Policy</h1>
                <p style={{ fontSize: '1.125rem', color: 'var(--text-secondary)' }}>Last updated: October 2026</p>
            </div>

            <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: '32px', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <section>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '16px' }}>Information We Collect</h2>
                    <p>
                        When you create an account, place an order, or customize a product, we collect the necessary information
                        (e.g., your name, email, shipping address, and uploaded media).
                    </p>
                </section>

                <section>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '16px' }}>How We Use It</h2>
                    <p>
                        We use your data solely for fulfilling your orders, improving our services, and communicating with you securely.
                        Customized images uploaded to our servers are kept strictly private and used only for producing your final item.
                    </p>
                </section>

                <section>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '16px' }}>Third-Party Providers</h2>
                    <p>
                        TrendKartz relies on trusted third-party providers such as Google (Firebase) for secure database storage and authentication,
                        and Razorpay for processing encrypted financial transactions. We do not store your credit card details on our servers.
                    </p>
                </section>
            </div>
        </div>
    );
}
