import { describe, it, before, after, beforeEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
    type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    query,
    where,
    orderBy,
    getDocs,
    deleteDoc,
} from "firebase/firestore";

describe("Firestore Security Rules Integration Tests (rules_version = '2')", () => {
    let testEnv: RulesTestEnvironment;

    before(async () => {
        const rulesPath = path.resolve(process.cwd(), "firestore.rules");
        const rules = fs.readFileSync(rulesPath, "utf8");

        testEnv = await initializeTestEnvironment({
            projectId: "demo-trendkartz",
            firestore: {
                host: "127.0.0.1",
                port: 8080,
                rules,
            },
        });
    });

    after(async () => {
        if (testEnv) {
            await testEnv.cleanup();
        }
    });

    beforeEach(async () => {
        await testEnv.clearFirestore();

        // Seed synthetic test fixtures via privileged context
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();

            // 1. Orders
            await setDoc(doc(db, "orders", "ord-cust-b"), {
                id: "ord-cust-b",
                userId: "cust_b",
                total: 2500,
                subtotal: 2500,
                orderStatus: "Processing",
                paymentStatus: "PAID",
                paymentMethod: "RAZORPAY",
                createdAt: new Date().toISOString(),
            });

            // 2. Users
            await setDoc(doc(db, "users", "cust_b"), {
                uid: "cust_b",
                email: "cust_b@example.com",
                role: "customer",
                createdAt: Date.now(),
            });

            // Spoofed user: has role "admin" in Firestore document, but NO custom claims in auth token
            await setDoc(doc(db, "users", "spoofed_admin"), {
                uid: "spoofed_admin",
                email: "spoofed@example.com",
                role: "admin", // Spoofed field
                createdAt: Date.now(),
            });

            // 3. Products
            await setDoc(doc(db, "products", "prod_visible"), {
                id: "prod_visible",
                name: "Visible Denim Jacket",
                price: 1999,
                isVisible: true,
                inventory: 20,
            });

            await setDoc(doc(db, "products", "prod_hidden"), {
                id: "prod_hidden",
                name: "Draft Unreleased Jacket",
                price: 2999,
                isVisible: false,
                inventory: 5,
            });

            // 4. Categories
            await setDoc(doc(db, "categories", "cat_apparel"), {
                id: "cat_apparel",
                name: "Apparel",
                showOnHome: true,
                order: 1,
            });

            // 5. Coupons
            await setDoc(doc(db, "coupons", "SAVE20"), {
                code: "SAVE20",
                discountType: "percentage",
                discountValue: 20,
                usageLimit: 100,
                timesUsed: 5,
                isActive: true,
            });

            // 6. Reviews
            await setDoc(doc(db, "reviews", "rev_existing"), {
                id: "rev_existing",
                productId: "prod_visible",
                userId: "cust_b",
                rating: 5,
                comment: "Excellent product!",
                isFake: false,
                createdAt: Date.now(),
            });

            // 6b. Review Import Batches
            await setDoc(doc(db, "reviewImportBatches", "batch_test_022"), {
                batchId: "batch_test_022",
                productId: "prod_visible",
                productName: "Visible Product",
                adminUid: "admin_uid",
                createdAt: Date.now(),
                totalSubmitted: 38,
                validEntries: 38,
                rejectedEntries: 0,
                publishedEntries: 38,
                duplicateEntries: 0,
                status: "published",
                errorSummary: [],
            });

            // 7. Internal Collections
            await setDoc(doc(db, "paymentRecords", "pay_100"), {
                paymentId: "pay_100",
                amount: 2500,
                status: "captured",
            });

            await setDoc(doc(db, "paymentWebhookEvents", "evt_100"), {
                eventId: "evt_100",
                type: "payment.captured",
            });

            await setDoc(doc(db, "rateLimits", "ip:127.0.0.1:orders"), {
                count: 15,
                windowStart: Date.now(),
            });

            await setDoc(doc(db, "unmatchedPayments", "pay_orphan"), {
                paymentId: "pay_orphan",
                amount: 1500,
            });
        });
    });

    // RULE-001 — Unauthenticated Order Read
    it("RULE-001: Unauthenticated Order Read — anonymous client cannot read customer orders", async () => {
        const unauthDb = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(unauthDb, "orders", "ord-cust-b")));
    });

    // RULE-002 — Authenticated Cross-User Order Read
    it("RULE-002: Authenticated Cross-User Order Read — Customer A cannot read Customer B order", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();
        await assertFails(getDoc(doc(custADb, "orders", "ord-cust-b")));
    });

    // RULE-003 — Direct Client Order Write
    it("RULE-003: Direct Client Order Write — customer cannot directly create or overwrite orders", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();
        await assertFails(
            setDoc(doc(custADb, "orders", "ord-tamper-01"), {
                id: "ord-tamper-01",
                userId: "cust_a",
                total: 1, // Attempting ₹1 price
                paymentStatus: "PAID",
            })
        );
    });

    // RULE-004 — Payment State Manipulation
    it("RULE-004: Payment State Manipulation — customer cannot mark order as PAID", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();
        await assertFails(
            updateDoc(doc(custADb, "orders", "ord-cust-b"), {
                paymentStatus: "PAID",
            })
        );
    });

    // RULE-005 — User Role Escalation & Profile Field Hardening (TASK B)
    it("RULE-005: User Role Escalation — customer cannot modify own profile role to admin", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();

        // First create a legitimate profile
        await assertSucceeds(
            setDoc(doc(custADb, "users", "cust_a"), {
                uid: "cust_a",
                email: "cust_a@example.com",
                role: "customer",
                createdAt: Date.now(),
            })
        );

        // Attempt privilege escalation to admin role
        await assertFails(
            updateDoc(doc(custADb, "users", "cust_a"), {
                role: "admin",
            })
        );
    });

    it("RULE-005B: Profile Field Hardening — customer can update allowed profile fields", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();
        await assertSucceeds(
            setDoc(doc(custADb, "users", "cust_a"), {
                uid: "cust_a",
                email: "cust_a@example.com",
                role: "customer",
                createdAt: Date.now(),
            })
        );

        await assertSucceeds(
            updateDoc(doc(custADb, "users", "cust_a"), {
                displayName: "Alice Customer",
                phone: "+919876543210",
                shippingAddress: "123 Main St, New Delhi, India",
                updatedAt: Date.now(),
            })
        );
    });

    it("RULE-005C: Profile Field Hardening — customer cannot inject arbitrary or privileged fields", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();
        await assertSucceeds(
            setDoc(doc(custADb, "users", "cust_a"), {
                uid: "cust_a",
                email: "cust_a@example.com",
                role: "customer",
                createdAt: Date.now(),
            })
        );

        // Disallowed arbitrary/privilege fields: admin, credits, isEmailVerified, fraudRisk
        await assertFails(
            updateDoc(doc(custADb, "users", "cust_a"), {
                admin: true,
            })
        );
        await assertFails(
            updateDoc(doc(custADb, "users", "cust_a"), {
                credits: 5000,
            })
        );
        await assertFails(
            updateDoc(doc(custADb, "users", "cust_a"), {
                isEmailVerified: true,
            })
        );
    });

    it("RULE-005D: Profile Field Hardening — customer cannot tamper with immutable uid or createdAt", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();
        await assertSucceeds(
            setDoc(doc(custADb, "users", "cust_a"), {
                uid: "cust_a",
                email: "cust_a@example.com",
                role: "customer",
                createdAt: 1000,
            })
        );

        await assertFails(
            updateDoc(doc(custADb, "users", "cust_a"), {
                uid: "cust_b",
            })
        );
        await assertFails(
            updateDoc(doc(custADb, "users", "cust_a"), {
                createdAt: 2000,
            })
        );
    });

    // RULE-006 — Self-Service Profile Creation
    it("RULE-006: Self-Service Profile Creation — customer can create valid profile with role: customer", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();
        await assertSucceeds(
            setDoc(doc(custADb, "users", "cust_a"), {
                uid: "cust_a",
                email: "cust_a@example.com",
                role: "customer",
                createdAt: Date.now(),
            })
        );
    });

    // RULE-007 — Cross-User Profile Access
    it("RULE-007: Cross-User Profile Access — customer cannot read another customer profile", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();
        await assertFails(getDoc(doc(custADb, "users", "cust_b")));
    });

    // RULE-008 — Verified Admin Access
    it("RULE-008: Verified Admin Access — user with custom claim admin: true can read orders and manage catalog", async () => {
        const adminDb = testEnv.authenticatedContext("admin_uid", { admin: true }).firestore();

        // Admin can read any order
        await assertSucceeds(getDoc(doc(adminDb, "orders", "ord-cust-b")));

        // Admin can update product catalog
        await assertSucceeds(
            updateDoc(doc(adminDb, "products", "prod_visible"), {
                price: 2199,
            })
        );
    });

    // RULE-009 — Spoofed Admin Profile
    it("RULE-009: Spoofed Admin Profile — user with role: 'admin' in Firestore document but NO custom claims is DENIED admin operations", async () => {
        // Authenticated as spoofed_admin, but token custom claims do NOT contain { admin: true }
        const spoofedDb = testEnv.authenticatedContext("spoofed_admin").firestore();

        // Attempting to read orders must fail
        await assertFails(getDoc(doc(spoofedDb, "orders", "ord-cust-b")));

        // Attempting to update product catalog must fail
        await assertFails(
            updateDoc(doc(spoofedDb, "products", "prod_visible"), {
                price: 1,
            })
        );
    });

    // RULE-010 — Product Price Manipulation
    it("RULE-010: Product Price Manipulation — normal customer cannot modify product price", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();
        await assertFails(
            updateDoc(doc(custADb, "products", "prod_visible"), {
                price: 10,
            })
        );
    });

    // RULE-010b — Product Variant & Inventory Tampering
    it("RULE-010b: Variant & Inventory Tampering — normal customer cannot modify variants, SKUs, or inventory; admin can", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();
        const adminDb = testEnv.authenticatedContext("admin_uid", { admin: true }).firestore();

        // Customer cannot modify variants array
        await assertFails(
            updateDoc(doc(custADb, "products", "prod_visible"), {
                variants: [{ id: "var_hacked", inventory: 999, price: 1 }],
            })
        );

        // Customer cannot modify inventory directly
        await assertFails(
            updateDoc(doc(custADb, "products", "prod_visible"), {
                inventory: 9999,
            })
        );

        // Admin can update variants and inventory
        await assertSucceeds(
            updateDoc(doc(adminDb, "products", "prod_visible"), {
                variants: [{ id: "var_admin_test", inventory: 20, price: 599, isActive: true }],
                inventory: 20,
            })
        );
    });

    // RULE-011 — Public Catalog Read
    it("RULE-011: Public Catalog Read — unauthenticated customer can read publicly visible product", async () => {
        const unauthDb = testEnv.unauthenticatedContext().firestore();
        await assertSucceeds(getDoc(doc(unauthDb, "products", "prod_visible")));
    });

    // RULE-012 — Hidden Product Query
    it("RULE-012: Hidden Product Query — unauthenticated client cannot read or query hidden products", async () => {
        const unauthDb = testEnv.unauthenticatedContext().firestore();

        // Direct get on hidden product fails
        await assertFails(getDoc(doc(unauthDb, "products", "prod_hidden")));

        // Unfiltered query fails (could expose hidden products)
        await assertFails(getDocs(collection(unauthDb, "products")));

        // Filtered query for isVisible == true succeeds
        const q = query(collection(unauthDb, "products"), where("isVisible", "==", true));
        await assertSucceeds(getDocs(q));
    });

    // RULE-013 — Category Management
    it("RULE-013: Category Management — normal customer cannot write categories; admin can manage", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();
        const adminDb = testEnv.authenticatedContext("admin_uid", { admin: true }).firestore();

        // Customer write denied
        await assertFails(
            setDoc(doc(custADb, "categories", "cat_new"), {
                name: "Shoes",
                order: 2,
            })
        );

        // Admin write allowed
        await assertSucceeds(
            setDoc(doc(adminDb, "categories", "cat_new"), {
                name: "Shoes",
                order: 2,
            })
        );
    });

    // RULE-014 — Coupon Tampering
    it("RULE-014: Coupon Tampering — customer cannot create, modify, or delete coupons", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();

        // Modify discount denied
        await assertFails(
            updateDoc(doc(custADb, "coupons", "SAVE20"), {
                discountValue: 99,
            })
        );

        // Create coupon denied
        await assertFails(
            setDoc(doc(custADb, "coupons", "HACK100"), {
                code: "HACK100",
                discountValue: 100,
            })
        );
    });

    // RULE-015 — Review Collection Privacy & Server-Authoritative Boundary (TASK 022 Hardened)
    it("RULE-015: Review Privacy — anonymous and regular customers CANNOT read reviews directly via client SDK; direct client writes denied", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();
        const adminDb = testEnv.authenticatedContext("admin_uid", { admin: true }).firestore();
        const unauthDb = testEnv.unauthenticatedContext().firestore();

        // 1. Customer attempting direct client SDK review creation FAILS (must use /api/reviews/submit)
        await assertFails(
            setDoc(doc(custADb, "reviews", "rev_cust_a"), {
                id: "rev_cust_a",
                productId: "prod_visible",
                userId: "cust_a",
                userName: "Alice",
                rating: 5,
                comment: "Loved the quality!",
                isFake: false,
                createdAt: Date.now(),
            })
        );

        // 2. Customer cannot submit fake review directly
        await assertFails(
            setDoc(doc(custADb, "reviews", "rev_fake_attempt"), {
                id: "rev_fake_attempt",
                productId: "prod_visible",
                userId: "cust_a",
                rating: 5,
                comment: "Fake review attempt",
                isFake: true,
                createdAt: Date.now(),
            })
        );

        // 3. Customer cannot modify existing reviews directly
        await assertFails(
            updateDoc(doc(custADb, "reviews", "rev_existing"), {
                comment: "Tampered review",
            })
        );

        // 4. Customer cannot delete reviews directly
        await assertFails(
            deleteDoc(doc(custADb, "reviews", "rev_existing"))
        );

        // 5. Unauthenticated client direct read FAILS (prevents leakage of unpublished reviews and private metadata)
        await assertFails(
            getDoc(doc(unauthDb, "reviews", "rev_existing"))
        );

        // 6. Regular customer direct read FAILS (must read via /api/reviews)
        await assertFails(
            getDoc(doc(custADb, "reviews", "rev_existing"))
        );

        // 7. Verified administrator can inspect reviews
        await assertSucceeds(
            getDoc(doc(adminDb, "reviews", "rev_existing"))
        );

        // 8. Direct client SDK writes by administrator FAIL (all moderation must pass through server APIs)
        await assertFails(
            setDoc(doc(adminDb, "reviews", "rev_admin_moderated"), {
                id: "rev_admin_moderated",
                productId: "prod_visible",
                userId: null,
                userName: "Verified Buyer",
                rating: 5,
                comment: "Admin verified review",
                isFake: false,
                createdAt: Date.now(),
            })
        );
    });

    // RULE-015B — Review Import Batches Audit Logs (TASK 022 Hardened)
    it("RULE-015B: Review Import Batches — audit records are read-only for admin; client SDK writes strictly prohibited (TASK 022)", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();
        const adminDb = testEnv.authenticatedContext("admin_uid", { admin: true }).firestore();
        const unauthDb = testEnv.unauthenticatedContext().firestore();

        const testBatchId = "batch_test_022";
        const sampleBatchData = {
            batchId: testBatchId,
            productId: "prod_visible",
            productName: "Visible Product",
            adminUid: "admin_uid",
            createdAt: Date.now(),
            totalSubmitted: 38,
            validEntries: 38,
            rejectedEntries: 0,
            publishedEntries: 38,
            duplicateEntries: 0,
            status: "published",
            errorSummary: [],
        };

        // 1. Unauthenticated access fails completely
        await assertFails(getDoc(doc(unauthDb, "reviewImportBatches", testBatchId)));
        await assertFails(setDoc(doc(unauthDb, "reviewImportBatches", testBatchId), sampleBatchData));

        // 2. Authenticated customer access fails completely
        await assertFails(getDoc(doc(custADb, "reviewImportBatches", testBatchId)));
        await assertFails(setDoc(doc(custADb, "reviewImportBatches", testBatchId), sampleBatchData));

        // 3. Verified administrator can READ audit log
        await assertSucceeds(getDoc(doc(adminDb, "reviewImportBatches", testBatchId)));

        // 4. Direct client SDK writes/updates/deletions by admin FAIL to prevent audit record tampering
        await assertFails(setDoc(doc(adminDb, "reviewImportBatches", "batch_new_attempt"), sampleBatchData));
        await assertFails(updateDoc(doc(adminDb, "reviewImportBatches", testBatchId), { status: "tampered" }));
        await assertFails(deleteDoc(doc(adminDb, "reviewImportBatches", testBatchId)));
    });

    // RULE-016 — Payment Records
    it("RULE-016: Payment Records — browser client cannot read or modify internal paymentRecords", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();
        await assertFails(getDoc(doc(custADb, "paymentRecords", "pay_100")));
        await assertFails(
            setDoc(doc(custADb, "paymentRecords", "pay_forged"), {
                status: "captured",
            })
        );
    });

    // RULE-017 — Webhook Records
    it("RULE-017: Webhook Records — browser client cannot modify paymentWebhookEvents", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();
        await assertFails(
            setDoc(doc(custADb, "paymentWebhookEvents", "evt_forged"), {
                type: "payment.captured",
            })
        );
    });

    // RULE-018 — Rate Limit Counters
    it("RULE-018: Rate Limit Counters — browser client cannot reset or tamper with rateLimits collection", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();
        await assertFails(getDoc(doc(custADb, "rateLimits", "ip:127.0.0.1:orders")));
        await assertFails(
            setDoc(doc(custADb, "rateLimits", "ip:127.0.0.1:orders"), {
                count: 0,
            })
        );
    });

    // RULE-019 — Arbitrary Unknown Collections
    it("RULE-019: Arbitrary Unknown Collections — browser client cannot access unknown or server-only collections", async () => {
        const custADb = testEnv.authenticatedContext("cust_a").firestore();
        await assertFails(getDoc(doc(custADb, "unmatchedPayments", "pay_orphan")));
        await assertFails(getDoc(doc(custADb, "nonExistentSecretCollection", "doc1")));
    });

    // RULE-020 — Query Compatibility
    it("RULE-020: Query Compatibility — authorized application queries succeed and unauthorized listing fails", async () => {
        const unauthDb = testEnv.unauthenticatedContext().firestore();
        const adminDb = testEnv.authenticatedContext("admin_uid", { admin: true }).firestore();

        // 1. Public can read single coupon by code for checkout preview
        await assertSucceeds(getDoc(doc(unauthDb, "coupons", "SAVE20")));

        // 2. Public CANNOT list all coupons (anti-enumeration)
        await assertFails(getDocs(collection(unauthDb, "coupons")));

        // 3. Admin CAN list all coupons
        await assertSucceeds(getDocs(collection(adminDb, "coupons")));

        // 4. Public can read categories collection
        await assertSucceeds(getDocs(collection(unauthDb, "categories")));

        // 5. Admin can query orders list
        const adminOrdersQuery = query(collection(adminDb, "orders"), orderBy("createdAt", "desc"));
        await assertSucceeds(getDocs(adminOrdersQuery));
    });
});
