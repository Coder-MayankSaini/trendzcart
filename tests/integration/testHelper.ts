import { NextRequest } from "next/server";
import * as adminModule from "firebase-admin";
import { SYNTHETIC_PRODUCTS } from "../fixtures/products.ts";
import { adminAuth } from "../../src/lib/firebase/admin.ts";

const admin = (adminModule as any).default || adminModule;
import { SYNTHETIC_COUPONS } from "../fixtures/coupons.ts";

/**
 * Seeds synthetic products and coupons into the emulated Firestore.
 */
export async function seedEmulatorDatabase(db: admin.firestore.Firestore): Promise<void> {
    const batch = db.batch();

    // 1. Seed Products
    for (const [id, product] of Object.entries(SYNTHETIC_PRODUCTS)) {
        const ref = db.collection("products").doc(id);
        batch.set(ref, { ...product });
    }

    // 2. Seed Coupons
    for (const [code, coupon] of Object.entries(SYNTHETIC_COUPONS)) {
        const ref = db.collection("coupons").doc(code);
        batch.set(ref, {
            ...coupon,
            expiryDate: coupon.expiryDate ? admin.firestore.Timestamp.fromDate(new Date(coupon.expiryDate)) : null,
        });
    }

    await batch.commit();
}

/**
 * Cleans all documents from a given collection in emulated Firestore.
 */
export async function clearCollection(db: admin.firestore.Firestore, collectionName: string): Promise<void> {
    const snapshot = await db.collection(collectionName).get();
    if (snapshot.empty) return;

    const batch = db.batch();
    for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
    }
    await batch.commit();
}

/**
 * Creates a NextRequest instance suitable for testing Next.js Route Handlers.
 */
export function createJsonPostRequest(url: string, payload: any, headers: Record<string, string> = {}): NextRequest {
    const request = new Request(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...headers,
        },
        body: JSON.stringify(payload),
    });

    return new NextRequest(request);
}

/**
 * Creates a PATCH NextRequest instance suitable for testing Next.js Route Handlers.
 */
export function createJsonPatchRequest(url: string, payload: any, headers: Record<string, string> = {}): NextRequest {
    const request = new Request(url, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            ...headers,
        },
        body: JSON.stringify(payload),
    });

    return new NextRequest(request);
}

/**
 * Exchanges a Firebase Admin custom token for a genuine Firebase ID token
 * against the local Auth Emulator REST endpoint.
 */
export async function getSyntheticUserAuthToken(uid: string): Promise<string> {
    if (!adminAuth) {
        throw new Error("adminAuth is not initialized");
    }
    const customToken = await adminAuth.createCustomToken(uid);
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
    const cleanHost = authHost.replace(/^https?:\/\//, "");

    const res = await fetch(`http://${cleanHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });

    const data = await res.json();
    if (!data.idToken) {
        throw new Error(`Failed to exchange custom token for ID token: ${JSON.stringify(data)}`);
    }
    return data.idToken as string;
}
