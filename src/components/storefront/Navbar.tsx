"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useTheme } from "@/context/ThemeContext";
import { useState, useEffect } from "react";
import AuthModal from "./AuthModal";

export default function Navbar() {
    const { user, profile, signOut } = useAuth();
    const { cartCount } = useCart();
    const { theme, toggleTheme } = useTheme();
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    // Close mobile menu on route change / resize
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth > 768) setIsMobileMenuOpen(false);
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    const closeMobileMenu = () => setIsMobileMenuOpen(false);

    const ThemeIcon = () => theme === 'dark' ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
    ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
    );

    return (
        <header className="navbar">
            <div className="navbar-container">
                {/* Logo */}
                <div className="navbar-logo">
                    <Link href="/">
                        TrendKartz<span className="logo-dot">.</span>
                    </Link>
                </div>

                {/* Desktop Links */}
                <nav className="navbar-links">
                    <Link href="/products" className="nav-link">Shop</Link>
                    <Link href="/categories" className="nav-link">Categories</Link>
                    {user && <Link href="/orders" className="nav-link">My Orders</Link>}
                    <Link href="/about" className="nav-link">About</Link>
                </nav>

                {/* Actions */}
                <div className="navbar-actions">
                    {/* Theme toggle — desktop only */}
                    <button
                        onClick={toggleTheme}
                        className="action-btn theme-toggle-btn desktop-only"
                        aria-label="Toggle Dark Mode"
                    >
                        <ThemeIcon />
                    </button>

                    {/* User icon — mobile only, opens auth */}
                    {!user && (
                        <button
                            onClick={() => setIsAuthModalOpen(true)}
                            className="action-btn mobile-user-icon"
                            aria-label="Sign In"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                        </button>
                    )}

                    <Link href="/cart" className="action-btn cart-icon-btn" aria-label="Cart">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
                        {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
                    </Link>

                    {/* Desktop-only auth buttons */}
                    <div className="desktop-auth">
                        {user ? (
                            <>
                                {profile?.role === "admin" && (
                                    <Link href="/admin/dashboard" className="action-btn admin-btn">Admin</Link>
                                )}
                                <button onClick={signOut} className="action-btn logout-btn">Logout</button>
                            </>
                        ) : (
                            <button onClick={() => setIsAuthModalOpen(true)} className="action-btn login-btn">
                                Sign In
                            </button>
                        )}
                    </div>

                    {/* Hamburger — mobile only */}
                    <button
                        className="hamburger-btn"
                        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                        aria-label="Toggle Mobile Menu"
                    >
                        <span className={`hamburger-icon ${isMobileMenuOpen ? 'open' : ''}`}>
                            <span></span>
                            <span></span>
                            <span></span>
                        </span>
                    </button>
                </div>
            </div>

            {/* Mobile Full-Screen Menu */}
            <div className={`mobile-menu ${isMobileMenuOpen ? 'open' : ''}`}>
                <div className="mobile-menu-inner">
                    <nav className="mobile-nav">
                        <Link href="/products" className="mobile-nav-link" onClick={closeMobileMenu}>
                            Shop
                        </Link>
                        <Link href="/categories" className="mobile-nav-link" onClick={closeMobileMenu}>
                            Categories
                        </Link>
                        {user && (
                            <Link href="/orders" className="mobile-nav-link" onClick={closeMobileMenu}>
                                My Orders
                            </Link>
                        )}
                        <Link href="/about" className="mobile-nav-link" onClick={closeMobileMenu}>
                            About
                        </Link>
                    </nav>

                    {/* Theme toggle inside mobile menu */}
                    <button
                        onClick={toggleTheme}
                        className="mobile-theme-toggle"
                    >
                        <ThemeIcon />
                        <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                    </button>

                    <div className="mobile-auth-section">
                        {user ? (
                            <>
                                <div className="mobile-user-info">
                                    <div className="mobile-avatar">{user.email?.charAt(0).toUpperCase()}</div>
                                    <span className="mobile-user-email">{user.email}</span>
                                </div>
                                {profile?.role === "admin" && (
                                    <Link href="/admin/dashboard" className="mobile-auth-btn admin" onClick={closeMobileMenu}>
                                        Admin Dashboard
                                    </Link>
                                )}
                                <button onClick={() => { signOut(); closeMobileMenu(); }} className="mobile-auth-btn logout">
                                    Logout
                                </button>
                            </>
                        ) : (
                            <button onClick={() => { setIsAuthModalOpen(true); closeMobileMenu(); }} className="mobile-auth-btn signin">
                                Sign In
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Overlay */}
            {isMobileMenuOpen && <div className="mobile-overlay" onClick={closeMobileMenu} />}

            <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
        </header>
    );
}
