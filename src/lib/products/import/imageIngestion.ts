/**
 * Bazaarvilla Shopify-Compatible CSV Bulk Product Import (TASK 030)
 * Secure Cloudflare R2 Remote Image Ingestion Engine
 *
 * Implements strict SSRF protection, IP pinning against DNS rebinding, redirect guards,
 * IPv4-mapped IPv6 detection, magic byte format validation, timeout limits, and content deduplication.
 */

import dns from "dns";
import https from "node:https";
import http from "node:http";
import crypto from "crypto";
import { uploadBufferToR2, getPublicAssetUrl } from "../../storage/r2.ts";

export const MAX_REMOTE_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const IMAGE_FETCH_TIMEOUT_MS = 10000; // 10 seconds
export const MAX_REDIRECT_DEPTH = 3;

export interface IngestImageResult {
    success: boolean;
    originalUrl: string;
    publicUrl?: string;
    storageKey?: string;
    contentType?: string;
    sizeBytes?: number;
    contentHash?: string;
    error?: string;
}

/**
 * Checks if an IPv4 or IPv6 address is in a private, loopback, link-local,
 * cloud metadata, documentation, multicast, broadcast, or reserved range (SSRF defense).
 * Fully handles standard IPv4, standard IPv6, and IPv4-mapped IPv6 (::ffff:x.x.x.x).
 */
