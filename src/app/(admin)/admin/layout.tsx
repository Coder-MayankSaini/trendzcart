"use client";

import AdminGuard from "@/components/admin/AdminGuard";
import AdminSidebar from "@/components/admin/ui/AdminSidebar";
import AdminHeader from "@/components/admin/ui/AdminHeader";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return (
        <AdminGuard>
            <div className="admin-layout-container">
                {/* Desktop Persistent Sidebar (>= 1024px) */}
                <AdminSidebar />

                {/* Mobile Header & Main Content Area */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, width: "100%" }}>
                    <AdminHeader />

                    <main className="admin-main-content" id="admin-main-content">
                        <div className="admin-page-container">
                            {children}
                        </div>
                    </main>
                </div>
            </div>
        </AdminGuard>
    );
}
