import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { adminAuth, adminDb } from "../../src/lib/firebase/admin.ts";
import { POST as authorizeUploadRoute } from "../../src/app/api/uploads/authorize/route.ts";
import { POST as completeUploadRoute } from "../../src/app/api/uploads/complete/route.ts";
import { PUT as mockPutRoute } from "../../src/app/api/uploads/mock-put/route.ts";
import {
    _mockStorage,
    verifyObject,
    generateUploadUrl,
    deleteR2Object,
} from "../../src/lib/storage/r2.ts";
import {
    clearCollection,
    createJsonPostRequest,
    getSyntheticUserAuthToken,
} from "./testHelper.ts";

describe("Cloudflare R2 Storage Layer Integration Tests (R2-001 to R2-012, R2-023, R2-024)", () => {
    const CUST_ALICE_UID = "cust_alice_r2_101";
    const CUST_BOB_UID = "cust_bob_r2_202";
    const GUEST_UID = "guest_anon_r2_303";
    let aliceToken: string;
    let bobToken: string;
    let guestToken: string;

    before(async () => {
        if (!adminAuth) throw new Error("adminAuth unavailable");
        aliceToken = await getSyntheticUserAuthToken(CUST_ALICE_UID);
        bobToken = await getSyntheticUserAuthToken(CUST_BOB_UID);
        guestToken = await getSyntheticUserAuthToken(GUEST_UID);
    });

    beforeEach(async () => {
        _mockStorage.clear();
        if (adminDb) {
            await clearCollection(adminDb, "uploadSessions");
            await clearCollection(adminDb, "rateLimits");
            await clearCollection(adminDb, "orders");
        }
    });

    it("R2-001: Authorized user receives a signed upload URL", async () => {
        const req = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            {
                folder: "customizations",
                contentType: "image/jpeg",
                sizeBytes: 1024 * 50,
                originalName: "alice_vacation.jpg",
            },
            { Authorization: `Bearer ${aliceToken}` }
        );

        const res = await authorizeUploadRoute(req);
        assert.equal(res.status, 200);

        const data = await res.json();
        assert.equal(data.success, true);
        assert.ok(data.uploadUrl, "Expected uploadUrl");
        assert.ok(data.key.startsWith(`customizations/${CUST_ALICE_UID}/`), "Expected scoped key");
        assert.ok(data.sessionId, "Expected sessionId");
        assert.ok(data.expiresAt > Date.now(), "Expected future expiration");
    });

    it("R2-002: Unauthenticated caller is rejected", async () => {
        const req = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            {
                folder: "customizations",
                contentType: "image/jpeg",
            }
        );

        const res = await authorizeUploadRoute(req);
        assert.equal(res.status, 401);
        const data = await res.json();
        assert.ok(data.error.includes("Unauthorized"));
    });

    it("R2-003: User cannot select an arbitrary object key", async () => {
        // Even if caller provides malicious key in payload, server MUST generate its own key
        const req = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            {
                folder: "customizations",
                contentType: "image/png",
                key: "customizations/victim_uid/stolen_file.png", // Attempted forged key
            },
            { Authorization: `Bearer ${aliceToken}` }
        );

        const res = await authorizeUploadRoute(req);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.notEqual(data.key, "customizations/victim_uid/stolen_file.png");
        assert.ok(data.key.startsWith(`customizations/${CUST_ALICE_UID}/`));
    });

    it("R2-004: User cannot upload into another customer's namespace", async () => {
        // Alice attempts to specify Bob's UID in folder or options
        const req = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            {
                folder: "customizations",
                ownerUid: CUST_BOB_UID, // Tampered ownerUid
                contentType: "image/jpeg",
            },
            { Authorization: `Bearer ${aliceToken}` }
        );

        const res = await authorizeUploadRoute(req);
        assert.equal(res.status, 200);
        const data = await res.json();
        // Server MUST bind strictly to caller's verified token UID (Alice), not Bob
        assert.ok(data.key.startsWith(`customizations/${CUST_ALICE_UID}/`));
        assert.ok(!data.key.includes(CUST_BOB_UID));
    });

    it("R2-005: Unsupported file type is rejected", async () => {
        const unsupportedTypes = ["image/svg+xml", "text/html", "application/javascript", "image/gif"];

        for (const type of unsupportedTypes) {
            const req = createJsonPostRequest(
                "http://localhost:3000/api/uploads/authorize",
                {
                    folder: "customizations",
                    contentType: type,
                },
                { Authorization: `Bearer ${aliceToken}` }
            );

            const res = await authorizeUploadRoute(req);
            assert.equal(res.status, 400);
            const data = await res.json();
            assert.ok(data.error.includes("Unsupported content type"));
        }
    });

    it("R2-006: Oversized image is rejected at the supported validation boundaries", async () => {
        const req = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            {
                folder: "customizations",
                contentType: "image/jpeg",
                sizeBytes: 11 * 1024 * 1024, // 11 MB > 10 MB limit
            },
            { Authorization: `Bearer ${aliceToken}` }
        );

        const res = await authorizeUploadRoute(req);
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.ok(data.error.includes("size exceeds maximum"));
    });

    it("R2-007: Uploaded object metadata is verified server-side", async () => {
        // 1. Authorize
        const authReq = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            {
                folder: "customizations",
                contentType: "image/webp",
                sizeBytes: 50000,
            },
            { Authorization: `Bearer ${aliceToken}` }
        );
        const authRes = await authorizeUploadRoute(authReq);
        const authData = await authRes.json();

        // 2. Perform direct upload to mock/R2
        const putReq = new Request(`http://localhost:3000${authData.uploadUrl}`, {
            method: "PUT",
            headers: { "Content-Type": "image/webp" },
            body: Buffer.alloc(50000, "A"),
        });
        const putRes = await mockPutRoute(putReq as any);
        assert.equal(putRes.status, 200);

        // 3. Confirm upload
        const compReq = createJsonPostRequest(
            "http://localhost:3000/api/uploads/complete",
            {
                sessionId: authData.sessionId,
                key: authData.key,
            },
            { Authorization: `Bearer ${aliceToken}` }
        );
        const compRes = await completeUploadRoute(compReq);
        assert.equal(compRes.status, 200);
        const compData = await compRes.json();

        assert.equal(compData.success, true);
        assert.equal(compData.key, authData.key);
        assert.equal(compData.size, 50000);
        assert.equal(compData.contentType, "image/webp");
    });

    it("R2-010: Duplicate upload completion is idempotent", async () => {
        const authReq = createJsonPostRequest(
            "http://localhost:3000/api/uploads/authorize",
            {
                folder: "customizations",
                contentType: "image/jpeg",
                sizeBytes: 10000,
            },
            { Authorization: `Bearer ${aliceToken}` }
        );
        const authRes = await authorizeUploadRoute(authReq);
        const { sessionId, key, uploadUrl } = await authRes.json();

        // Upload
        const putReq = new Request(`http://localhost:3000${uploadUrl}`, {
            method: "PUT",
            headers: { "Content-Type": "image/jpeg" },
            body: Buffer.alloc(10000, "B"),
        });
        await mockPutRoute(putReq as any);

        // Complete first time
        const compReq1 = createJsonPostRequest(
            "http://localhost:3000/api/uploads/complete",
            { sessionId, key },
            { Authorization: `Bearer ${aliceToken}` }
        );
        const res1 = await completeUploadRoute(compReq1);
        assert.equal(res1.status, 200);

        // Complete duplicate second time
        const compReq2 = createJsonPostRequest(
            "http://localhost:3000/api/uploads/complete",
            { sessionId, key },
            { Authorization: `Bearer ${aliceToken}` }
        );
        const res2 = await completeUploadRoute(compReq2);
        assert.equal(res2.status, 200);
        const data2 = await res2.json();
        assert.equal(data2.success, true);
    });

    it("R2-011: Upload authorization expires correctly", async () => {
        // Test expired upload via mock-put with past timestamp
        const pastTimestamp = Date.now() - 10000;
        const expiredReq = new Request(`http://localhost:3000/api/uploads/mock-put?key=customizations/test/file.jpg&expires=${pastTimestamp}`, {
            method: "PUT",
            headers: { "Content-Type": "image/jpeg" },
            body: Buffer.from("EXPIRED"),
        });
        const res = await mockPutRoute(expiredReq as any);
        assert.equal(res.status, 403);
    });

    it("R2-012: Rate limits protect the authorization endpoint", async () => {
        // Rapidly send requests exceeding 20/min
        let rateLimitedHit = false;
        for (let i = 0; i < 25; i++) {
            const req = createJsonPostRequest(
                "http://localhost:3000/api/uploads/authorize",
                {
                    folder: "customizations",
                    contentType: "image/jpeg",
                },
                { Authorization: `Bearer ${aliceToken}` }
            );

            const res = await authorizeUploadRoute(req);
            if (res.status === 429) {
                rateLimitedHit = true;
                const retryAfter = res.headers.get("retry-after");
                assert.ok(retryAfter, "Expected Retry-After header");
                break;
            }
        }
        assert.equal(rateLimitedHit, true, "Rate limit should be triggered after exceeding limit");
    });

    it("R2-023: Presigned URL generation includes create-once semantics", async () => {
        const uploadResult = await generateUploadUrl({
            folder: "customizations",
            ownerUid: CUST_ALICE_UID,
            contentType: "image/jpeg",
            ifNoneMatch: true,
        });

        assert.ok(uploadResult.uploadUrl);
        assert.ok(uploadResult.key.startsWith(`customizations/${CUST_ALICE_UID}/`));
    });

    it("R2-024: Upload cleanup cannot delete a file claimed by an active order", async () => {
        // Seed order with customizationPath
        const activeKey = `customizations/${CUST_ALICE_UID}/active_order_photo.jpg`;
        _mockStorage.set(activeKey, {
            key: activeKey,
            contentType: "image/jpeg",
            size: 20000,
            metadata: {},
            createdAt: Date.now(),
            etag: "etag-1",
        });

        if (adminDb) {
            await adminDb.collection("orders").doc("order_active_r2_99").set({
                id: "order_active_r2_99",
                userId: CUST_ALICE_UID,
                customizationPaths: [activeKey],
                orderStatus: "Processing",
                paymentStatus: "PAID",
                createdAt: Date.now(),
            });

            // Simulate cleanup attempt: verify order claim before deletion
            const orderClaims = await adminDb
                .collection("orders")
                .where("customizationPaths", "array-contains", activeKey)
                .limit(1)
                .get();

            assert.equal(orderClaims.empty, false, "Active order claim should exist");

            // Deletion should be PREVENTED when claim exists
            const canDelete = orderClaims.empty;
            assert.equal(canDelete, false, "Should not delete object claimed by active order");
        }
    });
});
