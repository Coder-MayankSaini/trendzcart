"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import AdminMobileDrawer from "./AdminMobileDrawer";

export function AdminHeader() {
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    return (
        <>
            <header className="admin-mobile-header" aria-label="Mobile Administrative Header">
                <div className="admin-mobile-header-left">
                    <button
                        type="button"
                        className="admin-hamburger-btn"
                        onClick={() => setIsDrawerOpen(true)}
                        aria-expanded={isDrawerOpen}
                        aria-label="Open administrative navigation drawer"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <line x1="3" y1="12" x2="21" y2="12" />
                            <line x1="3" y1="6" x2="21" y2="6" />
                            <line x1="3" y1="18" x2="21" y2="18" />
                        </svg>
                    </button>

                    <Link href="/admin/dashboard" className="admin-mobile-brand" aria-label="Bazaarvilla Admin Dashboard">
                        <Image
                            src="/brand/bazaarvilla-logo-horizontal.webp"
                            alt="Bazaarvilla"
                            width={125}
                            height={30}
                            priority
                            style={{ objectFit: "contain", height: "auto" }}
                        />
                        <span className="admin-badge-pill">Admin</span>
                    </Link>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Link
                        href="/"
                        className="admin-btn admin-btn-secondary admin-btn-sm"
                        style={{ padding: "6px 10px" }}
                        aria-label="Return to storefront"
                        title="Return to storefront"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                            <polyline points="9 22 9 12 15 12 15 22" />
                        </svg>
                    </Link>
                </div>
            </header>

            <AdminMobileDrawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} />
        </>
    );
}

export default AdminHeader;
