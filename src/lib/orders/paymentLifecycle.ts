import crypto from "crypto";
import * as adminModule from "firebase-admin";
import { calculateOrderPricing } from "./pricing";
import type { OrderItemInput } from "./pricing";
import { calculateVariantStockBreakdown } from "../products/variants";
import {
    generateGuestAccessToken,
    hashGuestAccessToken,
    verifyGuestAccessToken,
} from "./orderAuth";
import { extractStoragePath } from "./customizationAuth";

const admin = (adminModule as any).default || adminModule;

export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED";
export type OrderStatus =
    | "Pending"
    | "Processing"
    | "Payment_Failed"
    | "Cancelled"
    | "Expired"
    | "Pending_Reconciliation"
    | "Completed";

export interface ShippingAddress {
    fullName: string;
    email: string;
    addressLine1: string;
    city: string;
    state: string;
    pincode: string;
    phone: string;
}

/**
 * Validates allowed state transitions for the payment lifecycle.
 */
export function canTransitionPaymentStatus(current: PaymentStatus, next: PaymentStatus): boolean {
    if (current === next) return true;

    switch (current) {
        case "PENDING":
            return ["PAID", "FAILED", "EXPIRED", "CANCELLED"].includes(next);
        case "FAILED":
            // A failed attempt can transition to PAID if late capture or retry succeeds
            return ["PAID", "EXPIRED", "CANCELLED"].includes(next);
        case "EXPIRED":
            // Late payment captured after expiration requires explicit reconciliation check
            return next === "PAID";
        case "PAID":
            // Invariant: Once an order is PAID, it can never transition to unpaid/failed
            return false;
        case "CANCELLED":
            return false;
        default:
            return false;
    }
}

/**
 * Cryptographically verifies Razorpay Webhook signature using HMAC-SHA256
 * over the exact raw request body. Uses timingSafeEqual with buffer length validation.
 */
export function verifyRazorpayWebhookSignature(
    rawBody: string,
    signature: string | null | undefined,
    webhookSecret: string | null | undefined
): boolean {
    if (!rawBody || !signature || !webhookSecret) {
        return false;
    }

    try {
        const expected = crypto
            .createHmac("sha256", webhookSecret)
            .update(rawBody)
            .digest("hex");

        const expectedBuf = Buffer.from(expected, "utf8");
        const signatureBuf = Buffer.from(signature, "utf8");

        if (expectedBuf.length !== signatureBuf.length) {
            return false;
        }

        return crypto.timingSafeEqual(expectedBuf, signatureBuf);
    } catch {
        return false;
    }
}

export interface CreatePendingPrepaidOrderParams {
    items: OrderItemInput[];
    shippingAddress: ShippingAddress;
    couponCode?: string | null;
    userId?: string | null;
    guestAccessToken?: string | null;
    idempotencyKey?: string | null;
    currency?: string;
    receipt?: string;
    allowTestFixtures?: boolean;
}

export interface PendingOrderResult {
    success: boolean;
    orderId: string;
    total: number;
    amountPaise: number;
    currency: string;
    guestAccessToken?: string | null;
    reused?: boolean;
    error?: string;
    status: number;
}

/**
 * Creates a durable internal pending order in Firestore with transactional
 * inventory and coupon reservation before initiating Razorpay checkout.
 */
