// scripts/verify-production-deployment.mjs
// Verifies live production health on https://bazaarvilla.com after deployment

const BASE_URL = "https://bazaarvilla.com";

const checks = [
  { name: "Public Razorpay Config", path: "/api/razorpay/public-config", expectJson: true, validate: (d) => d.commercialCheckoutEnabled === true && d.keyId?.startsWith("rzp_live_") },
  { name: "Storefront Homepage", path: "/", expectStatus: 200, validateText: (t) => t.includes("bazaarvilla-banner-desktop.webp") && t.includes("bazaarvilla-logo-horizontal.webp") },
  { name: "Storefront Products", path: "/products", expectStatus: 200 },
  { name: "Storefront Checkout", path: "/checkout", expectStatus: 200 },
  { name: "Storefront Terms & Conditions", path: "/terms", expectStatus: 200, validateText: (t) => t.includes("Bazaarvilla") },
  { name: "Storefront Privacy Policy", path: "/privacy", expectStatus: 200, validateText: (t) => t.includes("Bazaarvilla") },
  { name: "Admin Dashboard HTML", path: "/admin/dashboard", expectStatus: 200, validateText: (t) => t.includes("admin") || t.includes("Admin") },
  { name: "Admin Products HTML", path: "/admin/products", expectStatus: 200, validateText: (t) => t.includes("admin") || t.includes("Admin") },
  { name: "Admin Orders HTML", path: "/admin/orders", expectStatus: 200, validateText: (t) => t.includes("admin") || t.includes("Admin") },
  { name: "Admin Categories HTML", path: "/admin/categories", expectStatus: 200, validateText: (t) => t.includes("admin") || t.includes("Admin") },
  { name: "Admin Coupons HTML", path: "/admin/coupons", expectStatus: 200, validateText: (t) => t.includes("admin") || t.includes("Admin") },
  { name: "Brand Horizontal Logo WebP", path: "/brand/bazaarvilla-logo-horizontal.webp", expectStatus: 200 },
  { name: "Brand Desktop Banner WebP", path: "/brand/bazaarvilla-banner-desktop.webp", expectStatus: 200 },
];

async function run() {
  console.log(`Starting live production smoke tests against ${BASE_URL}...`);
  let passed = 0;
  let failed = 0;

  for (const check of checks) {
    try {
      const url = `${BASE_URL}${check.path}`;
      const res = await fetch(url, { headers: { "User-Agent": "Bazaarvilla-Deploy-Verifier/1.0" } });
      
      const expectedStatus = check.expectStatus || 200;
      if (res.status !== expectedStatus) {
        console.error(`❌ [${check.name}] Expected HTTP ${expectedStatus}, got ${res.status}`);
        failed++;
        continue;
      }

      if (check.expectJson) {
        const json = await res.json();
        if (check.validate && !check.validate(json)) {
          console.error(`❌ [${check.name}] JSON validation failed:`, json);
          failed++;
          continue;
        }
        console.log(`✔ [${check.name}] HTTP ${res.status} — validated JSON payload:`, json);
      } else if (check.validateText) {
        const text = await res.text();
        if (!check.validateText(text)) {
          console.error(`❌ [${check.name}] Text validation assertion failed`);
          failed++;
          continue;
        }
        console.log(`✔ [${check.name}] HTTP ${res.status} — text assertion verified`);
      } else {
        console.log(`✔ [${check.name}] HTTP ${res.status} OK`);
      }
      passed++;
    } catch (err) {
      console.error(`❌ [${check.name}] Error:`, err.message);
      failed++;
    }
  }

  console.log(`\n==================================================`);
  console.log(`Production Smoke Test Results: ${passed} PASSED, ${failed} FAILED`);
  console.log(`==================================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

run();
