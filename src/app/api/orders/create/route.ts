import { NextRequest, NextResponse } from "next/server";
import * as adminModule from "firebase-admin";
import { adminDb, adminAuth, adminStorage } from "@/lib/firebase/admin";

const admin = (adminModule as any).default || adminModule;
import {
    calculateOrderPricing,
    verifyRazorpaySignature,
} from "@/lib/orders/pricing";
import type { OrderItemInput } from "@/lib/orders/pricing";
import {
    generateGuestAccessToken,
    hashGuestAccessToken,
} from "@/lib/orders/orderAuth";
import {
    validateOrderCustomizations,
    extractStoragePath,
} from "@/lib/orders/customizationAuth";

interface CreateOrderBody {
    id?: string;
    userId: string | null;
    items: OrderItemInput[];
    subtotal?: number;
    discount?: number;
    couponDiscount?: number;
    total?: number;
    couponCode: string | null;
    paymentMethod: "RAZORPAY" | "COD";
    paymentStatus: string;
    orderStatus?: string;
    razorpayOrderId?: string | null;
    razorpayPaymentId?: string | null;
    razorpaySignature?: string | null;
    shippingAddress: {
        fullName: string;
        email: string;
        addressLine1: string;
        city: string;
        state: string;
        pincode: string;
        phone: string;
    };
}

const getServerEnv = (key: string): string | undefined => process.env[key];

