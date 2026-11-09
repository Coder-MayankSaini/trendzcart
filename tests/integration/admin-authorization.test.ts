import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { adminAuth, adminDb } from "../../src/lib/firebase/admin.ts";
import { verifyAdminRequest } from "../../src/lib/auth/adminAuth.ts";
import { getSyntheticUserAuthToken } from "./testHelper.ts";

describe("Admin Authorization & Custom Claims Verification (Firebase Auth)", () => {
    const adminUid = "admin_verified_test_user";
    const customerUid = "customer_normal_test_user";
    const spoofedUid = "customer_spoofed_firestore_admin";

    before(async () => {
        if (!adminAuth || !adminDb) {
            throw new Error("adminAuth/adminDb not initialized");
        }

        // 1. Create or clean test users in Auth Emulator
        try { await adminAuth.deleteUser(adminUid); } catch {}
        try { await adminAuth.deleteUser(customerUid); } catch {}
        try { await adminAuth.deleteUser(spoofedUid); } catch {}

        await adminAuth.createUser({
            uid: adminUid,
            email: "admin@trendkartz.test",
            displayName: "Store Administrator",
        });

        await adminAuth.createUser({
            uid: customerUid,
            email: "customer@trendkartz.test",
            displayName: "Normal Customer",
        });

        await adminAuth.createUser({
            uid: spoofedUid,
            email: "spoofed@trendkartz.test",
            displayName: "Attacker Spoofed Admin",
        });

        // Assign admin custom claim exclusively to adminUid
        await adminAuth.setCustomUserClaims(adminUid, { admin: true });

        // Ensure customer and spoofed users have NO admin claim
        await adminAuth.setCustomUserClaims(customerUid, {});
        await adminAuth.setCustomUserClaims(spoofedUid, {});

        // In Firestore, create documents where spoofedUid claims role: "admin"
        await adminDb.collection("users").doc(adminUid).set({
            uid: adminUid,
            email: "admin@trendkartz.test",
            role: "admin",
            createdAt: Date.now(),
        });

        await adminDb.collection("users").doc(customerUid).set({
            uid: customerUid,
            email: "customer@trendkartz.test",
            role: "customer",
            createdAt: Date.now(),
        });

        await adminDb.collection("users").doc(spoofedUid).set({
            uid: spoofedUid,
            email: "spoofed@trendkartz.test",
            role: "admin", // ATTEMPTED SPOOF IN FIRESTORE
            createdAt: Date.now(),
        });
    });

    it("should authorize a request bearing a verified admin custom claim", async () => {
        const idToken = await getSyntheticUserAuthToken(adminUid);
        const result = await verifyAdminRequest(`Bearer ${idToken}`);

        assert.equal(result.isAdmin, true);
        assert.equal(result.uid, adminUid);
        assert.equal(result.email, "admin@trendkartz.test");
        assert.equal(result.error, undefined);
    });

    it("should REJECT a normal customer without admin custom claim", async () => {
        const idToken = await getSyntheticUserAuthToken(customerUid);
        const result = await verifyAdminRequest(`Bearer ${idToken}`);

        assert.equal(result.isAdmin, false);
        assert.equal(result.uid, customerUid);
        assert.match(result.error || "", /admin custom claim required/i);
    });

    it("FAIL-CLOSED: should REJECT a spoofed Firestore document role: 'admin' when ID token lacks claim", async () => {
        const idToken = await getSyntheticUserAuthToken(spoofedUid);
        const result = await verifyAdminRequest(`Bearer ${idToken}`);

        assert.equal(
            result.isAdmin,
            false,
            "User with role: 'admin' in Firestore MUST NOT be authorized if custom claims lack admin: true"
        );
        assert.match(result.error || "", /admin custom claim required/i);
    });

    it("should fail-closed on missing or malformed Authorization headers", async () => {
        const resMissing = await verifyAdminRequest(null);
        assert.equal(resMissing.isAdmin, false);
        assert.match(resMissing.error || "", /Missing or malformed Authorization header/i);

        const resMalformed = await verifyAdminRequest("Basic some_token");
        assert.equal(resMalformed.isAdmin, false);
        assert.match(resMalformed.error || "", /Missing or malformed Authorization header/i);

        const resInvalid = await verifyAdminRequest("Bearer invalid.fake.token");
        assert.equal(resInvalid.isAdmin, false);
        assert.match(resInvalid.error || "", /Invalid or expired admin token/i);
    });

    it("should safely provision and revoke admin custom claims using manage-admin-claims.mjs", async () => {
        const testTargetUid = "claims_script_test_target";
        try { await adminAuth!.deleteUser(testTargetUid); } catch {}
        await adminAuth!.createUser({
            uid: testTargetUid,
            email: "target@trendkartz.test",
        });

        // Set existing unrelated claim to ensure preservation
        await adminAuth!.setCustomUserClaims(testTargetUid, { betaTester: true });

        // 1. Dry run grant: verify nothing committed
        const dryRunOutput = execSync(
            `node scripts/manage-admin-claims.mjs --uid ${testTargetUid} --action grant --dry-run`,
            { env: process.env }
        ).toString();
        assert.match(dryRunOutput, /DRY-RUN COMPLETE/i);

        let user = await adminAuth!.getUser(testTargetUid);
        assert.equal(user.customClaims?.admin, undefined, "Dry run must not apply claims");
        assert.equal(user.customClaims?.betaTester, true, "Existing claims must be intact");

        // 2. Real grant
        const grantOutput = execSync(
            `node scripts/manage-admin-claims.mjs --uid ${testTargetUid} --action grant`,
            { env: process.env }
        ).toString();
        assert.match(grantOutput, /Successfully set custom claim/i);

        user = await adminAuth!.getUser(testTargetUid);
        assert.equal(user.customClaims?.admin, true, "Admin claim must be set");
        assert.equal(user.customClaims?.betaTester, true, "Unrelated claims must be preserved");

        // Verify Firestore profile synchronized
        const profileSnap = await adminDb!.collection("users").doc(testTargetUid).get();
        assert.equal(profileSnap.data()?.role, "admin");

        // 3. Real revoke
        const revokeOutput = execSync(
            `node scripts/manage-admin-claims.mjs --uid ${testTargetUid} --action revoke`,
            { env: process.env }
        ).toString();
        assert.match(revokeOutput, /Successfully revoked admin claim/i);

        user = await adminAuth!.getUser(testTargetUid);
        assert.equal(user.customClaims?.admin, undefined, "Admin claim must be removed");
        assert.equal(user.customClaims?.betaTester, true, "Unrelated claims must still be preserved");

        // Verify Firestore profile updated to customer
        const profileSnapRevoked = await adminDb!.collection("users").doc(testTargetUid).get();
        assert.equal(profileSnapRevoked.data()?.role, "customer");
    });
});