export function isPrivateIp(ip: string): boolean {
    if (!ip || typeof ip !== "string") return true;
    const cleanIp = ip.trim().toLowerCase();

    // 1. Handle IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1, ::ffff:169.254.169.254, 0:0:0:0:0:ffff:10.0.0.1)
    if (cleanIp.startsWith("::ffff:") || cleanIp.startsWith("0:0:0:0:0:ffff:")) {
        const lastPart = cleanIp.split(":").pop() || "";
        if (lastPart.includes(".")) {
            return isPrivateIp(lastPart);
        } else {
            // Hex-encoded IPv4 (e.g. ::ffff:7f00:0001)
            const hexParts = cleanIp.replace(/^.*ffff:/, "").split(":");
            if (hexParts.length === 2) {
                const hex1 = parseInt(hexParts[0], 16);
                const hex2 = parseInt(hexParts[1], 16);
                if (!isNaN(hex1) && !isNaN(hex2)) {
                    const ip4 = `${(hex1 >> 8) & 0xff}.${hex1 & 0xff}.${(hex2 >> 8) & 0xff}.${hex2 & 0xff}`;
                    return isPrivateIp(ip4);
                }
            }
        }
        return true; // Malformed mapped address -> fail closed
    }

    // 2. IPv4-compatible IPv6 (deprecated, e.g. ::127.0.0.1)
    if (cleanIp.startsWith("::") && cleanIp.includes(".")) {
        const lastPart = cleanIp.slice(2);
        return isPrivateIp(lastPart);
    }

    // 3. Standard IPv6 checks
    if (
        cleanIp === "::" ||
        cleanIp === "::1" ||
        cleanIp.startsWith("fe80:") || // Link-local (fe80::/10)
        cleanIp.startsWith("fe90:") ||
        cleanIp.startsWith("fea0:") ||
        cleanIp.startsWith("feb0:") ||
        cleanIp.startsWith("fc00:") || // Unique local (fc00::/7)
        cleanIp.startsWith("fd") ||
        cleanIp.startsWith("ff") ||    // Multicast (ff00::/8)
        cleanIp.startsWith("2001:db8:") || // Documentation
        cleanIp.startsWith("100::")    // Discard prefix
    ) {
        return true;
    }

    // 4. Standard IPv4 checks
    const parts = cleanIp.split(".").map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
        // Not a standard dotted-decimal IPv4 address, and not caught by IPv6 -> reject
        return true;
    }

    const [a, b, c, d] = parts;

    // 0.0.0.0/8 (Current network / "this host")
    if (a === 0) return true;
    // 10.0.0.0/8 (Private network)
    if (a === 10) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (Link-local & AWS/GCP/Cloud Metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (Private network: 172.16.0.0 to 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (a === 192 && b === 0 && c === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1 documentation)
    if (a === 192 && b === 0 && c === 2) return true;
    // 192.88.99.0/24 (6to4 Relay Anycast)
    if (a === 192 && b === 88 && c === 99) return true;
    // 192.168.0.0/16 (Private network)
    if (a === 192 && b === 168) return true;
    // 198.18.0.0/15 (Network benchmark testing)
    if (a === 198 && (b === 18 || b === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2 documentation)
    if (a === 198 && b === 51 && c === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3 documentation)
    if (a === 203 && b === 0 && c === 113) return true;
    // 224.0.0.0/4 (Multicast)
    if (a >= 224 && a <= 239) return true;
    // 240.0.0.0/4 (Reserved / Future use)
    if (a >= 240 && a <= 255) return true;
    // 255.255.255.255 (Limited Broadcast)
    if (a === 255 && b === 255 && c === 255 && d === 255) return true;

    return false;
}

/**
 * Pre-flight SSRF check: validates URL scheme, prohibited hostnames, and resolves DNS.
 * Checks that ALL resolved addresses are non-private.
 */
export async function validateRemoteImageUrl(rawUrl: string): Promise<{
    valid: boolean;
    error?: string;
    urlObj?: URL;
    pinnedIp?: string;
    allPinnedIps?: string[];
}> {
    let urlObj: URL;
    try {
        urlObj = new URL(rawUrl);
    } catch {
        return { valid: false, error: `Invalid URL format: '${rawUrl}'` };
    }

    // 1. Protocol must be HTTPS
    if (urlObj.protocol !== "https:") {
        return { valid: false, error: `Insecure protocol '${urlObj.protocol}'. Only HTTPS URLs are permitted.` };
    }

    // 2. Port must be standard 443 (or default/empty)
    const port = urlObj.port ? parseInt(urlObj.port, 10) : 443;
    if (port !== 443) {
        return { valid: false, error: `Prohibited non-standard HTTPS port ${port}. Only port 443 is permitted.` };
    }

    // 3. Reject localhost and local domain names
    const hostname = urlObj.hostname.toLowerCase();
    if (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") ||
        hostname.endsWith(".internal") ||
        hostname.endsWith(".test")
    ) {
        return { valid: false, error: `Forbidden local destination: '${hostname}'` };
    }

    // 4. DNS Resolution: resolve all A and AAAA records
    try {
        const lookupResult = await dns.promises.lookup(hostname, { all: true });
        if (!lookupResult || lookupResult.length === 0) {
            return { valid: false, error: `DNS resolution returned no addresses for '${hostname}'` };
        }

        // If ANY returned address is private/prohibited, reject the entire destination!
        for (const entry of lookupResult) {
            if (isPrivateIp(entry.address)) {
                return {
                    valid: false,
                    error: `SSRF Blocked: Host '${hostname}' resolved to prohibited address (${entry.address}).`,
                };
            }
        }

        // Prioritize IPv4 addresses over IPv6. Serverless runtimes (AWS Lambda, Netlify functions)
        // often do not have outbound IPv6 routing enabled, causing ENETUNREACH socket failures.
        const ipv4Entries = lookupResult.filter(e => e.family === 4);
        const ipv6Entries = lookupResult.filter(e => e.family === 6);
        const candidateIps = [...ipv4Entries.map(e => e.address), ...ipv6Entries.map(e => e.address)];

        if (candidateIps.length === 0) {
            return { valid: false, error: `DNS resolution returned no valid public addresses for '${hostname}'` };
        }

        return {
            valid: true,
            urlObj,
            pinnedIp: candidateIps[0],
            allPinnedIps: candidateIps,
        };
    } catch (err: any) {
        return { valid: false, error: `DNS resolution failed for '${hostname}': ${err.message}` };
    }
}

/**
 * Validates actual binary format using content signatures / magic bytes.
 * Returns normalized MIME type and extension or null if invalid/malicious.
 */
export function detectImageMagicBytes(buffer: Buffer): { contentType: string; ext: string } | null {
    if (!buffer || buffer.length < 12) return null;

    // Check for HTML or XML text signatures (preventing polyglots and XSS)
    const headerStr = buffer.slice(0, 100).toString("utf8").toLowerCase();
    if (
        headerStr.includes("<html") ||
        headerStr.includes("<!doctype html") ||
        headerStr.includes("<body") ||
        headerStr.includes("<script") ||
        headerStr.includes("<svg") ||
        headerStr.includes("<?xml")
    ) {
        return null; // Reject HTML/XML disguised as images
    }

    // 1. JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return { contentType: "image/jpeg", ext: "jpg" };
    }

    // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
    ) {
        return { contentType: "image/png", ext: "png" };
    }

    // 3. WebP: RIFF .... WEBP
    if (
        buffer.slice(0, 4).toString("ascii") === "RIFF" &&
        buffer.slice(8, 12).toString("ascii") === "WEBP"
    ) {
        return { contentType: "image/webp", ext: "webp" };
    }

    // 4. GIF: GIF87a or GIF89a
    const gifHeader = buffer.slice(0, 6).toString("ascii");
    if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
        return { contentType: "image/gif", ext: "gif" };
    }

    return null;
}

