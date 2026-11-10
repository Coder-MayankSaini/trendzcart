import crypto from 'crypto';

const BASE_URL = 'https://bazaarvilla.com';

const EXPECTED_R2 = {
    'products/82b5c865-3128-4515-96e5-80f7f0eed58e/f1a40980-e3d8-4f8f-9a58-e6eecf506695.png': {
        size: 1002951,
        sha256: '7bd1d620d0377a0059f4520c7b694fec0cf23d2cff0c2ea32e90de3ce93dc01a',
        label: 'Product Image [0] (Featured/Cover)'
    },
    'products/82b5c865-3128-4515-96e5-80f7f0eed58e/5c3046d4-c644-4d10-9fe0-ccbb2a61055d.png': {
        size: 870439,
        sha256: '2d3a10ccbe6e0f0c2c2f05021f6e05d25b91a22995b4509e8e2827e3d8491666',
        label: 'Product Image [1]'
    },
    'products/82b5c865-3128-4515-96e5-80f7f0eed58e/272e2e2d-b304-4d68-99cc-7fe6de3772a1.png': {
        size: 1041390,
        sha256: 'bb9409d77021e47d58c10782f550a8dffe690ea21986f6e875b826818ce36056',
        label: 'Product Image [2]'
    },
    'products/82b5c865-3128-4515-96e5-80f7f0eed58e/0e6147c7-d5bf-47a9-982c-6d564c0c3568.png': {
        size: 927605,
        sha256: 'cbc64da9f8109fa52636bd1d3ce4b48793c6c1625d37c760d6fce2af71397dd0',
        label: 'Product Image [3]'
    },
    'products/82b5c865-3128-4515-96e5-80f7f0eed58e/50d254ff-38e7-4a1a-954a-78eb583ba335.png': {
        size: 937142,
        sha256: 'a7c202a3c755f4a9499bf71a8fdfeed49d60a071e9fd9ec27edddcc1c1bb3457',
        label: 'Product Image [4]'
    },
    'categories/cd3e7259-51bc-420d-ac4c-2afa7d8fafa6/231ffa35-ceb3-4460-a06f-dd800c18a268.png': {
        size: 462816,
        sha256: 'ffb3d65533b756f79e9b76c5b73f12bea295362937f225ce56e81ff3c0200af9',
        label: 'Personalized Jewelry Category Image'
    }
};

async function testUrl(url, expected) {
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    const status = res.status;
    const contentType = res.headers.get('content-type');
    const cacheControl = res.headers.get('cache-control');
    const netlifyVary = res.headers.get('netlify-vary');
    const buf = await res.arrayBuffer();
    const bytes = buf.byteLength;
    const hash = crypto.createHash('sha256').update(Buffer.from(buf)).digest('hex');

    const sizeMatch = expected ? bytes === expected.size : null;
    const hashMatch = expected ? hash === expected.sha256 : null;

    return {
        url,
        status,
        contentType,
        cacheControl,
        netlifyVary,
        bytes,
        hash,
        sizeMatch,
        hashMatch
    };
}

