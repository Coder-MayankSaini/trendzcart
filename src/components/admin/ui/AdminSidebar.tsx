"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ADMIN_NAV_ITEMS, NavIconType } from "./adminNavItems";
import { useAuth } from "@/context/AuthContext";

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
        case "reviews":
            return (
                <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
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

export function AdminSidebar() {
    const pathname = usePathname();
    const { user } = useAuth();

    return (
        <aside className="admin-desktop-sidebar" aria-label="Desktop Administrative Navigation">
            <div className="admin-sidebar-header">
                <Link href="/admin/dashboard" className="admin-sidebar-logo-link" aria-label="Bazaarvilla Admin Dashboard">
                    <Image
                        src="/brand/bazaarvilla-logo-horizontal.webp"
                        alt="Bazaarvilla"
                        width={140}
                        height={35}
                        priority
                        style={{ objectFit: "contain", height: "auto" }}
                    />
                    <span className="admin-badge-pill">Admin</span>
                </Link>
            </div>

            <nav className="admin-sidebar-nav" aria-label="Admin navigation links">
                {ADMIN_NAV_ITEMS.map((item) => {
                    const isActive = pathname === item.href || (item.href !== "/admin/dashboard" && pathname?.startsWith(item.href));
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`admin-nav-item ${isActive ? "active" : ""}`}
                            aria-current={isActive ? "page" : undefined}
                        >
                            {renderNavIcon(item.icon, 20)}
                            <span>{item.label}</span>
                        </Link>
                    );
                })}
            </nav>

            <div className="admin-sidebar-footer">
                {user?.email && (
                    <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 4px" }} title={user.email}>
                        Signed in as <strong>{user.email}</strong>
                    </div>
                )}
                <Link href="/" className="admin-return-btn" aria-label="Return to customer storefront">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        <polyline points="9 22 9 12 15 12 15 22" />
                    </svg>
                    <span>Storefront</span>
                </Link>
            </div>
        </aside>
    );
}

export default AdminSidebar;