function attemptFetchPinnedIp(options: {
    targetUrl: string;
    urlObj: URL;
    pinnedIp: string;
    redirectDepth: number;
}): Promise<{ buffer: Buffer; finalUrl: string; contentType?: string }> {
    const { targetUrl, urlObj, pinnedIp, redirectDepth } = options;

    return new Promise<{ buffer: Buffer; finalUrl: string; contentType?: string }>((resolve, reject) => {
        let isDone = false;
        let timer: NodeJS.Timeout | null = null;
        let clientReq: http.ClientRequest | null = null;

        const cleanup = () => {
            if (timer) clearTimeout(timer);
        };

        const finalizeError = (err: Error) => {
            if (isDone) return;
            isDone = true;
            cleanup();
            if (clientReq) {
                try { clientReq.destroy(); } catch {}
            }
            reject(err);
        };

        // Enforce total connection & download timeout
        timer = setTimeout(() => {
            finalizeError(new Error(`Image fetch timed out after ${IMAGE_FETCH_TIMEOUT_MS}ms`));
        }, IMAGE_FETCH_TIMEOUT_MS);

        try {
            // Connect TCP directly to pinnedIp, while passing original hostname for SNI and Host header
            clientReq = https.request({
                host: pinnedIp, // Direct IP socket connection (zero second DNS lookup!)
                port: 443,
                path: urlObj.pathname + urlObj.search,
                method: "GET",
                headers: {
                    Host: urlObj.host, // Virtual host
                    "User-Agent": "Bazaarvilla-ProductImporter/1.0",
                    Accept: "image/webp,image/jpeg,image/png,image/*;q=0.8",
                    Connection: "close",
                },
                servername: urlObj.hostname, // TLS SNI matches domain for valid cert verification
                timeout: IMAGE_FETCH_TIMEOUT_MS,
            }, (res) => {
                // Redirect Handling
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
                    cleanup();
                    res.resume(); // Discard redirect body
                    const location = res.headers.location;
                    if (!location) {
                        return finalizeError(new Error(`HTTP ${res.statusCode} redirect missing Location header`));
                    }
                    const nextUrl = new URL(location, targetUrl).toString();
                    const nextObj = new URL(nextUrl);
                    if (nextObj.protocol !== "https:") {
                        return finalizeError(new Error(`Redirect attempted downgrade to insecure protocol '${nextObj.protocol}'`));
                    }
                    const nextPort = nextObj.port ? parseInt(nextObj.port, 10) : 443;
                    if (nextPort !== 443) {
                        return finalizeError(new Error(`Redirect to prohibited port ${nextPort}`));
                    }
                    // Recursively fetch with incremented depth
                    return fetchSecureRemoteBuffer(nextUrl, redirectDepth + 1).then(
                        (val) => {
                            if (!isDone) {
                                isDone = true;
                                resolve(val);
                            }
                        },
                        (err) => finalizeError(err)
                    );
                }

                if (res.statusCode !== 200) {
                    cleanup();
                    res.resume();
                    return finalizeError(new Error(`Remote server returned HTTP ${res.statusCode} ${res.statusMessage || ""}`));
                }

                const contentLengthStr = res.headers["content-length"];
                if (contentLengthStr) {
                    const cl = parseInt(contentLengthStr, 10);
                    if (!isNaN(cl) && cl > MAX_REMOTE_IMAGE_SIZE_BYTES) {
                        cleanup();
                        res.destroy();
                        return finalizeError(new Error(`Image Content-Length (${cl} bytes) exceeds 10MB limit`));
                    }
                }

                const chunks: Buffer[] = [];
                let totalBytes = 0;

                res.on("data", (chunk: Buffer) => {
                    totalBytes += chunk.length;
                    if (totalBytes > MAX_REMOTE_IMAGE_SIZE_BYTES) {
                        cleanup();
                        res.destroy();
                        return finalizeError(new Error(`Image stream exceeded 10MB limit during transfer`));
                    }
                    chunks.push(chunk);
                });

                res.on("end", () => {
                    if (isDone) return;
                    isDone = true;
                    cleanup();
                    const buffer = Buffer.concat(chunks);
                    const ct = (res.headers["content-type"] || "application/octet-stream").split(";")[0].trim();
                    resolve({ buffer, finalUrl: targetUrl, contentType: ct });
                });

                res.on("error", (err) => finalizeError(err));
            });

            clientReq.on("timeout", () => {
                finalizeError(new Error(`Socket connection timed out after ${IMAGE_FETCH_TIMEOUT_MS}ms`));
            });

            clientReq.on("error", (err) => finalizeError(err));

            clientReq.end();
        } catch (err: any) {
            finalizeError(err);
        }
    });
}

