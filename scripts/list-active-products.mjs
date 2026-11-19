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
const snap = await db.collection("products").get();
console.log("=== BAZAARVILLA ACTIVE GENUINE CATALOG ===");
for (const doc of snap.docs) {
  const d = doc.data();
  if (d.archived || d.isVisible === false) continue;
  console.log(`- ${d.name} | Price: ₹${d.price} | Stock: ${d.stock} | Slug: ${d.slug}`);
}
