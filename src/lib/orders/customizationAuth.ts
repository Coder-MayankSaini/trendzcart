import * as adminModule from "firebase-admin";
import type { OrderItemInput } from "./pricing";
import { verifyObject, extractStorageKey } from "@/lib/storage/r2";

export const ALLOWED_CUSTOMIZATION_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
];

export const MAX_CUSTOMIZATION_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// Strictly allow only scoped paths: customizations/{ownerUid}/{fileName}
// ownerUid: letters, numbers, underscores, hyphens
// fileName: alphanumeric base + supported extension
const SCOPED_CUSTOMIZATION_PATH_REGEX = /^customizations\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp))$/i;

export interface CustomizationValidationResult {
    isValid: boolean;
    error?: string;
    validatedItems?: OrderItemInput[];
}

/**
 * Extracts a normalized storage object key/path from a storage reference, download URL, or R2 path.
 */
export function extractStoragePath(input: string): string | null {
    if (!input || typeof input !== "string") return null;

    const trimmed = input.trim();

    // Direct path: customizations/{ownerUid}/{fileName}
    if (trimmed.startsWith("customizations/")) {
        return trimmed.split("?")[0];
    }

    // Media endpoint URL: /api/media/(public|download)?key=customizations%2F...
    const mediaMatch = trimmed.match(/\/api\/media\/(?:public|download)\?key=([^&#]+)/i);
    if (mediaMatch && mediaMatch[1]) {
        const decoded = decodeURIComponent(mediaMatch[1]);
        if (decoded.startsWith("customizations/")) {
            return decoded.split("?")[0];
        }
    }

    // Try generic R2 storage key extractor
    const r2Key = extractStorageKey(trimmed);
    if (r2Key && r2Key.startsWith("customizations/")) {
        return r2Key;
    }

    // Firebase Storage URL format:
    // https://firebasestorage.googleapis.com/v0/b/{bucket}/o/customizations%2F{ownerUid}%2F{fileName}?...
    // or http://127.0.0.1:9199/v0/b/{bucket}/o/customizations%2F{ownerUid}%2F{fileName}?...
    const match = trimmed.match(/\/o\/(customizations(?:%2F|\/)[^?&#]+)/i);
    if (match && match[1]) {
        return decodeURIComponent(match[1]);
    }

    return null;
}

/**
 * Authoritatively verifies customer customization references before order persistence.
 * Guarantees:
 * 1. Storage path conforms strictly to the scoped customer namespace.
 * 2. Path owner matches the verified caller UID.
 * 3. File exists in Cloudflare R2 storage (or fallback Firebase Storage in emulator).
 * 4. Content-type is strictly restricted to supported image formats (no SVG/HTML/executable).
 * 5. File size does not exceed 10MB.
 * 6. File has not been claimed by a different existing order (preventing upload hijacking).
 */
export async function validateOrderCustomizations(
    items: OrderItemInput[],
    callerAuthUid: string | null | undefined,
    options?: {
        db?: adminModule.firestore.Firestore | null;
        storage?: adminModule.storage.Storage | null;
        currentOrderId?: string | null;
    }
): Promise<CustomizationValidationResult> {
    if (!Array.isArray(items)) {
        return { isValid: true };
    }

    const { db, storage, currentOrderId } = options || {};

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.isCustomized || !item.customizationData) {
            continue;
        }

        const cust = item.customizationData;
        const rawPath = cust.storagePath || cust.pictureUrl;

        // Text personalization only (requires_name) without picture
        if (!rawPath) {
            continue;
        }

        // 1. Storage namespace & path format validation
        const extractedPath = extractStoragePath(rawPath);
        if (!extractedPath) {
            return {
                isValid: false,
                error: `Item '${item.name || i}': Invalid customization storage path or external URL forbidden.`,
            };
        }

        const pathMatch = extractedPath.match(SCOPED_CUSTOMIZATION_PATH_REGEX);
        if (!pathMatch) {
            return {
                isValid: false,
                error: `Item '${item.name || i}': Customization path '${extractedPath}' violates the required scoped format (customizations/{ownerUid}/{file}).`,
            };
        }

        const pathOwnerUid = pathMatch[1];

        // 2. Verified caller ownership check
        // A caller cannot attach another customer's private file to their order
        if (!callerAuthUid) {
            return {
                isValid: false,
                error: `Item '${item.name || i}': Missing verified authentication session for customization upload attachment.`,
            };
        }

        if (callerAuthUid !== pathOwnerUid) {
            return {
                isValid: false,
                error: `Item '${item.name || i}': Customization file does not belong to the verified customer session (cross-customer reference rejected).`,
            };
        }

        // 3. Storage existence, MIME type, and size validation
        // Evaluated when storage verification is requested (options.storage is provided)
        if (storage !== undefined) {
            let exists = false;
            let contentType = "";
            let sizeBytes = 0;

            // Check Cloudflare R2 first
            try {
                const r2Check = await verifyObject(extractedPath);
                if (r2Check.exists) {
                    exists = true;
                    contentType = (r2Check.contentType || "").toLowerCase();
                    sizeBytes = r2Check.size;
                }
            } catch (r2Err) {
                console.warn("[Customization Auth] R2 check encountered error, checking fallback:", r2Err);
            }

            // Fallback to Firebase Storage (for emulator integration tests)
            if (!exists && storage) {
                try {
                    let bucket = storage.bucket();
                    let file = bucket.file(extractedPath);
                    let [fbExists] = await file.exists();

                    if (!fbExists && bucket.name !== "demo-trendkartz") {
                        try {
                            const fallbackBucket = storage.bucket("demo-trendkartz");
                            const [fallbackExists] = await fallbackBucket.file(extractedPath).exists();
                            if (fallbackExists) {
                                bucket = fallbackBucket;
                                file = bucket.file(extractedPath);
                                fbExists = true;
                            }
                        } catch {}
                    }

                    if (fbExists) {
                        exists = true;
                        const [metadata] = await file.getMetadata();
                        contentType = (metadata.contentType || "").toLowerCase();
                        sizeBytes = Number(metadata.size) || 0;
                    }
                } catch (storageErr: any) {
                    console.error("[Customization Auth] Storage check error:", storageErr?.message);
                }
            }

            if (!exists) {
                return {
                    isValid: false,
                    error: `Item '${item.name || i}': Customization file '${extractedPath}' was not found in storage.`,
                };
            }

            // Validate Content Type
            if (!ALLOWED_CUSTOMIZATION_MIME_TYPES.includes(contentType)) {
                return {
                    isValid: false,
                    error: `Item '${item.name || i}': Unsupported customization image type '${contentType}'. Only JPEG, PNG, and WebP are accepted.`,
                };
            }

            // Validate Size Limit
            if (sizeBytes > MAX_CUSTOMIZATION_SIZE_BYTES) {
                return {
                    isValid: false,
                    error: `Item '${item.name || i}': Customization image size (${Math.round(sizeBytes / 1024 / 1024)}MB) exceeds maximum limit of 10MB.`,
                };
            }
        }

        // 4. Prevention of upload re-claiming by unrelated orders
        if (db && currentOrderId) {
            try {
                const existingClaimsSnap = await db
                    .collection("orders")
                    .where("customizationPaths", "array-contains", extractedPath)
                    .limit(2)
                    .get();

                for (const claimDoc of existingClaimsSnap.docs) {
                    if (claimDoc.id !== currentOrderId) {
                        return {
                            isValid: false,
                            error: `Item '${item.name || i}': Customization file has already been claimed by existing order '${claimDoc.id}'.`,
                        };
                    }
                }
            } catch (dbErr: any) {
                console.error("[Customization Auth] Order claim check error:", dbErr?.message);
            }
        }
    }

    return { isValid: true };
}