/**
 * Securely fetches a remote image buffer.
 * PINNED DESTINATION: Connects TCP socket directly to the validated pinned IP address
 * to mathematically prevent DNS rebinding attacks between preflight and connection.
 * Prioritizes IPv4 addresses and fails over between resolved candidate IPs to prevent
 * IPv6 network unreachability errors (ENETUNREACH) in serverless execution environments.
 * Enforces manual redirect tracking, streaming size caps, and socket timeouts.
 */
export async function fetchSecureRemoteBuffer(
    targetUrl: string,
    redirectDepth = 0
): Promise<{ buffer: Buffer; finalUrl: string; contentType?: string }> {
    if (redirectDepth > MAX_REDIRECT_DEPTH) {
        throw new Error(`Exceeded maximum redirect depth (${MAX_REDIRECT_DEPTH})`);
    }

    const validation = await validateRemoteImageUrl(targetUrl);
    if (!validation.valid || !validation.urlObj || !validation.pinnedIp) {
        throw new Error(validation.error || "Prohibited target URL");
    }

    const { urlObj } = validation;
    const candidateIps = (validation.allPinnedIps && validation.allPinnedIps.length > 0)
        ? validation.allPinnedIps
        : [validation.pinnedIp];

    let lastError: Error = new Error(`Failed to connect to image destination at '${targetUrl}'`);

    for (const currentIp of candidateIps) {
        try {
            return await attemptFetchPinnedIp({
                targetUrl,
                urlObj,
                pinnedIp: currentIp,
                redirectDepth,
            });
        } catch (err: any) {
            lastError = err;
            const code = err.code || "";
            // If network unreachable, address family not supported, or connection refused, try next candidate IP
            if (
                code === "ENETUNREACH" ||
                code === "EAFNOSUPPORT" ||
                code === "ECONNREFUSED" ||
                code === "EHOSTUNREACH" ||
                err.message?.includes("timed out")
            ) {
                continue;
            }
            // For fatal errors (HTTP status, size limit, redirect downgrade), fail fast
            throw err;
        }
    }

    throw lastError;
}

