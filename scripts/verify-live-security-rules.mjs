import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, getDocs, setDoc, collection } from "firebase/firestore";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import admin from "firebase-admin";
import { execSync } from "child_process";

const clientEmail = execSync("npx netlify env:get FIREBASE_CLIENT_EMAIL", { encoding: "utf8" }).trim();
const privateKey = execSync("npx netlify env:get FIREBASE_PRIVATE_KEY", { encoding: "utf8" }).trim();
const apiKey = execSync("npx netlify env:get NEXT_PUBLIC_FIREBASE_API_KEY", { encoding: "utf8" }).trim();
const projectId = "trendkartz";

// Initialize Admin for minting test tokens
admin.initializeApp({
    credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n"),
    })
});

const firebaseConfig = {
    apiKey,
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: `${projectId}.appspot.com`,
};

async function run() {
    console.log("=== VERIFYING LIVE FIRESTORE SECURITY RULES (STEPS 4 & 5) ===");

    // 1. Anonymous Client Checks
    console.log("\n[Test Suite 1] Anonymous Direct Client SDK Access:");
    const anonApp = initializeApp(firebaseConfig, "anonApp");
    const anonDb = getFirestore(anonApp);

    try {
        await getDoc(doc(anonDb, "reviews", "28d46bac-1d88-4f1e-a963-9fb93fff322e"));
        console.error("FAIL: Anonymous direct getDoc on /reviews was permitted!");
        process.exit(1);
    } catch (err) {
        console.log("PASS: Anonymous direct getDoc on /reviews denied:", err.code);
    }

    try {
        await getDocs(collection(anonDb, "reviews"));
        console.error("FAIL: Anonymous direct list on /reviews was permitted!");
        process.exit(1);
    } catch (err) {
        console.log("PASS: Anonymous direct list on /reviews denied:", err.code);
    }

    try {
        await getDoc(doc(anonDb, "reviewImportBatches", "dummy-batch-id"));
        console.error("FAIL: Anonymous direct getDoc on /reviewImportBatches was permitted!");
        process.exit(1);
    } catch (err) {
        console.log("PASS: Anonymous direct getDoc on /reviewImportBatches denied:", err.code);
    }

    try {
        await getDocs(collection(anonDb, "reviewImportBatches"));
        console.error("FAIL: Anonymous direct list on /reviewImportBatches was permitted!");
        process.exit(1);
    } catch (err) {
        console.log("PASS: Anonymous direct list on /reviewImportBatches denied:", err.code);
    }

    try {
        await setDoc(doc(anonDb, "reviews", "tamper-review-id"), { rating: 5 });
        console.error("FAIL: Anonymous direct setDoc on /reviews was permitted!");
        process.exit(1);
    } catch (err) {
        console.log("PASS: Anonymous direct setDoc on /reviews denied:", err.code);
    }

    // 2. Authenticated Non-Admin Customer Checks
    console.log("\n[Test Suite 2] Authenticated Non-Admin Customer Client SDK Access:");
    const custApp = initializeApp(firebaseConfig, "custApp");
    const custAuth = getAuth(custApp);
    const custDb = getFirestore(custApp);

    const testCustUid = "customer_security_test_" + Date.now();
    const custCustomToken = await admin.auth().createCustomToken(testCustUid, { role: "customer" });
    await signInWithCustomToken(custAuth, custCustomToken);
    console.log("Signed in as customer UID:", custAuth.currentUser?.uid);

    try {
        await getDoc(doc(custDb, "reviews", "28d46bac-1d88-4f1e-a963-9fb93fff322e"));
        console.error("FAIL: Non-admin customer direct getDoc on /reviews was permitted!");
        process.exit(1);
    } catch (err) {
        console.log("PASS: Non-admin customer direct getDoc on /reviews denied:", err.code);
    }

    try {
        await getDocs(collection(custDb, "reviews"));
        console.error("FAIL: Non-admin customer direct list on /reviews was permitted!");
        process.exit(1);
    } catch (err) {
        console.log("PASS: Non-admin customer direct list on /reviews denied:", err.code);
    }

    try {
        await getDoc(doc(custDb, "reviewImportBatches", "dummy-batch-id"));
        console.error("FAIL: Non-admin customer direct getDoc on /reviewImportBatches was permitted!");
        process.exit(1);
    } catch (err) {
        console.log("PASS: Non-admin customer direct getDoc on /reviewImportBatches denied:", err.code);
    }

    try {
        await setDoc(doc(custDb, "reviews", "tamper-review-id"), { rating: 5 });
        console.error("FAIL: Non-admin customer direct setDoc on /reviews was permitted!");
        process.exit(1);
    } catch (err) {
        console.log("PASS: Non-admin customer direct setDoc on /reviews denied:", err.code);
    }

    // 3. Admin Client Write Safeguards
    console.log("\n[Test Suite 3] Admin Client SDK Safeguards (Direct writes must be blocked):");
    const adminApp = initializeApp(firebaseConfig, "adminApp");
    const adminClientAuth = getAuth(adminApp);
    const adminClientDb = getFirestore(adminApp);

    const adminUid = "jdi97hwEJQYt5NXoUhyISOpW7Hl1";
    const adminCustomToken = await admin.auth().createCustomToken(adminUid, { admin: true });
    await signInWithCustomToken(adminClientAuth, adminCustomToken);
    console.log("Signed in as admin UID:", adminClientAuth.currentUser?.uid);

    // Admin direct read should be permitted (since allow read: if isAdmin())
    try {
        const snap = await getDoc(doc(adminClientDb, "reviews", "28d46bac-1d88-4f1e-a963-9fb93fff322e"));
        console.log("PASS: Admin direct read on /reviews permitted (doc exists:", snap.exists(), ")");
    } catch (err) {
        console.error("FAIL: Admin direct read failed:", err);
        process.exit(1);
    }

    // Admin direct writes to /reviews must be DENIED (allow write: if false)
    try {
        await setDoc(doc(adminClientDb, "reviews", "tamper-review-id"), { rating: 5 });
        console.error("FAIL: Admin direct client write to /reviews was permitted!");
        process.exit(1);
    } catch (err) {
        console.log("PASS: Admin direct client write to /reviews denied:", err.code);
    }

    // Admin direct writes to /reviewImportBatches must be DENIED (allow write: if false)
    try {
        await setDoc(doc(adminClientDb, "reviewImportBatches", "tamper-batch-id"), { status: "tampered" });
        console.error("FAIL: Admin direct client write to /reviewImportBatches was permitted!");
        process.exit(1);
    } catch (err) {
        console.log("PASS: Admin direct client write to /reviewImportBatches denied:", err.code);
    }

    // Clean up temporary user
    try {
        await admin.auth().deleteUser(testCustUid);
    } catch {}

    console.log("\n============================================================");
    console.log("ALL LIVE SECURITY RULES CHECKS PASSED WITH 100% SUCCESS!");
    console.log("Direct client access is strictly denied; privacy & audit logs are protected.");
    console.log("============================================================");
}

run().catch((err) => {
    console.error("Fatal verification error:", err);
    process.exit(1);
});
