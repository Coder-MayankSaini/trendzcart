// scripts/check-reservations-task037.mjs
import admin from "firebase-admin";
import { execSync } from "child_process";

const clientEmail = execSync("npx netlify env:get FIREBASE_CLIENT_EMAIL", { encoding: "utf8" }).trim();
const privateKey = execSync("npx netlify env:get FIREBASE_PRIVATE_KEY", { encoding: "utf8" }).trim();

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: "trendkartz",
      clientEmail,
      privateKey: privateKey.replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

async function run() {
  const winterProductIds = [
    "14a29e10-758e-4fd2-a10a-6c04c74fe73a",
    "2a4b51a9-991d-4d62-905e-d0e6cf243879",
    "51adb109-1acb-4f7e-96b7-cdccba9ed961",
    "af7ddaf9-bb61-43fa-846f-22f9b69e4c01",
    "f1b8f647-1b61-4b90-9978-a4f719c5d901",
    "f728d2b8-089c-4cc1-9c7f-2f7fe0f0c3dd",
  ];

  console.log("=== CHECKING RESERVATIONS FOR WINTER PRODUCTS ===");
  const resSnap = await db.collection("inventory_reservations").get().catch(() => ({ empty: true, docs: [] }));
  console.log("Total inventory_reservations:", resSnap.docs?.length || 0);

  const resSnap2 = await db.collection("reservations").get().catch(() => ({ empty: true, docs: [] }));
  console.log("Total reservations:", resSnap2.docs?.length || 0);

  // Check orders containing these items
  console.log("\n=== CHECKING ORDERS FOR WINTER PRODUCTS ===");
  const ordersSnap = await db.collection("orders").get();
  console.log("Total orders in database:", ordersSnap.size);

  let ordersWithWinterProducts = 0;
  ordersSnap.forEach((doc) => {
    const o = doc.data();
    const items = o.items || [];
    const matched = items.filter((item) => winterProductIds.includes(item.id || item.productId));
    if (matched.length > 0) {
      ordersWithWinterProducts++;
      console.log(`Order ${doc.id} (status: ${o.status}) has items:`, matched);
    }
  });
  console.log(`Orders containing Winter Special products: ${ordersWithWinterProducts}`);
}

run().catch(console.error);