/**
 * Ingests a single remote image into Bazaarvilla's Cloudflare R2 storage infrastructure.
 * Deduplicates identical content using SHA-256 hashes.
 */
export async function ingestRemoteProductImage(options: {
    url: string;
    productId: string;
    knownHashes?: Map<string, string>; // hash -> publicUrl
}): Promise<IngestImageResult> {
    const { url, productId, knownHashes } = options;

    if (!url || typeof url !== "string") {
        return { success: false, originalUrl: url || "", error: "Missing image URL" };
    }

    // If already a local Bazaarvilla R2 proxy URL, return as-is without re-ingesting!
    // Stored URLs start with /api/media/public/products/ or use the custom R2 domain.
    // External URLs (like Shopify CDN https://cdn.shopify.com/.../products/...) must NOT be skipped!
    const customDomain = process.env.R2_PUBLIC_DOMAIN || process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN;
    const isLocalR2Url =
        url.startsWith("/api/media/public/products/") ||
        url.startsWith("/api/media/public?key=products/") ||
        (Boolean(customDomain) && url.startsWith(customDomain!.replace(/\/$/, "") + "/products/"));

    if (isLocalR2Url) {
        return {
            success: true,
            originalUrl: url,
            publicUrl: url,
        };
    }

    // Handle data: URIs safely (e.g. fixtures in testing or inline thumbnails)
    if (url.startsWith("data:")) {
        try {
            const matches = url.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return { success: false, originalUrl: url, error: "Malformed data URI" };
            }
            const buffer = Buffer.from(matches[2], "base64");
            const magic = detectImageMagicBytes(buffer);
            if (!magic) {
                return { success: false, originalUrl: url, error: "Invalid data URI image magic bytes" };
            }
            const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
            const storageKey = `products/${productId}/${hash}.${magic.ext}`;
            const uploaded = await uploadBufferToR2({
                buffer,
                key: storageKey,
                contentType: magic.contentType,
            });
            return {
                success: true,
                originalUrl: url,
                publicUrl: uploaded.publicUrl,
                storageKey,
                contentType: magic.contentType,
                sizeBytes: buffer.length,
                contentHash: hash,
            };
        } catch (err: any) {
            return { success: false, originalUrl: url, error: err.message };
        }
    }

    try {
        // 1. Fetch remote image with pinned IP and strict SSRF protections
        const { buffer } = await fetchSecureRemoteBuffer(url);

        // 2. Validate magic bytes
        const magic = detectImageMagicBytes(buffer);
        if (!magic) {
            return {
                success: false,
                originalUrl: url,
                error: "Invalid or unsupported image format. Content does not match valid JPEG, PNG, WebP, or GIF magic bytes, or contains prohibited markup.",
            };
        }

        // 3. Compute SHA-256 content hash for deduplication
        const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);

        // Deduplication check: if image with identical content was already ingested in this run
        if (knownHashes && knownHashes.has(hash)) {
            const existingUrl = knownHashes.get(hash)!;
            return {
                success: true,
                originalUrl: url,
                publicUrl: existingUrl,
                contentType: magic.contentType,
                sizeBytes: buffer.length,
                contentHash: hash,
            };
        }

        // 4. Stable R2 object key: products/{productId}/${hash}.{ext}
        const storageKey = `products/${productId}/${hash}.${magic.ext}`;

        // 5. Upload buffer to Cloudflare R2
        const uploaded = await uploadBufferToR2({
            buffer,
            key: storageKey,
            contentType: magic.contentType,
            metadata: {
                originalUrl: url.slice(0, 200),
                ingestedAt: String(Date.now()),
                productId,
            },
        });

        if (knownHashes) {
            knownHashes.set(hash, uploaded.publicUrl);
        }

        return {
            success: true,
            originalUrl: url,
            publicUrl: uploaded.publicUrl,
            storageKey,
            contentType: magic.contentType,
            sizeBytes: buffer.length,
            contentHash: hash,
        };
    } catch (err: any) {
        return {
            success: false,
            originalUrl: url,
            error: `Image ingestion failed: ${err.message || "Unknown error"}`,
        };
    }
}
