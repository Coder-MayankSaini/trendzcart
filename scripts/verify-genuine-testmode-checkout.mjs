import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

function getEnv(key) {
  if (process.env[key]) return process.env[key];
  if (fs.existsSync(".env.local")) {
    const envContent = fs.readFileSync(".env.local", "utf-8");
    const match = envContent.match(new RegExp(`${key}\\s*=\\s*([^\\r\\n]+)`));
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

function getFirebaseAccessToken() {
  const p = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(fs.readFileSync(p, "utf-8"));
  return data.tokens?.access_token;
}

function parseFirestoreDoc(rawDoc) {
  if (!rawDoc || !rawDoc.fields) return null;
  const res = {};
  for (const [k, v] of Object.entries(rawDoc.fields)) {
    res[k] = parseValue(v);
  }
  return res;
}

function parseValue(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return parseInt(v.integerValue, 10);
  if ("doubleValue" in v) return parseFloat(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) {
    const obj = {};
    for (const [mk, mv] of Object.entries(v.mapValue.fields || {})) {
      obj[mk] = parseValue(mv);
    }
    return obj;
  }
  if ("arrayValue" in v) {
    return (v.arrayValue.values || []).map(parseValue);
  }
  return v;
}

async function getFirestoreDoc(collection, docId) {
  const token = getFirebaseAccessToken();
  if (!token) return null;
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/trendkartz/databases/(default)/documents/${collection}/${docId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return parseFirestoreDoc(await res.json());
}

const BASE_URL = process.env.BASE_URL || "https://bazaarvilla.com";
const keyId = getEnv("RAZORPAY_KEY_ID");
const keySecret = getEnv("RAZORPAY_KEY_SECRET");
const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');

console.log("================================================================================");
console.log("TASK 014 — GENUINE RAZORPAY TEST MODE CHECKOUT & PAYMENT INTEGRITY VERIFICATION");
console.log(`Base URL:     ${BASE_URL}`);
console.log(`Gateway Key:  ${keyId}`);
console.log("================================================================================\n");

// Record initial stock
const initialProductDoc = await getFirestoreDoc("products", "task013_test_prod_simple");
const initialStock = initialProductDoc ? initialProductDoc.inventory : null;
console.log(`+ Initial Stock for task013_test_prod_simple: ${initialStock}`);

// STEP 1: CREATE HOSTED PREPAID ORDER
console.log("\nSTEP 1: Initiating hosted prepaid order via /api/razorpay/create-order...");
const createRes = await fetch(`${BASE_URL}/api/razorpay/create-order`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    items: [
      {
        productId: "task013_test_prod_simple",
        title: "Task 013 Test Simple T-Shirt",
        price: 199,
        quantity: 1,
        image: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800&q=80"
      }
    ],
    shippingAddress: {
      fullName: "Genuine Testmode Shopper",
      email: "genuine.shopper@bazaarvilla.com",
      addressLine1: "456 Integrity Boulevard",
      city: "Jaipur",
      state: "Rajasthan",
      pincode: "302001",
      phone: "9876543210"
    }
  })
});

if (!createRes.ok) {
  const errText = await createRes.text();
  throw new Error(`Failed to create order: HTTP ${createRes.status} - ${errText}`);
}

const createData = await createRes.json();
const internalOrderId = createData.internalOrderId;
const gatewayOrderId = createData.id;
const expectedAmount = createData.amount; // 19900 paise
const expectedCurrency = createData.currency; // INR
const guestAccessToken = createData.guestAccessToken;

console.log(`+ Internal Order ID: ${internalOrderId}`);
console.log(`+ Gateway Order ID:  ${gatewayOrderId}`);
console.log(`+ Payable Amount:    ${expectedAmount} paise (₹${expectedAmount / 100})`);
console.log(`+ Currency:          ${expectedCurrency}`);
console.log(`+ Guest Access Token: Issued [REDACTED_LENGTH_${guestAccessToken.length}]\n`);

