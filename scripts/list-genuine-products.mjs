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
async function getProds() {
    const snap = await db.collection("products").where("isVisible", "==", true).get();
    console.log("=== GENUINE VISIBLE CATALOG PRODUCTS ===");
    console.log("Count:", snap.size);
    for (const doc of snap.docs) {
        const d = doc.data();
        console.log(`- Product ID: ${doc.id}`);
        console.log(`  Name:      ${d.name}`);
        console.log(`  Price:     ₹${d.price}`);
        console.log(`  Inventory: ${d.inventory}`);
        console.log(`  Category:  ${d.category}`);
        console.log(`  Slug:      ${d.slug || "N/A"}`);
    }
}
getProds().catch(console.error);
