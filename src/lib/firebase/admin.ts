import 'server-only';
import * as admin from 'firebase-admin';

const getServerEnv = (key: string): string | undefined => process.env[key];

if (!admin.apps.length) {
    try {
        const projectId = getServerEnv("FIREBASE_PROJECT_ID") || getServerEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
        const clientEmail = getServerEnv("FIREBASE_CLIENT_EMAIL");
        const privateKey = getServerEnv("FIREBASE_PRIVATE_KEY")?.replace(/\\n/g, '\n');
        const storageBucket = getServerEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET");

        admin.initializeApp({
            credential: admin.credential.cert({
                projectId,
                clientEmail,
                privateKey,
            }),
            storageBucket,
        });
    } catch (error) {
        console.error('Firebase admin initialization error', error);
    }
}

export const adminDb = admin.apps.length ? admin.firestore() : null;
export const adminAuth = admin.apps.length ? admin.auth() : null;
export const adminStorage = admin.apps.length ? admin.storage() : null;