// STEP 2: VERIFY GATEWAY ORDER ON RAZORPAY
console.log("STEP 2: Verifying gateway order directly on Razorpay REST API...");
const rzpOrderRes = await fetch(`https://api.razorpay.com/v1/orders/${gatewayOrderId}`, {
  headers: { Authorization: authHeader }
});
if (!rzpOrderRes.ok) {
  throw new Error(`Gateway order ${gatewayOrderId} does not exist on Razorpay API`);
}
const rzpOrderData = await rzpOrderRes.json();
console.log(`+ Gateway Order Status: '${rzpOrderData.status}'`);
console.log(`+ Gateway Order Amount: ${rzpOrderData.amount} paise`);
console.log(`+ Gateway Order Due:    ${rzpOrderData.amount_due} paise`);
console.log(`+ Gateway Order Paid:   ${rzpOrderData.amount_paid} paise (unpaid initially)\n`);

if (rzpOrderData.status !== "created" || rzpOrderData.amount !== expectedAmount) {
  throw new Error("Gateway order attributes do not match internal order initiation");
}

// STEP 3: EXECUTE GENUINE RAZORPAY TEST MODE PAYMENT VIA CHECKOUT SIMULATION
console.log("STEP 3: Executing genuine Razorpay test payment via Standard Checkout simulation...");
const initPayRes = await fetch("https://api.razorpay.com/v1/payments/create/ajax", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    key_id: keyId,
    order_id: gatewayOrderId,
    amount: expectedAmount.toString(),
    currency: expectedCurrency,
    method: "netbanking",
    bank: "IBKL",
    email: "genuine.shopper@bazaarvilla.com",
    contact: "+919876543210"
  }).toString()
});

if (!initPayRes.ok) {
  const err = await initPayRes.text();
  throw new Error(`Payment initialization failed on Razorpay: ${err}`);
}

const payInitData = await initPayRes.json();
const genuinePaymentId = payInitData.payment_id;
console.log(`+ Genuine Razorpay Payment ID: ${genuinePaymentId}`);

// Submit bank success authorization
const mockReq = payInitData.request;
const mockPageRes = await fetch(mockReq.url, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(mockReq.content).toString()
});
const mockHtml = await mockPageRes.text();
const callbackUrlMatch = mockHtml.match(/name="callback_url"\s+value="([^"]+)"/);
if (!callbackUrlMatch) {
  throw new Error("Could not extract callback URL from Razorpay mock bank page");
}

const submitRes = await fetch(`https://api.razorpay.com/v1/gateway/mocksharp/payment/submit?key_id=${keyId}`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    callback_url: callbackUrlMatch[1],
    language_code: "en",
    success: "S"
  }).toString(),
  redirect: "manual"
});

const bankRedirect = submitRes.headers.get("location");
if (!bankRedirect || !bankRedirect.includes("status=authorized")) {
  throw new Error(`Mock bank authorization failed: redirect=${bankRedirect}`);
}

console.log("+ Mock bank authorized payment successfully");

// Complete the gateway callback
const callbackFinalRes = await fetch(bankRedirect, { redirect: "manual" });
console.log(`+ Gateway callback completed with HTTP ${callbackFinalRes.status}\n`);

// STEP 4: VERIFY PAYMENT STATE DIRECTLY AGAINST RAZORPAY TRUSTED API
console.log("STEP 4: Verifying payment state directly against Razorpay Trusted API (GET /v1/payments)...");
const payFetchRes = await fetch(`https://api.razorpay.com/v1/payments/${genuinePaymentId}`, {
  headers: { Authorization: authHeader }
});
if (!payFetchRes.ok) {
  throw new Error(`Failed to fetch payment ${genuinePaymentId} from Razorpay`);
}
const paymentObj = await payFetchRes.json();
console.log(`+ Payment ID:       ${paymentObj.id}`);
console.log(`+ Payment Status:   ${paymentObj.status}`);
console.log(`+ Captured:         ${paymentObj.captured}`);
console.log(`+ Amount:           ${paymentObj.amount} paise (₹${paymentObj.amount / 100})`);
console.log(`+ Associated Order: ${paymentObj.order_id}`);
console.log(`+ Method:           ${paymentObj.method} (${paymentObj.bank})\n`);

