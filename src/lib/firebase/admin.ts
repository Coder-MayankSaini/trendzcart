import 'server-only';
import * as adminModule from 'firebase-admin';
import { assertEmulatorSafety, isEmulatorMode, DEMO_PROJECT_ID } from './emulatorGuard';

const admin = (adminModule as any).default || adminModule;
const getServerEnv = (key: string): string | undefined => process.env[key];

if (!admin.apps || !admin.apps.length) {
    try {
        if (isEmulatorMode()) {
            assertEmulatorSafety();
            const projectId = getServerEnv("FIREBASE_PROJECT_ID") ||
                getServerEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID") ||
                getServerEnv("GCLOUD_PROJECT") ||
                DEMO_PROJECT_ID;
            const storageBucket = getServerEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET") || `${projectId}.appspot.com`;

            admin.initializeApp({
                projectId,
                storageBucket,
            });
        } else {
            const projectId = getServerEnv("FIREBASE_PROJECT_ID") || getServerEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
            const clientEmail = getServerEnv("FIREBASE_CLIENT_EMAIL");
            const privateKey = getServerEnv("FIREBASE_PRIVATE_KEY")?.replace(/\\n/g, '\n');
            const storageBucket = getServerEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET");

            if (projectId && clientEmail && privateKey) {
                admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId,
                        clientEmail,
                        privateKey,
                    }),
                    storageBucket,
                });
            }
        }
    } catch (error) {
        console.error('Firebase admin initialization error', error);
        if (isEmulatorMode()) {
            throw error;
        }
    }
}

if (admin.apps && admin.apps.length) {
    try {
        admin.firestore().settings({ ignoreUndefinedProperties: true });
    } catch {
        // Settings already applied or not re-configurable
    }
}

export const adminDb: adminModule.firestore.Firestore | null = admin.apps && admin.apps.length ? admin.firestore() : null;
export const adminAuth: adminModule.auth.Auth | null = admin.apps && admin.apps.length ? admin.auth() : null;
export const adminStorage: adminModule.storage.Storage | null = admin.apps && admin.apps.length ? admin.storage() : null;
export default admin;