export async function createPendingPrepaidOrder(
    db: adminModule.firestore.Firestore,
    params: CreatePendingPrepaidOrderParams
): Promise<PendingOrderResult> {
    const { items, shippingAddress, couponCode, userId, idempotencyKey, currency = "INR", receipt } = params;

    // 1. Idempotency Check: Look for existing pending order with the same key
    if (idempotencyKey && idempotencyKey.trim().length > 0) {
        const existingSnap = await db
            .collection("orders")
            .where("idempotencyKey", "==", idempotencyKey.trim())
            .limit(1)
            .get();

        if (!existingSnap.empty) {
            const doc = existingSnap.docs[0];
            const data = doc.data();
            const expiresAt = data.reservationExpiresAt?.toDate
                ? data.reservationExpiresAt.toDate()
                : new Date(data.reservationExpiresAt || 0);

            // If still pending and unexpired, reuse this order safely
            if (data.paymentStatus === "PENDING" && expiresAt.getTime() > Date.now()) {
                // Security check for guest token continuity on retry:
                // Only return guestAccessToken if caller proves continuity with the matching token
                let returnedGuestToken: string | null = null;
                if (!data.userId && params.guestAccessToken && data.guestAccessTokenHash) {
                    if (verifyGuestAccessToken(params.guestAccessToken, data.guestAccessTokenHash)) {
                        returnedGuestToken = params.guestAccessToken;
                    }
                }

                return {
                    status: 200,
                    success: true,
                    orderId: doc.id,
                    total: Number(data.total),
                    amountPaise: Number(data.amountPaise),
                    currency: data.currency || "INR",
                    guestAccessToken: returnedGuestToken,
                    reused: true,
                };
            }
        }
    }

    // 2. Transactional Pricing & Stock Reservation
    const result = await db.runTransaction(async (transaction) => {
        const uniqueProductIds = Array.from(
            new Set(items.map((item) => item.productId || item.id).filter(Boolean))
        ) as string[];

        const productSnaps = await Promise.all(
            uniqueProductIds.map((id) => transaction.get(db.collection("products").doc(id)))
        );
        const productMap = new Map<string, adminModule.firestore.DocumentSnapshot>();
        uniqueProductIds.forEach((id, idx) => {
            productMap.set(id, productSnaps[idx]);
        });

        const normalizedCouponCode = couponCode?.trim().toUpperCase();
        let couponSnap: adminModule.firestore.DocumentSnapshot | null = null;
        if (normalizedCouponCode) {
            couponSnap = await transaction.get(db.collection("coupons").doc(normalizedCouponCode));
        }

        // Authoritative Pricing
        const pricing = await calculateOrderPricing(
            items,
            couponCode,
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
                        category: data?.category,
                        isTestFixture: data?.isTestFixture,
                        purchasable: data?.purchasable,
                        isArchived: data?.isArchived,
                        hasVariants: data?.hasVariants,
                        sizeMode: data?.sizeMode,
                        sizesList: data?.sizesList,
                        colors: data?.colors,
                        variants: data?.variants,
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
                    isTestFixture: data?.isTestFixture,
                };
            },
            new Date(),
            { allowTestFixtures: Boolean(params.allowTestFixtures) }
        );

        if (!pricing.isValid) {
            return {
                status: 400,
                success: false,
                error: `Validation failed: ${pricing.errors.join("; ")}`,
            };
        }

        if (pricing.total <= 0) {
            return {
                status: 400,
                success: false,
                error: "Order total must be greater than zero for prepaid payment",
            };
        }

        // Generate or resolve document reference
        let orderRef: adminModule.firestore.DocumentReference;
        if (receipt && receipt.trim().length > 0) {
            const checkDoc = await transaction.get(db.collection("orders").doc(receipt.trim()));
            if (!checkDoc.exists) {
                orderRef = db.collection("orders").doc(receipt.trim());
            } else {
                const existingData = checkDoc.data();
                const expiresAt = existingData?.reservationExpiresAt?.toDate
                    ? existingData.reservationExpiresAt.toDate()
                    : new Date(existingData?.reservationExpiresAt || 0);

                if (existingData?.paymentStatus === "PENDING" && expiresAt.getTime() > Date.now()) {
                    // Safe transactional reuse of unexpired pending order matching receipt
                    let returnedGuestToken: string | null = null;
                    if (!existingData.userId && params.guestAccessToken && existingData.guestAccessTokenHash) {
                        if (verifyGuestAccessToken(params.guestAccessToken, existingData.guestAccessTokenHash)) {
                            returnedGuestToken = params.guestAccessToken;
                        }
                    }

                    return {
                        status: 200,
                        success: true,
                        orderId: checkDoc.id,
                        total: Number(existingData.total),
                        amountPaise: Number(existingData.amountPaise),
                        currency: existingData.currency || "INR",
                        guestAccessToken: returnedGuestToken,
                        reused: true,
                    };
                }
                orderRef = db.collection("orders").doc();
            }
        } else {
            orderRef = db.collection("orders").doc();
        }

        const finalOrderId = orderRef.id;
        const now = new Date();
        const reservationExpiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 minute reservation window
        const amountPaise = Math.round(pricing.total * 100);

        // Reserve inventory in database
        const uniqueProductIdsInOrder = Array.from(new Set(pricing.validatedItems.map((item) => item.productId)));
        for (const productId of uniqueProductIdsInOrder) {
            const snap = productMap.get(productId);
            const prodData = snap?.data();
            const productRef = db.collection("products").doc(productId);

            if (prodData?.hasVariants === true && Array.isArray(prodData?.variants) && prodData.variants.length > 0) {
                const variantDecrements = new Map<string, number>();
                for (const item of pricing.validatedItems) {
                    if (item.productId === productId && item.variantId) {
                        variantDecrements.set(
                            item.variantId,
                            (variantDecrements.get(item.variantId) || 0) + item.quantity
                        );
                    }
                }

                // MANDATORY TRANSACTION STOCK CHECK (Prevent Overselling & Silent Clamping)
                for (const [vId, decQty] of variantDecrements.entries()) {
                    const v = prodData.variants.find((variant: any) => variant.id === vId);
                    if (!v) {
                        return {
                            status: 400,
                            success: false,
                            error: `Variant '${vId}' not found on product '${prodData.name || productId}'.`,
                        };
                    }
                    const currentVariantStock = Number(v.inventory) || 0;
                    if (currentVariantStock < decQty) {
                        return {
                            status: 400,
                            success: false,
                            error: `Insufficient stock for variant '${vId}' on '${prodData.name || productId}'. Available: ${currentVariantStock}, requested: ${decQty}.`,
                        };
                    }
                }

                const updatedVariants = prodData.variants.map((v: any) => {
                    const dec = variantDecrements.get(v.id) || 0;
                    if (dec > 0) {
                        const currentStock = Number(v.inventory) || 0;
                        const newStock = currentStock - dec;
                        if (newStock < 0) {
                            throw new Error(`Inventory underflow prevented: variant ${v.id} stock cannot drop below zero.`);
                        }
                        return { ...v, inventory: newStock };
                    }
                    return v;
                });

                const breakdown = calculateVariantStockBreakdown(updatedVariants);

                transaction.update(productRef, {
                    variants: updatedVariants,
                    inventory: breakdown.sellableStock,
                    totalPhysicalInventory: breakdown.totalPhysicalStock,
                });
            } else {
                const totalQty = pricing.validatedItems
                    .filter((item) => item.productId === productId)
                    .reduce((sum, item) => sum + item.quantity, 0);

                const currentStock = prodData?.inventory;
                if (typeof currentStock === "number") {
                    if (currentStock < totalQty) {
                        return {
                            status: 400,
                            success: false,
                            error: `Insufficient stock for '${prodData?.name || productId}'. Available: ${currentStock}, requested: ${totalQty}.`,
                        };
                    }
                    const newStock = currentStock - totalQty;
                    if (newStock < 0) {
                        throw new Error(`Inventory underflow prevented: product ${productId} stock cannot drop below zero.`);
                    }
                    transaction.update(productRef, {
                        inventory: newStock,
                    });
                } else {
                    transaction.update(productRef, {
                        inventory: admin.firestore.FieldValue.increment(-totalQty),
                    });
                }
            }
        }

        // Reserve coupon usage if applicable
        if (pricing.appliedCouponCode && couponSnap && couponSnap.exists) {
            const currentTimesUsed = Number(couponSnap.data()?.timesUsed) || 0;
            const couponRef = db.collection("coupons").doc(pricing.appliedCouponCode);
            transaction.set(
                couponRef,
                { timesUsed: currentTimesUsed + 1 },
                { merge: true }
            );
        }

        // Generate secure guest access token if this is a guest checkout
        let guestAccessToken: string | null = null;
        let guestAccessTokenHash: string | null = null;
        if (!userId) {
            guestAccessToken = params.guestAccessToken || generateGuestAccessToken();
            guestAccessTokenHash = hashGuestAccessToken(guestAccessToken);
        }

        const customizationPaths = pricing.validatedItems
            .map((item) => item.customizationData?.storagePath || (item.customizationData?.pictureUrl ? extractStoragePath(item.customizationData.pictureUrl) : null))
            .filter(Boolean) as string[];

        // Persist pending order with financial snapshot & reservation metadata
        transaction.set(orderRef, {
            id: finalOrderId,
            userId: userId || null,
            guestAccessTokenHash: guestAccessTokenHash || null,
            items: pricing.validatedItems,
            customizationPaths,
            subtotal: pricing.subtotal,
            discount: pricing.couponDiscount,
            couponDiscount: pricing.couponDiscount,
            total: pricing.total,
            amountPaise,
            currency,
            couponCode: pricing.appliedCouponCode,
            paymentMethod: "RAZORPAY",
            paymentStatus: "PENDING",
            gatewayState: "NOT_STARTED",
            gatewayAttempts: 0,
            orderStatus: "Pending",
            shippingAddress,
            inventoryReserved: true,
            inventoryFinalized: false,
            reservationReleased: false,
            reservationExpiresAt,
            paymentAttempts: [],
            idempotencyKey: idempotencyKey || null,
            createdAt: now,
            updatedAt: now,
        });

        return {
            status: 200,
            success: true,
            orderId: finalOrderId,
            total: pricing.total,
            amountPaise,
            currency,
            guestAccessToken,
        };
    });

    return result as PendingOrderResult;
}

