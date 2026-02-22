"use client";

import { useEffect, useState } from "react";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

export default function AdminDashboard() {
    const [stats, setStats] = useState({
        totalOrders: 0,
        totalRevenue: 0,
        recentOrders: [] as any[],
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const q = query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(50));
                const snapshot = await getDocs(q);

                let revenue = 0;
                const orders = snapshot.docs.map((doc) => {
                    const data = doc.data();
                    if (data.paymentStatus === "PAID" || data.paymentMethod === "COD") {
                        revenue += data.total || 0;
                    }
                    return { id: doc.id, ...data };
                });

                setStats({
                    totalOrders: snapshot.size,
                    totalRevenue: revenue,
                    recentOrders: orders.slice(0, 5),
                });
            } catch (err: any) {
                console.error("Failed to fetch admin stats", err);
                if (err.code === "permission-denied") {
                    setError("Missing Firestore Read Permissions. Please update your Firebase Security Rules to allow admins to read the 'orders' collection.");
                } else {
                    setError(err.message || "Failed to load dashboard statistics.");
                }
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, []);

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', color: 'var(--text-secondary)' }}>
            <div className="animate-spin" style={{ width: '24px', height: '24px', border: '3px solid var(--border-color)', borderTopColor: 'var(--accent)', borderRadius: '50%', marginRight: '12px' }}></div>
            Loading dashboard...
        </div>
    );

    return (
        <div className="animate-fade-in" style={{ padding: '24px' }}>
            <h1 style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '32px', letterSpacing: '-0.02em' }}>Dashboard Overview</h1>

            {error && (
                <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '16px 20px', borderRadius: '12px', marginBottom: '32px', fontSize: '0.9rem', fontWeight: 500, border: '1px solid rgba(239, 68, 68, 0.2)', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '2px' }}>
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <div>{error}</div>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', marginBottom: '48px' }}>
                <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '24px', borderRadius: '24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', transition: 'transform 0.2s ease' }} onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}>
                    <h3 style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Total Revenue</h3>
                    <p style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>₹{stats.totalRevenue.toLocaleString("en-IN")}</p>
                </div>

                <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '24px', borderRadius: '24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', transition: 'transform 0.2s ease' }} onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}>
                    <h3 style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Total Orders</h3>
                    <p style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>{stats.totalOrders}</p>
                </div>

                <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '24px', borderRadius: '24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', transition: 'transform 0.2s ease' }} onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}>
                    <h3 style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Conversion Rate</h3>
                    <p style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>--%</p>
                </div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: '24px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ padding: '24px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Recent Orders</h2>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                            <tr>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Order ID</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Date</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Customer</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Status</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)', textAlign: 'right' }}>Total</th>
                            </tr>
                        </thead>
                        <tbody style={{ fontSize: '0.9rem' }}>
                            {stats.recentOrders.length === 0 && (
                                <tr>
                                    <td colSpan={5} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                        {error ? "Orders couldn't be loaded due to missing permissions." : "No recent orders found."}
                                    </td>
                                </tr>
                            )}
                            {stats.recentOrders.map((order) => (
                                <tr key={order.id} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background-color 0.2s ease' }} onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-primary)'} onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                                    <td style={{ padding: '16px 24px', color: 'var(--accent)', fontFamily: 'monospace', fontWeight: 600 }}>{order.id}</td>
                                    <td style={{ padding: '16px 24px', color: 'var(--text-primary)' }}>{new Date(order.createdAt?.toDate?.() || order.createdAt).toLocaleDateString()}</td>
                                    <td style={{ padding: '16px 24px', color: 'var(--text-primary)', fontWeight: 500 }}>{order.shippingAddress?.fullName}</td>
                                    <td style={{ padding: '16px 24px' }}>
                                        <span style={{
                                            padding: '4px 12px',
                                            borderRadius: '999px',
                                            fontSize: '0.75rem',
                                            fontWeight: 600,
                                            backgroundColor: order.orderStatus === 'Delivered' ? 'rgba(34, 197, 94, 0.1)' : order.orderStatus === 'Processing' ? 'rgba(234, 179, 8, 0.1)' : 'var(--border-color)',
                                            color: order.orderStatus === 'Delivered' ? '#16a34a' : order.orderStatus === 'Processing' ? '#ca8a04' : 'var(--text-secondary)'
                                        }}>
                                            {order.orderStatus}
                                        </span>
                                    </td>
                                    <td style={{ padding: '16px 24px', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>₹{order.total?.toLocaleString("en-IN")}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
