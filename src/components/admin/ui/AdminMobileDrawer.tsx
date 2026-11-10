"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ADMIN_NAV_ITEMS, NavIconType } from "./adminNavItems";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";

function renderNavIcon(icon: NavIconType, size = 20) {
    switch (icon) {
        case "dashboard":
            return (
                <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect width="7" height="9" x="3" y="3" rx="1" />
                    <rect width="7" height="5" x="14" y="3" rx="1" />
                    <rect width="7" height="9" x="14" y="12" rx="1" />
                    <rect width="7" height="5" x="3" y="16" rx="1" />
                </svg>
            );
        case "products":
            return (
                <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m7.5 4.27 9 5.15" />
                    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                    <path d="m3.3 7 8.7 5 8.7-5" />
                    <path d="M12 22V12" />
                </svg>
            );
        case "categories":
            return (
                <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect width="7" height="7" x="3" y="3" rx="1" />
                    <rect width="7" height="7" x="14" y="3" rx="1" />
                    <rect width="7" height="7" x="14" y="14" rx="1" />
                    <rect width="7" height="7" x="3" y="14" rx="1" />
                </svg>
            );
        case "orders":
            return (
                <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="8" cy="21" r="1" />
                    <circle cx="19" cy="21" r="1" />
                    <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
                </svg>
            );
        case "coupons":
            return (
                <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
                    <path d="M13 5v2" />
                    <path d="M13 17v2" />
                    <path d="M13 11v2" />
                </svg>
            );
    }
}

interface AdminMobileDrawerProps {
    isOpen: boolean;
    onClose: () => void;
}

export function AdminMobileDrawer({ isOpen, onClose }: AdminMobileDrawerProps) {
    const pathname = usePathname();
    const { user, signOut } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const drawerRef = useRef<HTMLDivElement>(null);
    const closeBtnRef = useRef<HTMLButtonElement>(null);

    // Close on navigation
    useEffect(() => {
        onClose();
    }, [pathname]);

    // Handle Escape key and lock body scroll
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isOpen) {
                onClose();
            }
        };

        if (isOpen) {
            document.body.style.overflow = "hidden";
            window.addEventListener("keydown", handleKeyDown);
            setTimeout(() => closeBtnRef.current?.focus(), 50);
        } else {
            document.body.style.overflow = "";
        }

        return () => {
            document.body.style.overflow = "";
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [isOpen, onClose]);

    return (
        <>
            {/* Backdrop Overlay */}
            <div
                className={`admin-mobile-drawer-overlay ${isOpen ? "open" : ""}`}
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Slide-out Drawer */}
            <div
                ref={drawerRef}
                className={`admin-mobile-drawer ${isOpen ? "open" : ""}`}
                role="dialog"
                aria-modal="true"
                aria-label="Admin Mobile Navigation"
                tabIndex={-1}
            >
                <div className="admin-drawer-header">
                    <Link href="/admin/dashboard" className="admin-mobile-brand" onClick={onClose}>
                        <Image
                            src="/brand/bazaarvilla-logo-horizontal.webp"
                            alt="Bazaarvilla"
                            width={130}
                            height={32}
                            priority
                            style={{ objectFit: "contain", height: "auto" }}
                        />
                        <span className="admin-badge-pill">Admin</span>
                    </Link>

                    <button
                        ref={closeBtnRef}
                        className="admin-drawer-close-btn"
                        onClick={onClose}
                        aria-label="Close admin navigation menu"
                    >
                        &times;
                    </button>
                </div>

                <nav className="admin-sidebar-nav" aria-label="Mobile admin navigation links">
                    {ADMIN_NAV_ITEMS.map((item) => {
                        const isActive = pathname === item.href || (item.href !== "/admin/dashboard" && pathname?.startsWith(item.href));
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`admin-nav-item ${isActive ? "active" : ""}`}
                                aria-current={isActive ? "page" : undefined}
                                onClick={onClose}
                            >
                                {renderNavIcon(item.icon, 20)}
                                <span>{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>

                <div className="admin-sidebar-footer">
                    {/* Theme Toggle */}
                    <button
                        onClick={toggleTheme}
                        className="admin-nav-item"
                        style={{ border: "1px solid var(--border-color)", justifyContent: "center" }}
                        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
                    >
                        {theme === "dark" ? (
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                        )}
                        <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
                    </button>

                    {/* Return to storefront */}
                    <Link href="/" className="admin-return-btn" onClick={onClose}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                            <polyline points="9 22 9 12 15 12 15 22" />
                        </svg>
                        <span>Return to Store</span>
                    </Link>

                    {/* Admin Profile & Sign Out */}
                    {user?.email && (
                        <div style={{ padding: "8px 4px 0 4px", borderTop: "1px solid var(--border-color)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "160px", whiteSpace: "nowrap" }}>
                                {user.email}
                            </span>
                            <button
                                onClick={() => { signOut(); onClose(); }}
                                style={{ fontSize: "0.75rem", color: "#ef4444", fontWeight: 700, padding: "4px 8px" }}
                            >
                                Logout
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

export default AdminMobileDrawer;
