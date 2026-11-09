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

async function inspectOrder() {
  const orderId = "371905cc-2a2d-4aa1-a50c-5aec49359b41";
  const orderDoc = await db.collection("orders").doc(orderId).get();
  console.log("=== ORDER DOCUMENT ===");
  console.log(JSON.stringify(orderDoc.data(), null, 2));

  console.log("\n=== PAYMENT RECORDS FOR ORDER ===");
  const payRecords = await db.collection("paymentRecords").where("orderId", "==", orderId).get();
  for (const doc of payRecords.docs) {
    console.log(doc.id, "=>", JSON.stringify(doc.data(), null, 2));
  }

  console.log("\n=== RECENT WEBHOOK EVENTS ===");
  const whSnap = await db.collection("paymentWebhookEvents").orderBy("receivedAt", "desc").limit(5).get();
  for (const doc of whSnap.docs) {
    console.log(doc.id, "=>", JSON.stringify(doc.data(), null, 2));
  }
}

inspectOrder().catch(console.error);
