if (typeof window !== 'undefined') {
    throw new Error('This module can only be executed in a server environment.');
}
import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

export const ALLOWED_IMAGE_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
];

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const DEFAULT_PRESIGNED_UPLOAD_EXPIRY = 900; // 15 minutes
export const DEFAULT_PRESIGNED_DOWNLOAD_EXPIRY = 3600; // 1 hour

// Memory store for mock/emulator mode when R2 credentials are not set
interface MockObject {
    key: string;
    contentType: string;
    size: number;
    metadata: Record<string, string>;
    data?: Buffer;
    createdAt: number;
    etag: string;
}

const mockObjectStorage = new Map<string, MockObject>();

/**
 * Accessor for mock storage, used by test assertions and local emulation.
 */
export const _mockStorage = {
    get: (key: string) => mockObjectStorage.get(key),
    set: (key: string, obj: MockObject) => mockObjectStorage.set(key, obj),
    has: (key: string) => mockObjectStorage.has(key),
    delete: (key: string) => mockObjectStorage.delete(key),
    clear: () => mockObjectStorage.clear(),
    all: () => Array.from(mockObjectStorage.entries()),
};

/**
 * Check if Cloudflare R2 credentials are fully configured.
 */
export function isR2Configured(): boolean {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucketName = process.env.R2_BUCKET_NAME;

    return Boolean(accountId && accessKeyId && secretAccessKey && bucketName);
}

export function getR2BucketName(): string {
    return process.env.R2_BUCKET_NAME || 'bazaarvilla-media';
}

export function getR2PublicDomain(): string | undefined {
    return process.env.R2_PUBLIC_DOMAIN || process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN;
}

let s3ClientInstance: S3Client | null = null;

/**
 * Singleton factory for AWS S3 compatible client configured for Cloudflare R2.
 */
export function getR2Client(): S3Client | null {
    if (!isR2Configured()) {
        return null;
    }

    if (!s3ClientInstance) {
        const accountId = process.env.R2_ACCOUNT_ID;
        const accessKeyId = process.env.R2_ACCESS_KEY_ID!;
        const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY!;
        const endpoint = process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;

        s3ClientInstance = new S3Client({
            region: 'auto',
            endpoint,
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
        });
    }

    return s3ClientInstance;
}

/**
 * Validates whether the given MIME type is an allowed image format.
 */
export function validateFileType(contentType: string): boolean {
    if (!contentType || typeof contentType !== 'string') return false;
    return ALLOWED_IMAGE_MIME_TYPES.includes(contentType.toLowerCase().trim());
}

/**
 * Validates whether the file size is within acceptable limits.
 */
export function validateFileSize(sizeBytes: number, maxSize: number = MAX_FILE_SIZE_BYTES): boolean {
    if (typeof sizeBytes !== 'number' || isNaN(sizeBytes)) return false;
    return sizeBytes > 0 && sizeBytes <= maxSize;
}

/**
 * Normalizes file extension from MIME type or original file name.
 */
export function getExtensionForMimeType(contentType: string, originalName?: string): string {
    const lower = (contentType || '').toLowerCase().trim();
    if (lower === 'image/png') return 'png';
    if (lower === 'image/webp') return 'webp';
    if (lower === 'image/jpeg' || lower === 'image/jpg') return 'jpg';

    if (originalName) {
        const ext = originalName.split('.').pop()?.toLowerCase();
        if (ext === 'png' || ext === 'webp' || ext === 'jpg' || ext === 'jpeg') {
            return ext === 'jpeg' ? 'jpg' : ext;
        }
    }
    return 'jpg';
}

/**
 * Server-authoritatively generates an unpredictable object key in the appropriate namespace.
 */
export function generateObjectKey(options: {
    folder: 'customizations' | 'products' | 'categories' | 'reviews' | string;
    ownerUid?: string;
    subId?: string; // productId or categoryId
    ext?: string;
}): string {
    const fileId = uuidv4();
    const ext = (options.ext || 'webp').replace(/^\./, '');

    switch (options.folder) {
        case 'customizations': {
            if (!options.ownerUid) {
                throw new Error("Customization object keys require a verified owner UID");
            }
            return `customizations/${options.ownerUid}/${fileId}.${ext}`;
        }
        case 'products': {
            const prodId = options.subId || 'general';
            return `products/${prodId}/${fileId}.${ext}`;
        }
        case 'categories': {
            const catId = options.subId || 'general';
            return `categories/${catId}/${fileId}.${ext}`;
        }
        case 'reviews': {
            const prodId = options.subId || 'general';
            const ownerUid = options.ownerUid || 'anonymous';
            return `reviews/${prodId}/${ownerUid}/${fileId}.${ext}`;
        }
        default:
            throw new Error(`Unsupported storage folder: ${options.folder}`);
    }
}

