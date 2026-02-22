"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import Link from "next/link";
import AuthModal from "@/components/storefront/AuthModal";

export default function MyOrdersPage() {
    const { user } = useAuth();
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        }

        const q = query(
            collection(db, "orders"),
            where("userId", "==", user.uid),
            orderBy("createdAt", "desc")
        );

        const unsub = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setOrders(data);
            setLoading(false);
        }, (err) => {
            console.error("Failed to load orders", err);
            setLoading(false);
        });

        return () => unsub();
    }, [user]);

    const getStatusColor = (status: string) => {
        switch (status) {
            case "Delivered": return { bg: "rgba(34, 197, 94, 0.1)", color: "#16a34a" };
            case "Shipped": return { bg: "rgba(59, 130, 246, 0.1)", color: "#3b82f6" };
            case "Processing": return { bg: "rgba(234, 179, 8, 0.1)", color: "#ca8a04" };
            case "Cancelled": return { bg: "rgba(239, 68, 68, 0.1)", color: "#ef4444" };
            default: return { bg: "rgba(148, 163, 184, 0.1)", color: "#94a3b8" };
        }
    };

    const getPaymentColor = (status: string) => {
        switch (status) {
            case "PAID": return { bg: "rgba(34, 197, 94, 0.1)", color: "#16a34a" };
            case "PENDING": return { bg: "rgba(234, 179, 8, 0.1)", color: "#ca8a04" };
            case "FAILED": return { bg: "rgba(239, 68, 68, 0.1)", color: "#ef4444" };
            default: return { bg: "rgba(148, 163, 184, 0.1)", color: "#94a3b8" };
        }
    };

    const formatDate = (ts: any) => {
        try {
            const date = ts?.toDate?.() ? ts.toDate() : new Date(ts);
            return date.toLocaleDateString("en-IN", {
                day: "numeric", month: "short", year: "numeric"
            });
        } catch {
            return "—";
        }
    };

    // Not logged in
    if (!user && !loading) {
        return (
            <div className="co-empty">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                <h2>Sign in to view your orders</h2>
                <p>Track your purchases and order status.</p>
                <button onClick={() => setIsAuthModalOpen(true)} className="co-empty-link">Sign In</button>
                <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
            </div>
        );
    }

    if (loading) {
        return (
            <div className="mo-container">
                <div className="mo-loading">
                    <div className="co-spinner" style={{ width: 28, height: 28 }} />
                    <span>Loading your orders...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="mo-container">
            <h1 className="mo-title">My Orders</h1>

            {orders.length === 0 ? (
                <div className="mo-empty">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
                    <h3>No orders yet</h3>
                    <p>Your order history will appear here once you make a purchase.</p>
                    <Link href="/products" className="co-empty-link">Start Shopping</Link>
                </div>
            ) : (
                <div className="mo-list">
                    {orders.map(order => {
                        const statusStyle = getStatusColor(order.orderStatus);
                        const payStyle = getPaymentColor(order.paymentStatus);

                        return (
                            <div key={order.id} className="mo-card">
                                {/* Card Header */}
                                <div className="mo-card-header">
                                    <div className="mo-card-header-left">
                                        <span className="mo-order-id">Order #{order.id.substring(0, 8).toUpperCase()}</span>
                                        <span className="mo-order-date">{formatDate(order.createdAt)}</span>
                                    </div>
                                    <div className="mo-card-header-right">
                                        <span className="mo-status-badge" style={{ background: statusStyle.bg, color: statusStyle.color }}>
                                            {order.orderStatus}
                                        </span>
                                    </div>
                                </div>

                                {/* Items */}
                                <div className="mo-items">
                                    {order.items?.map((item: any, idx: number) => (
                                        <div key={idx} className="mo-item">
                                            {item.image && (
                                                <div className="mo-item-img">
                                                    <img src={item.image} alt={item.name} />
                                                </div>
                                            )}
                                            <div className="mo-item-info">
                                                <span className="mo-item-name">{item.name}</span>
                                                <span className="mo-item-meta">Qty: {item.quantity} &middot; ₹{item.price?.toLocaleString("en-IN")}</span>
                                            </div>
                                            <span className="mo-item-total">₹{(item.price * item.quantity).toLocaleString("en-IN")}</span>
                                        </div>
                                    ))}
                                </div>

                                {/* Card Footer */}
                                <div className="mo-card-footer">
                                    <div className="mo-footer-left">
                                        <span className="mo-pay-method">{order.paymentMethod === "RAZORPAY" ? "Paid Online" : "Cash on Delivery"}</span>
                                        <span className="mo-pay-badge" style={{ background: payStyle.bg, color: payStyle.color }}>
                                            {order.paymentStatus}
                                        </span>
                                    </div>
                                    <div className="mo-footer-total">
                                        <span className="mo-total-label">Total</span>
                                        <span className="mo-total-value">₹{order.total?.toLocaleString("en-IN")}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
