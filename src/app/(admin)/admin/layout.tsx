"use client";

import AdminGuard from "@/components/admin/AdminGuard";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return (
        <AdminGuard>
            <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                {/* Sidebar Navigation */}
                <aside style={{ width: '280px', backgroundColor: 'var(--bg-secondary)', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '32px 24px', borderBottom: '1px solid var(--border-color)' }}>
                        <a href="/admin/dashboard" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', textDecoration: 'none' }}>
                            TrendKartz <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '1rem', letterSpacing: '0.1em', textTransform: 'uppercase', marginLeft: '8px' }}>Admin</span>
                        </a>
                    </div>

                    <nav style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                        <a href="/admin/dashboard" style={{ display: 'block', padding: '12px 16px', borderRadius: '12px', fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none', transition: 'all 0.2s ease' }} onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-primary)'; e.currentTarget.style.color = 'var(--text-primary)' }} onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
                            Dashboard
                        </a>
                        <a href="/admin/products" style={{ display: 'block', padding: '12px 16px', borderRadius: '12px', fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none', transition: 'all 0.2s ease' }} onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-primary)'; e.currentTarget.style.color = 'var(--text-primary)' }} onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
                            Products
                        </a>
                        <a href="/admin/categories" style={{ display: 'block', padding: '12px 16px', borderRadius: '12px', fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none', transition: 'all 0.2s ease' }} onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-primary)'; e.currentTarget.style.color = 'var(--text-primary)' }} onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
                            Categories
                        </a>
                        <a href="/admin/orders" style={{ display: 'block', padding: '12px 16px', borderRadius: '12px', fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none', transition: 'all 0.2s ease' }} onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-primary)'; e.currentTarget.style.color = 'var(--text-primary)' }} onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
                            Orders
                        </a>
                        <a href="/admin/coupons" style={{ display: 'block', padding: '12px 16px', borderRadius: '12px', fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none', transition: 'all 0.2s ease' }} onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-primary)'; e.currentTarget.style.color = 'var(--text-primary)' }} onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)' }}>
                            Coupons
                        </a>
                    </nav>

                    <div style={{ padding: '24px', borderTop: '1px solid var(--border-color)' }}>
                        <a href="/" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '14px', borderRadius: '999px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontWeight: 600, textDecoration: 'none', transition: 'all 0.2s ease' }} onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--accent)'} onMouseOut={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                            Return to Store
                        </a>
                    </div>
                </aside>

                {/* Main Content Area */}
                <main style={{ flex: 1, padding: '48px', overflowY: 'auto', backgroundColor: 'var(--bg-primary)' }}>
                    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
                        {children}
                    </div>
                </main>
            </div>
        </AdminGuard>
    );
}