export interface UploadUrlResult {
    uploadUrl: string;
    key: string;
    publicUrl: string;
    expiresAt: number;
    headers?: Record<string, string>;
}

/**
 * Generates a signed PUT URL for direct browser-to-R2 upload.
 */
export async function generateUploadUrl(options: {
    folder: 'customizations' | 'products' | 'categories' | 'reviews' | string;
    ownerUid?: string;
    subId?: string;
    contentType: string;
    sizeBytes?: number;
    originalName?: string;
    expiresInSeconds?: number;
    ifNoneMatch?: boolean;
}): Promise<UploadUrlResult> {
    const { folder, ownerUid, subId, contentType, sizeBytes, originalName, expiresInSeconds = DEFAULT_PRESIGNED_UPLOAD_EXPIRY, ifNoneMatch = false } = options;

    if (!validateFileType(contentType)) {
        throw new Error(`Unsupported file type '${contentType}'. Allowed types: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}`);
    }

    if (sizeBytes !== undefined && !validateFileSize(sizeBytes)) {
        throw new Error(`File size ${sizeBytes} exceeds maximum permitted size of ${MAX_FILE_SIZE_BYTES} bytes`);
    }

    const ext = getExtensionForMimeType(contentType, originalName);
    const key = generateObjectKey({ folder, ownerUid, subId, ext });
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    const bucketName = getR2BucketName();
    const publicUrl = getPublicAssetUrl(key);

    const client = getR2Client();

    if (!client) {
        // Fallback to local mock mode for development/testing without live Cloudflare credentials
        const mockUploadUrl = `/api/uploads/mock-put?key=${encodeURIComponent(key)}&expires=${expiresAt}`;

        // Register pending mock object
        mockObjectStorage.set(key, {
            key,
            contentType,
            size: sizeBytes || 1024,
            metadata: {
                folder,
                ownerUid: ownerUid || '',
                originalName: originalName || '',
            },
            createdAt: Date.now(),
            etag: `mock-etag-${Date.now()}`,
        });

        return {
            uploadUrl: mockUploadUrl,
            key,
            publicUrl,
            expiresAt,
            headers: {
                'Content-Type': contentType,
                ...(ifNoneMatch ? { 'If-None-Match': '*' } : {}),
            },
        };
    }

    // Live Cloudflare R2 presigned PUT command
    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        ContentType: contentType,
        Metadata: {
            folder,
            ownerUid: ownerUid || '',
            originalName: (originalName || '').substring(0, 100),
        },
        ...(ifNoneMatch ? { IfNoneMatch: '*' } : {}),
    });

    const uploadUrl = await getSignedUrl(client, command, {
        expiresIn: expiresInSeconds,
    });

    return {
        uploadUrl,
        key,
        publicUrl,
        expiresAt,
        headers: {
            'Content-Type': contentType,
            ...(ifNoneMatch ? { 'If-None-Match': '*' } : {}),
        },
    };
}

/**
 * Server-authoritatively uploads a raw Buffer directly to Cloudflare R2 (or mock storage).
 * Used for secure remote image ingestion during CSV imports.
 */
export async function uploadBufferToR2(options: {
    buffer: Buffer;
    key: string;
    contentType: string;
    metadata?: Record<string, string>;
}): Promise<{ key: string; publicUrl: string }> {
    const { buffer, key, contentType, metadata = {} } = options;
    const client = getR2Client();
    const publicUrl = getPublicAssetUrl(key);

    if (!client) {
        mockObjectStorage.set(key, {
            key,
            contentType,
            size: buffer.length,
            metadata,
            data: buffer,
            createdAt: Date.now(),
            etag: `mock-etag-${Date.now()}`,
        });
        return { key, publicUrl };
    }

    const command = new PutObjectCommand({
        Bucket: getR2BucketName(),
        Key: key,
        Body: buffer,
        ContentType: contentType,
        Metadata: metadata,
    });

    await client.send(command);
    return { key, publicUrl };
}

export interface ObjectVerificationResult {
    exists: boolean;
    size: number;
    contentType: string;
    metadata: Record<string, string>;
    lastModified?: Date;
    etag?: string;
}

/**
 * Checks if an object exists in Cloudflare R2 and retrieves its metadata.
 */
