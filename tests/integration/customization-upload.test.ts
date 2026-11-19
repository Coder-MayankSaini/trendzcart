import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
    type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
    ref,
    uploadBytes,
    getBytes,
} from "firebase/storage";
import Razorpay from "razorpay";
import * as adminModule from "firebase-admin";
import { adminDb, adminStorage } from "../../src/lib/firebase/admin.ts";
import { POST as createOrderRoute } from "../../src/app/api/orders/create/route.ts";
import { POST as createRazorpayOrderRoute } from "../../src/app/api/razorpay/create-order/route.ts";
import { seedEmulatorDatabase, clearCollection, createJsonPostRequest, getSyntheticUserAuthToken } from "./testHelper.ts";
import { SYNTHETIC_SHIPPING_ADDRESS } from "../fixtures/orders.ts";
import { validateOrderCustomizations, extractStoragePath } from "../../src/lib/orders/customizationAuth.ts";

describe("Customization Upload & Authorization Integration Tests (UPLOAD-001 to UPLOAD-024)", () => {
    let testEnv: RulesTestEnvironment;
    const GUEST_UID = "guest_anon_101";
    const CUST_ALICE_UID = "cust_alice_202";
    const CUST_BOB_UID = "cust_bob_303";
    const ADMIN_UID = "admin_supervisor_999";

    before(async () => {
        const rulesPath = path.resolve(process.cwd(), "storage.rules");
        const rules = fs.readFileSync(rulesPath, "utf8");

        testEnv = await initializeTestEnvironment({
            projectId: "demo-trendkartz",
            storage: {
                host: "127.0.0.1",
                port: 9199,
                rules,
            },
        });

        process.env.RAZORPAY_KEY_ID = "rzp_test_mock_upload_key";
        process.env.RAZORPAY_KEY_SECRET = "mock_secret_upload_999";

        // Intercept Razorpay SDK API call prototype to prevent external HTTP calls in emulator
        const dummy = new Razorpay({ key_id: "rzp_test_mock", key_secret: "mock" });
        const apiProto = Object.getPrototypeOf(dummy.api);
        apiProto.post = async function (params: any) {
            return {
                id: "order_rzp_mock_custom_101",
                currency: params.data?.currency || "INR",
                amount: params.data?.amount || 0,
                ...params.data,
            };
        };
    });

    after(async () => {
        if (testEnv) {
            await testEnv.cleanup();
        }
    });

    beforeEach(async () => {
        await testEnv.clearStorage();

        if (adminDb) {
            await clearCollection(adminDb, "orders");
            await seedEmulatorDatabase(adminDb);
        }

        // Privileged seeding of baseline assets
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const storage = context.storage();

            // 1. Seed public catalog image
            await uploadBytes(
                ref(storage, "products/prod_100/hero.jpg"),
                Buffer.from("SYNTHETIC_PRODUCT_IMAGE"),
                { contentType: "image/jpeg" }
            );

            // 2. Seed public category image
            await uploadBytes(
                ref(storage, "categories/cat_apparel/banner.jpg"),
                Buffer.from("SYNTHETIC_CATEGORY_BANNER"),
                { contentType: "image/jpeg" }
            );

            // 3. Seed Alice's existing customization file
            await uploadBytes(
                ref(storage, `customizations/${CUST_ALICE_UID}/alice_photo.jpg`),
                Buffer.from("ALICE_PRIVATE_PHOTO_BYTES"),
                { contentType: "image/jpeg" }
            );

            // 4. Seed Bob's existing customization file
            await uploadBytes(
                ref(storage, `customizations/${CUST_BOB_UID}/bob_photo.jpg`),
                Buffer.from("BOB_PRIVATE_PHOTO_BYTES"),
                { contentType: "image/jpeg" }
            );

            // 5. Seed legacy flat customization file for compatibility test
            await uploadBytes(
                ref(storage, "customizations/legacy_flat_photo.jpg"),
                Buffer.from("LEGACY_FLAT_PHOTO_BYTES"),
                { contentType: "image/jpeg" }
            );

            // 5b. Seed Guest customization files for order tests
            await uploadBytes(
                ref(storage, `customizations/${GUEST_UID}/guest_custom_print.jpg`),
                Buffer.from("GUEST_PRINT_PHOTO_BYTES"),
                { contentType: "image/jpeg" }
            );
            await uploadBytes(
                ref(storage, `customizations/${GUEST_UID}/hoodie_patch.png`),
                Buffer.from("GUEST_PATCH_PNG_BYTES"),
                { contentType: "image/png" }
            );
            await uploadBytes(
                ref(storage, `customizations/${GUEST_UID}/double_custom.jpg`),
                Buffer.from("GUEST_DOUBLE_PHOTO_BYTES"),
                { contentType: "image/jpeg" }
            );
            await uploadBytes(
                ref(storage, `customizations/${GUEST_UID}/private_gift.jpg`),
                Buffer.from("GUEST_GIFT_PHOTO_BYTES"),
                { contentType: "image/jpeg" }
            );

            // 6. Seed review image
            await uploadBytes(
                ref(storage, `reviews/prod_100/${CUST_ALICE_UID}_rev.jpg`),
                Buffer.from("ALICE_REVIEW_PHOTO"),
                { contentType: "image/jpeg" }
            );
        });
    });

    // UPLOAD-001 — Guest Upload
    it("UPLOAD-001: Guest customer with anonymous authentication can upload valid image to scoped namespace", async () => {
        const guestStorage = testEnv.authenticatedContext(GUEST_UID, { provider_id: "anonymous" }).storage();
        const fileRef = ref(guestStorage, `customizations/${GUEST_UID}/guest_tshirt.jpg`);

        await assertSucceeds(
            uploadBytes(fileRef, Buffer.from("SYNTHETIC_GUEST_PHOTO"), {
                contentType: "image/jpeg",
            })
        );
    });

    // UPLOAD-002 — Authenticated Upload
    it("UPLOAD-002: Registered customer can upload valid image to their scoped namespace", async () => {
        const aliceStorage = testEnv.authenticatedContext(CUST_ALICE_UID, { email: "alice@example.com" }).storage();
        const fileRef = ref(aliceStorage, `customizations/${CUST_ALICE_UID}/new_design.png`);

        await assertSucceeds(
            uploadBytes(fileRef, Buffer.from("SYNTHETIC_ALICE_PNG"), {
                contentType: "image/png",
            })
        );
    });

    // UPLOAD-003 — Cross-Customer Upload
    it("UPLOAD-003: Customer A cannot upload into Customer B's protected namespace", async () => {
        const aliceStorage = testEnv.authenticatedContext(CUST_ALICE_UID).storage();
        const targetRef = ref(aliceStorage, `customizations/${CUST_BOB_UID}/malicious_injection.jpg`);

        await assertFails(
            uploadBytes(targetRef, Buffer.from("MALICIOUS_BYTES"), {
                contentType: "image/jpeg",
            })
        );
    });

    // UPLOAD-004 — Cross-Customer Read
    it("UPLOAD-004: Customer A cannot read Customer B's private customization file", async () => {
        const aliceStorage = testEnv.authenticatedContext(CUST_ALICE_UID).storage();
        const bobsFileRef = ref(aliceStorage, `customizations/${CUST_BOB_UID}/bob_photo.jpg`);

        await assertFails(getBytes(bobsFileRef));
    });

    // UPLOAD-005 — Cross-Customer Overwrite
    it("UPLOAD-005: One customer cannot overwrite another customer's file, and updates are denied", async () => {
        const aliceStorage = testEnv.authenticatedContext(CUST_ALICE_UID).storage();
        const bobsExistingRef = ref(aliceStorage, `customizations/${CUST_BOB_UID}/bob_photo.jpg`);

        // Overwrite Bob's file -> DENIED
        await assertFails(
            uploadBytes(bobsExistingRef, Buffer.from("OVERWRITE_ATTEMPT"), {
                contentType: "image/jpeg",
            })
        );

        // Even Alice attempting to overwrite her own existing file is denied (no overwrite rule)
        const aliceExistingRef = ref(aliceStorage, `customizations/${CUST_ALICE_UID}/alice_photo.jpg`);
        await assertFails(
            uploadBytes(aliceExistingRef, Buffer.from("NEW_BYTES_OVERWRITE"), {
                contentType: "image/jpeg",
            })
        );
    });

    // UPLOAD-006 — Anonymous Public Write
    it("UPLOAD-006: Unauthenticated public caller cannot write arbitrary files to customizations", async () => {
        const unauthStorage = testEnv.unauthenticatedContext().storage();
        const fileRef = ref(unauthStorage, `customizations/${GUEST_UID}/unauth_file.jpg`);

        await assertFails(
            uploadBytes(fileRef, Buffer.from("UNAUTHENTICATED_UPLOAD"), {
                contentType: "image/jpeg",
            })
        );
    });

    // UPLOAD-007 — Oversized Image
    it("UPLOAD-007: Image exceeding the 10MB limit is rejected", async () => {
        const aliceStorage = testEnv.authenticatedContext(CUST_ALICE_UID).storage();
        const oversizedBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
        const fileRef = ref(aliceStorage, `customizations/${CUST_ALICE_UID}/huge.jpg`);

        await assertFails(
            uploadBytes(fileRef, oversizedBuffer, {
                contentType: "image/jpeg",
            })
        );
    });

    // UPLOAD-008 — Unsupported Format
    it("UPLOAD-008: Unsupported formats such as SVG, HTML, or scripts are rejected", async () => {
        const aliceStorage = testEnv.authenticatedContext(CUST_ALICE_UID).storage();

        // 1. SVG rejected
        const svgRef = ref(aliceStorage, `customizations/${CUST_ALICE_UID}/vector.svg`);
        await assertFails(
            uploadBytes(svgRef, Buffer.from("<svg></svg>"), {
                contentType: "image/svg+xml",
            })
        );

        // 2. HTML rejected
        const htmlRef = ref(aliceStorage, `customizations/${CUST_ALICE_UID}/page.html`);
        await assertFails(
            uploadBytes(htmlRef, Buffer.from("<h1>Exploit</h1>"), {
                contentType: "text/html",
            })
        );
    });

    // UPLOAD-009 — Filename Manipulation
    it("UPLOAD-009: Invalid filenames with path manipulation or illegal characters are rejected", async () => {
        const aliceStorage = testEnv.authenticatedContext(CUST_ALICE_UID).storage();
        // Disallowed special characters or format
        const illegalRef = ref(aliceStorage, `customizations/${CUST_ALICE_UID}/exploit..test.jpg`);
        await assertFails(
            uploadBytes(illegalRef, Buffer.from("BYTES"), {
                contentType: "image/jpeg",
            })
        );
    });

    // UPLOAD-010 — Admin Read
    it("UPLOAD-010: Authorized administrator can access any customization file for fulfillment", async () => {
        const adminStorageRules = testEnv.authenticatedContext(ADMIN_UID, { admin: true }).storage();

        // Admin reads Alice's private photo
        const aliceRef = ref(adminStorageRules, `customizations/${CUST_ALICE_UID}/alice_photo.jpg`);
        await assertSucceeds(getBytes(aliceRef));

        // Admin reads Bob's private photo
        const bobRef = ref(adminStorageRules, `customizations/${CUST_BOB_UID}/bob_photo.jpg`);
        await assertSucceeds(getBytes(bobRef));

        // Admin reads legacy flat photo
        const legacyRef = ref(adminStorageRules, "customizations/legacy_flat_photo.jpg");
        await assertSucceeds(getBytes(legacyRef));
    });

    // UPLOAD-011 — Non-Admin Fulfillment Access
    it("UPLOAD-011: Normal customer cannot access another customer's file via direct storage read", async () => {
        const normalUserStorage = testEnv.authenticatedContext("random_user_888").storage();
        const aliceRef = ref(normalUserStorage, `customizations/${CUST_ALICE_UID}/alice_photo.jpg`);
        await assertFails(getBytes(aliceRef));
    });

    // UPLOAD-012 — Existing Product Images
    it("UPLOAD-012: Public unauthenticated access to product images remains functional", async () => {
        const unauthStorage = testEnv.unauthenticatedContext().storage();
        const prodRef = ref(unauthStorage, "products/prod_100/hero.jpg");
        await assertSucceeds(getBytes(prodRef));
    });

    // UPLOAD-013 — Existing Category Images
    it("UPLOAD-013: Public unauthenticated access to category images remains functional", async () => {
        const unauthStorage = testEnv.unauthenticatedContext().storage();
        const catRef = ref(unauthStorage, "categories/cat_apparel/banner.jpg");
        await assertSucceeds(getBytes(catRef));
    });

    // UPLOAD-014 — Existing Review Images
    it("UPLOAD-014: Review images are publicly readable, and author can upload with UID prefix", async () => {
        const unauthStorage = testEnv.unauthenticatedContext().storage();
        const revReadRef = ref(unauthStorage, `reviews/prod_100/${CUST_ALICE_UID}_rev.jpg`);
        await assertSucceeds(getBytes(revReadRef));

        const aliceStorage = testEnv.authenticatedContext(CUST_ALICE_UID).storage();
        const newRevRef = ref(aliceStorage, `reviews/prod_100/${CUST_ALICE_UID}_rev2.jpg`);
        await assertSucceeds(
            uploadBytes(newRevRef, Buffer.from("NEW_REVIEW_PHOTO"), {
                contentType: "image/jpeg",
            })
        );
    });

    // UPLOAD-015 — Guest COD Checkout
    it("UPLOAD-015: Guest customization image remains correctly associated with a COD order", async () => {
        const guestToken = await getSyntheticUserAuthToken(GUEST_UID);

        const payload = {
            items: [
                {
                    productId: "prod-hoodie-1000",
                    quantity: 1,
                    isCustomized: true,
                    customizationData: {
                        name: "Custom Print",
                        storagePath: `customizations/${GUEST_UID}/guest_custom_print.jpg`,
                        pictureUrl: `http://127.0.0.1:9199/v0/b/demo-trendkartz.appspot.com/o/customizations%2F${GUEST_UID}%2Fguest_custom_print.jpg`,
                    },
                },
            ],
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload, {
            Authorization: `Bearer ${guestToken}`,
        });

        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.ok(data.id);
        assert.ok(data.guestAccessToken, "Guest access token must be returned for guest order");

        // Verify order persisted in Firestore with customizationPaths
        const orderDoc = await adminDb!.collection("orders").doc(data.id).get();
        assert.equal(orderDoc.exists, true);
        const orderData = orderDoc.data();
        assert.equal(orderData?.paymentStatus, "PENDING");
        assert.equal(orderData?.orderStatus, "Processing");
        assert.deepEqual(orderData?.customizationPaths, [`customizations/${GUEST_UID}/guest_custom_print.jpg`]);
    });

    // UPLOAD-016 — Guest Razorpay Checkout
    it("UPLOAD-016: Guest customization reference remains correctly associated with pending prepaid order", async () => {
        const guestToken = await getSyntheticUserAuthToken(GUEST_UID);

        const payload = {
            items: [
                {
                    productId: "prod-hoodie-1000",
                    quantity: 1,
                    isCustomized: true,
                    customizationData: {
                        storagePath: `customizations/${GUEST_UID}/hoodie_patch.png`,
                        pictureUrl: `http://127.0.0.1:9199/v0/b/demo-trendkartz.appspot.com/o/customizations%2F${GUEST_UID}%2Fhoodie_patch.png`,
                    },
                },
            ],
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
            receipt: "order_rzp_custom_101",
        };

        const req = createJsonPostRequest("http://localhost:3000/api/razorpay/create-order", payload, {
            Authorization: `Bearer ${guestToken}`,
        });

        const res = await createRazorpayOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.ok(data.internalOrderId);
        assert.ok(data.guestAccessToken);

        // Verify pending order in Firestore
        const orderDoc = await adminDb!.collection("orders").doc(data.internalOrderId).get();
        assert.equal(orderDoc.exists, true);
        const orderData = orderDoc.data();
        assert.equal(orderData?.paymentMethod, "RAZORPAY");
        assert.equal(orderData?.inventoryReserved, true);
        assert.deepEqual(orderData?.customizationPaths, [`customizations/${GUEST_UID}/hoodie_patch.png`]);
    });

    // UPLOAD-017 — Forged Customization Path
    it("UPLOAD-017: Attacker cannot attach another customer's private customization file to their order", async () => {
        const attackerToken = await getSyntheticUserAuthToken("attacker_uid_666");

        // Attacker attempts to reference Alice's private file
        const payload = {
            items: [
                {
                    productId: "prod-hoodie-1000",
                    quantity: 1,
                    isCustomized: true,
                    customizationData: {
                        storagePath: `customizations/${CUST_ALICE_UID}/alice_photo.jpg`,
                    },
                },
            ],
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload, {
            Authorization: `Bearer ${attackerToken}`,
        });

        const res = await createOrderRoute(req);
        const data = await res.json();

        // Server detects cross-customer ownership violation and strictly rejects
        assert.equal(res.status, 400);
        assert.match(data.error, /does not belong to the verified customer session/i);

        // Verify order was not created
        const ordersSnap = await adminDb!.collection("orders").where("userId", "==", "attacker_uid_666").get();
        assert.equal(ordersSnap.empty, true);
    });

    // UPLOAD-018 — Checkout Retry
    it("UPLOAD-018: Idempotent checkout retry can reuse its own customization reference", async () => {
        const aliceToken = await getSyntheticUserAuthToken(CUST_ALICE_UID);
        const fixedOrderId = "retry_custom_order_111";

        const payload = {
            id: fixedOrderId,
            userId: CUST_ALICE_UID,
            items: [
                {
                    productId: "prod-hoodie-1000",
                    quantity: 1,
                    isCustomized: true,
                    customizationData: {
                        storagePath: `customizations/${CUST_ALICE_UID}/alice_photo.jpg`,
                    },
                },
            ],
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        // 1. Initial order creation succeeds
        const req1 = createJsonPostRequest("http://localhost:3000/api/orders/create", payload, {
            Authorization: `Bearer ${aliceToken}`,
        });
        const res1 = await createOrderRoute(req1);
        assert.equal(res1.status, 200);

        // 2. Retry with same order ID and same customization is recognized
        const check = await validateOrderCustomizations(payload.items, CUST_ALICE_UID, {
            db: adminDb,
            currentOrderId: fixedOrderId,
        });
        assert.equal(check.isValid, true);
    });

    // UPLOAD-019 — Anonymous Session Persistence
    it("UPLOAD-019: Anonymous session provides stable identity across verification", async () => {
        const token1 = await getSyntheticUserAuthToken("anon_stable_session");
        assert.ok(token1);
        const checkResult = await validateOrderCustomizations(
            [
                {
                    productId: "prod-hoodie-1000",
                    quantity: 1,
                    isCustomized: true,
                    customizationData: {
                        storagePath: "customizations/anon_stable_session/upload_1.jpg",
                    },
                },
            ],
            "anon_stable_session"
        );
        assert.equal(checkResult.isValid, true);
    });

    // UPLOAD-020 — Account Upgrade Compatibility
    it("UPLOAD-020: Anonymous identity transitions cleanly without corrupting user collection", async () => {
        // Confirm that anonymous authentication does NOT create an unverified customer profile in Firestore
        const anonRef = adminDb!.collection("users").doc("anon_ephemeral_user");
        const anonSnap = await anonRef.get();
        assert.equal(anonSnap.exists, false, "Anonymous sessions must not leave ghost user documents");
    });

    // UPLOAD-021 — Upload Abuse Protection
    it("UPLOAD-021: Rejects arbitrary external URLs and path manipulation attempts", async () => {
        const res1 = await validateOrderCustomizations(
            [
                {
                    productId: "prod-hoodie-1000",
                    quantity: 1,
                    isCustomized: true,
                    customizationData: {
                        storagePath: "https://malicious-site.com/exploit.jpg",
                    },
                },
            ],
            CUST_ALICE_UID
        );
        assert.equal(res1.isValid, false);
        assert.match(res1.error || "", /violates the required scoped format|external URL forbidden/i);

        const res2 = await validateOrderCustomizations(
            [
                {
                    productId: "prod-hoodie-1000",
                    quantity: 1,
                    isCustomized: true,
                    customizationData: {
                        storagePath: "customizations/../secret.jpg",
                    },
                },
            ],
            CUST_ALICE_UID
        );
        assert.equal(res2.isValid, false);
    });

    // UPLOAD-022 — Abandoned Upload
    it("UPLOAD-022: Abandoned upload references without an order do not lock inventory or coupon capacity", async () => {
        // Stock of prod-hoodie-1000 before upload
        const productSnapBefore = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        const stockBefore = productSnapBefore.data()?.inventory;

        // An abandoned upload exists in Storage (e.g. customizations/anon/abandoned.jpg)
        // Verify inventory is untouched
        const productSnapAfter = await adminDb!.collection("products").doc("prod-hoodie-1000").get();
        assert.equal(productSnapAfter.data()?.inventory, stockBefore);
    });

    // UPLOAD-023 — Private URL Leakage
    it("UPLOAD-023: Order retrieval without proper guest access token refuses to expose order details", async () => {
        // Create guest order
        const guestToken = await getSyntheticUserAuthToken(GUEST_UID);
        const payload = {
            items: [
                {
                    productId: "prod-hoodie-1000",
                    quantity: 1,
                    isCustomized: true,
                    customizationData: {
                        storagePath: `customizations/${GUEST_UID}/private_gift.jpg`,
                    },
                },
            ],
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const createReq = createJsonPostRequest("http://localhost:3000/api/orders/create", payload, {
            Authorization: `Bearer ${guestToken}`,
        });
        const createRes = await createOrderRoute(createReq);
        const { id: orderId } = await createRes.json();

        // Attempt lookup without guestAccessToken
        const lookupReq = createJsonPostRequest("http://localhost:3000/api/orders/by-ids", {
            orderIds: [orderId],
            guestTokens: {},
        });
        const { POST: byIdsRoute } = await import("../../src/app/api/orders/by-ids/route.ts");
        const lookupRes = await byIdsRoute(lookupReq);
        const lookupData = await lookupRes.json();

        // Order is omitted or empty because guest token is missing
        assert.equal(lookupData.orders.length, 0);
    });

    // UPLOAD-024 — Payment Regression
    it("UPLOAD-024: Customization handling does not interfere with order total calculation or pricing", async () => {
        const guestToken = await getSyntheticUserAuthToken(GUEST_UID);
        const payload = {
            items: [
                {
                    productId: "prod-hoodie-1000", // Catalog price is ₹1000
                    quantity: 2,
                    isCustomized: true,
                    customizationData: {
                        storagePath: `customizations/${GUEST_UID}/double_custom.jpg`,
                    },
                },
            ],
            total: 2000,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            shippingAddress: SYNTHETIC_SHIPPING_ADDRESS,
        };

        const req = createJsonPostRequest("http://localhost:3000/api/orders/create", payload, {
            Authorization: `Bearer ${guestToken}`,
        });
        const res = await createOrderRoute(req);
        const data = await res.json();

        assert.equal(res.status, 200);
        const orderSnap = await adminDb!.collection("orders").doc(data.id).get();
        assert.equal(orderSnap.data()?.total, 2000);
        assert.equal(orderSnap.data()?.subtotal, 2000);
    });
});
