import { NextRequest } from "next/server";
import * as adminModule from "firebase-admin";

export interface RateLimitOptions {
    key: string;
    limit: number;
    windowMs: number;
}

export interface RateLimitResult {
    allowed: boolean;
    current: number;
    limit: number;
    remaining: number;
    resetAt: number;
    retryAfterSeconds: number;
}

/**
 * Derives the trusted client IP address from request headers.
 * Netlify populates `x-nf-client-connection-ip` with the true client IP.
 */
export function getClientIp(req: NextRequest): string {
    const netlifyIp = req.headers.get("x-nf-client-connection-ip");
    if (netlifyIp && netlifyIp.trim()) {
        return netlifyIp.trim();
    }

    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded && forwarded.trim()) {
        const first = forwarded.split(",")[0].trim();
        if (first) return first;
    }

    const realIp = req.headers.get("x-real-ip");
    if (realIp && realIp.trim()) {
        return realIp.trim();
    }

    return "127.0.0.1";
}

/**
 * Sanitizes a rate limit key for safe use as a Firestore document ID.
 */
export function sanitizeRateLimitKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

/**
 * Distributed rate limiter backed by Cloud Firestore transactions.
 * Provides atomic, synchronized rate limiting across multi-instance serverless environments.
 */
export async function checkRateLimit(
    db: adminModule.firestore.Firestore,
    options: RateLimitOptions
): Promise<RateLimitResult> {
    const { key, limit, windowMs } = options;
    const sanitizedKey = sanitizeRateLimitKey(key);
    const docRef = db.collection("rateLimits").doc(sanitizedKey);
    const now = Date.now();

    return db.runTransaction(async (transaction) => {
        const snap = await transaction.get(docRef);

        if (!snap.exists) {
            const resetAt = now + windowMs;
            transaction.set(docRef, {
                count: 1,
                windowStart: now,
                resetAt,
                updatedAt: now,
            });
            return {
                allowed: true,
                current: 1,
                limit,
                remaining: limit - 1,
                resetAt,
                retryAfterSeconds: Math.ceil(windowMs / 1000),
            };
        }

        const data = snap.data() || {};
        const resetAt = typeof data.resetAt === "number" ? data.resetAt : now + windowMs;

        // Window has expired; reset counter
        if (now >= resetAt) {
            const nextResetAt = now + windowMs;
            transaction.set(docRef, {
                count: 1,
                windowStart: now,
                resetAt: nextResetAt,
                updatedAt: now,
            });
            return {
                allowed: true,
                current: 1,
                limit,
                remaining: limit - 1,
                resetAt: nextResetAt,
                retryAfterSeconds: Math.ceil(windowMs / 1000),
            };
        }

        const currentCount = typeof data.count === "number" ? data.count : 0;
        const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));

        if (currentCount >= limit) {
            return {
                allowed: false,
                current: currentCount,
                limit,
                remaining: 0,
                resetAt,
                retryAfterSeconds,
            };
        }

        const nextCount = currentCount + 1;
        transaction.update(docRef, {
            count: nextCount,
            updatedAt: now,
        });

        return {
            allowed: true,
            current: nextCount,
            limit,
            remaining: Math.max(0, limit - nextCount),
            resetAt,
            retryAfterSeconds,
        };
    });
}

/**
 * Injects standard rate limiting headers into a Response or Headers object.
 */
export function applyRateLimitHeaders(
    headers: Headers,
    result: RateLimitResult
): void {
    headers.set("X-RateLimit-Limit", String(result.limit));
    headers.set("X-RateLimit-Remaining", String(result.remaining));
    headers.set("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
        headers.set("Retry-After", String(result.retryAfterSeconds));
    }
}