export async function verifyObject(key: string): Promise<ObjectVerificationResult> {
    if (!key || typeof key !== 'string') {
        return { exists: false, size: 0, contentType: '', metadata: {} };
    }

    const client = getR2Client();

    if (!client) {
        const mock = mockObjectStorage.get(key);
        if (!mock) {
            return { exists: false, size: 0, contentType: '', metadata: {} };
        }
        return {
            exists: true,
            size: mock.size,
            contentType: mock.contentType,
            metadata: mock.metadata,
            lastModified: new Date(mock.createdAt),
            etag: mock.etag,
        };
    }

    try {
        const command = new HeadObjectCommand({
            Bucket: getR2BucketName(),
            Key: key,
        });

        const response = await client.send(command);

        return {
            exists: true,
            size: response.ContentLength || 0,
            contentType: response.ContentType || 'application/octet-stream',
            metadata: response.Metadata || {},
            lastModified: response.LastModified,
            etag: response.ETag,
        };
    } catch (err: any) {
        if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
            return { exists: false, size: 0, contentType: '', metadata: {} };
        }
        throw err;
    }
}

/**
 * Generates an authorized, time-limited download URL for a private object.
 */
export async function generateDownloadUrl(key: string, expiresInSeconds: number = DEFAULT_PRESIGNED_DOWNLOAD_EXPIRY): Promise<string> {
    if (!key || typeof key !== 'string') {
        throw new Error("Key is required to generate download URL");
    }

    const client = getR2Client();

    if (!client) {
        return `/api/media/download?key=${encodeURIComponent(key)}`;
    }

    const command = new GetObjectCommand({
        Bucket: getR2BucketName(),
        Key: key,
    });

    return await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/**
 * Deletes an object from Cloudflare R2.
 */
export async function deleteR2Object(key: string): Promise<boolean> {
    if (!key || typeof key !== 'string') return false;

    const client = getR2Client();

    if (!client) {
        return mockObjectStorage.delete(key);
    }

    try {
        const command = new DeleteObjectCommand({
            Bucket: getR2BucketName(),
            Key: key,
        });
        await client.send(command);
        return true;
    } catch (err) {
        console.error(`Failed to delete R2 object '${key}':`, err);
        return false;
    }
}

/**
 * Constructs public asset URL (for products, categories, reviews).
 * Uses path-based routing (/api/media/public/{key}) to ensure CDN edge caches
 * (such as Netlify Edge) correctly treat each distinct storage key as an independent cache entity.
 */
export function getPublicAssetUrl(key: string): string {
    if (!key) return '';

    const cleanKey = key.replace(/^\/+/, '');
    const customDomain = getR2PublicDomain();
    if (customDomain) {
        const base = customDomain.replace(/\/$/, '');
        return `${base}/${cleanKey}`;
    }

    return `/api/media/public/${cleanKey}`;
}

/**
 * Extracts storage key from a public URL, download URL, or direct path.
 * Supports both path-based (/api/media/public/products/...) and query-based (/api/media/public?key=...) formats,
 * as well as custom domains and legacy Firebase storage URLs.
 */
export function extractStorageKey(input: string): string | null {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();

    // Direct key starting with known namespace
    if (
        trimmed.startsWith('customizations/') ||
        trimmed.startsWith('products/') ||
        trimmed.startsWith('categories/') ||
        trimmed.startsWith('reviews/')
    ) {
        return trimmed.split('?')[0];
    }

    // Path-based media proxy URL: /api/media/public/{key} or /api/media/download/{key}
    const pathProxyMatch = trimmed.match(/\/api\/media\/(?:public|download)\/((?:products|categories|reviews|customizations)\/.+)/i);
    if (pathProxyMatch && pathProxyMatch[1]) {
        return decodeURIComponent(pathProxyMatch[1]).split('?')[0];
    }

    // Media proxy URL with query string: /api/media/public?key=... or /api/media/download?key=...
    const mediaProxyMatch = trimmed.match(/\/api\/media\/(?:public|download)\?key=([^&#]+)/i);
    if (mediaProxyMatch && mediaProxyMatch[1]) {
        return decodeURIComponent(mediaProxyMatch[1]).split('?')[0];
    }

    // Custom domain URL: https://media.bazaarvilla.com/{key}
    const customDomain = getR2PublicDomain();
    if (customDomain) {
        const domainClean = customDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const customMatch = trimmed.match(new RegExp(`https?:\\/\\/${domainClean}\\/(.+)`, 'i'));
        if (customMatch && customMatch[1]) {
            return customMatch[1].split('?')[0];
        }
    }

    // Legacy Firebase storage URL fallback extraction:
    const legacyMatch = trimmed.match(/\/o\/((?:customizations|products|categories|reviews)(?:%2F|\/)[^?&#]+)/i);
    if (legacyMatch && legacyMatch[1]) {
        return decodeURIComponent(legacyMatch[1].replace(/%2F/gi, '/')).split('?')[0];
    }

    return null;
}
