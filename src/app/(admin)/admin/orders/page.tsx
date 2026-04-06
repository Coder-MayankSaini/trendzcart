"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, doc, updateDoc, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

export default function AdminOrders() {
    const [orders, setOrders] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        try {
            const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
            const unsub = onSnapshot(q, (snapshot) => {
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setOrders(data);
                setError(null);
                setLoading(false);
            }, (err) => {
                console.error("AdminOrders: Firestore error", err);
                setError("Failed to load orders. Please update your Firestore Security Rules to allow admin reads on the 'orders' collection.");
                setLoading(false);
            });
            return () => unsub();
        } catch (err: any) {
            setError(err.message);
            setLoading(false);
        }
    }, []);

    const handleStatusChange = async (id: string, newStatus: string) => {
        try {
            const order = orders.find(o => o.id === id);
            const updateData: any = { orderStatus: newStatus, updatedAt: new Date() };

            // Auto-mark COD orders as PAID when delivered
            if (newStatus === "Delivered" && order?.paymentMethod === "COD" && order?.paymentStatus === "PENDING") {
                updateData.paymentStatus = "PAID";
            }

            await updateDoc(doc(db, "orders", id), updateData);
        } catch (err) {
            console.error("Failed to update status", err);
            alert("Failed to update order status. Check your Firestore permissions.");
        }
    };

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', color: 'var(--text-secondary)' }}>
            <div className="animate-spin" style={{ width: '24px', height: '24px', border: '3px solid var(--border-color)', borderTopColor: 'var(--accent)', borderRadius: '50%', marginRight: '12px' }}></div>
            Loading orders...
        </div>
    );

    return (
        <div className="animate-fade-in">
            <h1 style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '32px', letterSpacing: '-0.02em' }}>Order Management</h1>

            {error && (
                <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '16px 20px', borderRadius: '12px', marginBottom: '24px', fontSize: '0.9rem', fontWeight: 500, border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                    {error}
                </div>
            )}

            <div style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: '24px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            <tr>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Order ID</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Date</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Customer</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Items</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Amount</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)', textAlign: 'right' }}>Status</th>
                            </tr>
                        </thead>
                        <tbody style={{ fontSize: '0.9rem' }}>
                            {orders.length === 0 && !error && (
                                <tr>
                                    <td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>No orders found.</td>
                                </tr>
                            )}
                            {orders.map(order => (
                                <tr key={order.id} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background-color 0.2s ease' }} onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-primary)'} onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                                    <td style={{ padding: '16px 24px', verticalAlign: 'top', color: 'var(--accent)', fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 600 }}>{order.id.substring(0, 12)}...</td>
                                    <td style={{ padding: '16px 24px', verticalAlign: 'top', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                        {new Date(order.createdAt?.toDate?.() || order.createdAt).toLocaleDateString()}
                                    </td>
                                    <td style={{ padding: '16px 24px', verticalAlign: 'top' }}>
                                        <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>{order.shippingAddress?.fullName}</p>
                                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{order.shippingAddress?.phone}</p>
                                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '4px', maxWidth: '200px' }}>
                                            {order.shippingAddress?.addressLine1}, {order.shippingAddress?.city}, {order.shippingAddress?.state} - {order.shippingAddress?.pincode}
                                        </p>
                                    </td>
                                    <td style={{ padding: '16px 24px', verticalAlign: 'top' }}>
                                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            {order.items?.map((item: any, idx: number) => (
                                                <li key={idx}>
                                                    <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{item.quantity}× {item.name}</span>
                                                    {item.customizationData && (
                                                        <div style={{ fontSize: '0.75rem', backgroundColor: 'rgba(234, 179, 8, 0.1)', color: '#ca8a04', padding: '4px 8px', marginTop: '4px', borderRadius: '8px', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
                                                            <strong>Custom: </strong>
                                                            {item.customizationData.name && <span>Name: {item.customizationData.name} </span>}
                                                            {item.customizationData.pictureUrl && (
                                                                <a href={item.customizationData.pictureUrl} target="_blank" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>View Image</a>
                                                            )}
                                                        </div>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    </td>
                                    <td style={{ padding: '16px 24px', verticalAlign: 'top' }}>
                                        <p style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1.1rem', marginBottom: '4px' }}>₹{order.total?.toLocaleString("en-IN")}</p>
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>{order.paymentMethod}</p>
                                        {order.couponCode && (
                                            <p style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 600, marginBottom: '6px' }}>
                                                Coupon: {order.couponCode} (-₹{order.couponDiscount?.toLocaleString("en-IN") || order.discount?.toLocaleString("en-IN")})
                                            </p>
                                        )}
                                        <span style={{
                                            padding: '3px 10px', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700,
                                            backgroundColor: order.paymentStatus === 'PAID' ? 'rgba(34, 197, 94, 0.1)' : order.paymentStatus === 'PENDING' ? 'rgba(234, 179, 8, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                            color: order.paymentStatus === 'PAID' ? '#16a34a' : order.paymentStatus === 'PENDING' ? '#ca8a04' : '#ef4444',
                                        }}>
                                            {order.paymentStatus}
                                        </span>
                                    </td>
                                    <td style={{ padding: '16px 24px', verticalAlign: 'top', textAlign: 'right' }}>
                                        <select
                                            value={order.orderStatus}
                                            onChange={(e) => handleStatusChange(order.id, e.target.value)}
                                            style={{
                                                padding: '8px 14px', borderRadius: '12px', fontWeight: 600, fontSize: '0.85rem',
                                                border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)',
                                                color: 'var(--text-primary)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
                                            }}
                                        >
                                            <option value="Processing">Processing</option>
                                            <option value="Shipped">Shipped</option>
                                            <option value="Delivered">Delivered</option>
                                            <option value="Cancelled">Cancelled</option>
                                        </select>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
