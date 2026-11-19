import { adminDb } from "../../src/lib/firebase/admin";
import { runReservationCleanup } from "../../src/lib/orders/reservationCleanup";

export interface ScheduledFunctionConfig {
    schedule: string;
}

/**
 * Netlify Scheduled Function for Automated Inventory and Coupon Reservation Cleanup.
 * Runs on a 5-minute cron cadence to process expired prepaid reservations.
 * Enforces server-to-server gateway reconciliation before releasing stock.
 */
export default async function handler(req: Request): Promise<Response> {
    const invocationStart = new Date().toISOString();
    console.log(`[Scheduled Reservation Cleanup] Started at ${invocationStart}`);

    if (!adminDb) {
        console.error("[Scheduled Reservation Cleanup] Firestore adminDb is not initialized.");
        return new Response(
            JSON.stringify({
                success: false,
                error: "Database service unavailable",
                invocationStart,
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }

    try {
        const cleanupResult = await runReservationCleanup(adminDb, {
            batchSize: 25,
        });

        console.log(
            `[Scheduled Reservation Cleanup] Completed: processed=${cleanupResult.processed}, released=${cleanupResult.released}, finalized=${cleanupResult.finalized}, reconciliation=${cleanupResult.reconciliationCount}, gatewayErrors=${cleanupResult.gatewayErrors}, firestoreErrors=${cleanupResult.firestoreErrors}, durationMs=${cleanupResult.durationMs}, hasMore=${cleanupResult.hasMore}`
        );

        return new Response(
            JSON.stringify({
                success: true,
                invocationStart,
                result: cleanupResult,
            }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }
        );
    } catch (error: any) {
        console.error(
            `[Scheduled Reservation Cleanup] Fatal execution error: ${error?.message || "Unknown error"}`
        );
        return new Response(
            JSON.stringify({
                success: false,
                error: "Internal cleanup worker error",
                invocationStart,
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}

export const config: ScheduledFunctionConfig = {
    schedule: "*/5 * * * *",
};
