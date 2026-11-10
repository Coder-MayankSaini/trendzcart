"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import AdminPageHeader from "@/components/admin/ui/AdminPageHeader";
import AdminBadge from "@/components/admin/ui/AdminBadge";

interface Coupon {
    code: string;
    discountType: "percentage" | "flat";
    discountValue: number;
    expiryDate: any;
    usageLimit: number;
    timesUsed: number;
    isActive: boolean;
}

export default function AdminCoupons() {
    const [coupons, setCoupons] = useState<Coupon[]>([]);
    const [isAdding, setIsAdding] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [code, setCode] = useState("");
    const [type, setType] = useState<"percentage" | "flat">("percentage");
    const [value, setValue] = useState(10);
    const [expiry, setExpiry] = useState("");
    const [limit, setLimit] = useState(100);

    useEffect(() => {
        try {
            const unsub = onSnapshot(collection(db, "coupons"), (snapshot) => {
                const data = snapshot.docs.map(doc => ({ ...doc.data() } as Coupon));
                setCoupons(data);
                setError(null);
            }, (err) => {
                console.error("AdminCoupons: Firestore error", err);
                setError("Failed to load coupons. Check your Firestore Security Rules.");
            });
            return () => unsub();
        } catch (err: any) {
            setError(err.message);
        }
    }, []);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        const finalCode = code.toUpperCase().trim();
        if (!finalCode) return;
        try {
            await setDoc(doc(db, "coupons", finalCode), {
                code: finalCode,
                discountType: type,
                discountValue: Number(value),
                expiryDate: expiry ? Timestamp.fromDate(new Date(expiry)) : null,
                usageLimit: Number(limit),
                timesUsed: 0,
                isActive: true,
            });
            setIsAdding(false);
            setCode("");
            setValue(10);
            setExpiry("");
        } catch (err) {
            console.error(err);
            alert("Failed to save coupon.");
        }
    };

    const handleToggleStatus = async (couponCode: string, currentStatus: boolean) => {
        try {
            await setDoc(doc(db, "coupons", couponCode), { isActive: !currentStatus }, { merge: true });
        } catch (err) {
            console.error(err);
            alert("Failed to toggle coupon status.");
        }
    };

    const handleDelete = async (couponCode: string) => {
        if (confirm(`Delete coupon "${couponCode}" permanently?`)) {
            try {
                await deleteDoc(doc(db, "coupons", couponCode));
            } catch (err) {
                console.error(err);
                alert("Failed to delete coupon.");
            }
        }
    };

    return (
        <div className="animate-fade-in">
            <AdminPageHeader
                title="Coupon Management"
                subtitle={`Create and manage discount promotions (${coupons.length} total coupons)`}
            >
                <button
                    type="button"
                    onClick={() => setIsAdding(!isAdding)}
                    className={`admin-btn ${isAdding ? "admin-btn-secondary" : "admin-btn-primary"}`}
                >
                    {isAdding ? "Cancel" : "+ Add Coupon"}
                </button>
            </AdminPageHeader>

            {error && (
                <div style={{ backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#ef4444", padding: "16px 20px", borderRadius: "16px", marginBottom: "24px", fontSize: "0.9rem", fontWeight: 500, border: "1px solid rgba(239, 68, 68, 0.2)" }}>
                    {error}
                </div>
            )}

            {/* Create Coupon Form */}
            {isAdding && (
                <form onSubmit={handleSave} className="admin-form-card" style={{ marginBottom: "28px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
                        <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
                            Create New Promotional Coupon
                        </h2>
                        <button
                            type="button"
                            onClick={() => setIsAdding(false)}
                            className="admin-btn admin-btn-secondary admin-btn-sm"
                        >
                            Cancel
                        </button>
                    </div>

                    <div className="admin-form-grid-3">
                        <div className="admin-form-group">
                            <label htmlFor="coupon-code">Coupon Code *</label>
                            <input
                                id="coupon-code"
                                type="text"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                required
                                className="admin-form-input"
                                style={{ textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}
                                placeholder="e.g. FESTIVE20"
                            />
                        </div>

                        <div className="admin-form-group">
                            <label htmlFor="coupon-type">Discount Type</label>
                            <select
                                id="coupon-type"
                                value={type}
                                onChange={(e) => setType(e.target.value as any)}
                                className="admin-form-select"
                            >
                                <option value="percentage">Percentage Off (%)</option>
                                <option value="flat">Flat Amount Off (₹)</option>
                            </select>
                        </div>

                        <div className="admin-form-group">
                            <label htmlFor="coupon-val">Discount Value *</label>
                            <input
                                id="coupon-val"
                                type="number"
                                inputMode="numeric"
                                min="1"
                                value={value}
                                onChange={(e) => setValue(Number(e.target.value))}
                                required
                                className="admin-form-input"
                            />
                        </div>
                    </div>

                    <div className="admin-form-grid-2">
                        <div className="admin-form-group">
                            <label htmlFor="coupon-expiry">Expiry Date (Optional)</label>
                            <input
                                id="coupon-expiry"
                                type="datetime-local"
                                value={expiry}
                                onChange={(e) => setExpiry(e.target.value)}
                                className="admin-form-input"
                            />
                        </div>

                        <div className="admin-form-group">
                            <label htmlFor="coupon-limit">Total Usage Limit *</label>
                            <input
                                id="coupon-limit"
                                type="number"
                                inputMode="numeric"
                                min="1"
                                value={limit}
                                onChange={(e) => setLimit(Number(e.target.value))}
                                required
                                className="admin-form-input"
                            />
                        </div>
                    </div>

                    {/* Desktop Form Actions */}
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
                        <button
                            type="button"
                            onClick={() => setIsAdding(false)}
                            className="admin-btn admin-btn-secondary"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="admin-btn admin-btn-primary"
                        >
                            Save Coupon
                        </button>
                    </div>

                    {/* Mobile Sticky Actions */}
                    <div className="admin-mobile-sticky-actions">
                        <button
                            type="button"
                            onClick={() => setIsAdding(false)}
                            className="admin-btn admin-btn-secondary"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="admin-btn admin-btn-primary"
                        >
                            Save Coupon
                        </button>
                    </div>
                </form>
            )}

            {/* Coupons Card Container */}
            <div className="admin-card">
                {/* Desktop View: Table (>= 768px) */}
                <div className="admin-table-container">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>Coupon Code</th>
                                <th>Discount Offer</th>
                                <th>Usage Capacity</th>
                                <th>Expires On</th>
                                <th>Active Status</th>
                                <th style={{ textAlign: "right" }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {coupons.length === 0 && (
                                <tr>
                                    <td colSpan={6} style={{ padding: "48px 20px", textAlign: "center", color: "var(--text-secondary)" }}>
                                        No coupons active. Click &quot;+ Add Coupon&quot; to create one!
                                    </td>
                                </tr>
                            )}
                            {coupons.map((coupon) => {
                                const usagePercent = Math.min(100, Math.round(((coupon.timesUsed || 0) / (coupon.usageLimit || 1)) * 100));
                                return (
                                    <tr key={coupon.code}>
                                        <td style={{ fontFamily: "monospace", fontWeight: 800, fontSize: "0.95rem", color: "var(--text-primary)" }}>
                                            {coupon.code}
                                        </td>
                                        <td style={{ fontWeight: 700, color: "var(--accent)" }}>
                                            {coupon.discountType === "percentage" ? `${coupon.discountValue}% OFF` : `₹${coupon.discountValue} OFF`}
                                        </td>
                                        <td>
                                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                                <div style={{ width: "90px", height: "8px", borderRadius: "999px", backgroundColor: "var(--border-color)", overflow: "hidden" }}>
                                                    <div style={{ width: `${usagePercent}%`, height: "100%", backgroundColor: "var(--accent)", borderRadius: "999px", transition: "width 0.3s ease" }} />
                                                </div>
                                                <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)", fontWeight: 600 }}>
                                                    {coupon.timesUsed || 0}/{coupon.usageLimit}
                                                </span>
                                            </div>
                                        </td>
                                        <td style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                                            {coupon.expiryDate ? (coupon.expiryDate.toDate ? coupon.expiryDate.toDate().toLocaleDateString("en-IN") : new Date(coupon.expiryDate).toLocaleDateString("en-IN")) : "No Expiry"}
                                        </td>
                                        <td>
                                            <button
                                                type="button"
                                                onClick={() => handleToggleStatus(coupon.code, coupon.isActive)}
                                                aria-label={`Toggle status for coupon ${coupon.code}`}
                                                style={{ cursor: "pointer" }}
                                            >
                                                <AdminBadge variant={coupon.isActive ? "visible" : "hidden"}>
                                                    {coupon.isActive ? "Active" : "Disabled"}
                                                </AdminBadge>
                                            </button>
                                        </td>
                                        <td style={{ textAlign: "right" }}>
                                            <button
                                                type="button"
                                                onClick={() => handleDelete(coupon.code)}
                                                className="admin-btn admin-btn-danger admin-btn-sm"
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Mobile View: Cards (< 768px) */}
                <div className="admin-mobile-cards-list">
                    {coupons.length === 0 && (
                        <div style={{ padding: "36px 16px", textAlign: "center", color: "var(--text-secondary)" }}>
                            No coupons active. Click &quot;+ Add Coupon&quot; to create one!
                        </div>
                    )}
                    {coupons.map((coupon) => {
                        const usagePercent = Math.min(100, Math.round(((coupon.timesUsed || 0) / (coupon.usageLimit || 1)) * 100));
                        return (
                            <div key={coupon.code} className="admin-mobile-item-card">
                                <div className="admin-mobile-card-top">
                                    <div>
                                        <span style={{ fontFamily: "monospace", fontSize: "1.1rem", fontWeight: 800, color: "var(--text-primary)" }}>
                                            {coupon.code}
                                        </span>
                                        <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "var(--accent)", marginTop: "2px" }}>
                                            {coupon.discountType === "percentage" ? `${coupon.discountValue}% OFF` : `₹${coupon.discountValue} FLAT OFF`}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleToggleStatus(coupon.code, coupon.isActive)}
                                        aria-label={`Toggle status for coupon ${coupon.code}`}
                                    >
                                        <AdminBadge variant={coupon.isActive ? "visible" : "hidden"}>
                                            {coupon.isActive ? "Active" : "Disabled"}
                                        </AdminBadge>
                                    </button>
                                </div>

                                {/* Usage Progress Bar */}
                                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                                        <span>Redemptions</span>
                                        <span>{coupon.timesUsed || 0} / {coupon.usageLimit} used ({usagePercent}%)</span>
                                    </div>
                                    <div style={{ width: "100%", height: "8px", borderRadius: "999px", backgroundColor: "var(--border-color)", overflow: "hidden" }}>
                                        <div style={{ width: `${usagePercent}%`, height: "100%", backgroundColor: "var(--accent)", borderRadius: "999px", transition: "width 0.3s ease" }} />
                                    </div>
                                </div>

                                <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                                    Expires: {coupon.expiryDate ? (coupon.expiryDate.toDate ? coupon.expiryDate.toDate().toLocaleString("en-IN") : new Date(coupon.expiryDate).toLocaleString("en-IN")) : "Never (Indefinite)"}
                                </div>

                                <div className="admin-mobile-card-actions">
                                    <button
                                        type="button"
                                        onClick={() => handleToggleStatus(coupon.code, coupon.isActive)}
                                        className="admin-btn admin-btn-secondary admin-btn-sm"
                                        style={{ flex: 1 }}
                                    >
                                        {coupon.isActive ? "Deactivate" : "Activate"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(coupon.code)}
                                        className="admin-btn admin-btn-danger admin-btn-sm"
                                        style={{ padding: "6px 14px" }}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
