// scripts/dump-six-products.mjs
import admin from "firebase-admin";
import { execSync } from "child_process";
import fs from "fs";

const clientEmail = execSync("npx netlify env:get FIREBASE_CLIENT_EMAIL", { encoding: "utf8" }).trim();
const privateKey = execSync("npx netlify env:get FIREBASE_PRIVATE_KEY", { encoding: "utf8" }).trim();

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: "trendkartz",
    clientEmail,
    privateKey: privateKey.replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n"),
  }),
});

const db = admin.firestore();

async function run() {
  const ids = [
    "14a29e10-758e-4fd2-a10a-6c04c74fe73a",
    "2a4b51a9-991d-4d62-905e-d0e6cf243879",
    "51adb109-1acb-4f7e-96b7-cdccba9ed961",
    "af7ddaf9-bb61-43fa-846f-22f9b69e4c01",
    "f1b8f647-1b61-4b90-9978-a4f719c5d901",
    "f728d2b8-089c-4cc1-9c7f-2f7fe0f0c3dd",
  ];
  const results = [];
  for (const id of ids) {
    const doc = await db.collection("products").doc(id).get();
    if (doc.exists) {
      results.push({ id: doc.id, ...doc.data() });
    }
  }
  fs.writeFileSync("scripts/task037-six-products-snapshot.json", JSON.stringify(results, null, 2));
  console.log("Saved", results.length, "products to scripts/task037-six-products-snapshot.json");
}

run().catch(console.error);
