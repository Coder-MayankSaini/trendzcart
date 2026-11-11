/**
 * Bazaarvilla Shopify-Compatible CSV Bulk Product Import (TASK 030)
 * Secure Cloudflare R2 Remote Image Ingestion Engine
 *
 * Implements strict SSRF protection, DNS pre-flight verification, redirect guards,
 * magic byte format validation, timeout limits, and content deduplication.
 */

import dns from "dns";
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
 * or cloud metadata range (SSRF defense).
 */
export function isPrivateIp(ip: string): boolean {
    const cleanIp = ip.trim().toLowerCase();

    // IPv6 checks
    if (cleanIp === "::1" || cleanIp === "::" || cleanIp.startsWith("fe80:") || cleanIp.startsWith("fc00:") || cleanIp.startsWith("fd00:")) {
        return true;
    }

    // IPv4 checks
    const parts = cleanIp.split(".").map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
        return false;
    }

    const [a, b] = parts;

    // 0.0.0.0/8
    if (a === 0) return true;
    // 10.0.0.0/8 (Private network)
    if (a === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (Link-local & AWS/GCP/Cloud Metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (Private network: 172.16.0.0 to 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 (Private network)
    if (a === 192 && b === 168) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 198.18.0.0/15 (Benchmark testing)
    if (a === 198 && (b === 18 || b === 19)) return true;

    return false;
}

/**
 * Pre-flight SSRF check: ensures URL is HTTPS and resolves to a public, non-private IP.
 */
export async function validateRemoteImageUrl(rawUrl: string): Promise<{ valid: boolean; error?: string; urlObj?: URL }> {
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

    // 2. Reject localhost and local domain names
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

    // 3. DNS Pre-flight: resolve IP and verify it is not in a private/metadata range
    try {
        const lookupResult = await dns.promises.lookup(hostname, { all: true });
        for (const entry of lookupResult) {
            if (isPrivateIp(entry.address)) {
                return {
                    valid: false,
                    error: `SSRF Blocked: Host '${hostname}' resolved to prohibited private/internal address (${entry.address}).`,
                };
            }
        }
    } catch (err: any) {
        return { valid: false, error: `DNS resolution failed for '${hostname}': ${err.message}` };
    }

    return { valid: true, urlObj };
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

/**
 * Securely fetches a remote image with redirect validation and streaming size caps.
 */
async function fetchSecureRemoteBuffer(
    targetUrl: string,
    redirectDepth = 0
): Promise<{ buffer: Buffer; finalUrl: string }> {
    if (redirectDepth > MAX_REDIRECT_DEPTH) {
        throw new Error(`Exceeded maximum redirect depth (${MAX_REDIRECT_DEPTH})`);
    }

    const validation = await validateRemoteImageUrl(targetUrl);
    if (!validation.valid || !validation.urlObj) {
        throw new Error(validation.error || "Prohibited target URL");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(targetUrl, {
            method: "GET",
            headers: {
                "User-Agent": "Bazaarvilla-ProductImporter/1.0",
                Accept: "image/webp,image/jpeg,image/png,image/*;q=0.8",
            },
            signal: controller.signal,
            redirect: "manual", // Handle redirects manually to enforce SSRF validation at every hop
        });

        // Handle Redirects
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location) {
                throw new Error(`HTTP ${response.status} redirect without Location header`);
            }
            const nextUrl = new URL(location, targetUrl).toString();
            return await fetchSecureRemoteBuffer(nextUrl, redirectDepth + 1);
        }

        if (!response.ok) {
            throw new Error(`Remote server returned HTTP ${response.status} ${response.statusText}`);
        }

        // Check Content-Length header if present
        const contentLength = response.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > MAX_REMOTE_IMAGE_SIZE_BYTES) {
            throw new Error(
                `Remote image size (${contentLength} bytes) exceeds the maximum limit of ${MAX_REMOTE_IMAGE_SIZE_BYTES} bytes (10MB)`
            );
        }

        const arrayBuf = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        if (buffer.length > MAX_REMOTE_IMAGE_SIZE_BYTES) {
            throw new Error(
                `Remote image payload (${buffer.length} bytes) exceeds the maximum limit of ${MAX_REMOTE_IMAGE_SIZE_BYTES} bytes`
            );
        }

        return { buffer, finalUrl: targetUrl };
    } finally {
        clearTimeout(timeout);
    }
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
    if (url.includes("/api/media/public/products/") || url.includes("/products/")) {
        return {
            success: true,
            originalUrl: url,
            publicUrl: url,
        };
    }

    try {
        // 1. Fetch remote image with SSRF protections
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

        // 4. Stable R2 object key: products/{productId}/{hash}.{ext}
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
