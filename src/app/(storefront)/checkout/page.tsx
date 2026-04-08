"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import AuthModal from "@/components/storefront/AuthModal";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { doc, setDoc, updateDoc, increment } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { v4 as uuidv4 } from "uuid";

interface ShippingAddress {
    fullName: string;
    email: string;
    addressLine1: string;
    city: string;
    state: string;
    pincode: string;
    phone: string;
}

export default function CheckoutPage() {
    const { user } = useAuth();
    const { items, cartTotal, clearCart } = useCart();
    const router = useRouter();
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

    const [shipping, setShipping] = useState<ShippingAddress>({
        fullName: "",
        email: "",
        addressLine1: "",
        city: "",
        state: "",
        pincode: "",
        phone: "",
    });

    const [paymentMethod, setPaymentMethod] = useState<"RAZORPAY" | "COD">("RAZORPAY");
    const [coupon, setCoupon] = useState<{ code: string; type: string; value: number } | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.async = true;
        document.body.appendChild(script);

        if (typeof window !== "undefined") {
            const savedCoupon = sessionStorage.getItem("trendkartz_checkout_coupon");
            if (savedCoupon) {
                setCoupon(JSON.parse(savedCoupon));
            }
        }

        return () => {
            if (document.body.contains(script)) {
                document.body.removeChild(script);
            }
        };
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setShipping((prev) => ({ ...prev, [name]: value }));
    };

    const discountFromCoupon = coupon
        ? coupon.type === "percentage"
            ? (cartTotal * coupon.value) / 100
            : coupon.value
        : 0;

    const totalDiscount = discountFromCoupon;
    const finalTotal = Math.max(0, cartTotal - totalDiscount);

    const saveOrder = async (
        orderId: string,
        status: string,
        payStatus: string,
        rzpOrderId?: string
    ) => {
        const orderRef = doc(db, "orders", orderId);
        // Clean items to remove undefined values (Firestore rejects undefined)
        const cleanItems = JSON.parse(JSON.stringify(items));
        await setDoc(orderRef, {
            id: orderId,
            userId: user?.uid || null,
            items: cleanItems,
            subtotal: cartTotal,
            discount: totalDiscount,
            couponDiscount: discountFromCoupon,
            total: finalTotal,
            couponCode: coupon ? coupon.code : null,
            paymentMethod,
            paymentStatus: payStatus,
            orderStatus: status,
            razorpayOrderId: rzpOrderId || null,
            shippingAddress: shipping,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        if (coupon && payStatus !== "FAILED") {
            try {
                const couponRef = doc(db, "coupons", coupon.code.toUpperCase());
                await updateDoc(couponRef, { timesUsed: increment(1) });
            } catch (err) {
                console.error("Failed to increment coupon usage:", err);
            }
        }
    };

    const processPayment = async () => {
        if (!shipping.fullName || !shipping.email || !shipping.addressLine1 || !shipping.pincode || !shipping.phone) {
            alert("Please fill in all required shipping details including email.");
            return;
        }

        setIsProcessing(true);
        const orderId = uuidv4();

        if (paymentMethod === "COD") {
            try {
                await saveOrder(orderId, "Processing", "PENDING");
                clearCart();
                sessionStorage.removeItem("trendkartz_checkout_coupon");
                router.push("/orders");
            } catch (err) {
                console.error(err);
                alert("Failed to place order.");
                setIsProcessing(false);
            }
            return;
        }

        try {
            const res = await fetch("/api/razorpay/create-order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amount: finalTotal, receipt: orderId }),
            });
            const { id: rzpOrderId, amount, currency, error } = await res.json();
            if (error) throw new Error(error);

            const options = {
                key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                amount: amount.toString(),
                currency: currency,
                name: "TrendKartz",
                description: "Payment for your order",
                order_id: rzpOrderId,
                handler: async function (response: any) {
                    const verifyRes = await fetch("/api/razorpay/verify-payment", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                        }),
                    });
                    const verifyData = await verifyRes.json();

                    if (verifyData.success) {
                        await saveOrder(orderId, "Processing", "PAID", rzpOrderId);
                        clearCart();
                        sessionStorage.removeItem("trendkartz_checkout_coupon");
                        router.push("/orders");
                    } else {
                        alert("Payment verification failed. Please contact support.");
                        await saveOrder(orderId, "Payment_Failed", "FAILED", rzpOrderId);
                        setIsProcessing(false);
                    }
                },
                prefill: {
                    name: shipping.fullName,
                    email: shipping.email || (user?.email || ""),
                    contact: shipping.phone,
                },
                theme: { color: "#0f172a" },
            };

            const paymentObject = new (window as any).Razorpay(options);
            paymentObject.open();
            paymentObject.on('payment.failed', function (response: any) {
                alert("Payment failed: " + response.error.description);
                setIsProcessing(false);
            });
        } catch (err) {
            console.error(err);
            alert("Something went wrong with the payment gateway.");
            setIsProcessing(false);
        }
    };

    // Empty cart state
    if (items.length === 0 && !isProcessing) {
        return (
            <div className="co-empty">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
                <h2>Your cart is empty</h2>
                <p>Add some items to your cart before checking out.</p>
                <Link href="/products" className="co-empty-link">Continue Shopping</Link>
            </div>
        );
    }



    return (
        <div className="co-container">
            {/* Header */}
            <div className="co-header">
                <h1 className="co-title">Checkout</h1>
                <div className="co-steps">
                    <span className="co-step co-step-active">
                        <span className="co-step-num">1</span> Shipping
                    </span>
                    <span className="co-step-divider" />
                    <span className={`co-step ${paymentMethod ? 'co-step-active' : ''}`}>
                        <span className="co-step-num">2</span> Payment
                    </span>
                    <span className="co-step-divider" />
                    <span className="co-step">
                        <span className="co-step-num">3</span> Confirm
                    </span>
                </div>
            </div>

            <div className="co-layout">
                {/* Left: Form */}
                <div className="co-form-col">
                    {/* Shipping Section */}
                    <div className="co-section">
                        <div className="co-section-header">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                            <h2>Shipping Address</h2>
                        </div>
                        <div className="co-form-grid">
                            <div className="co-field co-field-full">
                                <label className="co-label">Full Name</label>
                                <input type="text" name="fullName" placeholder="Enter your full name" value={shipping.fullName} onChange={handleInputChange} className="co-input" required />
                            </div>
                            <div className="co-field co-field-full">
                                <label className="co-label">Phone Number</label>
                                <input type="text" name="phone" placeholder="10-digit mobile number" value={shipping.phone} onChange={handleInputChange} className="co-input" required />
                            </div>
                            <div className="co-field co-field-full">
                                <label className="co-label">Email Address</label>
                                <input type="email" name="email" placeholder="Updates will be sent here" value={shipping.email} onChange={handleInputChange} className="co-input" required />
                            </div>
                            <div className="co-field co-field-full">
                                <label className="co-label">Address</label>
                                <input type="text" name="addressLine1" placeholder="Flat, House no., Building, Street" value={shipping.addressLine1} onChange={handleInputChange} className="co-input" required />
                            </div>
                            <div className="co-field">
                                <label className="co-label">City</label>
                                <input type="text" name="city" placeholder="Your city" value={shipping.city} onChange={handleInputChange} className="co-input" required />
                            </div>
                            <div className="co-field">
                                <label className="co-label">State</label>
                                <input type="text" name="state" placeholder="Your state" value={shipping.state} onChange={handleInputChange} className="co-input" required />
                            </div>
                            <div className="co-field co-field-full">
                                <label className="co-label">PIN Code</label>
                                <input type="text" name="pincode" placeholder="6-digit PIN code" value={shipping.pincode} onChange={handleInputChange} className="co-input" required />
                            </div>
                        </div>
                    </div>

                    {/* Payment Section */}
                    <div className="co-section">
                        <div className="co-section-header">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>
                            <h2>Payment Method</h2>
                        </div>

                        <div className="co-payment-options">
                            <label className={`co-payment-card ${paymentMethod === "RAZORPAY" ? "co-payment-selected" : ""}`}>
                                <input type="radio" name="payment" value="RAZORPAY" checked={paymentMethod === "RAZORPAY"} onChange={() => setPaymentMethod("RAZORPAY")} className="co-radio" />
                                <div className="co-payment-info">
                                    <span className="co-payment-name">Pay Online</span>
                                    <span className="co-payment-desc">UPI, Credit Card, NetBanking</span>
                                </div>
                            </label>

                            <label className={`co-payment-card ${paymentMethod === "COD" ? "co-payment-selected" : ""}`}>
                                <input type="radio" name="payment" value="COD" checked={paymentMethod === "COD"} onChange={() => setPaymentMethod("COD")} className="co-radio" />
                                <div className="co-payment-info">
                                    <span className="co-payment-name">Cash on Delivery</span>
                                    <span className="co-payment-desc">Pay when your order arrives</span>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>

                {/* Right: Order Summary */}
                <div className="co-summary-col">
                    <div className="co-summary-card">
                        <h2 className="co-summary-title">Order Summary</h2>

                        <div className="co-items-list">
                            {items.map(item => (
                                <div key={item.id} className="co-item">
                                    {item.image && (
                                        <div className="co-item-img">
                                            <img src={item.image} alt={item.name} />
                                            <span className="co-item-qty">{item.quantity}</span>
                                        </div>
                                    )}
                                    <div className="co-item-details">
                                        <span className="co-item-name">{item.name}</span>
                                        {item.isCustomized && <span className="co-item-custom">Customized</span>}
                                    </div>
                                    <span className="co-item-price">₹{(item.price * item.quantity).toLocaleString("en-IN")}</span>
                                </div>
                            ))}
                        </div>

                        <div className="co-totals">
                            <div className="co-total-row">
                                <span>Subtotal</span>
                                <span>₹{cartTotal.toLocaleString("en-IN")}</span>
                            </div>

                            {coupon && (
                                <div className="co-total-row co-discount-row">
                                    <span>Coupon ({coupon.code})</span>
                                    <span>-₹{discountFromCoupon.toLocaleString("en-IN")}</span>
                                </div>
                            )}

                            <div className="co-total-row co-total-final">
                                <span>Total</span>
                                <span>₹{finalTotal.toLocaleString("en-IN")}</span>
                            </div>
                        </div>

                        <button
                            onClick={processPayment}
                            disabled={isProcessing}
                            className="co-pay-btn"
                        >
                            {isProcessing ? (
                                <>
                                    <span className="co-spinner" />
                                    Processing...
                                </>
                            ) : paymentMethod === "RAZORPAY" ? (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                                    Pay ₹{finalTotal.toLocaleString("en-IN")} Securely
                                </>
                            ) : (
                                <>Place Order &mdash; ₹{finalTotal.toLocaleString("en-IN")}</>
                            )}
                        </button>

                        <p className="co-secure-note">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                            Your payment information is encrypted and secure
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
