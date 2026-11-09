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
    ref,
    uploadBytes,
    getBytes,
} from "firebase/storage";

describe("Cloud Storage Security Rules Integration Tests (rules_version = '2')", () => {
    let testEnv: RulesTestEnvironment;

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
    });

    after(async () => {
        if (testEnv) {
            await testEnv.cleanup();
        }
    });

    beforeEach(async () => {
        await testEnv.clearStorage();

        // Seed initial synthetic assets via privileged context
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const storage = context.storage();

            // 1. Seed public product asset
            const prodRef = ref(storage, "products/prod_100/hero.jpg");
            await uploadBytes(prodRef, Buffer.from("SYNTHETIC_IMAGE_BYTES"), {
                contentType: "image/jpeg",
            });

            // 2. Seed public category asset
            const catRef = ref(storage, "categories/cat_apparel/banner.jpg");
            await uploadBytes(catRef, Buffer.from("SYNTHETIC_CATEGORY_BYTES"), {
                contentType: "image/jpeg",
            });

            // 3. Seed private customer customization
            const customRef = ref(storage, "customizations/custom_existing_photo.jpg");
            await uploadBytes(customRef, Buffer.from("SYNTHETIC_PRIVATE_PHOTO_BYTES"), {
                contentType: "image/jpeg",
            });

            // 4. Seed review asset
            const revRef = ref(storage, "reviews/prod_100/cust_b_review_photo.jpg");
            await uploadBytes(revRef, Buffer.from("SYNTHETIC_REVIEW_PHOTO_BYTES"), {
                contentType: "image/jpeg",
            });
        });
    });

    // STORAGE-001 — Public Catalog Asset Reads
    it("STORAGE-001: Public customers can read legitimately public product assets", async () => {
        const unauthStorage = testEnv.unauthenticatedContext().storage();
        const fileRef = ref(unauthStorage, "products/prod_100/hero.jpg");
        await assertSucceeds(getBytes(fileRef));
    });

    // STORAGE-002 — Unauthenticated Product Upload Blocked
    it("STORAGE-002: Unauthenticated users cannot upload or replace managed product images", async () => {
        const unauthStorage = testEnv.unauthenticatedContext().storage();
        const fileRef = ref(unauthStorage, "products/prod_100/unauth_hack.jpg");
        await assertFails(
            uploadBytes(fileRef, Buffer.from("IMAGE_DATA"), {
                contentType: "image/jpeg",
            })
        );
    });

    // STORAGE-003 — Authenticated Non-Admin Category Upload Blocked
    it("STORAGE-003: Authenticated non-admin customers cannot modify managed category assets", async () => {
        const custStorage = testEnv.authenticatedContext("cust_a").storage();
        const fileRef = ref(custStorage, "categories/cat_apparel/hacked_banner.jpg");
        await assertFails(
            uploadBytes(fileRef, Buffer.from("IMAGE_DATA"), {
                contentType: "image/jpeg",
            })
        );
    });

    // STORAGE-004 — Verified Admin Product Upload Allowed
    it("STORAGE-004: Verified admins can upload allowed product images", async () => {
        const adminStorage = testEnv.authenticatedContext("admin_uid", { admin: true }).storage();
        const fileRef = ref(adminStorage, "products/prod_100/admin_upload.jpg");
        await assertSucceeds(
            uploadBytes(fileRef, Buffer.from("IMAGE_DATA"), {
                contentType: "image/jpeg",
            })
        );
    });

    // STORAGE-005 — Oversized Uploads Rejected
    it("STORAGE-005: Oversized uploads exceeding size limits are rejected", async () => {
        const adminStorage = testEnv.authenticatedContext("admin_uid", { admin: true }).storage();
        // Product limit is 10 MB. Allocate 11 MB buffer.
        const oversizedBuffer = Buffer.alloc(11 * 1024 * 1024);
        const fileRef = ref(adminStorage, "products/prod_100/oversized.jpg");

        await assertFails(
            uploadBytes(fileRef, oversizedBuffer, {
                contentType: "image/jpeg",
            })
        );
    });

    // STORAGE-006 — Unsupported File MIME Types Rejected
    it("STORAGE-006: Unsupported file MIME types (e.g. text/html, exe, scripts) are rejected", async () => {
        const adminStorage = testEnv.authenticatedContext("admin_uid", { admin: true }).storage();
        const fileRef = ref(adminStorage, "products/prod_100/exploit.html");

        await assertFails(
            uploadBytes(fileRef, Buffer.from("<script>alert(1)</script>"), {
                contentType: "text/html",
            })
        );
    });

    // STORAGE-007 — Customer Customizations Read Protected
    it("STORAGE-007: Unauthorized users cannot access another customer private customization files", async () => {
        const custStorage = testEnv.authenticatedContext("cust_a").storage();
        const unauthStorage = testEnv.unauthenticatedContext().storage();

        // Customer cannot read private customizations
        await assertFails(getBytes(ref(custStorage, "customizations/custom_existing_photo.jpg")));

        // Unauthenticated visitor cannot read private customizations
        await assertFails(getBytes(ref(unauthStorage, "customizations/custom_existing_photo.jpg")));

        // Admin CAN read private customizations
        const adminStorage = testEnv.authenticatedContext("admin_uid", { admin: true }).storage();
        await assertSucceeds(getBytes(ref(adminStorage, "customizations/custom_existing_photo.jpg")));
    });

    // STORAGE-008 — Guest Customization Direct Upload Restrictions
    it("STORAGE-008: Guest customization uploads cannot bypass their intended authorization restrictions", async () => {
        const unauthStorage = testEnv.unauthenticatedContext().storage();
        const fileRef = ref(unauthStorage, "customizations/guest_anonymous_upload.jpg");

        // Anonymous unauthenticated upload directly via Storage SDK is denied
        await assertFails(
            uploadBytes(fileRef, Buffer.from("ANONYMOUS_IMAGE"), {
                contentType: "image/jpeg",
            })
        );
    });

    // STORAGE-009 — Overwrite Protection on Customization Paths
    it("STORAGE-009: Users cannot overwrite unrelated users' upload paths", async () => {
        const custStorage = testEnv.authenticatedContext("cust_a").storage();
        const existingRef = ref(custStorage, "customizations/custom_existing_photo.jpg");

        // Overwriting existing resource is denied for non-admin
        await assertFails(
            uploadBytes(existingRef, Buffer.from("OVERWRITE_ATTEMPT"), {
                contentType: "image/jpeg",
            })
        );
    });

    // STORAGE-010 — Review Image Upload Authorization and Restrictions
    it("STORAGE-010: Review image uploads follow their defined authorization and size restrictions", async () => {
        const custAStorage = testEnv.authenticatedContext("cust_a").storage();

        // 1. User cust_a uploads image prefixed with own UID -> ALLOWED
        const validRevRef = ref(custAStorage, "reviews/prod_100/cust_a_1700000_photo.jpg");
        await assertSucceeds(
            uploadBytes(validRevRef, Buffer.from("VALID_PHOTO"), {
                contentType: "image/jpeg",
            })
        );

        // 2. User cust_a attempts to upload with cust_b's UID prefix -> DENIED
        const spoofedRevRef = ref(custAStorage, "reviews/prod_100/cust_b_impersonation.jpg");
        await assertFails(
            uploadBytes(spoofedRevRef, Buffer.from("SPOOFED_PHOTO"), {
                contentType: "image/jpeg",
            })
        );

        // 3. User cust_a uploads oversized review image (>5MB) -> DENIED
        const oversizedRevBuffer = Buffer.alloc(6 * 1024 * 1024);
        const oversizedRevRef = ref(custAStorage, "reviews/prod_100/cust_a_huge.jpg");
        await assertFails(
            uploadBytes(oversizedRevRef, oversizedRevBuffer, {
                contentType: "image/jpeg",
            })
        );
    });
});
