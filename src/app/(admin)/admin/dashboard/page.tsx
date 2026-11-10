"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import AdminPageHeader from "@/components/admin/ui/AdminPageHeader";
import AdminBadge from "@/components/admin/ui/AdminBadge";

interface DashboardStats {
    totalOrders: number;
    totalRevenue: number;
    pendingOrders: number;
    recentOrders: any[];
}

export default function AdminDashboard() {
    const [stats, setStats] = useState<DashboardStats>({
        totalOrders: 0,
        totalRevenue: 0,
        pendingOrders: 0,
        recentOrders: [],
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const q = query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(50));
                const snapshot = await getDocs(q);

                let revenue = 0;
                let validOrderCount = 0;
                let pendingCount = 0;

                const orders = snapshot.docs.map((doc) => {
                    const data = doc.data();
                    const isQuarantined =
                        data.quarantined === true ||
                        data.orderStatus === "Synthetic_Test_Artifact" ||
                        data.paymentStatus === "UNPAID_SYNTHETIC_ARTIFACT";

                    if (!isQuarantined) {
                        validOrderCount++;
                        if (data.paymentStatus === "PAID" || (data.paymentMethod === "COD" && data.orderStatus !== "Cancelled")) {
                            revenue += data.total || 0;
                        }
                        if (data.orderStatus === "Processing" || data.paymentStatus === "PENDING") {
                            pendingCount++;
                        }
                    }
                    return { id: doc.id, ...data };
                });

                setStats({
                    totalOrders: validOrderCount,
                    totalRevenue: revenue,
                    pendingOrders: pendingCount,
                    recentOrders: orders.filter((o: any) => !o.quarantined && o.orderStatus !== "Synthetic_Test_Artifact").slice(0, 5),
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

    const getStatusVariant = (status: string) => {
        switch (status) {
            case "Delivered":
                return "delivered";
            case "Processing":
                return "pending";
            case "Shipped":
                return "shipped";
            case "Cancelled":
                return "cancelled";
            default:
                return "neutral";
        }
    };

    if (loading) {
        return (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "50vh", color: "var(--text-secondary)", gap: "12px" }}>
                <div className="animate-spin" style={{ width: "28px", height: "28px", border: "3px solid var(--border-color)", borderTopColor: "var(--accent)", borderRadius: "50%" }}></div>
                <p style={{ fontSize: "0.95rem", fontWeight: 500 }}>Loading dashboard statistics...</p>
            </div>
        );
    }

    return (
        <div className="animate-fade-in">
            <AdminPageHeader
                title="Dashboard Overview"
                subtitle="High-level store performance metrics and recent customer activity."
            >
                <Link href="/admin/orders" className="admin-btn admin-btn-secondary admin-btn-sm">
                    Manage Orders &rarr;
                </Link>
            </AdminPageHeader>

            {error && (
                <div style={{ backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#ef4444", padding: "16px 20px", borderRadius: "16px", marginBottom: "28px", fontSize: "0.9rem", fontWeight: 500, border: "1px solid rgba(239, 68, 68, 0.2)", display: "flex", alignItems: "flex-start", gap: "12px" }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "2px" }}>
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <div>{error}</div>
                </div>
            )}

            {/* KPI Cards Grid */}
            <div className="admin-kpi-grid">
                <div className="admin-kpi-card">
                    <span className="admin-kpi-label">Total Revenue</span>
                    <span className="admin-kpi-value" style={{ color: "var(--accent)" }}>
                        ₹{stats.totalRevenue.toLocaleString("en-IN")}
                    </span>
                    <span className="admin-kpi-subtext">Settled & confirmed orders</span>
                </div>

                <div className="admin-kpi-card">
                    <span className="admin-kpi-label">Total Orders</span>
                    <span className="admin-kpi-value">{stats.totalOrders}</span>
                    <span className="admin-kpi-subtext">All active customer purchases</span>
                </div>

                <div className="admin-kpi-card">
                    <span className="admin-kpi-label">Pending Fulfillment</span>
                    <span className="admin-kpi-value" style={{ color: stats.pendingOrders > 0 ? "#ca8a04" : "var(--text-primary)" }}>
                        {stats.pendingOrders}
                    </span>
                    <span className="admin-kpi-subtext">Awaiting shipping or delivery</span>
                </div>

                <div className="admin-kpi-card">
                    <span className="admin-kpi-label">Store Conversion</span>
                    <span className="admin-kpi-value">--%</span>
                    <span className="admin-kpi-subtext">Analytics tracking</span>
                </div>
            </div>

            {/* Recent Orders Section */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <div>
                        <h2 className="admin-card-title">Recent Orders</h2>
                        <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                            Latest transactions placed on Bazaarvilla
                        </p>
                    </div>
                    <Link href="/admin/orders" className="admin-btn admin-btn-secondary admin-btn-sm">
                        View All Orders
                    </Link>
                </div>

                {/* Desktop View: Table (>= 768px) */}
                <div className="admin-table-container">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>Order ID</th>
                                <th>Date</th>
                                <th>Customer</th>
                                <th>Status</th>
                                <th style={{ textAlign: "right" }}>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.recentOrders.length === 0 && (
                                <tr>
                                    <td colSpan={5} style={{ padding: "48px 20px", textAlign: "center", color: "var(--text-secondary)" }}>
                                        {error ? "Orders couldn't be loaded due to missing permissions." : "No recent orders found."}
                                    </td>
                                </tr>
                            )}
                            {stats.recentOrders.map((order) => {
                                const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
                                const formattedDate = isNaN(orderDate.getTime()) ? "Recently" : orderDate.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });
                                return (
                                    <tr key={order.id}>
                                        <td style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--accent)" }}>
                                            <Link href="/admin/orders" style={{ textDecoration: "underline" }}>
                                                {order.id.slice(0, 14)}...
                                            </Link>
                                        </td>
                                        <td style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>{formattedDate}</td>
                                        <td style={{ fontWeight: 600 }}>{order.shippingAddress?.fullName || "Guest Customer"}</td>
                                        <td>
                                            <AdminBadge variant={getStatusVariant(order.orderStatus)}>
                                                {order.orderStatus || "Processing"}
                                            </AdminBadge>
                                        </td>
                                        <td style={{ textAlign: "right", fontWeight: 700, color: "var(--text-primary)" }}>
                                            ₹{(order.total || 0).toLocaleString("en-IN")}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Mobile View: Responsive Cards (< 768px) */}
                <div className="admin-mobile-cards-list">
                    {stats.recentOrders.length === 0 && (
                        <div style={{ padding: "36px 16px", textAlign: "center", color: "var(--text-secondary)" }}>
                            {error ? "Orders couldn't be loaded due to permissions." : "No recent orders found."}
                        </div>
                    )}
                    {stats.recentOrders.map((order) => {
                        const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
                        const formattedDate = isNaN(orderDate.getTime()) ? "Recently" : orderDate.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
                        return (
                            <div key={order.id} className="admin-mobile-item-card">
                                <div className="admin-mobile-card-top">
                                    <div>
                                        <span style={{ fontFamily: "monospace", fontSize: "0.82rem", fontWeight: 700, color: "var(--accent)" }}>
                                            #{order.id.slice(0, 10)}...
                                        </span>
                                        <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                                            {formattedDate}
                                        </p>
                                    </div>
                                    <AdminBadge variant={getStatusVariant(order.orderStatus)}>
                                        {order.orderStatus || "Processing"}
                                    </AdminBadge>
                                </div>

                                <div className="admin-mobile-card-details">
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-primary)" }}>
                                            {order.shippingAddress?.fullName || "Guest Customer"}
                                        </span>
                                        <span style={{ fontSize: "1.05rem", fontWeight: 800, color: "var(--accent)" }}>
                                            ₹{(order.total || 0).toLocaleString("en-IN")}
                                        </span>
                                    </div>
                                    {order.shippingAddress?.city && (
                                        <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                                            {order.shippingAddress.city}, {order.shippingAddress.state}
                                        </span>
                                    )}
                                </div>

                                <div className="admin-mobile-card-actions">
                                    <Link href="/admin/orders" className="admin-btn admin-btn-secondary admin-btn-sm" style={{ width: "100%" }}>
                                        Manage Order &rarr;
                                    </Link>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
