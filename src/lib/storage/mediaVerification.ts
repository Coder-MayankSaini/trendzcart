/**
 * Bazaarvilla Production Media Verification & Integrity Engine (TASK 036)
 *
 * Provides non-false-positive media verification:
 * - Strictly verifies Cloudflare R2 object existence.
 * - Enforces non-empty binary bytes (size > 0).
 * - Enforces allowed binary MIME types (image/jpeg, image/png, image/webp, image/gif).
 * - Strictly REJECTS generic SVG fallbacks and XML/HTML placeholders from being reported as valid.
 * - Decodes and checks magic bytes.
 */

import { verifyObject, extractStorageKey, getR2Client, getR2BucketName, _mockStorage } from "./r2.ts";
import { detectImageMagicBytes } from "../products/import/imageIngestion.ts";
import { GetObjectCommand } from "@aws-sdk/client-s3";

export interface StrictMediaVerificationResult {
    isValid: boolean;
    storageKey: string | null;
    exists: boolean;
    sizeBytes: number;
    contentType: string;
    isSvgFallback: boolean;
    isBinaryImage: boolean;
    error?: string;
}

/**
 * Validates whether a given buffer or content string is the Bazaarvilla placeholder SVG.
 */
export function isPlaceholderSvg(bufferOrText: Buffer | string | null | undefined): boolean {
    if (!bufferOrText) return false;
    const text = typeof bufferOrText === "string" ? bufferOrText : bufferOrText.slice(0, 500).toString("utf8");
    const lower = text.toLowerCase();
    return (
        lower.includes("<svg") &&
        (lower.includes("bazaarvilla image") || lower.includes("fill=\"#f1f5f9\"") || lower.includes("placeholder-image") || lower.includes("placeholder") || lower.includes("no image"))
    );
}

/**
 * Evaluates binary buffer integrity directly (pure unit-testable validation).
 */
export function verifyMediaBuffer(
    buffer: Buffer,
    declaredContentType?: string
): { isValid: boolean; contentType?: string; isSvgFallback: boolean; reason?: string } {
    if (!buffer || buffer.length === 0) {
        return { isValid: false, isSvgFallback: false, reason: "Empty media payload (0 bytes)" };
    }

    if (isPlaceholderSvg(buffer)) {
        return { isValid: false, isSvgFallback: true, reason: "SVG placeholder rejected as valid media" };
    }

    const previewText = buffer.slice(0, 100).toString("utf8").toLowerCase();
    if (previewText.includes("<!doctype html") || previewText.includes("<html") || previewText.includes("<svg")) {
        return { isValid: false, isSvgFallback: previewText.includes("<svg"), reason: "HTML or SVG response detected instead of binary image" };
    }

    const detected = detectImageMagicBytes(buffer);
    if (!detected) {
        return { isValid: false, isSvgFallback: false, reason: "Unsupported or unrecognized binary image format" };
    }

    return {
        isValid: true,
        contentType: detected.contentType,
        isSvgFallback: false,
    };
}

/**
 * Authoritatively verifies a stored media reference in Cloudflare R2 (or mock storage).
 * Ensures the object exists, is binary, non-empty, and NOT a fallback SVG.
 */
export async function verifyStoredMedia(input: string): Promise<StrictMediaVerificationResult> {
    const storageKey = extractStorageKey(input);
    if (!storageKey) {
        return {
            isValid: false,
            storageKey: null,
            exists: false,
            sizeBytes: 0,
            contentType: "",
            isSvgFallback: false,
            isBinaryImage: false,
            error: `Invalid media reference format: '${input}'`,
        };
    }

    try {
        const obj = await verifyObject(storageKey);
        if (!obj.exists) {
            return {
                isValid: false,
                storageKey,
                exists: false,
                sizeBytes: 0,
                contentType: "",
                isSvgFallback: false,
                isBinaryImage: false,
                error: `Object does not exist in R2 storage at key: '${storageKey}'`,
            };
        }

        if (obj.size <= 0) {
            return {
                isValid: false,
                storageKey,
                exists: true,
                sizeBytes: 0,
                contentType: obj.contentType,
                isSvgFallback: false,
                isBinaryImage: false,
                error: `Object in R2 storage is empty (0 bytes): '${storageKey}'`,
            };
        }

        const isSvg = obj.contentType.includes("image/svg+xml");
        if (isSvg) {
            return {
                isValid: false,
                storageKey,
                exists: true,
                sizeBytes: obj.size,
                contentType: obj.contentType,
                isSvgFallback: true,
                isBinaryImage: false,
                error: `False-positive detected: Stored asset is an SVG fallback, not a binary product photograph.`,
            };
        }

        // For thorough verification, inspect actual bytes if available
        let isBinary = false;
        const client = getR2Client();
        if (client) {
            const getCmd = new GetObjectCommand({
                Bucket: getR2BucketName(),
                Key: storageKey,
                Range: "bytes=0-32", // Read first 32 bytes for magic bytes verification
            });
            const getRes = await client.send(getCmd);
            const byteSlice = await getRes.Body?.transformToByteArray();
            if (byteSlice) {
                const magic = detectImageMagicBytes(Buffer.from(byteSlice));
                isBinary = Boolean(magic);
            }
        } else {
            // Mock storage inspection
            const mock = _mockStorage.get(storageKey);
            if (mock && mock.data) {
                const magic = detectImageMagicBytes(mock.data);
                isBinary = Boolean(magic);
            } else if (mock) {
                isBinary = !isSvg && obj.size > 0;
            }
        }

        if (!isBinary) {
            return {
                isValid: false,
                storageKey,
                exists: true,
                sizeBytes: obj.size,
                contentType: obj.contentType,
                isSvgFallback: false,
                isBinaryImage: false,
                error: `Object magic bytes failed validation for JPEG, PNG, or WebP: '${storageKey}'`,
            };
        }

        return {
            isValid: true,
            storageKey,
            exists: true,
            sizeBytes: obj.size,
            contentType: obj.contentType,
            isSvgFallback: false,
            isBinaryImage: true,
        };
    } catch (err: any) {
        return {
            isValid: false,
            storageKey,
            exists: false,
            sizeBytes: 0,
            contentType: "",
            isSvgFallback: false,
            isBinaryImage: false,
            error: `Failed to verify media object: ${err.message || "Unknown error"}`,
        };
    }
}