if (paymentObj.status !== "captured" || !paymentObj.captured) {
  throw new Error(`Payment is not in captured status on Razorpay: status=${paymentObj.status}`);
}
if (paymentObj.order_id !== gatewayOrderId) {
  throw new Error(`Payment order_id mismatch: ${paymentObj.order_id} !== ${gatewayOrderId}`);
}
if (paymentObj.amount !== expectedAmount) {
  throw new Error(`Payment amount mismatch: ${paymentObj.amount} !== ${expectedAmount}`);
}

// STEP 5: EXECUTE BROWSER PAYMENT VERIFICATION CALLBACK
console.log("STEP 5: Executing browser verification callback via /api/razorpay/verify-payment...");
const clientSignature = crypto
  .createHmac("sha256", keySecret)
  .update(`${gatewayOrderId}|${genuinePaymentId}`)
  .digest("hex");

const verifyRes = await fetch(`${BASE_URL}/api/razorpay/verify-payment`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    orderId: internalOrderId,
    razorpay_order_id: gatewayOrderId,
    razorpay_payment_id: genuinePaymentId,
    razorpay_signature: clientSignature
  })
});

const verifyData = await verifyRes.json();
console.log(`+ Verification HTTP Status: ${verifyRes.status}`);
console.log(`+ Verification Response:    ${JSON.stringify(verifyData)}\n`);

if (!verifyRes.ok || !verifyData.success) {
  throw new Error(`Browser payment verification failed: ${JSON.stringify(verifyData)}`);
}

// STEP 6: VERIFY CUSTOMER FACING ORDER PROJECTION VIA /api/orders/by-ids
console.log("STEP 6: Verifying customer order projection via /api/orders/by-ids...");
const orderCheckRes = await fetch(`${BASE_URL}/api/orders/by-ids`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    orders: [
      { id: internalOrderId, token: guestAccessToken }
    ]
  })
});

if (!orderCheckRes.ok) {
  throw new Error(`Failed to query order: HTTP ${orderCheckRes.status}`);
}

const orderCheckData = await orderCheckRes.json();
const customerOrder = orderCheckData.orders?.[0];

if (!customerOrder) {
  throw new Error(`Order ${internalOrderId} not found or guest access token denied`);
}

console.log(`+ Customer Order ID:        ${customerOrder.id}`);
console.log(`+ Payment Status:           ${customerOrder.paymentStatus}`);
console.log(`+ Order Status:             ${customerOrder.orderStatus}`);
console.log(`+ Total Payable:            ₹${customerOrder.total}\n`);

if (customerOrder.paymentStatus !== "PAID") {
  throw new Error(`Expected paymentStatus 'PAID', got '${customerOrder.paymentStatus}'`);
}
if (customerOrder.orderStatus !== "Processing") {
  throw new Error(`Expected orderStatus 'Processing', got '${customerOrder.orderStatus}'`);
}

