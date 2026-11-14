// scripts/audit-all-products-inventory.mjs
import admin from "firebase-admin";
import { execSync } from "child_process";
import fs from "fs";

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
  const snap = await db.collection("products").get();
  console.log("Total products:", snap.size);
  const rows = [];
  const fullList = [];
  snap.forEach((doc) => {
    const d = doc.data();
    const variantsCount = Array.isArray(d.variants) ? d.variants.length : (d.variants ? "non-array" : 0);
    const sizesCount = Array.isArray(d.sizesList) ? d.sizesList.length : (Array.isArray(d.sizes) ? d.sizes.length : 0);
    rows.push({
      id: doc.id,
      name: (d.name || d.title || "").substring(0, 30),
      category: d.category,
      isVisible: d.isVisible,
      hasVariants: d.hasVariants,
      variantsCount,
      sizesCount,
      inventory: d.inventory,
      totalPhysicalInventory: d.totalPhysicalInventory,
    });
    fullList.push({ id: doc.id, ...d });
  });

  console.table(rows);
  fs.writeFileSync("scripts/all-products-audit.json", JSON.stringify(fullList, null, 2), "utf8");

  // Summary by category
  const breakdown = {};
  for (const r of rows) {
    const cat = r.category || "Uncategorized";
    if (!breakdown[cat]) breakdown[cat] = { total: 0, hasVariantsTrue: 0, emptyVariants: 0, withVariants: 0 };
    breakdown[cat].total++;
    if (r.hasVariants) {
      breakdown[cat].hasVariantsTrue++;
      if (r.variantsCount === 0) {
        breakdown[cat].emptyVariants++;
      } else {
        breakdown[cat].withVariants++;
      }
    }
  }
  console.log("\nCategory breakdown of variants:");
  console.table(breakdown);
}

run().catch(console.error);
