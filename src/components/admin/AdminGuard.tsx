"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AdminGuard({ children }: { children: React.ReactNode }) {
    const { user, profile, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading) {
            if (!user) {
                router.push("/");
            } else if (profile && profile.role !== "admin") {
                router.push("/");
            }
        }
    }, [user, profile, loading, router]);

    if (loading || !profile || profile.role !== "admin") {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', backgroundColor: 'var(--bg-primary)', gap: '16px' }}>
                <div className="animate-spin" style={{ width: '32px', height: '32px', border: '3px solid var(--border-color)', borderTopColor: 'var(--accent)', borderRadius: '50%' }}></div>
                <p style={{ color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.9rem' }}>Verifying admin access...</p>
            </div>
        );
    }

    return <>{children}</>;
}
