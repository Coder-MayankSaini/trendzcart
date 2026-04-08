import React from 'react';
import Link from 'next/link';

export const metadata = {
    title: "Contact Us | TrendKartz",
    description: "Get in touch with TrendKartz customer support.",
};

export default function ContactPage() {
    const phoneNumber = "918278377255";
    const message = encodeURIComponent("Hello TrendKartz, I have a query about your store.");
    const whatsappUrl = `https://wa.me/${phoneNumber}?text=${message}`;

    return (
        <div className="page-container" style={{ maxWidth: '800px' }}>
            <div className="catalog-header" style={{ marginBottom: '48px', textAlign: 'left' }}>
                <h1 style={{ fontSize: '3.5rem', fontWeight: 800, letterSpacing: '-0.04em', marginBottom: '16px' }}>Contact Us</h1>
                <p style={{ fontSize: '1.25rem', color: 'var(--text-secondary)' }}>
                    We're here to help! Reach out to us through any of the channels below.
                </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '32px', marginTop: '40px' }}>
                
                {/* Email Support Card */}
                <div style={{ padding: '32px', borderRadius: '16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px', color: 'var(--text-primary)' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                    </div>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '12px' }}>Email Support</h2>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', flex: 1 }}>
                        Have a question regarding your order, our products, or anything else? Send us an email and we'll get back to you soon.
                    </p>
                    <a href="mailto:ofctrendkartz@gmail.com" style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'underline' }}>
                        ofctrendkartz@gmail.com
                    </a>
                </div>

                {/* WhatsApp Support Card */}
                <div style={{ padding: '32px', borderRadius: '16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#25d366', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px', color: '#fff' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.888-.788-1.489-1.761-1.663-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                        </svg>
                    </div>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '12px' }}>WhatsApp Chat</h2>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', flex: 1 }}>
                        Need immediate assistance or prefer texting? Chat with us directly on WhatsApp for lightning fast support.
                    </p>
                    <a 
                        href={whatsappUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        style={{ 
                            display: 'inline-flex', 
                            alignItems: 'center', 
                            gap: '8px', 
                            padding: '12px 24px', 
                            background: '#25d366', 
                            color: '#fff', 
                            fontWeight: 600, 
                            borderRadius: '999px',
                            textDecoration: 'none' 
                        }}
                    >
                        Chat on WhatsApp
                    </a>
                </div>

            </div>
        </div>
    );
}