export interface FinalizePaymentOptions {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    amountPaise: number;
    currency: string;
    internalOrderId?: string;
    source: "WEBHOOK" | "BROWSER_CALLBACK" | "API" | "RECONCILIATION_WORKER";
    eventId?: string;
}

export interface FinalizePaymentResult {
    status: number;
    success: boolean;
    orderId?: string;
    paymentStatus?: string;
    orderStatus?: string;
    duplicate?: boolean;
    reconciliationRequired?: boolean;
    error?: string;
    message?: string;
}

/**
 * Idempotently finalizes order payment across Webhooks, Browser Callbacks, and API calls.
 * Enforces Level 1 (Event Deduplication) and Level 2 (Payment ID Uniqueness & State Machine Invariants).
 */
export async function finalizeOrderPayment(
    db: adminModule.firestore.Firestore,
    options: FinalizePaymentOptions
): Promise<FinalizePaymentResult> {
    const { razorpayOrderId, razorpayPaymentId, amountPaise, currency, source, eventId } = options;

    // 1. Locate the internal order
    let resolvedOrderId = options.internalOrderId;

    if (!resolvedOrderId) {
        let querySnap = await db
            .collection("orders")
            .where("razorpayOrderId", "==", razorpayOrderId)
            .limit(1)
            .get();

        // If not found by razorpayOrderId, check if order has an unassociatedGatewayOrderId
        // recorded during a transient Firestore write failure
        if (querySnap.empty) {
            querySnap = await db
                .collection("orders")
                .where("unassociatedGatewayOrderId", "==", razorpayOrderId)
                .limit(1)
                .get();
        }

        if (querySnap.empty) {
            // Record unmatched payment safely for admin reconciliation
            await db.collection("unmatchedPayments").doc(razorpayPaymentId).set({
                razorpayPaymentId,
                razorpayOrderId,
                amountPaise,
                currency,
                eventId: eventId || null,
                receivedAt: new Date(),
                reason: "INTERNAL_ORDER_NOT_FOUND",
            });

            return {
                status: 404,
                success: false,
                error: `No internal order found matching Razorpay Order ID: ${razorpayOrderId}`,
            };
        }
        resolvedOrderId = querySnap.docs[0].id;
    }

    const orderRef = db.collection("orders").doc(resolvedOrderId);
    const paymentRecordRef = db.collection("paymentRecords").doc(razorpayPaymentId);
    const eventRef = eventId ? db.collection("paymentWebhookEvents").doc(eventId) : null;

    // 2. Transactional Finalization with Uniqueness Guarantees
    const finalizationResult = await db.runTransaction(async (transaction) => {
        // Read Phase
        let eventSnap: adminModule.firestore.DocumentSnapshot | null = null;
        if (eventRef) {
            eventSnap = await transaction.get(eventRef);
        }

        const paymentRecordSnap = await transaction.get(paymentRecordRef);
        const orderSnap = await transaction.get(orderRef);

        // Level 1: Event-level deduplication
        if (eventSnap && eventSnap.exists && eventSnap.data()?.status === "PROCESSED") {
            return {
                status: 200,
                success: true,
                orderId: resolvedOrderId,
                duplicate: true,
                message: "Event already processed",
            };
        }

        // Level 2: Payment ID uniqueness constraint
        if (paymentRecordSnap.exists) {
            const existingRecord = paymentRecordSnap.data();
            if (existingRecord?.orderId !== resolvedOrderId) {
                return {
                    status: 400,
                    success: false,
                    error: `Payment ID ${razorpayPaymentId} is already associated with different order ${existingRecord?.orderId}`,
                };
            }
            // Same order, same payment ID -> Already successfully finalized
            if (eventRef) {
                transaction.set(eventRef, {
                    eventId,
                    eventType: "payment.captured",
                    razorpayOrderId,
                    razorpayPaymentId,
                    status: "PROCESSED",
                    receivedAt: new Date(),
                    processedAt: new Date(),
                });
            }
            return {
                status: 200,
                success: true,
                orderId: resolvedOrderId,
                duplicate: true,
                message: "Payment already finalized for this order",
            };
        }

        if (!orderSnap.exists) {
            return {
                status: 404,
                success: false,
                error: `Order ${resolvedOrderId} not found`,
            };
        }

        const orderData = orderSnap.data();

        // Gateway association check
        if (orderData?.razorpayOrderId && orderData.razorpayOrderId !== razorpayOrderId) {
            return {
                status: 400,
                success: false,
                error: `Razorpay Order ID mismatch. Expected: ${orderData.razorpayOrderId}, received: ${razorpayOrderId}`,
            };
        }

        // Currency verification
        const expectedCurrency = orderData?.currency || "INR";
        if (currency && currency.toUpperCase() !== expectedCurrency.toUpperCase()) {
            transaction.update(orderRef, {
                reconciliationRequired: true,
                reconciliationReason: `Currency mismatch: expected ${expectedCurrency}, received ${currency}`,
                reconciliationPaymentId: razorpayPaymentId,
                updatedAt: new Date(),
            });
            return {
                status: 400,
                success: false,
                error: `Payment currency mismatch. Expected ${expectedCurrency}, received ${currency}`,
            };
        }

        // Authoritative Amount verification
        const expectedPaise =
            typeof orderData?.amountPaise === "number"
                ? orderData.amountPaise
                : Math.round(Number(orderData?.total) * 100);

        if (amountPaise !== expectedPaise) {
            transaction.update(orderRef, {
                reconciliationRequired: true,
                reconciliationReason: `Amount mismatch: expected ${expectedPaise} paise, received ${amountPaise} paise`,
                reconciliationPaymentId: razorpayPaymentId,
                updatedAt: new Date(),
            });
            return {
                status: 400,
                success: false,
                error: `Payment amount mismatch: expected ${expectedPaise} paise, received ${amountPaise} paise`,
            };
        }

        // If order is already PAID
        if (orderData?.paymentStatus === "PAID") {
            transaction.set(paymentRecordRef, {
                paymentId: razorpayPaymentId,
                orderId: resolvedOrderId,
                amountPaise,
                currency,
                status: "CAPTURED",
                source,
                createdAt: new Date(),
            });
            if (eventRef) {
                transaction.set(eventRef, {
                    eventId,
                    eventType: "payment.captured",
                    razorpayOrderId,
                    razorpayPaymentId,
                    status: "PROCESSED",
                    receivedAt: new Date(),
                    processedAt: new Date(),
                });
            }
            return {
                status: 200,
                success: true,
                orderId: resolvedOrderId,
                paymentStatus: "PAID",
                duplicate: true,
                message: "Order was already marked PAID",
            };
        }

        // Late Payment Recovery (After Reservation Expiration)
        if (orderData?.reservationReleased === true || orderData?.paymentStatus === "EXPIRED") {
            let stockAvailable = true;
            const items = orderData.items || [];
            const uniqueProductIdsForRecovery = Array.from(
                new Set(items.map((i: any) => i.productId).filter(Boolean))
            ) as string[];

            const productDocsMap = new Map<string, adminModule.firestore.DocumentSnapshot>();
            for (const pid of uniqueProductIdsForRecovery) {
                const pSnap = await transaction.get(db.collection("products").doc(pid));
                productDocsMap.set(pid, pSnap);
            }

            const productUpdates = new Map<string, any>();

            for (const pid of uniqueProductIdsForRecovery) {
                const pSnap = productDocsMap.get(pid);
                const prodData = pSnap?.data();
                const productItems = items.filter((i: any) => i.productId === pid);

                if (prodData?.hasVariants === true && Array.isArray(prodData?.variants)) {
                    const variantDemands = new Map<string, number>();
                    for (const item of productItems) {
                        if (item.variantId) {
                            variantDemands.set(
                                item.variantId,
                                (variantDemands.get(item.variantId) || 0) + item.quantity
                            );
                        }
                    }

                    for (const [vId, reqQty] of variantDemands.entries()) {
                        const variant = prodData.variants.find((v: any) => v.id === vId);
                        if (!variant || (typeof variant.inventory === "number" && variant.inventory < reqQty)) {
                            stockAvailable = false;
                            break;
                        }
                    }

                    if (!stockAvailable) break;

                    const updatedVariants = prodData.variants.map((v: any) => {
                        const dec = variantDemands.get(v.id) || 0;
                        if (dec > 0) {
                            const currentStock = Number(v.inventory) || 0;
                            const newStock = currentStock - dec;
                            if (newStock < 0) {
                                throw new Error(`Inventory underflow prevented: variant ${v.id} stock cannot drop below zero.`);
                            }
                            return { ...v, inventory: newStock };
                        }
                        return v;
                    });
                    const breakdown = calculateVariantStockBreakdown(updatedVariants);
                    productUpdates.set(pid, {
                        variants: updatedVariants,
                        inventory: breakdown.sellableStock,
                        totalPhysicalInventory: breakdown.totalPhysicalStock,
                    });
                } else {
                    const totalProductQty = productItems.reduce((s: number, i: any) => s + i.quantity, 0);
                    const currentInv = prodData?.inventory;
                    if (typeof currentInv === "number") {
                        if (currentInv < totalProductQty) {
                            stockAvailable = false;
                            break;
                        }
                        productUpdates.set(pid, { inventory: currentInv - totalProductQty });
                    }
                }
            }

            if (!stockAvailable) {
                // Prevent negative inventory / overselling! Retain payment and flag for reconciliation
                transaction.set(paymentRecordRef, {
                    paymentId: razorpayPaymentId,
                    orderId: resolvedOrderId,
                    amountPaise,
                    currency,
                    status: "REQUIRES_RECONCILIATION",
                    reason: "INSUFFICIENT_STOCK_AFTER_EXPIRATION",
                    createdAt: new Date(),
                });

                transaction.update(orderRef, {
                    paymentStatus: "PAID",
                    orderStatus: "Pending_Reconciliation",
                    reconciliationRequired: true,
                    reconciliationReason: "INSUFFICIENT_STOCK_AFTER_EXPIRATION",
                    razorpayPaymentId,
                    paidAt: new Date(),
                    updatedAt: new Date(),
                });

                if (eventRef) {
                    transaction.set(eventRef, {
                        eventId,
                        eventType: "payment.captured",
                        razorpayOrderId,
                        razorpayPaymentId,
                        status: "PROCESSED",
                        receivedAt: new Date(),
                        processedAt: new Date(),
                    });
                }

                return {
                    status: 200,
                    success: true,
                    orderId: resolvedOrderId,
                    paymentStatus: "PAID",
                    orderStatus: "Pending_Reconciliation",
                    reconciliationRequired: true,
                    message: "Payment captured after reservation expired with insufficient stock. Flagged for manual review.",
                };
            } else {
                // Stock is available: re-decrement and commit
                for (const [pId, updates] of productUpdates.entries()) {
                    transaction.update(db.collection("products").doc(pId), updates);
                }
                transaction.update(orderRef, {
                    inventoryReserved: true,
                    reservationReleased: false,
                    latePaymentRecovered: true,
                });
            }
        }

        // Write Phase: Record payment and mark order PAID
        transaction.set(paymentRecordRef, {
            paymentId: razorpayPaymentId,
            orderId: resolvedOrderId,
            amountPaise,
            currency,
            status: "CAPTURED",
            source,
            createdAt: new Date(),
        });

        transaction.update(orderRef, {
            paymentStatus: "PAID",
            orderStatus: "Processing",
            razorpayPaymentId,
            razorpayOrderId,
            gatewayState: "READY_FOR_PAYMENT",
            unassociatedGatewayOrderId: admin.firestore.FieldValue.delete(),
            reconciliationRequired: false,
            paidAt: new Date(),
            inventoryFinalized: true,
            updatedAt: new Date(),
        });

        if (eventRef) {
            transaction.set(eventRef, {
                eventId,
                eventType: "payment.captured",
                razorpayOrderId,
                razorpayPaymentId,
                status: "PROCESSED",
                receivedAt: new Date(),
                processedAt: new Date(),
            });
        }

        return {
            status: 200,
            success: true,
            orderId: resolvedOrderId,
            paymentStatus: "PAID",
            orderStatus: "Processing",
        };
    });

    return finalizationResult;
}