async function run() {
    console.log('================================================================================');
    console.log('BAZAARVILLA — LIVE PRODUCTION MEDIA VERIFICATION');
    console.log(`Target: ${BASE_URL}`);
    console.log('================================================================================\n');

    console.log('1. PATH-BASED ENDPOINTS (/api/media/public/[...key]):');
    const pathResults = [];
    for (const [key, expected] of Object.entries(EXPECTED_R2)) {
        const url = `${BASE_URL}/api/media/public/${key}`;
        const res = await testUrl(url, expected);
        pathResults.push(res);
        const pass = res.status === 200 && res.sizeMatch && res.hashMatch;
        console.log(`[${pass ? 'PASS' : 'FAIL'}] ${expected.label}`);
        console.log(`  URL:         ${url}`);
        console.log(`  HTTP:        ${res.status} | Content-Type: ${res.contentType}`);
        console.log(`  Bytes:       ${res.bytes} (Expected: ${expected.size}) -> ${res.sizeMatch ? 'MATCH' : 'MISMATCH'}`);
        console.log(`  SHA-256:     ${res.hash}`);
        console.log(`  Hash Match:  ${res.hashMatch ? 'EXACT MATCH' : 'MISMATCH'}`);
        console.log(`  Cache-Ctrl:  ${res.cacheControl}`);
        console.log();
    }

    console.log('2. DISTINCTNESS VERIFICATION ACROSS ALL 5 PRODUCT IMAGES:');
    const productHashes = pathResults.slice(0, 5).map(r => r.hash);
    const uniqueHashes = new Set(productHashes);
    console.log(`  Total product images tested: ${productHashes.length}`);
    console.log(`  Unique SHA-256 hashes:        ${uniqueHashes.size}`);
    console.log(`  Result: ${uniqueHashes.size === 5 ? '100% DISTINCT — ZERO DUPLICATION' : 'DUPLICATION DETECTED'}\n`);

    console.log('3. CATEGORY ISOLATION VERIFICATION:');
    const catResult = pathResults[5];
    const isCatDistinctFromAllProducts = !productHashes.includes(catResult.hash);
    console.log(`  Category hash: ${catResult.hash}`);
    console.log(`  Matches any product image? ${!isCatDistinctFromAllProducts}`);
    console.log(`  Result: ${isCatDistinctFromAllProducts ? '100% ISOLATED' : 'CROSS-ENTITY SHARING DETECTED'}\n`);

    console.log('4. NON-EXISTENT KEY REJECTION CHECK:');
    const notFoundUrl = `${BASE_URL}/api/media/public/products/nonexistent-item/fake.png`;
    const nfRes = await testUrl(notFoundUrl, null);
    console.log(`  URL:    ${notFoundUrl}`);
    console.log(`  Status: ${nfRes.status} (Expected: 404) -> ${nfRes.status === 404 ? 'PASS' : 'FAIL'}`);
    console.log(`  Bytes:  ${nfRes.bytes}`);
    console.log();

    console.log('5. UNAUTHORIZED NAMESPACE REJECTION (PRIVATE CUSTOMIZATION):');
    const privUrl = `${BASE_URL}/api/media/public/customizations/user123/private-photo.png`;
    const privRes = await testUrl(privUrl, null);
    console.log(`  URL:    ${privUrl}`);
    console.log(`  Status: ${privRes.status} (Expected: 403) -> ${privRes.status === 403 ? 'PASS' : 'FAIL'}`);
    console.log();

    console.log('6. LEGACY QUERY-BASED ENDPOINT BACKWARD COMPATIBILITY:');
    const legacyUrl = `${BASE_URL}/api/media/public?key=products%2F82b5c865-3128-4515-96e5-80f7f0eed58e%2F5c3046d4-c644-4d10-9fe0-ccbb2a61055d.png`;
    const legRes = await testUrl(legacyUrl, EXPECTED_R2['products/82b5c865-3128-4515-96e5-80f7f0eed58e/5c3046d4-c644-4d10-9fe0-ccbb2a61055d.png']);
    console.log(`  URL:         ${legacyUrl}`);
    console.log(`  Status:      ${legRes.status}`);
    console.log(`  Bytes:       ${legRes.bytes} -> ${legRes.sizeMatch ? 'MATCH' : 'MISMATCH'}`);
    console.log(`  Hash:        ${legRes.hash}`);
    console.log(`  Hash Match:  ${legRes.hashMatch ? 'MATCH' : 'MISMATCH'}`);
    console.log(`  Vary Header: ${legRes.netlifyVary || 'None'}`);
    console.log();

    console.log('7. COMMERCIAL CHECKOUT GATE & PUBLIC CONFIG CHECK:');
    const configRes = await fetch(`${BASE_URL}/api/razorpay/public-config`);
    const configData = await configRes.json();
    console.log('  /api/razorpay/public-config response:', configData);
    console.log(`  commercialCheckoutEnabled: ${configData.commercialCheckoutEnabled} -> ${configData.commercialCheckoutEnabled === true ? 'PASS' : 'FAIL'}`);
    console.log(`  keyId:                     ${configData.keyId} -> ${configData.keyId === 'rzp_live_Ty8CuwoSSBGpHi' ? 'PASS (LIVE KEY)' : 'FAIL'}`);
    console.log('================================================================================');
}

run().catch(console.error);
