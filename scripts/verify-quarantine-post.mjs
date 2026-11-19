import admin from "firebase-admin";
import { execSync } from "child_process";

const clientEmail = execSync("npx netlify env:get FIREBASE_CLIENT_EMAIL", { encoding: "utf8" }).trim();
const privateKey = execSync("npx netlify env:get FIREBASE_PRIVATE_KEY", { encoding: "utf8" }).trim();

admin.initializeApp({
    credential: admin.credential.cert({
        projectId: "trendkartz",
        clientEmail,
        privateKey: privateKey.replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n"),
    })
});

const db = admin.firestore();
const orderIds = [
    "c39xYbGgIFZ7OeCogOLs",
    "VCRIyEYOL9Qs9kXO3q0l",
    "9zZ9yDaKxacS5ZyYdFMO",
    "E1TSDrDBpbiKRLRoBljf",
    "ZgX60mkrfy8bYPVG5xAr",
    "MBbquzz08LpVNZqqUTSt",
    "DV0JKWgs60V8lUvGEv5u"
];

async function check() {
    console.log("=== QUARANTINE POST-EXECUTION VERIFICATION ===");
    for (const id of orderIds) {
        const doc = await db.collection("orders").doc(id).get();
        const d = doc.data();
        const payDoc = await db.collection("paymentRecords").doc(d.razorpayPaymentId).get();
        const pd = payDoc.data();
        console.log(`Order ${id}: orderStatus="${d.orderStatus}", paymentStatus="${d.paymentStatus}", quarantined=${d.quarantined}, released=${d.reservationReleased} | PaymentRecord ${d.razorpayPaymentId}: status="${pd?.status}", quarantined=${pd?.quarantined}`);
    }

    // Verify catalog stock of task013_test_prod_simple is still 46
    const prodDoc = await db.collection("products").doc("task013_test_prod_simple").get();
    console.log(`Product task013_test_prod_simple inventory: ${prodDoc.data()?.inventory} (Expected: 46)`);
}

check().catch(console.error);