/**
 * Records a failed payment attempt without regressing an already confirmed PAID order.
 */
export async function recordPaymentFailure(
    db: adminModule.firestore.Firestore,
    razorpayOrderId: string,
    razorpayPaymentId?: string | null,
    reason?: string,
    eventId?: string
): Promise<{ status: number; success: boolean; ignored?: boolean; error?: string }> {
    const querySnap = await db
        .collection("orders")
        .where("razorpayOrderId", "==", razorpayOrderId)
        .limit(1)
        .get();

    if (querySnap.empty) {
        return { status: 404, success: false, error: "Order not found" };
    }

    const orderRef = querySnap.docs[0].ref;
    const eventRef = eventId ? db.collection("paymentWebhookEvents").doc(eventId) : null;

    return await db.runTransaction(async (transaction) => {
        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap.exists) {
            return { status: 404, success: false, error: "Order not found" };
        }

        const data = orderSnap.data();

        // Invariant: Once an order is PAID, a failure event cannot overwrite it
        if (data?.paymentStatus === "PAID") {
            if (eventRef) {
                transaction.set(eventRef, {
                    eventId,
                    eventType: "payment.failed",
                    razorpayOrderId,
                    razorpayPaymentId: razorpayPaymentId || null,
                    status: "PROCESSED",
                    receivedAt: new Date(),
                    processedAt: new Date(),
                });
            }
            return {
                status: 200,
                success: true,
                ignored: true,
            };
        }

        const existingAttempts = Array.isArray(data?.paymentAttempts) ? data.paymentAttempts : [];
        const updatedAttempts = [
            ...existingAttempts,
            {
                razorpayPaymentId: razorpayPaymentId || null,
                failedAt: new Date(),
                reason: reason || "Payment failed at gateway",
            },
        ];

        transaction.update(orderRef, {
            paymentStatus: "FAILED",
            orderStatus: "Payment_Failed",
            paymentAttempts: updatedAttempts,
            updatedAt: new Date(),
        });

        if (eventRef) {
            transaction.set(eventRef, {
                eventId,
                eventType: "payment.failed",
                razorpayOrderId,
                razorpayPaymentId: razorpayPaymentId || null,
                status: "PROCESSED",
                receivedAt: new Date(),
                processedAt: new Date(),
            });
        }

        return { status: 200, success: true };
    });
}