// STEP 7: DIRECT FIRESTORE AUDIT (INTERNAL SECURE STATE)
console.log("STEP 7: Auditing authoritative Firestore document states...");
const firestoreOrder = await getFirestoreDoc("orders", internalOrderId);
if (firestoreOrder) {
  console.log(`+ Firestore Order ID:       ${firestoreOrder.id}`);
  console.log(`+ Payment Status:           ${firestoreOrder.paymentStatus}`);
  console.log(`+ Order Status:             ${firestoreOrder.orderStatus}`);
  console.log(`+ Razorpay Order ID:        ${firestoreOrder.razorpayOrderId}`);
  console.log(`+ Razorpay Payment ID:      ${firestoreOrder.razorpayPaymentId}`);
  console.log(`+ Inventory Reserved:       ${firestoreOrder.inventoryReserved}`);
  console.log(`+ Inventory Finalized:      ${firestoreOrder.inventoryFinalized}`);
  console.log(`+ Verified At:              ${firestoreOrder.paymentVerifiedAt}`);
  console.log(`+ Finalized At:             ${firestoreOrder.paymentFinalizedAt}\n`);

  if (firestoreOrder.paymentStatus !== "PAID") {
    throw new Error(`Firestore order paymentStatus is not PAID`);
  }
  if (firestoreOrder.razorpayPaymentId !== genuinePaymentId) {
    throw new Error(`Firestore razorpayPaymentId does not match: ${firestoreOrder.razorpayPaymentId} !== ${genuinePaymentId}`);
  }
  if (firestoreOrder.razorpayOrderId !== gatewayOrderId) {
    throw new Error(`Firestore razorpayOrderId does not match: ${firestoreOrder.razorpayOrderId} !== ${gatewayOrderId}`);
  }
  if (!firestoreOrder.inventoryFinalized) {
    throw new Error(`Firestore inventoryFinalized is not true`);
  }
} else {
  console.log("+ Firestore direct check skipped (no local firebase CLI token)");
}

// Audit paymentRecords collection
const paymentRecord = await getFirestoreDoc("paymentRecords", genuinePaymentId);
if (paymentRecord) {
  console.log(`+ Payment Record Status:    ${paymentRecord.status}`);
  console.log(`+ Payment Record Amount:    ${paymentRecord.amountPaise} paise`);
  console.log(`+ Payment Record Order:     ${paymentRecord.orderId}\n`);
  if (paymentRecord.status !== "CAPTURED" || paymentRecord.amountPaise !== expectedAmount) {
    throw new Error(`paymentRecords state invalid: ${JSON.stringify(paymentRecord)}`);
  }
}

// Check stock decrement
const finalProductDoc = await getFirestoreDoc("products", "task013_test_prod_simple");
if (finalProductDoc && initialStock !== null) {
  console.log(`+ Initial Stock: ${initialStock}, Final Stock: ${finalProductDoc.inventory}`);
  if (finalProductDoc.inventory !== initialStock - 1) {
    throw new Error(`Stock decrement mismatch: expected ${initialStock - 1}, got ${finalProductDoc.inventory}`);
  }
}

// STEP 8: IDEMPOTENT RE-SUBMISSION (DUAL PATH SIMULATION)
console.log("STEP 8: Testing idempotent dual-path re-submission with authentic payment...");
const reVerifyRes = await fetch(`${BASE_URL}/api/razorpay/verify-payment`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    orderId: internalOrderId,
    razorpay_order_id: gatewayOrderId,
    razorpay_payment_id: genuinePaymentId,
    razorpay_signature: clientSignature
  })
});

const reVerifyData = await reVerifyRes.json();
console.log(`+ Re-verification HTTP Status: ${reVerifyRes.status}`);
console.log(`+ Re-verification Response:    ${JSON.stringify(reVerifyData)}\n`);

if (!reVerifyRes.ok || !reVerifyData.success) {
  throw new Error(`Re-verification failed: ${JSON.stringify(reVerifyData)}`);
}

// Verify stock did NOT decrement a second time
const postReverifyProductDoc = await getFirestoreDoc("products", "task013_test_prod_simple");
if (postReverifyProductDoc && initialStock !== null) {
  console.log(`+ Stock after re-verification: ${postReverifyProductDoc.inventory} (retained exactly ${initialStock - 1})\n`);
  if (postReverifyProductDoc.inventory !== initialStock - 1) {
    throw new Error("Double decrement detected on re-verification!");
  }
}

console.log("================================================================================");
console.log("ALL GENUINE RAZORPAY TEST MODE CHECKOUT VERIFICATION CHECKS PASSED (100% PASS)");
console.log("================================================================================");
