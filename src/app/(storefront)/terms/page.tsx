import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Terms of Service | Bazaarvilla",
    description: "Read the official terms and conditions for shopping on Bazaarvilla.",
};

export default function TermsPage() {
    return (
        <div className="page-container" style={{ maxWidth: '840px', padding: '40px 24px' }}>
            <div className="catalog-header" style={{ marginBottom: '48px', textAlign: 'left' }}>
                <h1 style={{ fontSize: '2.75rem', fontWeight: 800, letterSpacing: '-0.03em', marginBottom: '12px', color: 'var(--text-primary)' }}>
                    Terms and Conditions
                </h1>
                <p style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>Effective Date: November 2026 | Bazaarvilla</p>
            </div>

            <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: '32px', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <section>
                    <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>1. Introduction</h2>
                    <p>
                        Welcome to Bazaarvilla (https://bazaarvilla.com/). By accessing our storefront, creating an account, or placing an order, you agree to comply with and be bound by these Terms of Service. If you do not agree with any part of these terms, please do not use our services.
                    </p>
                </section>

                <section>
                    <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>2. Product Customizations</h2>
                    <p>
                        Bazaarvilla offers customizable lifestyle merchandise, including personalized photo frames, mugs, apparel, and accessories. By uploading media or text for customization, you certify that you own all copyrights, trademarks, and permissions for the submitted materials. We reserve the right to decline or cancel orders containing unlawful, infringing, obscene, or defamatory content.
                    </p>
                </section>

                <section>
                    <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>3. Pricing and Payments</h2>
                    <p>
                        All product prices and shipping charges are displayed in Indian Rupees (INR) and are inclusive of applicable taxes unless stated otherwise. We support secure prepaid payments (UPI, Netbanking, Debit/Credit Cards via Razorpay) and Cash on Delivery (COD) for eligible pin codes. Orders are processed only after payment capture or order confirmation.
                    </p>
                </section>

                <section>
                    <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>4. Shipping and Delivery Policy</h2>
                    <p>
                        Orders are typically dispatched within 1–3 business days following order verification. Custom-printed products may require an additional 24–48 hours for production. Standard delivery timelines across India range between 3–7 business days depending on the destination pincode. Tracking details are provided upon dispatch.
                    </p>
                </section>

                <section>
                    <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>5. Cancellation and Refund Policy</h2>
                    <p>
                        Standard orders may be cancelled prior to dispatch by contacting customer support. Due to their individualized nature, customized products cannot be cancelled once printing/production has begun. In the rare event an item arrives damaged, defective, or incorrect, customers must report the issue within 7 days of delivery with photographic evidence for a free replacement or full refund.
                    </p>
                </section>

                <section>
                    <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>6. Merchant Information and Customer Support</h2>
                    <p>
                        For questions, disputes, or order assistance, contact Bazaarvilla customer support at:
                    </p>
                    <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
                        <li><strong>Email:</strong> support@bazaarvilla.com (or ofctrendkartz@gmail.com)</li>
                        <li><strong>WhatsApp:</strong> +91 8278377255</li>
                        <li><strong>Operating Hours:</strong> Monday – Saturday, 10:00 AM – 7:00 PM IST</li>
                    </ul>
                </section>
            </div>
        </div>
    );
}