/**
 * Releases reserved inventory and coupon capacity when a prepaid order expires or is cancelled.
 * Operates idempotently to guarantee stock is restored at most once.
 */
export async function releaseExpiredReservation(
    orderId: string,
    db: adminModule.firestore.Firestore
): Promise<{ success: boolean; released: boolean; reason?: string }> {
    const orderRef = db.collection("orders").doc(orderId);

    return await db.runTransaction(async (transaction) => {
        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap.exists) {
            return { success: false, released: false, reason: "ORDER_NOT_FOUND" };
        }

        const data = orderSnap.data();

        // If order was already paid, never release
        if (data?.paymentStatus === "PAID") {
            return { success: false, released: false, reason: "ORDER_ALREADY_PAID" };
        }

        // Idempotency: only release if reserved and not yet released
        if (data?.inventoryReserved === true && data?.reservationReleased !== true) {
            const items = data.items || [];
            const uniqueProductIds = Array.from(
                new Set(items.map((item: any) => item.productId).filter(Boolean))
            ) as string[];

            // READ PHASE: Read all product and coupon documents before any writes
            const productSnaps = await Promise.all(
                uniqueProductIds.map((id) => transaction.get(db.collection("products").doc(id)))
            );
            const productMap = new Map<string, adminModule.firestore.DocumentSnapshot>();
            uniqueProductIds.forEach((id, idx) => {
                productMap.set(id, productSnaps[idx]);
            });

            let couponSnap: adminModule.firestore.DocumentSnapshot | null = null;
            if (data?.couponCode) {
                couponSnap = await transaction.get(db.collection("coupons").doc(data.couponCode));
            }

            // WRITE PHASE: Now perform all database writes atomically
            // 1. Restore product stock
            for (const productId of uniqueProductIds) {
                const productRef = db.collection("products").doc(productId);
                const pSnap = productMap.get(productId);
                const prodData = pSnap?.data();
                const productItems = items.filter((item: any) => item.productId === productId);

                if (prodData?.hasVariants === true && Array.isArray(prodData?.variants)) {
                    const variantIncrements = new Map<string, number>();
                    for (const item of productItems) {
                        if (item.variantId) {
                            variantIncrements.set(
                                item.variantId,
                                (variantIncrements.get(item.variantId) || 0) + (Number(item.quantity) || 1)
                            );
                        }
                    }

                    const updatedVariants = prodData.variants.map((v: any) => {
                        const inc = variantIncrements.get(v.id) || 0;
                        if (inc > 0) {
                            return { ...v, inventory: (Number(v.inventory) || 0) + inc };
                        }
                        return v;
                    });

                    // TASK 029 Hardening: Prevent active-reservation data loss if an admin deleted
                    // or rebuilt the matrix while a reservation was pending.
                    const existingVariantIds = new Set(prodData.variants.map((v: any) => v.id));
                    for (const [vId, incQty] of variantIncrements.entries()) {
                        if (!existingVariantIds.has(vId)) {
                            const itemSnapshot = productItems.find((i: any) => i.variantId === vId);
                            updatedVariants.push({
                                id: vId,
                                sizeName: itemSnapshot?.size || "",
                                colorName: itemSnapshot?.color || "",
                                sku: itemSnapshot?.sku || "",
                                price: itemSnapshot?.price ?? null,
                                inventory: incQty,
                                isActive: false,
                                dimensions: itemSnapshot?.dimensions,
                            });
                        }
                    }

                    const breakdown = calculateVariantStockBreakdown(updatedVariants);

                    transaction.update(productRef, {
                        variants: updatedVariants,
                        inventory: breakdown.sellableStock,
                        totalPhysicalInventory: breakdown.totalPhysicalStock,
                    });
                } else {
                    const totalQty = productItems.reduce(
                        (sum: number, item: any) => sum + (Number(item.quantity) || 1),
                        0
                    );
                    const currentStock = prodData?.inventory;
                    if (typeof currentStock === "number") {
                        transaction.update(productRef, {
                            inventory: currentStock + totalQty,
                        });
                    } else {
                        transaction.update(productRef, {
                            inventory: admin.firestore.FieldValue.increment(totalQty),
                        });
                    }
                }
            }

            // 2. Restore coupon capacity if applied
            if (data?.couponCode && couponSnap && couponSnap.exists) {
                const couponRef = db.collection("coupons").doc(data.couponCode);
                const currentUsed = Number(couponSnap.data()?.timesUsed) || 0;
                transaction.update(couponRef, {
                    timesUsed: Math.max(0, currentUsed - 1),
                });
            }

            // 3. Update order document
            transaction.update(orderRef, {
                inventoryReserved: false,
                reservationReleased: true,
                stockRestored: true,
                paymentStatus: "EXPIRED",
                orderStatus: "Expired",
                expiredAt: new Date(),
                updatedAt: new Date(),
            });

            return { success: true, released: true };
        }

        return { success: true, released: false, reason: "ALREADY_RELEASED_OR_NOT_RESERVED" };
    });
}

