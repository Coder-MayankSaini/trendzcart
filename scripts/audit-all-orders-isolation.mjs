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

async function auditPendingOrders() {
    console.log("=== AUDITING ALL ORDERS IN FIRESTORE ===");
    const snap = await db.collection("orders").get();
    console.log(`Total orders in Firestore: ${snap.size}`);

    const activePending = [];
    const testModeOrders = [];

    for (const doc of snap.docs) {
        const d = doc.data();
        const isPending = d.reservationReleased === false && d.paymentStatus !== "PAID" && d.paymentMethod === "RAZORPAY";
        if (isPending) {
            activePending.push({ id: doc.id, ...d });
        }
        if (d.razorpayOrderId || d.razorpayPaymentId) {
            testModeOrders.push({
                id: doc.id,
                orderStatus: d.orderStatus,
                paymentStatus: d.paymentStatus,
                razorpayOrderId: d.razorpayOrderId,
                razorpayPaymentId: d.razorpayPaymentId,
                reservationReleased: d.reservationReleased,
                quarantined: d.quarantined
            });
        }
    }

    console.log(`\nActive unreleased RAZORPAY orders (candidates for reservation-cleanup): ${activePending.length}`);
    for (const o of activePending) {
        console.log(` - ID: ${o.id}, Status: ${o.orderStatus}/${o.paymentStatus}, RzpOrder: ${o.razorpayOrderId}, Reserved: ${o.inventoryReserved}, Expires: ${o.reservationExpiresAt}`);
    }

    console.log(`\nAll orders with Razorpay associations: ${testModeOrders.length}`);
    for (const o of testModeOrders) {
        console.log(` - ID: ${o.id}, Status: ${o.orderStatus}/${o.paymentStatus}, RzpOrder: ${o.razorpayOrderId}, RzpPayment: ${o.razorpayPaymentId}, Quarantined: ${o.quarantined}`);
    }
}

auditPendingOrders().catch(console.error);
