/**
 * Staging Environment Safety & Production Isolation Guard
 *
 * Implements strict fail-closed validation for hosted staging deployments
 * to guarantee complete isolation from Bazaarvilla's production resources.
 */

export const PRODUCTION_CUSTOM_DOMAIN = "bazaarvilla.com";
export const ALLOWED_STAGING_PROJECT_PREFIXES = ["bazaarvilla-staging", "trendkartz-staging", "staging-"];

export interface StagingIsolationValidationResult {
    isIsolated: boolean;
    isStaging: boolean;
    violations: string[];
    warnings: string[];
}

/**
 * Determines whether the current execution context is configured for hosted staging.
 */
export function isStagingEnvironment(): boolean {
    const appEnv = (process.env.APP_ENV || "").toLowerCase().trim();
    const publicAppEnv = (process.env.NEXT_PUBLIC_APP_ENV || "").toLowerCase().trim();
    const netlifyContext = (process.env.CONTEXT || "").toLowerCase().trim();

    return (
        appEnv === "staging" ||
        publicAppEnv === "staging" ||
        netlifyContext === "deploy-preview" ||
        netlifyContext === "branch-deploy" ||
        Boolean(process.env.STAGING_FIREBASE_PROJECT_ID)
    );
}

/**
 * Performs rigorous fail-closed verification of staging environment configuration.
 * Enforces the 8 mandatory fail-closed isolation rules:
 * 1. Firebase Admin credentials point to a different project.
 * 2. Browser Firebase configuration points to production.
 * 3. Storage bucket belongs to production.
 * 4. Razorpay key begins with rzp_live_.
 * 5. Required environment variables are missing.
 * 6. Environment indicators conflict.
 * 7. Emulator mode is mistakenly combined with hosted staging credentials.
 * 8. The staging deployment is configured with the production custom domain.
 */