export interface CancelOrderOptions {
    reason?: string;
    callerUid?: string;
}

export interface CancelOrderResult {
    status: number;
    success: boolean;
    duplicate?: boolean;
    error?: string;
    message?: string;
}

/**
 * Idempotently cancels an order and restores reserved or committed inventory
 * to the exact variant or product record.
 */
export async function cancelOrder(
    db: adminModule.firestore.Firestore,
    orderId: string,
    options?: CancelOrderOptions
): Promise<CancelOrderResult> {
    const orderRef = db.collection("orders").doc(orderId);

    return await db.runTransaction(async (transaction) => {
        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap.exists) {
            return { status: 404, success: false, error: "Order not found" };
        }

        const data = orderSnap.data();

        // Idempotency: If order was already cancelled and stock restored
        if (data?.orderStatus === "Cancelled" && (data?.stockRestored === true || data?.reservationReleased === true)) {
            return {
                status: 200,
                success: true,
                duplicate: true,
                message: "Order already cancelled and stock restored",
            };
        }

        const items = data?.items || [];
        const uniqueProductIds = Array.from(
            new Set(items.map((item: any) => item.productId).filter(Boolean))
        ) as string[];

        // READ PHASE
        const productSnaps = await Promise.all(
            uniqueProductIds.map((id) => transaction.get(db.collection("products").doc(id)))
        );
        const productMap = new Map<string, adminModule.firestore.DocumentSnapshot>();
        uniqueProductIds.forEach((id, idx) => {
            productMap.set(id, productSnaps[idx]);
        });

        let couponSnap: adminModule.firestore.DocumentSnapshot | null = null;
        if (data?.couponCode) {
            couponSnap = await transaction.get(db.collection("coupons").doc(data.couponCode));
        }

        // WRITE PHASE: Restore stock if stock was reserved or finalized
        const shouldRestoreStock =
            (data?.inventoryReserved === true || data?.inventoryFinalized === true) &&
            data?.stockRestored !== true &&
            data?.reservationReleased !== true;

        if (shouldRestoreStock) {
            for (const productId of uniqueProductIds) {
                const productRef = db.collection("products").doc(productId);
                const pSnap = productMap.get(productId);
                if (!pSnap || !pSnap.exists) continue;
                const prodData = pSnap.data();
                const productItems = items.filter((item: any) => item.productId === productId);

                if (prodData?.hasVariants === true && Array.isArray(prodData?.variants)) {
                    const variantIncrements = new Map<string, number>();
                    for (const item of productItems) {
                        if (item.variantId) {
                            variantIncrements.set(
                                item.variantId,
                                (variantIncrements.get(item.variantId) || 0) + (Number(item.quantity) || 1)
                            );
                        }
                    }

                    const updatedVariants = prodData.variants.map((v: any) => {
                        const inc = variantIncrements.get(v.id) || 0;
                        if (inc > 0) {
                            return { ...v, inventory: (Number(v.inventory) || 0) + inc };
                        }
                        return v;
                    });

                    // Restore any deleted/orphaned variants as inactive
                    const existingVariantIds = new Set(prodData.variants.map((v: any) => v.id));
                    for (const [vId, incQty] of variantIncrements.entries()) {
                        if (!existingVariantIds.has(vId)) {
                            const itemSnapshot = productItems.find((i: any) => i.variantId === vId);
                            updatedVariants.push({
                                id: vId,
                                sizeName: itemSnapshot?.size || "",
                                colorName: itemSnapshot?.color || "",
                                sku: itemSnapshot?.sku || "",
                                price: itemSnapshot?.price ?? null,
                                inventory: incQty,
                                isActive: false,
                                dimensions: itemSnapshot?.dimensions,
                            });
                        }
                    }

                    const breakdown = calculateVariantStockBreakdown(updatedVariants);
                    transaction.update(productRef, {
                        variants: updatedVariants,
                        inventory: breakdown.sellableStock,
                        totalPhysicalInventory: breakdown.totalPhysicalStock,
                    });
                } else {
                    const totalQty = productItems.reduce(
                        (sum: number, item: any) => sum + (Number(item.quantity) || 1),
                        0
                    );
                    const currentStock = prodData?.inventory;
                    if (typeof currentStock === "number") {
                        transaction.update(productRef, {
                            inventory: currentStock + totalQty,
                        });
                    } else {
                        transaction.update(productRef, {
                            inventory: admin.firestore.FieldValue.increment(totalQty),
                        });
                    }
                }
            }

            // Restore coupon capacity
            if (data?.couponCode && couponSnap && couponSnap.exists) {
                const couponRef = db.collection("coupons").doc(data.couponCode);
                const currentUsed = Number(couponSnap.data()?.timesUsed) || 0;
                transaction.update(couponRef, {
                    timesUsed: Math.max(0, currentUsed - 1),
                });
            }
        }

        transaction.update(orderRef, {
            orderStatus: "Cancelled",
            paymentStatus: data?.paymentStatus === "PAID" ? "REFUNDED" : "CANCELLED",
            inventoryReserved: false,
            reservationReleased: true,
            stockRestored: true,
            cancellationReason: options?.reason || "Cancelled by admin or customer",
            cancelledAt: new Date(),
            updatedAt: new Date(),
        });

        return {
            status: 200,
            success: true,
            message: "Order cancelled and stock restored successfully",
        };
    });
}
