"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, onSnapshot, doc, updateDoc, orderBy, query } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";
import AdminPageHeader from "@/components/admin/ui/AdminPageHeader";
import AdminBadge from "@/components/admin/ui/AdminBadge";

export default function AdminOrders() {
    const [orders, setOrders] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    // Search and filter states
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedStatusFilter, setSelectedStatusFilter] = useState("ALL");
    const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set());

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

    // Filtered orders
    const filteredOrders = useMemo(() => {
        return orders.filter((order) => {
            const queryLower = searchQuery.toLowerCase().trim();
            const matchesSearch = !queryLower ||
                order.id?.toLowerCase().includes(queryLower) ||
                order.shippingAddress?.fullName?.toLowerCase().includes(queryLower) ||
                order.shippingAddress?.phone?.includes(queryLower) ||
                order.shippingAddress?.city?.toLowerCase().includes(queryLower);

            const isQuarantined = order.quarantined === true || order.orderStatus === "Synthetic_Test_Artifact";

            let matchesStatus = true;
            if (selectedStatusFilter === "ALL") {
                matchesStatus = true;
            } else if (selectedStatusFilter === "QUARANTINED") {
                matchesStatus = isQuarantined;
            } else {
                matchesStatus = !isQuarantined && order.orderStatus === selectedStatusFilter;
            }

            return matchesSearch && matchesStatus;
        });
    }, [orders, searchQuery, selectedStatusFilter]);

    const handleStatusChange = async (id: string, newStatus: string) => {
        const order = orders.find(o => o.id === id);
        if (order?.quarantined === true || order?.orderStatus === "Synthetic_Test_Artifact") {
            alert("Quarantined synthetic test artifacts cannot be fulfilled or status-modified.");
            return;
        }

        if (newStatus === "Cancelled") {
            if (!confirm(`Are you sure you want to cancel Order #${id.slice(0, 8)}? This action cannot be easily undone.`)) {
                return;
            }
        } else if (newStatus === "Delivered") {
            if (!confirm(`Mark Order #${id.slice(0, 8)} as Delivered? (This will also settle COD payment if pending).`)) {
                return;
            }
        }

        try {
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

    const handleViewCustomization = async (cust: any) => {
        try {
            const key = cust.storagePath || cust.pictureUrl;
            if (!key) return;

            // If it's a legacy Firebase URL, handle gracefully
            if (typeof key === "string" && key.includes("firebasestorage.googleapis.com")) {
                window.open(key, "_blank");
                return;
            }

            const user = auth.currentUser;
            if (!user) {
                alert("Please sign in as admin to access private customization files.");
                return;
            }

            const token = await user.getIdToken();
            const res = await fetch(`/api/media/download?key=${encodeURIComponent(key)}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                alert(`Cannot view customer file: ${err.error || res.statusText}`);
                return;
            }

            const contentType = res.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
                const data = await res.json();
                if (data.downloadUrl) {
                    window.open(data.downloadUrl, "_blank");
                    return;
                }
            }

            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            window.open(blobUrl, "_blank");
        } catch (err: any) {
            console.error("Failed to view customization image", err);
            alert("Failed to load customer image.");
        }
    };

    const toggleExpandOrder = (id: string) => {
        setExpandedOrderIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

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

    const getPaymentVariant = (status: string, quarantined: boolean) => {
        if (quarantined) return "quarantined";
        switch (status) {
            case "PAID":
                return "paid";
            case "PENDING":
                return "pending";
            default:
                return "cancelled";
        }
    };

    if (loading) {
        return (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "50vh", color: "var(--text-secondary)", gap: "12px" }}>
                <div className="animate-spin" style={{ width: "28px", height: "28px", border: "3px solid var(--border-color)", borderTopColor: "var(--accent)", borderRadius: "50%" }}></div>
                <p style={{ fontSize: "0.95rem", fontWeight: 500 }}>Loading customer orders...</p>
            </div>
        );
    }

    return (
        <div className="animate-fade-in">
            <AdminPageHeader
                title="Order Management"
                subtitle={`Track, fulfill, and inspect customer purchases (${orders.length} total orders)`}
            />

            {error && (
                <div style={{ backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#ef4444", padding: "16px 20px", borderRadius: "16px", marginBottom: "24px", fontSize: "0.9rem", fontWeight: 500, border: "1px solid rgba(239, 68, 68, 0.2)" }}>
                    {error}
                </div>
            )}

            <div className="admin-card">
                {/* Search & Filter Bar */}
                <div className="admin-filter-bar">
                    <div className="admin-search-wrapper">
                        <svg className="admin-search-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <input
                            type="search"
                            className="admin-search-input"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search by order ID, customer name, phone, city..."
                            aria-label="Search orders"
                        />
                    </div>

                    <div className="admin-filter-pills">
                        {["ALL", "Processing", "Shipped", "Delivered", "Cancelled"].map((status) => (
                            <button
                                key={status}
                                type="button"
                                className={`admin-filter-pill ${selectedStatusFilter === status ? "active" : ""}`}
                                onClick={() => setSelectedStatusFilter(status)}
                            >
                                {status === "ALL" ? `All Orders (${orders.length})` : status}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Desktop View: Table (>= 768px) */}
                <div className="admin-table-container">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>Order ID</th>
                                <th>Date</th>
                                <th>Customer & Address</th>
                                <th>Items</th>
                                <th>Amount & Pay</th>
                                <th style={{ textAlign: "right" }}>Fulfillment Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredOrders.length === 0 && (
                                <tr>
                                    <td colSpan={6} style={{ padding: "48px 20px", textAlign: "center", color: "var(--text-secondary)" }}>
                                        No orders found matching your search.
                                    </td>
                                </tr>
                            )}
                            {filteredOrders.map((order) => {
                                const isQuarantined = order.quarantined === true || order.orderStatus === "Synthetic_Test_Artifact";
                                const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
                                const formattedDate = isNaN(orderDate.getTime()) ? "Recently" : orderDate.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });

                                return (
                                    <tr key={order.id}>
                                        <td style={{ fontFamily: "monospace", fontSize: "0.8rem", fontWeight: 700, color: "var(--accent)", verticalAlign: "top" }}>
                                            {order.id.slice(0, 12)}...
                                        </td>
                                        <td style={{ color: "var(--text-secondary)", fontSize: "0.85rem", verticalAlign: "top", whiteSpace: "nowrap" }}>
                                            {formattedDate}
                                        </td>
                                        <td style={{ verticalAlign: "top" }}>
                                            <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                                                {order.shippingAddress?.fullName || "Guest Customer"}
                                            </div>
                                            {order.shippingAddress?.phone && (
                                                <a
                                                    href={`tel:${order.shippingAddress.phone}`}
                                                    style={{ color: "var(--accent)", fontSize: "0.8rem", textDecoration: "underline", display: "inline-block", marginTop: "2px" }}
                                                >
                                                    {order.shippingAddress.phone}
                                                </a>
                                            )}
                                            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", maxWidth: "220px", lineHeight: 1.3 }}>
                                                {order.shippingAddress?.addressLine1 && `${order.shippingAddress.addressLine1}, `}
                                                {order.shippingAddress?.city}, {order.shippingAddress?.state} - {order.shippingAddress?.pincode}
                                            </div>
                                        </td>
                                        <td style={{ verticalAlign: "top" }}>
                                            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                                                {order.items?.map((item: any, idx: number) => (
                                                    <li key={idx} style={{ fontSize: "0.85rem" }}>
                                                        <span style={{ fontWeight: 600 }}>{item.quantity}×</span> {item.name}
                                                        {item.customizationData && (
                                                            <div style={{ fontSize: "0.75rem", backgroundColor: "rgba(234, 179, 8, 0.12)", color: "#ca8a04", padding: "4px 8px", marginTop: "3px", borderRadius: "6px", border: "1px solid rgba(234, 179, 8, 0.25)" }}>
                                                                <strong>Custom: </strong>
                                                                {item.customizationData.name && <span>&quot;{item.customizationData.name}&quot; </span>}
                                                                {(item.customizationData.pictureUrl || item.customizationData.storagePath) && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleViewCustomization(item.customizationData)}
                                                                        style={{
                                                                            color: "var(--accent)",
                                                                            fontWeight: 700,
                                                                            textDecoration: "underline",
                                                                            marginLeft: "4px",
                                                                            cursor: "pointer",
                                                                            fontFamily: "inherit",
                                                                            fontSize: "inherit"
                                                                        }}
                                                                    >
                                                                        View Image &rarr;
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        </td>
                                        <td style={{ verticalAlign: "top" }}>
                                            <div style={{ fontWeight: 800, fontSize: "1.05rem", color: "var(--text-primary)" }}>
                                                ₹{(order.total || 0).toLocaleString("en-IN")}
                                            </div>
                                            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", margin: "2px 0 4px 0" }}>
                                                {order.paymentMethod || "Prepaid"}
                                            </div>
                                            {order.couponCode && (
                                                <div style={{ fontSize: "0.72rem", color: "#16a34a", fontWeight: 600, marginBottom: "4px" }}>
                                                    Coupon: {order.couponCode}
                                                </div>
                                            )}
                                            <AdminBadge variant={getPaymentVariant(order.paymentStatus, isQuarantined)}>
                                                {isQuarantined ? "QUARANTINED" : order.paymentStatus || "PENDING"}
                                            </AdminBadge>
                                        </td>
                                        <td style={{ verticalAlign: "top", textAlign: "right" }}>
                                            {isQuarantined ? (
                                                <span className="admin-status-badge admin-status-quarantined">
                                                    Quarantined Artifact
                                                </span>
                                            ) : (
                                                <select
                                                    value={order.orderStatus || "Processing"}
                                                    onChange={(e) => handleStatusChange(order.id, e.target.value)}
                                                    className="admin-form-select"
                                                    style={{ width: "auto", minWidth: "130px", fontSize: "0.85rem", padding: "6px 10px", minHeight: "36px" }}
                                                    aria-label={`Change status for order ${order.id}`}
                                                >
                                                    <option value="Processing">Processing</option>
                                                    <option value="Shipped">Shipped</option>
                                                    <option value="Delivered">Delivered</option>
                                                    <option value="Cancelled">Cancelled</option>
                                                </select>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Mobile View: Responsive Order Cards (< 768px) */}
                <div className="admin-mobile-cards-list">
                    {filteredOrders.length === 0 && (
                        <div style={{ padding: "36px 16px", textAlign: "center", color: "var(--text-secondary)" }}>
                            No orders found matching your search.
                        </div>
                    )}
                    {filteredOrders.map((order) => {
                        const isQuarantined = order.quarantined === true || order.orderStatus === "Synthetic_Test_Artifact";
                        const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
                        const formattedDate = isNaN(orderDate.getTime()) ? "Recently" : orderDate.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });
                        const isExpanded = expandedOrderIds.has(order.id);

                        return (
                            <div key={order.id} className="admin-mobile-item-card">
                                {/* Top Header: ID + Date + Badges */}
                                <div className="admin-mobile-card-top">
                                    <div>
                                        <span style={{ fontFamily: "monospace", fontSize: "0.82rem", fontWeight: 700, color: "var(--accent)" }}>
                                            #{order.id.slice(0, 10)}...
                                        </span>
                                        <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                                            {formattedDate}
                                        </p>
                                    </div>
                                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                                        <AdminBadge variant={getPaymentVariant(order.paymentStatus, isQuarantined)}>
                                            {isQuarantined ? "QUARANTINED" : order.paymentStatus || "PENDING"}
                                        </AdminBadge>
                                        <AdminBadge variant={getStatusVariant(order.orderStatus)}>
                                            {order.orderStatus || "Processing"}
                                        </AdminBadge>
                                    </div>
                                </div>

                                {/* Customer Info */}
                                <div style={{ padding: "10px 12px", borderRadius: "12px", backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-color)" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <span style={{ fontWeight: 700, fontSize: "0.92rem", color: "var(--text-primary)" }}>
                                            {order.shippingAddress?.fullName || "Guest Customer"}
                                        </span>
                                        {order.shippingAddress?.phone && (
                                            <a
                                                href={`tel:${order.shippingAddress.phone}`}
                                                className="admin-btn admin-btn-secondary admin-btn-sm"
                                                style={{ minHeight: "30px", padding: "4px 8px", fontSize: "0.75rem" }}
                                            >
                                                Call
                                            </a>
                                        )}
                                    </div>
                                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.35 }}>
                                        {order.shippingAddress?.city}, {order.shippingAddress?.state} - {order.shippingAddress?.pincode}
                                    </div>
                                    {isExpanded && order.shippingAddress?.addressLine1 && (
                                        <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "4px", borderTop: "1px dashed var(--border-color)", paddingTop: "4px" }}>
                                            {order.shippingAddress.addressLine1}
                                        </div>
                                    )}
                                </div>

                                {/* Items list */}
                                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                    <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                        Ordered Items ({order.items?.length || 0})
                                    </span>
                                    {order.items?.map((item: any, idx: number) => (
                                        <div key={idx} style={{ fontSize: "0.85rem", padding: "6px 0", borderBottom: idx < (order.items?.length || 0) - 1 ? "1px solid var(--border-color)" : "none" }}>
                                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                                <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                                                    {item.quantity}× {item.name}
                                                </span>
                                                <span style={{ fontWeight: 700, color: "var(--text-secondary)" }}>
                                                    ₹{((item.price || 0) * (item.quantity || 1)).toLocaleString("en-IN")}
                                                </span>
                                            </div>

                                            {item.customizationData && (
                                                <div style={{ marginTop: "4px", padding: "6px 10px", borderRadius: "8px", backgroundColor: "rgba(234, 179, 8, 0.12)", color: "#ca8a04", fontSize: "0.75rem", border: "1px solid rgba(234, 179, 8, 0.25)" }}>
                                                    {item.customizationData.name && <div><strong>Name Engraving:</strong> &quot;{item.customizationData.name}&quot;</div>}
                                                    {(item.customizationData.pictureUrl || item.customizationData.storagePath) && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleViewCustomization(item.customizationData)}
                                                            className="admin-btn admin-btn-primary admin-btn-sm"
                                                            style={{ marginTop: "6px", width: "100%", fontSize: "0.75rem", minHeight: "32px" }}
                                                        >
                                                            View Customer Uploaded Image &rarr;
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* Pricing & Payment Summary */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "8px", borderTop: "1px solid var(--border-color)" }}>
                                    <div>
                                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block" }}>
                                            {order.paymentMethod || "Prepaid"}
                                        </span>
                                        {order.couponCode && (
                                            <span style={{ fontSize: "0.72rem", color: "#16a34a", fontWeight: 600 }}>
                                                Coupon: {order.couponCode}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                        <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", display: "block" }}>Order Total</span>
                                        <span style={{ fontSize: "1.25rem", fontWeight: 800, color: "var(--accent)" }}>
                                            ₹{(order.total || 0).toLocaleString("en-IN")}
                                        </span>
                                    </div>
                                </div>

                                {/* Status Action Control */}
                                <div className="admin-mobile-card-actions" style={{ flexDirection: "column", alignItems: "stretch", gap: "8px" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                                            Update Fulfillment:
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => toggleExpandOrder(order.id)}
                                            style={{ fontSize: "0.78rem", color: "var(--accent)", fontWeight: 600 }}
                                        >
                                            {isExpanded ? "Hide Details" : "Full Details"}
                                        </button>
                                    </div>

                                    {isQuarantined ? (
                                        <div style={{ padding: "8px 12px", borderRadius: "10px", backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#dc2626", fontSize: "0.78rem", fontWeight: 700, textAlign: "center", border: "1px solid rgba(239, 68, 68, 0.25)" }}>
                                            Quarantined Artifact — Fulfillment Locked
                                        </div>
                                    ) : (
                                        <select
                                            value={order.orderStatus || "Processing"}
                                            onChange={(e) => handleStatusChange(order.id, e.target.value)}
                                            className="admin-form-select"
                                            style={{ width: "100%", fontSize: "0.95rem", fontWeight: 600 }}
                                            aria-label={`Update fulfillment status for order ${order.id}`}
                                        >
                                            <option value="Processing">Status: Processing</option>
                                            <option value="Shipped">Status: Shipped</option>
                                            <option value="Delivered">Status: Delivered</option>
                                            <option value="Cancelled">Status: Cancelled</option>
                                        </select>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
