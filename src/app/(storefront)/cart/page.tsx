"use client";

import { useState } from "react";
import { useCart } from "@/context/CartContext";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";

export default function CartPage() {
    const { items, removeFromCart, updateQuantity, cartTotal } = useCart();
    const { user } = useAuth();
    const router = useRouter();

    const [couponCode, setCouponCode] = useState("");
    const [isValidating, setIsValidating] = useState(false);
    const [couponError, setCouponError] = useState("");
    const [appliedCoupon, setAppliedCoupon] = useState<{
        code: string;
        type: "percentage" | "flat";
        value: number;
    } | null>(null);

    const handleApplyCoupon = async () => {
        if (!couponCode.trim()) return;
        setIsValidating(true);
        setCouponError("");

        try {
            const couponRef = doc(db, "coupons", couponCode.toUpperCase());
            const couponSnap = await getDoc(couponRef);

            if (!couponSnap.exists()) {
                setCouponError("Invalid coupon code.");
            } else {
                const data = couponSnap.data();
                if (!data.isActive) {
                    setCouponError("This coupon is temporarily inactive.");
                } else if (data.expiryDate && data.expiryDate.toDate() < new Date()) {
                    setCouponError("This coupon has expired.");
                } else if (data.timesUsed >= data.usageLimit) {
                    setCouponError("Coupon usage limit reached.");
                } else {
                    setAppliedCoupon({
                        code: data.code,
                        type: data.discountType,
                        value: data.discountValue,
                    });
                    setCouponError("");
                }
            }
        } catch (err) {
            console.error(err);
            setCouponError("Failed to apply coupon.");
        } finally {
            setIsValidating(false);
        }
    };

    const removeCoupon = () => {
        setAppliedCoupon(null);
        setCouponCode("");
    };

    const discountAmount = appliedCoupon
        ? (appliedCoupon.type === "percentage" ? (cartTotal * appliedCoupon.value) / 100 : appliedCoupon.value)
        : 0;

    const finalTotal = Math.max(0, cartTotal - discountAmount);

    const handleCheckout = () => {
        sessionStorage.setItem("trendkartz_checkout_coupon", JSON.stringify(appliedCoupon));
        router.push("/checkout");
    };

    if (items.length === 0) {
        return (
            <div className="empty-cart-container animate-fade-in" style={{
                minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 24px'
            }}>
                <div style={{ width: '80px', height: '80px', backgroundColor: 'var(--bg-secondary)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-color)', fontSize: '2rem' }}>🛒</div>
                <h2 style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '16px', letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>Your Cart is Empty</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.125rem', marginBottom: '32px', maxWidth: '400px' }}>Discover the perfect piece to elevate your wardrobe today.</p>
                <Link href="/products" className="hero-btn" style={{ textDecoration: 'none' }}>
                    Continue Shopping
                </Link>
            </div>
        );
    }

    return (
        <div className="cart-page-container animate-fade-in" style={{ maxWidth: '1280px', margin: '0 auto', padding: '60px 24px', minHeight: '80vh' }}>
            <div style={{ marginBottom: '40px' }}>
                <h1 style={{ fontSize: '3rem', fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--text-primary)', margin: 0 }}>Shopping Cart</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.125rem', marginTop: '8px' }}>Review your items before checkout.</p>
            </div>

            <div className="cart-layout" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '48px', alignItems: 'start' }}>
                {/* Cart Items List */}
                <div className="cart-items-section" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {items.map((item) => (
                        <div key={item.id} className="cart-item" style={{
                            display: 'flex', gap: '24px', padding: '24px',
                            backgroundColor: 'var(--bg-secondary)',
                            borderRadius: '24px',
                            border: '1px solid var(--border-color)',
                            boxShadow: 'var(--shadow-sm)',
                            transition: 'transform 0.2s ease, box-shadow 0.2s ease'
                        }}
                            onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
                            onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
                        >
                            <div className="item-image-wrapper" style={{ width: '140px', height: '180px', flexShrink: 0, borderRadius: '12px', overflow: 'hidden', backgroundColor: 'var(--bg-primary)' }}>
                                <img src={item.image} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>

                            <div className="item-details" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                    <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{item.name}</h3>
                                    <button
                                        onClick={() => removeFromCart(item.id)}
                                        style={{ color: '#ef4444', fontSize: '0.875rem', fontWeight: 600, transition: 'opacity 0.2s' }}
                                        onMouseOver={(e) => e.currentTarget.style.opacity = '0.7'}
                                        onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                                    >
                                        Remove
                                    </button>
                                </div>
                                <p style={{ color: 'var(--text-secondary)', fontSize: '1.125rem', fontWeight: 500, margin: '0 0 16px 0' }}>₹{Number(item.price).toLocaleString("en-IN")}</p>

                                {item.size && (
                                    <p style={{ margin: '0 0 8px 0', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Size: {item.size}</p>
                                )}

                                {item.customizationData && (
                                    <div style={{ backgroundColor: 'var(--bg-primary)', padding: '12px 16px', borderRadius: '8px', fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '16px', border: '1px solid var(--border-color)' }}>
                                        {item.customizationData.name && <p style={{ margin: '0 0 4px 0' }}><strong>Name:</strong> {item.customizationData.name}</p>}
                                        {item.customizationData.pictureUrl && (
                                            <p style={{ margin: 0 }}>
                                                <strong>Custom Image:</strong> <a href={item.customizationData.pictureUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>View Attachment</a>
                                            </p>
                                        )}
                                    </div>
                                )}

                                <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border-color)', borderRadius: '999px', overflow: 'hidden', backgroundColor: 'var(--bg-primary)' }}>
                                        <button
                                            style={{ padding: '8px 16px', fontWeight: 600, color: 'var(--text-primary)', transition: 'background-color 0.2s' }}
                                            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--border-color)'}
                                            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                        >-</button>
                                        <span style={{ padding: '8px 16px', fontWeight: 600, color: 'var(--text-primary)', borderLeft: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)' }}>{item.quantity}</span>
                                        <button
                                            style={{ padding: '8px 16px', fontWeight: 600, color: 'var(--text-primary)', transition: 'background-color 0.2s' }}
                                            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--border-color)'}
                                            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                        >+</button>
                                    </div>
                                    <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                        ₹{(item.price * item.quantity).toLocaleString("en-IN")}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Order Summary Sidebar */}
                <div className="cart-summary-section">
                    <div className="summary-card" style={{
                        backgroundColor: 'var(--glass-bg)',
                        backdropFilter: 'blur(16px)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: '24px',
                        padding: '32px',
                        position: 'sticky',
                        top: '120px',
                        boxShadow: 'var(--shadow-lg)'
                    }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '24px', color: 'var(--text-primary)' }}>Order Summary</h2>

                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '1.125rem' }}>
                            <span>Subtotal</span>
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>₹{cartTotal.toLocaleString("en-IN")}</span>
                        </div>

                        {/* Coupon Section */}
                        <div style={{ padding: '24px 0', borderTop: '1px dashed var(--border-color)', borderBottom: '1px dashed var(--border-color)', margin: '24px 0' }}>
                            <p style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Discount Code</p>

                            {!appliedCoupon ? (
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <input
                                        type="text"
                                        value={couponCode}
                                        onChange={(e) => setCouponCode(e.target.value)}
                                        placeholder="Enter code"
                                        style={{
                                            flex: 1,
                                            backgroundColor: 'var(--bg-primary)',
                                            border: '1px solid var(--border-color)',
                                            padding: '12px 16px',
                                            borderRadius: '12px',
                                            outline: 'none',
                                            color: 'var(--text-primary)',
                                            textTransform: 'uppercase',
                                            fontWeight: 500
                                        }}
                                        onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                                        onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                                    />
                                    <button
                                        onClick={handleApplyCoupon}
                                        disabled={isValidating || !couponCode.trim()}
                                        style={{
                                            backgroundColor: 'var(--text-primary)',
                                            color: 'var(--bg-primary)',
                                            padding: '0 24px',
                                            borderRadius: '12px',
                                            fontWeight: 600,
                                            opacity: isValidating || !couponCode.trim() ? 0.5 : 1,
                                            cursor: isValidating || !couponCode.trim() ? 'not-allowed' : 'pointer'
                                        }}
                                    >
                                        {isValidating ? "..." : "Apply"}
                                    </button>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(34, 197, 94, 0.1)', padding: '12px 16px', borderRadius: '12px', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
                                    <div>
                                        <span style={{ fontWeight: 700, color: '#16a34a' }}>{appliedCoupon.code}</span>
                                        <span style={{ fontSize: '0.75rem', color: '#15803d', marginLeft: '8px', fontWeight: 600, textTransform: 'uppercase' }}>Applied</span>
                                    </div>
                                    <button onClick={removeCoupon} style={{ color: '#ef4444', fontSize: '0.875rem', fontWeight: 600 }}>Remove</button>
                                </div>
                            )}
                            {couponError && <p style={{ color: '#ef4444', fontSize: '0.875rem', marginTop: '8px', fontWeight: 500 }}>{couponError}</p>}
                        </div>

                        {appliedCoupon && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', color: '#16a34a', fontSize: '1.125rem', fontWeight: 600 }}>
                                <span>Discount ({appliedCoupon.code})</span>
                                <span>- ₹{discountAmount.toLocaleString("en-IN")}</span>
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px', paddingTop: '24px', borderTop: '2px solid var(--border-color)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                            <span>Total</span>
                            <span>₹{finalTotal.toLocaleString("en-IN")}</span>
                        </div>

                        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '16px', marginBottom: '32px', textAlign: 'center' }}>Tax included. Shipping calculated at checkout.</p>

                        <button
                            onClick={handleCheckout}
                            className="hero-btn"
                            style={{ width: '100%', justifyContent: 'center' }}
                        >
                            Proceed to Checkout
                        </button>
                    </div>
                </div>
            </div>

            <style jsx>{`
                @media (min-width: 1024px) {
                    .cart-layout {
                        grid-template-columns: 2fr 1fr !important;
                    }
                }
            `}</style>
        </div>
    );
}
