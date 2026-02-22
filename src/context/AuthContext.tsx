"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { onAuthStateChanged, User, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";

interface UserProfile {
    uid: string;
    email: string;
    role: "admin" | "customer";
    phone?: string;
    createdAt: number;
}

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
    loading: boolean;
    signInWithGoogle: () => Promise<void>;
    signInWithEmail: (e: string, p: string) => Promise<void>;
    signUpWithEmail: (e: string, p: string) => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    profile: null,
    loading: true,
    signInWithGoogle: async () => { },
    signInWithEmail: async () => { },
    signUpWithEmail: async () => { },
    signOut: async () => { },
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            setUser(currentUser);
            if (currentUser) {
                try {
                    // Fetch or create user profile
                    const userRef = doc(db, "users", currentUser.uid);
                    const userSnap = await getDoc(userRef);

                    if (userSnap.exists()) {
                        setProfile(userSnap.data() as UserProfile);
                    } else {
                        const newProfile: UserProfile = {
                            uid: currentUser.uid,
                            email: currentUser.email || "",
                            role: "customer", // Default role
                            createdAt: Date.now(),
                        };
                        await setDoc(userRef, newProfile);
                        setProfile(newProfile);
                    }
                } catch (err: any) {
                    console.error("AuthContext/Firestore: Could not sync user profile. Check Firebase Security Rules.", err.message);
                    // Fallback to basic profile so app continues to function
                    setProfile({
                        uid: currentUser.uid,
                        email: currentUser.email || "",
                        role: "customer",
                        createdAt: Date.now(),
                    });
                }
            } else {
                setProfile(null);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

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
        <AuthContext.Provider value={{ user, profile, loading, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
