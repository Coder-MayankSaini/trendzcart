import Navbar from "@/components/storefront/Navbar";
import Link from "next/link";
import Image from "next/image";
import WhatsAppFloat from "@/components/storefront/WhatsAppFloat";

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="storefront-layout">
            <Navbar />
            <main className="main-content">
                {children}
            </main>
            <footer className="hp-footer">
                <div className="hp-footer-grid">
                    {/* Brand Column */}
                    <div>
                        <Link href="/" className="hp-footer-logo-link" aria-label="Bazaarvilla Homepage">
                            <Image
                                src="/brand/bazaarvilla-logo-horizontal.webp"
                                alt="Bazaarvilla"
                                width={160}
                                height={40}
                                className="hp-footer-logo"
                            />
                        </Link>
                        <p className="hp-footer-tagline">
                            Everyday finds, thoughtful gifts, and custom creations. Curated essentials delivered across India.
                        </p>
                    </div>

                    {/* Quick Links */}
                    <div>
                        <h4 className="hp-footer-col-title">Quick Links</h4>
                        <ul className="hp-footer-links">
                            <li><Link href="/products" className="hp-footer-link">Shop All</Link></li>
                            <li><Link href="/categories" className="hp-footer-link">Categories</Link></li>
                            <li><Link href="/about" className="hp-footer-link">About Us</Link></li>
                        </ul>
                    </div>

                    {/* Customer Care */}
                    <div>
                        <h4 className="hp-footer-col-title">Customer Care</h4>
                        <ul className="hp-footer-links">
                            <li><Link href="/terms" className="hp-footer-link">Shipping &amp; Returns</Link></li>
                            <li><Link href="/terms" className="hp-footer-link">Size Guide</Link></li>
                            <li><Link href="/privacy" className="hp-footer-link">FAQ</Link></li>
                            <li><Link href="/contact" className="hp-footer-link">Contact Us</Link></li>
                        </ul>
                    </div>

                    {/* Connect */}
                    <div>
                        <h4 className="hp-footer-col-title">Connect</h4>
                        <ul className="hp-footer-links">
                            <li><a href="mailto:support@bazaarvilla.com" className="hp-footer-link">support@bazaarvilla.com</a></li>
                            <li><a href="https://wa.me/918278377255" target="_blank" rel="noopener noreferrer" className="hp-footer-link">+91 8278377255 (WhatsApp)</a></li>
                            <li style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Mon – Sat, 10 AM – 7 PM IST</li>
                        </ul>
                    </div>
                </div>

                <div className="hp-footer-bottom">
                    <p className="hp-footer-copy">&copy; {new Date().getFullYear()} Bazaarvilla. All rights reserved. | Secure Payments via Razorpay</p>
                </div>
            </footer>
            <WhatsAppFloat />
        </div>
    );
}
