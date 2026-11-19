"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
    onAuthStateChanged,
    User,
    GoogleAuthProvider,
    signInWithPopup,
    signOut as firebaseSignOut,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInAnonymously,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";

export interface UserProfile {
    uid: string;
    email: string;
    role: "admin" | "customer";
    phone?: string;
    createdAt: number;
}

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
    isAdmin: boolean;
    claims: Record<string, any>;
    loading: boolean;
    refreshClaims: () => Promise<boolean>;
    ensureGuestAuth: () => Promise<User | null>;
    signInWithGoogle: () => Promise<void>;
    signInWithEmail: (e: string, p: string) => Promise<void>;
    signUpWithEmail: (e: string, p: string) => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    profile: null,
    isAdmin: false,
    claims: {},
    loading: true,
    refreshClaims: async () => false,
    ensureGuestAuth: async () => null,
    signInWithGoogle: async () => { },
    signInWithEmail: async () => { },
    signUpWithEmail: async () => { },
    signOut: async () => { },
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [claims, setClaims] = useState<Record<string, any>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            setUser(currentUser);
            if (currentUser) {
                // Anonymous guest identity: do not create or query a permanent Firestore user profile
                if (currentUser.isAnonymous) {
                    setIsAdmin(false);
                    setClaims({});
                    setProfile(null);
                    setLoading(false);
                    return;
                }

                let userIsAdmin = false;
                let userClaims: Record<string, any> = {};

                // 1. Authoritative: inspect verified Firebase ID Token claims
                try {
                    const tokenResult = await currentUser.getIdTokenResult();
                    userClaims = tokenResult.claims || {};
                    userIsAdmin = userClaims.admin === true;
                } catch (err: any) {
                    console.error("AuthContext: Could not fetch ID token claims", err?.message);
                }

                setIsAdmin(userIsAdmin);
                setClaims(userClaims);

                // 2. Fetch or create Firestore profile for display / contact info
                try {
                    const userRef = doc(db, "users", currentUser.uid);
                    const userSnap = await getDoc(userRef);

                    if (userSnap.exists()) {
                        const data = userSnap.data() as UserProfile;
                        // Enforce: role is derived strictly from custom claim, ignoring untrusted profile field
                        setProfile({
                            ...data,
                            role: userIsAdmin ? "admin" : "customer",
                        });
                    } else {
                        // Create default customer profile adhering to strict security rules
                        const newProfile: UserProfile = {
                            uid: currentUser.uid,
                            email: currentUser.email || "",
                            role: "customer",
                            createdAt: Date.now(),
                        };
                        await setDoc(userRef, newProfile);
                        setProfile({
                            ...newProfile,
                            role: userIsAdmin ? "admin" : "customer",
                        });
                    }
                } catch (err: any) {
                    console.error("AuthContext/Firestore: Could not sync user profile.", err?.message);
                    setProfile({
                        uid: currentUser.uid,
                        email: currentUser.email || "",
                        role: userIsAdmin ? "admin" : "customer",
                        createdAt: Date.now(),
                    });
                }
            } else {
                setProfile(null);
                setIsAdmin(false);
                setClaims({});
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const refreshClaims = async (): Promise<boolean> => {
        if (!auth.currentUser) {
            setIsAdmin(false);
            setClaims({});
            return false;
        }
        try {
            const tokenResult = await auth.currentUser.getIdTokenResult(true);
            const userClaims = tokenResult.claims || {};
            const adminStatus = userClaims.admin === true;
            setIsAdmin(adminStatus);
            setClaims(userClaims);
            setProfile((prev) =>
                prev ? { ...prev, role: adminStatus ? "admin" : "customer" } : null
            );
            return adminStatus;
        } catch (err) {
            console.error("AuthContext: Error refreshing claims", err);
            return false;
        }
    };

    const ensureGuestAuth = async (): Promise<User | null> => {
        if (auth.currentUser) {
            return auth.currentUser;
        }
        try {
            const cred = await signInAnonymously(auth);
            return cred.user;
        } catch (err) {
            console.error("AuthContext: Anonymous sign-in failed", err);
            return null;
        }
    };

    const signInWithGoogle = async () => {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
    };

    const signInWithEmail = async (email: string, pass: string) => {
        await signInWithEmailAndPassword(auth, email, pass);
    };

    const signUpWithEmail = async (email: string, pass: string) => {
        await createUserWithEmailAndPassword(auth, email, pass);
    };

    const signOut = async () => {
        await firebaseSignOut(auth);
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                profile,
                isAdmin,
                claims,
                loading,
                refreshClaims,
                ensureGuestAuth,
                signInWithGoogle,
                signInWithEmail,
                signUpWithEmail,
                signOut,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
