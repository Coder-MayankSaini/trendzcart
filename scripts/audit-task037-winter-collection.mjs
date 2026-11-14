// scripts/audit-task037-winter-collection.mjs
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

async function runAudit() {
  console.log("=== 1. FETCHING CATEGORIES ===");
  const catsSnap = await db.collection("categories").get();
  const categories = [];
  catsSnap.forEach((doc) => {
    categories.push({ id: doc.id, ...doc.data() });
  });
  console.log(`Found ${categories.length} categories:`);
  for (const c of categories) {
    console.log(`- ID: ${c.id} | Name: "${c.name}" | Slug: "${c.slug || ""}"`);
  }

  console.log("\n=== 2. FETCHING ALL PRODUCTS ===");
  const prodsSnap = await db.collection("products").get();
  console.log(`Found ${prodsSnap.size} total products in production.`);

  const allProducts = [];
  prodsSnap.forEach((doc) => {
    allProducts.push({ id: doc.id, ...doc.data() });
  });

  // Find Winter Collection category ID(s)
  const winterCats = categories.filter(
    (c) =>
      c.name?.toLowerCase().includes("winter") ||
      c.slug?.toLowerCase().includes("winter") ||
      c.id.toLowerCase().includes("winter")
  );
  console.log("\nMatching Winter categories:", winterCats);

  const winterCatIds = new Set(winterCats.map((c) => c.id));
  const winterCatNames = new Set(winterCats.map((c) => c.name?.toLowerCase()));

  // Filter products matching Winter Collection
  const winterProducts = allProducts.filter((p) => {
    const catId = p.categoryId || p.category;
    if (winterCatIds.has(catId) || winterCatIds.has(p.category)) return true;
    if (typeof p.category === "string" && winterCatNames.has(p.category.toLowerCase())) return true;
    if (typeof p.categoryName === "string" && winterCatNames.has(p.categoryName.toLowerCase())) return true;
    return false;
  });

  console.log(`\nFound ${winterProducts.length} products matching Winter Collection.`);

  for (const p of winterProducts) {
    console.log("--------------------------------------------------");
    console.log(`ID: ${p.id}`);
    console.log(`Title: ${p.title || p.name}`);
    console.log(`Slug: ${p.slug || p.handle}`);
    console.log(`SKU: ${p.sku || "N/A"}`);
    console.log(`Category: ${p.category} | CategoryId: ${p.categoryId}`);
    console.log(`Visibility (isVisible): ${p.isVisible}`);
    console.log(`Stock / Inventory: ${p.inventory ?? p.stockQuantity ?? "undefined"}`);
    console.log(`Price: ₹${p.price} | Original: ₹${p.originalPrice}`);
    console.log(`Track Inventory: ${p.trackInventory ?? p.inventoryPolicy ?? "undefined"}`);
    console.log(`Variants count: ${Array.isArray(p.variants) ? p.variants.length : 0}`);
    if (Array.isArray(p.variants) && p.variants.length > 0) {
      console.log("Variants:", JSON.stringify(p.variants, null, 2));
    }
    console.log(`Sizes:`, p.sizes);
    console.log(`Colors:`, p.colors);
    console.log(`Options:`, p.options);
    console.log(`Images count: ${Array.isArray(p.images) ? p.images.length : 0}`);
  }

  // Also print all categories present across all products to see if any other products might belong to winter
  const distinctCategoriesInProducts = new Set();
  allProducts.forEach(p => {
    distinctCategoriesInProducts.add(JSON.stringify({ category: p.category, categoryId: p.categoryId }));
  });
  console.log("\nDistinct Category fields across all products:", Array.from(distinctCategoriesInProducts));

  // Write full raw JSON for winter products to scratch file
  fs.writeFileSync("scripts/winter-products-audit.json", JSON.stringify(winterProducts, null, 2), "utf8");
  console.log("\nWrote scripts/winter-products-audit.json");
}

runAudit().catch(console.error);
