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
async function inspect() {
    const snap = await db.collection("products").get();
    console.log(`Total products: ${snap.size}`);
    for (const doc of snap.docs) {
        const d = doc.data();
        console.log(`--- Product ${doc.id} ---`);
        console.log(`  Name: ${d.name}`);
        console.log(`  isVisible: ${d.isVisible}, isFeatured: ${d.isFeatured}, archived: ${d.archived || d.isArchived}`);
        console.log(`  images:`, d.images);
        console.log(`  thumbnails:`, d.thumbnails);
    }
}
inspect().catch(console.error);