export async function POST(req: NextRequest) {
    try {
        if (!adminDb) {
            return NextResponse.json({ error: "Order service is not configured" }, { status: 500 });
        }

        const body = (await req.json()) as CreateOrderBody;

        if (
            !Array.isArray(body?.items) ||
            body.items.length === 0 ||
            !body.shippingAddress?.fullName ||
            !body.shippingAddress?.email ||
            !body.shippingAddress?.phone ||
            !body.shippingAddress?.addressLine1 ||
            !body.shippingAddress?.pincode
        ) {
            return NextResponse.json({ error: "Invalid order payload or missing shipping details" }, { status: 400 });
        }

        // 1.5 Authenticate Caller and Validate Customization Attachments
        let verifiedCallerUid: string | null = null;
        const authHeader = req.headers.get("Authorization");
        if (authHeader && authHeader.startsWith("Bearer ") && adminAuth) {
            const token = authHeader.substring(7).trim();
            try {
                const decoded = await adminAuth.verifyIdToken(token);
                verifiedCallerUid = decoded.uid;
            } catch (authErr) {
                console.warn("[Orders Create] ID token verification skipped/failed:", (authErr as any)?.message);
            }
        }
        if (!verifiedCallerUid && body.userId) {
            verifiedCallerUid = body.userId;
        }

        const hasCustomizedPhotos = body.items.some(
            (item) => item.isCustomized && (item.customizationData?.storagePath || item.customizationData?.pictureUrl)
        );

        if (hasCustomizedPhotos) {
            const custCheck = await validateOrderCustomizations(body.items, verifiedCallerUid, {
                db: adminDb,
                storage: adminStorage,
                currentOrderId: body.id || null,
            });

            if (!custCheck.isValid) {
                return NextResponse.json({ error: custCheck.error }, { status: 400 });
            }
        }

        // 2. Determine and Verify Payment Status
        let paymentStatus: string;
        let orderStatus: string;

        if (body.paymentMethod === "COD") {
            paymentStatus = "PENDING";
            orderStatus = "Processing";
        } else if (body.paymentMethod === "RAZORPAY") {
            if (body.paymentStatus === "PAID") {
                const keySecret = getServerEnv("RAZORPAY_KEY_SECRET");
                if (!keySecret) {
                    return NextResponse.json(
                        { error: "Payment verification service is not configured" },
                        { status: 500 }
                    );
                }

                if (!body.razorpayOrderId || !body.razorpayPaymentId || !body.razorpaySignature) {
                    return NextResponse.json(
                        { error: "Missing Razorpay payment proof for PAID status" },
                        { status: 400 }
                    );
                }

                const isSignatureValid = verifyRazorpaySignature(
                    body.razorpayOrderId,
                    body.razorpayPaymentId,
                    body.razorpaySignature,
                    keySecret
                );

                if (!isSignatureValid) {
                    return NextResponse.json(
                        { error: "Invalid payment signature verification failed" },
                        { status: 400 }
                    );
                }

                paymentStatus = "PAID";
                orderStatus = "Processing";
            } else if (body.paymentStatus === "FAILED") {
                paymentStatus = "FAILED";
                orderStatus = "Payment_Failed";
            } else {
                paymentStatus = "PENDING";
                orderStatus = "Pending";
            }
        } else {
            return NextResponse.json({ error: "Unsupported payment method" }, { status: 400 });
        }

        // 3. Transactional Verification & Atomic Persistence
        // Uses Firestore runTransaction to guarantee serializability, prevent overselling
        // during concurrent checkout requests, and enforce coupon redemption limits.
        const transactionResult = await adminDb.runTransaction(async (transaction) => {
            // READ PHASE (All reads must precede writes in a Firestore transaction)
            const uniqueProductIds = Array.from(
                new Set(body.items.map((item) => item.productId || item.id).filter(Boolean))
            ) as string[];

            const productSnaps = await Promise.all(
                uniqueProductIds.map((id) => transaction.get(adminDb!.collection("products").doc(id)))
            );
            const productMap = new Map<string, adminModule.firestore.DocumentSnapshot>();
            uniqueProductIds.forEach((id, idx) => {
                productMap.set(id, productSnaps[idx]);
            });

            const normalizedCouponCode = body.couponCode?.trim().toUpperCase();
            let couponSnap: adminModule.firestore.DocumentSnapshot | null = null;
            if (normalizedCouponCode) {
                couponSnap = await transaction.get(adminDb!.collection("coupons").doc(normalizedCouponCode));
            }

            let requestedIdSnap: adminModule.firestore.DocumentSnapshot | null = null;
            if (body.id && body.id.trim().length > 0) {
                requestedIdSnap = await transaction.get(adminDb!.collection("orders").doc(body.id.trim()));
            }

            // VALIDATION & PRICING PHASE
            const pricing = await calculateOrderPricing(
                body.items,
                body.couponCode,
                async (productId: string) => {
                    const docSnap = productMap.get(productId);
                    if (!docSnap || !docSnap.exists) return null;
                    const data = docSnap.data();
                    return {
                        id: docSnap.id,
                        name: data?.name || "",
                        price: Number(data?.price),
                        inventory: typeof data?.inventory === "number" ? data.inventory : undefined,
                        isVisible: data?.isVisible,
                        images: data?.images,
                    };
                },
                async (code: string) => {
                    if (!couponSnap || !couponSnap.exists || couponSnap.id !== code) return null;
                    const data = couponSnap.data();
                    return {
                        code: couponSnap.id,
                        discountType: data?.discountType,
                        discountValue: Number(data?.discountValue),
                        expiryDate: data?.expiryDate,
                        usageLimit: data?.usageLimit,
                        timesUsed: data?.timesUsed,
                        isActive: data?.isActive,
                    };
                }
            );

            if (!pricing.isValid) {
                return {
                    status: 400,
                    error: `Validation failed: ${pricing.errors.join("; ")}`,
                };
            }

            if (typeof body.total === "number") {
                const difference = Math.abs(body.total - pricing.total);
                if (difference > 1) {
                    return {
                        status: 400,
                        error: `Order total mismatch. Calculated: ₹${pricing.total}, received: ₹${body.total}. Please refresh cart.`,
                    };
                }
            }

            // WRITE PHASE (All writes executed atomically upon transaction commit)
            let orderRef: adminModule.firestore.DocumentReference;
            if (requestedIdSnap && !requestedIdSnap.exists) {
                orderRef = requestedIdSnap.ref;
            } else {
                orderRef = adminDb!.collection("orders").doc();
            }

            const finalOrderId = orderRef.id;
            const now = new Date();
            const amountPaise = Math.round(pricing.total * 100);

            let guestAccessToken: string | null = null;
            let guestAccessTokenHash: string | null = null;
            if (!body.userId) {
                guestAccessToken = generateGuestAccessToken();
                guestAccessTokenHash = hashGuestAccessToken(guestAccessToken);
            }

            const customizationPaths = pricing.validatedItems
                .map((item) => item.customizationData?.storagePath || (item.customizationData?.pictureUrl ? extractStoragePath(item.customizationData.pictureUrl) : null))
                .filter(Boolean) as string[];

            transaction.set(orderRef, {
                id: finalOrderId,
                userId: body.userId || null,
                guestAccessTokenHash: guestAccessTokenHash || null,
                items: pricing.validatedItems,
                customizationPaths,
                subtotal: pricing.subtotal,
                discount: pricing.couponDiscount,
                couponDiscount: pricing.couponDiscount,
                total: pricing.total,
                amountPaise,
                currency: "INR",
                couponCode: pricing.appliedCouponCode,
                paymentMethod: body.paymentMethod,
                paymentStatus,
                orderStatus,
                razorpayOrderId: body.razorpayOrderId || null,
                razorpayPaymentId: body.razorpayPaymentId || null,
                shippingAddress: body.shippingAddress,
                inventoryReserved: true,
                inventoryFinalized: paymentStatus === "PAID" || body.paymentMethod === "COD",
                reservationReleased: false,
                createdAt: now,
                updatedAt: now,
            });

            // Write payment uniqueness record if PAID
            if (paymentStatus === "PAID" && body.razorpayPaymentId) {
                const paymentRecordRef = adminDb!.collection("paymentRecords").doc(body.razorpayPaymentId);
                transaction.set(paymentRecordRef, {
                    paymentId: body.razorpayPaymentId,
                    orderId: finalOrderId,
                    amountPaise,
                    currency: "INR",
                    status: "CAPTURED",
                    source: "API",
                    createdAt: now,
                });
            }

            // Decrement inventory safely within the transaction
            if (paymentStatus === "PAID" || (body.paymentMethod === "COD" && paymentStatus === "PENDING")) {
                const inventoryDecrements = new Map<string, number>();
                for (const item of pricing.validatedItems) {
                    inventoryDecrements.set(
                        item.productId,
                        (inventoryDecrements.get(item.productId) || 0) + item.quantity
                    );
                }
                for (const [productId, qty] of inventoryDecrements.entries()) {
                    const snap = productMap.get(productId);
                    const currentStock = snap?.data()?.inventory;
                    const productRef = adminDb!.collection("products").doc(productId);
                    if (typeof currentStock === "number") {
                        transaction.update(productRef, {
                            inventory: currentStock - qty,
                        });
                    } else {
                        transaction.update(productRef, {
                            inventory: admin.firestore.FieldValue.increment(-qty),
                        });
                    }
                }
            }

            // Increment coupon usage within the transaction
            if (pricing.appliedCouponCode && paymentStatus !== "FAILED" && couponSnap && couponSnap.exists) {
                const currentTimesUsed = Number(couponSnap.data()?.timesUsed) || 0;
                const couponRef = adminDb!.collection("coupons").doc(pricing.appliedCouponCode);
                transaction.set(
                    couponRef,
                    { timesUsed: currentTimesUsed + 1 },
                    { merge: true }
                );
            }

            return {
                status: 200,
                success: true,
                id: finalOrderId,
                total: pricing.total,
                paymentStatus,
                orderStatus,
                guestAccessToken,
            };
        });

        if (transactionResult.status !== 200) {
            return NextResponse.json({ error: transactionResult.error }, { status: transactionResult.status });
        }

        return NextResponse.json({
            success: true,
            id: transactionResult.id,
            total: transactionResult.total,
            paymentStatus: transactionResult.paymentStatus,
            orderStatus: transactionResult.orderStatus,
            guestAccessToken: transactionResult.guestAccessToken || null,
        });
    } catch (error) {
        console.error("Order creation failed", error);
        return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
    }
}
