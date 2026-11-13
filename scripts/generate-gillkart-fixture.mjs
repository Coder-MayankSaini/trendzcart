import fs from "node:fs";

// Load the 28 products from Gillkart JSON
const products = JSON.parse(fs.readFileSync("tests/fixtures/gillkart-products.json", "utf8"));

const headers = [
    "Handle",
    "Title",
    "Body (HTML)",
    "Vendor",
    "Product Category",
    "Type",
    "Tags",
    "Published",
    "Option1 Name",
    "Option1 Value",
    "Option2 Name",
    "Option2 Value",
    "Option3 Name",
    "Option3 Value",
    "Variant SKU",
    "Variant Grams",
    "Variant Inventory Tracker",
    "Variant Inventory Qty",
    "Variant Inventory Policy",
    "Variant Fulfillment Service",
    "Variant Price",
    "Variant Compare At Price",
    "Variant Requires Shipping",
    "Variant Taxable",
    "Variant Barcode",
    "Image Src",
    "Image Position",
    "Image Alt Text",
    "Gift Card",
    "SEO Title",
    "SEO Description",
    "Google Shopping / Google Product Category",
    "Google Shopping / Gender",
    "Google Shopping / Age Group",
    "Google Shopping / MPN",
    "Google Shopping / AdWords Grouping",
    "Google Shopping / AdWords Labels",
    "Google Shopping / Condition",
    "Google Shopping / Custom Product",
    "Google Shopping / Custom Label 0",
    "Google Shopping / Custom Label 1",
    "Google Shopping / Custom Label 2",
    "Google Shopping / Custom Label 3",
    "Google Shopping / Custom Label 4",
    "Variant Image",
    "Variant Weight Unit",
    "Variant Tax Code",
    "Cost per item"
];

function escapeCsvCell(val) {
    if (val === undefined || val === null) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

const rows = [];
rows.push(headers.map(escapeCsvCell).join(","));

let productCount = 0;
let totalImages = 0;
let additionalImageRows = 0;

for (const p of products) {
    productCount++;
    const v = p.variants?.[0] || {};
    const firstImg = p.images?.[0];
    if (firstImg) totalImages++;

    const parentRow = [
        p.handle,
        p.title,
        p.body_html || "",
        p.vendor || "Gillkart",
        "", // Product Category
        p.product_type || "Home Decor",
        (p.tags || []).join(", "),
        "true", // Published
        p.options?.[0]?.name || "Title",
        v.option1 || "Default Title",
        p.options?.[1]?.name || "",
        v.option2 || "",
        p.options?.[2]?.name || "",
        v.option3 || "",
        v.sku || "",
        v.grams || 500,
        "shopify", // Variant Inventory Tracker
        1, // Variant Inventory Qty = 1
        "deny",
        "manual",
        v.price || "0.00",
        v.compare_at_price || "",
        "true", // Requires shipping
        "true", // Taxable
        v.barcode || "",
        firstImg ? firstImg.src : "",
        firstImg ? 1 : "",
        firstImg?.alt || "",
        "false", // Gift card
        "", // SEO Title
        "", // SEO Description
        "", "", "", "", "", "", "", "", "", "", "", "", "", // Google Shopping
        "", // Variant Image
        "g", // Variant Weight Unit
        "", // Variant Tax Code
        ""  // Cost per item
    ];
    rows.push(parentRow.map(escapeCsvCell).join(","));

    // Additional image-only rows
    if (p.images && p.images.length > 1) {
        for (let j = 1; j < p.images.length; j++) {
            totalImages++;
            additionalImageRows++;
            const img = p.images[j];
            const imgRow = [
                p.handle,
                "", // Title
                "", // Body
                "", // Vendor
                "", // Product Category
                "", // Type
                "", // Tags
                "", // Published
                "", "", "", "", "", "", // Options
                "", // Variant SKU
                "", // Grams
                "", // Inventory Tracker
                "", // Inventory Qty
                "", // Policy
                "", // Service
                "", // Price
                "", // Compare At Price
                "", // Requires Shipping
                "", // Taxable
                "", // Barcode
                img.src,
                j + 1, // Image Position
                img.alt || "",
                "", // Gift Card
                "", "", "", "", "", "", "", "", "", "", "", "", "", "", // SEO & Google Shopping
                "", // Variant Image
                "", // Variant Weight Unit
                "", // Variant Tax Code
                ""  // Cost per item
            ];
            rows.push(imgRow.map(escapeCsvCell).join(","));
        }
    }
}

// 61st row: Shopify Spy promotional footer row
const promoFooterRow = [
    "shopify-spy-export",
    "Shopify Spy - Export Shopify Products to CSV (https://shopifyspy.com)",
    "Exported using Shopify Spy Chrome Extension. Upgrade to Pro for unlimited exports.",
    "Shopify Spy",
    "", "", "", "false",
    "", "", "", "", "", "",
    "", "", "", "", "", "", "", "", "", "", "",
    "", "", "", "", "", "",
    "", "", "", "", "", "", "", "", "", "", "", "", "",
    "", "", "", ""
];
rows.push(promoFooterRow.map(escapeCsvCell).join(","));

const csvOutput = rows.join("\r\n");

fs.writeFileSync("shopify_products_www-gillkart-com.csv", csvOutput, "utf8");
fs.writeFileSync("tests/fixtures/shopify_products_www-gillkart-com.csv", csvOutput, "utf8");

console.log("Generated CSV fixture:");
console.log("- Total Columns:", headers.length);
console.log("- Total Products:", productCount);
console.log("- Total Images:", totalImages);
console.log("- Additional Image Rows:", additionalImageRows);
console.log("- Total Data Rows (including promo footer):", rows.length - 1);
