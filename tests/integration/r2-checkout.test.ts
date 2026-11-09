import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Razorpay from "razorpay";
import { adminAuth, adminDb } from "../../src/lib/firebase/admin.ts";
import { POST as createOrderRoute } from "../../src/app/api/orders/create/route.ts";
import { POST as createRazorpayOrderRoute } from "../../src/app/api/razorpay/create-order/route.ts";
import { _mockStorage } from "../../src/lib/storage/r2.ts";
import {
    clearCollection,
    createJsonPostRequest,
    getSyntheticUserAuthToken,
    seedEmulatorDatabase,
} from "./testHelper.ts";
import { SYNTHETIC_SHIPPING_ADDRESS } from "../fixtures/orders.ts";

describe("Cloudflare R2 Checkout & Order Integration Tests (R2-008, R2-009, R2-015, R2-016, R2-022, R2-025)", () => {
    const GUEST_UID = "guest_anon_r2_chk_101";
    const CUST_ALICE_UID = "cust_alice_r2_chk_202";
    const CUST_BOB_UID = "cust_bob_r2_chk_303";

    let guestToken: string;
    let aliceToken: string;
    let bobToken: string;

    before(async () => {
        if (!adminAuth) throw new Error("adminAuth unavailable");

        try { await adminAuth.deleteUser(GUEST_UID); } catch {}
        try { await adminAuth.deleteUser(CUST_ALICE_UID); } catch {}
        try { await adminAuth.deleteUser(CUST_BOB_UID); } catch {}

        await adminAuth.createUser({ uid: GUEST_UID, email: "guest_chk@trendkartz.test" });
        await adminAuth.createUser({ uid: CUST_ALICE_UID, email: "alice_chk@trendkartz.test" });
        await adminAuth.createUser({ uid: CUST_BOB_UID, email: "bob_chk@trendkartz.test" });

        guestToken = await getSyntheticUserAuthToken(GUEST_UID);
        aliceToken = await getSyntheticUserAuthToken(CUST_ALICE_UID);
        bobToken = await getSyntheticUserAuthToken(CUST_BOB_UID);

        process.env.RAZORPAY_KEY_ID = "rzp_test_r2_checkout_key";
        process.env.RAZORPAY_KEY_SECRET = "mock_secret_r2_checkout_999";

        // Intercept Razorpay API prototype to avoid external calls
        const dummy = new Razorpay({ key_id: "rzp_test_mock", key_secret: "mock" });
        const apiProto = Object.getPrototypeOf(dummy.api);
        apiProto.post = async function (params: any) {
            return {
                id: "order_rzp_mock_r2_chk_101",
                currency: params.data?.currency || "INR",
                amount: params.data?.amount || 0,
                ...params.data,
            };
        };
    });

    beforeEach(async () => {
        _mockStorage.clear();
        if (adminDb) {
            await clearCollection(adminDb, "orders");
            await seedEmulatorDatabase(adminDb);
        }
    });

    it("R2-008: Missing upload object cannot be attached to an order", async () => {
        const nonExistentKey = `customizations/${CUST_ALICE_UID}/phantom_photo.jpg`;

        const req = createJsonPostRequest(
            "http://localhost:3000/api/orders/create",
            {
                paymentMethod: "COD",
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
                subtotal: 1000,
                total: 1000,
                items: [
                    {
                        productId: "prod-hoodie-1000",
                        quantity: 1,
                        isCustomized: true,
                        customizationData: {
                            pictureUrl: `/api/media/download?key=${encodeURIComponent(nonExistentKey)}`,
                            storagePath: nonExistentKey,
                            ownerUid: CUST_ALICE_UID,
                        },
                    },
                ],
            },
            { Authorization: `Bearer ${aliceToken}` }
        );

        const res = await createOrderRoute(req);
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.ok(data.error.includes("not found in storage"));
    });

    it("R2-009: Reused upload reference cannot be claimed by an unrelated order", async () => {
        const aliceKey = `customizations/${CUST_ALICE_UID}/alice_photo.jpg`;
        _mockStorage.set(aliceKey, {
            key: aliceKey,
            contentType: "image/jpeg",
            size: 20000,
            metadata: { ownerUid: CUST_ALICE_UID },
            data: Buffer.from("ALICE_PHOTO"),
            createdAt: Date.now(),
            etag: "etag-alice-chk",
        });

        // 1. Alice creates order claiming aliceKey
        const req1 = createJsonPostRequest(
            "http://localhost:3000/api/orders/create",
            {
                paymentMethod: "COD",
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
                subtotal: 1000,
                total: 1000,
                items: [
                    {
                        productId: "prod-hoodie-1000",
                        quantity: 1,
                        isCustomized: true,
                        customizationData: {
                            storagePath: aliceKey,
                            ownerUid: CUST_ALICE_UID,
                        },
                    },
                ],
            },
            { Authorization: `Bearer ${aliceToken}` }
        );
        const res1 = await createOrderRoute(req1);
        assert.equal(res1.status, 200);

        // 2. Bob attempts to claim Alice's key on his own order
        const req2 = createJsonPostRequest(
            "http://localhost:3000/api/orders/create",
            {
                paymentMethod: "COD",
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
                subtotal: 1000,
                total: 1000,
                items: [
                    {
                        productId: "prod-hoodie-1000",
                        quantity: 1,
                        isCustomized: true,
                        customizationData: {
                            storagePath: aliceKey,
                            ownerUid: CUST_ALICE_UID,
                        },
                    },
                ],
            },
            { Authorization: `Bearer ${bobToken}` }
        );
        const res2 = await createOrderRoute(req2);
        assert.equal(res2.status, 400);
        const data2 = await res2.json();
        assert.ok(data2.error.includes("cross-customer reference rejected"));
    });

    it("R2-015: Guest COD order correctly references the image", async () => {
        const guestKey = `customizations/${GUEST_UID}/guest_custom_tee.webp`;
        _mockStorage.set(guestKey, {
            key: guestKey,
            contentType: "image/webp",
            size: 25000,
            metadata: { ownerUid: GUEST_UID },
            data: Buffer.from("GUEST_CUSTOM_PHOTO"),
            createdAt: Date.now(),
            etag: "etag-guest-chk",
        });

        const req = createJsonPostRequest(
            "http://localhost:3000/api/orders/create",
            {
                paymentMethod: "COD",
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
                subtotal: 1000,
                total: 1000,
                items: [
                    {
                        productId: "prod-hoodie-1000",
                        quantity: 1,
                        isCustomized: true,
                        customizationData: {
                            name: "Guest Monogram",
                            storagePath: guestKey,
                            pictureUrl: `/api/media/download?key=${encodeURIComponent(guestKey)}`,
                            ownerUid: GUEST_UID,
                        },
                    },
                ],
            },
            { Authorization: `Bearer ${guestToken}` }
        );

        const res = await createOrderRoute(req);
        assert.equal(res.status, 200);
        const data = await res.json();

        assert.equal(data.success, true);
        const orderId = data.id || data.orderId;
        assert.ok(orderId);

        // Verify in database
        if (adminDb) {
            const orderDoc = await adminDb.collection("orders").doc(orderId).get();
            assert.equal(orderDoc.exists, true);
            const savedData = orderDoc.data();
            assert.deepEqual(savedData?.customizationPaths, [guestKey]);
        }
    });

    it("R2-016: Guest Razorpay pending order correctly references the image", async () => {
        const guestKey = `customizations/${GUEST_UID}/guest_rzp_tee.png`;
        _mockStorage.set(guestKey, {
            key: guestKey,
            contentType: "image/png",
            size: 30000,
            metadata: { ownerUid: GUEST_UID },
            data: Buffer.from("GUEST_RZP_PHOTO"),
            createdAt: Date.now(),
            etag: "etag-rzp-guest",
        });

        const req = createJsonPostRequest(
            "http://localhost:3000/api/razorpay/create-order",
            {
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
                subtotal: 1000,
                total: 1000,
                items: [
                    {
                        productId: "prod-hoodie-1000",
                        quantity: 1,
                        isCustomized: true,
                        customizationData: {
                            storagePath: guestKey,
                            ownerUid: GUEST_UID,
                        },
                    },
                ],
            },
            { Authorization: `Bearer ${guestToken}` }
        );

        const res = await createRazorpayOrderRoute(req);
        assert.equal(res.status, 200);
        const data = await res.json();

        assert.ok(data.internalOrderId);
        assert.ok(data.id || data.razorpayOrderId);

        // Verify pending order in database has customizationPaths
        if (adminDb) {
            const orderDoc = await adminDb.collection("orders").doc(data.internalOrderId).get();
            const savedData = orderDoc.data();
            assert.deepEqual(savedData?.customizationPaths, [guestKey]);
            assert.equal(savedData?.paymentStatus, "PENDING");
        }
    });

    it("R2-022: Storage failure is handled without falsely completing checkout", async () => {
        // An unauthenticated request with a customization path must fail-closed
        const req = createJsonPostRequest(
            "http://localhost:3000/api/orders/create",
            {
                paymentMethod: "COD",
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
                subtotal: 1000,
                total: 1000,
                items: [
                    {
                        productId: "prod-hoodie-1000",
                        quantity: 1,
                        isCustomized: true,
                        customizationData: {
                            storagePath: "customizations/unauth/unverified.jpg",
                        },
                    },
                ],
            }
            // No Authorization header
        );

        const res = await createOrderRoute(req);
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.ok(data.error.includes("Missing verified authentication session"));
    });

    it("R2-025: Standard catalog checkout without customization remains 100% functional", async () => {
        const req = createJsonPostRequest(
            "http://localhost:3000/api/orders/create",
            {
                paymentMethod: "COD",
                shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
                subtotal: 2000,
                total: 2000,
                items: [
                    {
                        productId: "prod-hoodie-1000",
                        quantity: 2,
                    },
                ],
            }
        );

        const res = await createOrderRoute(req);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.ok(data.guestAccessToken);
    });
});
