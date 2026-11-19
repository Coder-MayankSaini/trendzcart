import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Privacy Policy | Bazaarvilla",
    description: "Learn how Bazaarvilla protects customer privacy and handles personal and uploaded data.",
};

export default function PrivacyPage() {
    return (
        <div className="page-container" style={{ maxWidth: '840px', padding: '40px 24px' }}>
            <div className="catalog-header" style={{ marginBottom: '48px', textAlign: 'left' }}>
                <h1 style={{ fontSize: '2.75rem', fontWeight: 800, letterSpacing: '-0.03em', marginBottom: '12px', color: 'var(--text-primary)' }}>
                    Privacy Policy
                </h1>
                <p style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>Effective Date: November 2026 | Bazaarvilla</p>
            </div>

            <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: '32px', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <section>
                    <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>1. Information We Collect</h2>
                    <p>
                        When you browse Bazaarvilla, create an account, place an order, or upload customized photos, we collect necessary customer details, including your full name, email address, phone number, shipping address, and customization files. We do not collect or store full credit card or bank account credentials.
                    </p>
                </section>

                <section>
                    <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>2. How We Protect Your Data</h2>
                    <p>
                        Customer customization photos are stored securely using Cloudflare R2 object storage with time-limited signed access tokens. Photos are accessible only to the authenticated customer and authorized Bazaarvilla fulfillment staff strictly for order preparation. Unrelated users cannot view or download your private media.
                    </p>
                </section>

                <section>
                    <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>3. Third-Party Service Providers</h2>
                    <p>
                        Bazaarvilla partners with trusted, industry-standard infrastructure providers:
                    </p>
                    <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
                        <li><strong>Payment Gateway:</strong> Razorpay Software Private Limited for encrypted payment processing.</li>
                        <li><strong>Authentication & Database:</strong> Google Cloud Platform / Firebase for user authentication and order persistence.</li>
                        <li><strong>Media Storage:</strong> Cloudflare R2 for secure customization image hosting.</li>
                    </ul>
                </section>

                <section>
                    <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>4. Customer Rights & Data Retention</h2>
                    <p>
                        You have the right to request access to your personal data or request deletion of uploaded customization files once your order has been successfully delivered and the return period has elapsed. Contact us at support@bazaarvilla.com for data privacy inquiries.
                    </p>
                </section>
            </div>
        </div>
    );
}
