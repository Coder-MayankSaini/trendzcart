"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

interface Coupon {
    code: string;
    discountType: "percentage" | "flat";
    discountValue: number;
    expiryDate: any;
    usageLimit: number;
    timesUsed: number;
    isActive: boolean;
}

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: '12px',
    border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none',
};

const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '0.8rem', fontWeight: 600,
    color: 'var(--text-secondary)', marginBottom: '6px',
    textTransform: 'uppercase', letterSpacing: '0.04em',
};

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
                code: finalCode, discountType: type, discountValue: Number(value),
                expiryDate: expiry ? Timestamp.fromDate(new Date(expiry)) : null,
                usageLimit: Number(limit), timesUsed: 0, isActive: true,
            });
            setIsAdding(false); setCode(""); setValue(10); setExpiry("");
        } catch (err) { console.error(err); alert("Failed to save coupon."); }
    };

    const handleToggleStatus = async (couponCode: string, currentStatus: boolean) => {
        try { await setDoc(doc(db, "coupons", couponCode), { isActive: !currentStatus }, { merge: true }); }
        catch (err) { console.error(err); alert("Failed to toggle status."); }
    };

    const handleDelete = async (couponCode: string) => {
        if (confirm("Delete this coupon permanently?")) {
            try { await deleteDoc(doc(db, "coupons", couponCode)); }
            catch (err) { console.error(err); alert("Failed to delete coupon."); }
        }
    };

    return (
        <div className="animate-fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '16px' }}>
                <h1 style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Coupon Management</h1>
                <button onClick={() => setIsAdding(!isAdding)} style={{ padding: '12px 24px', borderRadius: '999px', backgroundColor: isAdding ? 'var(--bg-secondary)' : 'var(--text-primary)', color: isAdding ? 'var(--text-primary)' : 'var(--bg-primary)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: isAdding ? '1px solid var(--border-color)' : 'none', transition: 'all 0.2s ease' }}>
                    {isAdding ? "Cancel" : "+ Add Coupon"}
                </button>
            </div>

            {error && (
                <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '16px 20px', borderRadius: '12px', marginBottom: '24px', fontSize: '0.9rem', fontWeight: 500, border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                    {error}
                </div>
            )}

            {isAdding && (
                <form onSubmit={handleSave} style={{ backgroundColor: 'var(--bg-secondary)', padding: '32px', borderRadius: '24px', border: '1px solid var(--border-color)', marginBottom: '32px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', alignItems: 'end' }}>
                    <div>
                        <label style={labelStyle}>Coupon Code</label>
                        <input type="text" value={code} onChange={e => setCode(e.target.value)} required style={{ ...inputStyle, textTransform: 'uppercase' }} placeholder="e.g. SUMMER10" />
                    </div>
                    <div>
                        <label style={labelStyle}>Discount Type</label>
                        <select value={type} onChange={e => setType(e.target.value as any)} style={inputStyle}>
                            <option value="percentage">Percentage (%)</option>
                            <option value="flat">Flat Amount (₹)</option>
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Discount Value</label>
                        <input type="number" min="1" value={value} onChange={e => setValue(Number(e.target.value))} required style={inputStyle} />
                    </div>
                    <div>
                        <label style={labelStyle}>Expiry Date (Optional)</label>
                        <input type="datetime-local" value={expiry} onChange={e => setExpiry(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                        <label style={labelStyle}>Usage Limit</label>
                        <input type="number" min="1" value={limit} onChange={e => setLimit(Number(e.target.value))} required style={inputStyle} />
                    </div>
                    <div>
                        <button type="submit" style={{ width: '100%', padding: '12px 24px', borderRadius: '14px', backgroundColor: 'var(--accent)', color: 'white', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: 'none', fontSize: '0.9rem' }}>
                            Save Coupon
                        </button>
                    </div>
                </form>
            )}

            <div style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: '24px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            <tr>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Code</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Offer</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Usage</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Expiry</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>Status</th>
                                <th style={{ padding: '16px 24px', fontWeight: 600, borderBottom: '1px solid var(--border-color)', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody style={{ fontSize: '0.9rem' }}>
                            {coupons.length === 0 && !error && (
                                <tr>
                                    <td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>No coupons active. Create one to get started!</td>
                                </tr>
                            )}
                            {coupons.map(coupon => (
                                <tr key={coupon.code} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background-color 0.2s ease' }} onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-primary)'} onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                                    <td style={{ padding: '16px 24px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{coupon.code}</td>
                                    <td style={{ padding: '16px 24px', fontWeight: 600, color: '#16a34a' }}>
                                        {coupon.discountType === 'percentage' ? `${coupon.discountValue}% OFF` : `₹${coupon.discountValue} OFF`}
                                    </td>
                                    <td style={{ padding: '16px 24px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <div style={{ flex: 1, backgroundColor: 'var(--border-color)', height: '6px', borderRadius: '999px', overflow: 'hidden', width: '80px' }}>
                                                <div style={{ backgroundColor: 'var(--accent)', height: '100%', borderRadius: '999px', width: `${Math.min(100, (coupon.timesUsed / coupon.usageLimit) * 100)}%`, transition: 'width 0.3s ease' }}></div>
                                            </div>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{coupon.timesUsed}/{coupon.usageLimit}</span>
                                        </div>
                                    </td>
                                    <td style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                        {coupon.expiryDate ? coupon.expiryDate.toDate().toLocaleString() : 'Never'}
                                    </td>
                                    <td style={{ padding: '16px 24px' }}>
                                        <button
                                            onClick={() => handleToggleStatus(coupon.code, coupon.isActive)}
                                            style={{
                                                padding: '4px 14px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700,
                                                backgroundColor: coupon.isActive ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                                color: coupon.isActive ? '#16a34a' : '#ef4444',
                                                border: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s ease',
                                            }}
                                        >
                                            {coupon.isActive ? 'Active' : 'Disabled'}
                                        </button>
                                    </td>
                                    <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                                        <button onClick={() => handleDelete(coupon.code)} style={{ color: '#ef4444', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'opacity 0.2s ease' }}>
                                            Delete
                                        </button>
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
