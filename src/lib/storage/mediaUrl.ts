/**
 * Normalizes query-based public media URLs to path-based URLs (/api/media/public/{key}).
 * Path-based routing ensures clean edge CDN caching, avoids aliasing, and enables optimal Next.js image optimization.
 */
export function normalizeMediaUrl(url: string | null | undefined): string {
    if (!url || typeof url !== "string") return "";
    const trimmed = url.trim();
    const queryMatch = trimmed.match(/\/api\/media\/public\?key=([^&#]+)/i);
    if (queryMatch && queryMatch[1]) {
        const key = decodeURIComponent(queryMatch[1]).replace(/^\/+/, "");
        return `/api/media/public/${key}`;
    }
    return trimmed;
}