export function validateStagingIsolation(): StagingIsolationValidationResult {
    const violations: string[] = [];
    const warnings: string[] = [];

    const isStaging = isStagingEnvironment();
    if (!isStaging) {
        return { isIsolated: true, isStaging: false, violations: [], warnings: [] };
    }

    const appEnv = (process.env.APP_ENV || "").toLowerCase().trim();
    const publicAppEnv = (process.env.NEXT_PUBLIC_APP_ENV || "").toLowerCase().trim();
    const serverProjectId = (process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "").trim();
    const clientProjectId = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
    const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || "").trim();
    const storageBucket = (
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
        process.env.FIREBASE_STORAGE_BUCKET ||
        ""
    ).toLowerCase().trim();
    const razorpayKeyId = (
        process.env.RAZORPAY_KEY_ID ||
        process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ||
        ""
    ).trim();
    const razorpayKeySecret = (process.env.RAZORPAY_KEY_SECRET || "").trim();
    const hostDomain = (
        process.env.URL ||
        process.env.DEPLOY_PRIME_URL ||
        process.env.NEXT_PUBLIC_SITE_URL ||
        ""
    ).toLowerCase().trim();
    const useEmulator =
        process.env.USE_FIREBASE_EMULATOR === "true" ||
        process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";

    // RULE 1: Firebase Admin credentials point to a different project / Project ID consistency
    if (!serverProjectId && !clientProjectId) {
        violations.push("RULE 5: Missing Firebase project configuration in staging.");
    } else if (serverProjectId && clientProjectId && serverProjectId !== clientProjectId) {
        violations.push(
            `RULE 1: Project ID Mismatch: Server (${serverProjectId}) and Client (${clientProjectId}) must match in staging.`
        );
    }

    if (clientEmail && clientEmail.includes("@") && serverProjectId) {
        // e.g. service-account@project-id.iam.gserviceaccount.com
        const match = clientEmail.match(/@([^.]+)\.iam\.gserviceaccount\.com$/);
        if (match && match[1] && match[1] !== serverProjectId) {
            violations.push(
                `RULE 1: Service account email project (${match[1]}) does not match server project ID (${serverProjectId}).`
            );
        }
    }

    // RULE 2: Browser/Client Firebase configuration points to production
    const activeProject = (serverProjectId || clientProjectId).toLowerCase();
    if (
        activeProject === "bazaarvilla" ||
        activeProject === "trendzcart" ||
        activeProject === "trendkartz" ||
        (activeProject.includes("prod") && !activeProject.includes("staging"))
    ) {
        violations.push(
            `RULE 2: CRITICAL SAFETY VIOLATION: Production Firebase project ID (${activeProject}) detected in staging context!`
        );
    }

    // RULE 3: Storage bucket belongs to production
    if (
        storageBucket &&
        (storageBucket.includes("prod") ||
            (storageBucket.includes("bazaarvilla.appspot.com") && !storageBucket.includes("staging")) ||
            (storageBucket.includes("trendzcart.appspot.com") && !storageBucket.includes("staging")))
    ) {
        violations.push(
            `RULE 3: CRITICAL SAFETY VIOLATION: Production Storage bucket (${storageBucket}) detected in staging context!`
        );
    }

    // RULE 4: Razorpay key begins with rzp_live_
    if (razorpayKeyId.startsWith("rzp_live_")) {
        violations.push(
            "RULE 4: CRITICAL FINANCIAL RISK: Razorpay LIVE mode key detected in staging context. Live keys strictly prohibited."
        );
    } else if (razorpayKeyId && !razorpayKeyId.startsWith("rzp_test_")) {
        violations.push(
            `RULE 4: Invalid Razorpay key format: Expected key starting with 'rzp_test_', received invalid prefix.`
        );
    }

    // RULE 5: Required environment variables are missing
    if (!razorpayKeyId) {
        violations.push("RULE 5: Missing RAZORPAY_KEY_ID in staging environment.");
    }
    if (!razorpayKeySecret) {
        violations.push("RULE 5: Missing RAZORPAY_KEY_SECRET in staging environment.");
    }

    // RULE 6: Environment indicators conflict
    if (
        (appEnv === "staging" && publicAppEnv === "production") ||
        (appEnv === "production" && publicAppEnv === "staging")
    ) {
        violations.push(
            `RULE 6: Environment indicator conflict: APP_ENV='${appEnv}' conflicts with NEXT_PUBLIC_APP_ENV='${publicAppEnv}'.`
        );
    }

    // RULE 7: Emulator mode is mistakenly combined with hosted staging credentials
    if (useEmulator && (appEnv === "staging" || publicAppEnv === "staging") && !activeProject.startsWith("demo-")) {
        violations.push(
            "RULE 7: Emulator mode (USE_FIREBASE_EMULATOR=true) cannot be combined with hosted staging environment credentials."
        );
    }

    // RULE 8: The staging deployment is configured with the production custom domain
    if (
        hostDomain &&
        hostDomain.includes(PRODUCTION_CUSTOM_DOMAIN) &&
        !hostDomain.includes(`staging.${PRODUCTION_CUSTOM_DOMAIN}`)
    ) {
        violations.push(
            `RULE 8: CRITICAL SAFETY VIOLATION: Production custom domain (${PRODUCTION_CUSTOM_DOMAIN}) configured in staging context!`
        );
    }

    // Optional webhook secret check (warning)
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
        warnings.push("RAZORPAY_WEBHOOK_SECRET is not configured for staging. Inbound webhooks will be rejected.");
    }

    return {
        isIsolated: violations.length === 0,
        isStaging: true,
        violations,
        warnings,
    };
}

/**
 * Asserts that the staging environment is isolated. Throws if violations exist.
 */
export function assertStagingIsolation(): void {
    const result = validateStagingIsolation();
    if (!result.isIsolated) {
        throw new Error(
            `[STAGING ISOLATION FAILED]\n${result.violations.join("\n")}`
        );
    }
}
