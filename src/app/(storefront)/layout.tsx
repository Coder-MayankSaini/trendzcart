import Navbar from "@/components/storefront/Navbar";
import Link from "next/link";
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
                        <h3 className="hp-footer-brand-name">TrendKartz<span>.</span></h3>
                        <p className="hp-footer-tagline">
                            Defining elegance through minimalism. Curated collections for the modern wardrobe.
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
                            <li><a href="mailto:ofctrendkartz@gmail.com" className="hp-footer-link">ofctrendkartz@gmail.com</a></li>
                        </ul>
                    </div>
                </div>

                <div className="hp-footer-bottom">
                    <p className="hp-footer-copy">&copy; {new Date().getFullYear()} TrendKartz. All rights reserved.</p>
                </div>
            </footer>
            <WhatsAppFloat />
        </div>
    );
}
