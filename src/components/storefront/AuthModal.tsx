"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase/config";

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
}

// Icon Components for Password Visibility
const EyeIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const EyeOffIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
);

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
    const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();

    // View States
    const [isLoginView, setIsLoginView] = useState(true);
    const [isForgotPasswordView, setIsForgotPasswordView] = useState(false);

    // Input States
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    // UI States
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);

    if (!isOpen) return null;

    const resetStates = () => {
        setError("");
        setMessage("");
        setLoading(false);
    };

    const handleClose = () => {
        resetStates();
        setEmail("");
        setPassword("");
        setConfirmPassword("");
        setIsLoginView(true);
        setIsForgotPasswordView(false);
        onClose();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        resetStates();
        setLoading(true);

        try {
            if (isForgotPasswordView) {
                // Handle Password Reset
                if (!email) throw new Error("Please enter your email address.");
                await sendPasswordResetEmail(auth, email);
                setMessage("Password reset email sent! Please check your inbox.");
            } else if (isLoginView) {
                // Handle Sign In
                await signInWithEmail(email, password);
                handleClose(); // Success
            } else {
                // Handle Sign Up
                if (password !== confirmPassword) {
                    throw new Error("Passwords do not match.");
                }
                if (password.length < 6) {
                    throw new Error("Password must be at least 6 characters.");
                }
                await signUpWithEmail(email, password);
                handleClose(); // Success
            }
        } catch (err: any) {
            let errorMsg = err.message || "Authentication failed. Please check your credentials.";
            if (err.code === "auth/invalid-credential" || errorMsg.includes("auth/invalid-credential")) {
                errorMsg = "Invalid credentials. Please try again.";
            }
            setError(errorMsg);
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleAuth = async () => {
        resetStates();
        try {
            await signInWithGoogle();
            handleClose(); // Success
        } catch (err: any) {
            setError(err.message || "Google Authentication failed.");
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>

            <div className="animate-fade-in" style={{
                backgroundColor: 'var(--bg-secondary)',
                padding: '40px',
                borderRadius: '24px',
                width: '100%',
                maxWidth: '440px',
                boxShadow: 'var(--shadow-lg)',
                border: '1px solid var(--border-color)',
                position: 'relative'
            }}>
                <button
                    onClick={handleClose}
                    style={{ position: 'absolute', top: '24px', right: '24px', fontSize: '1.5rem', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                    &times;
                </button>

                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <h2 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '8px', letterSpacing: '-0.02em' }}>
                        {isForgotPasswordView ? "Reset Password" : isLoginView ? "Welcome Back" : "Create Account"}
                    </h2>
                    <p style={{ color: 'var(--text-secondary)' }}>
                        {isForgotPasswordView
                            ? "Enter your email and we'll send you a link to reset your password."
                            : isLoginView
                                ? "Enter your details to sign in to your account."
                                : "Register for a new account to start shopping."}
                    </p>
                </div>

                {error && (
                    <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '12px 16px', borderRadius: '8px', marginBottom: '24px', fontSize: '0.875rem', fontWeight: 500, border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                        {error}
                    </div>
                )}

                {message && (
                    <div style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)', color: '#16a34a', padding: '12px 16px', borderRadius: '8px', marginBottom: '24px', fontSize: '0.875rem', fontWeight: 500, border: '1px solid rgba(34, 197, 94, 0.2)' }}>
                        {message}
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Email Address</label>
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            style={{ width: '100%', padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none' }}
                        />
                    </div>

                    {!isForgotPasswordView && (
                        <>
                            <div style={{ position: 'relative' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Password</label>
                                    {isLoginView && (
                                        <button
                                            type="button"
                                            onClick={() => { setIsForgotPasswordView(true); resetStates(); }}
                                            style={{ color: 'var(--accent)', fontSize: '0.875rem', fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer' }}
                                        >
                                            Forgot?
                                        </button>
                                    )}
                                </div>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="••••••••"
                                        style={{ width: '100%', padding: '12px 48px 12px 16px', borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
                                        tabIndex={-1}
                                    >
                                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                                    </button>
                                </div>
                            </div>

                            {!isLoginView && (
                                <div style={{ position: 'relative' }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Confirm Password</label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            type={showConfirmPassword ? "text" : "password"}
                                            required
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            placeholder="••••••••"
                                            style={{ width: '100%', padding: '12px 48px 12px 16px', borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none' }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                            style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
                                            tabIndex={-1}
                                        >
                                            {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="hero-btn"
                        style={{ width: '100%', justifyContent: 'center', marginTop: '8px', padding: '14px 24px', fontSize: '1rem' }}
                    >
                        {loading ? "Processing..." : isForgotPasswordView ? "Send Reset Link" : isLoginView ? "Sign In" : "Create Account"}
                    </button>
                </form>

                {!isForgotPasswordView && (
                    <>
                        <div style={{ margin: '24px 0', display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }}></div>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500 }}>or continue with</span>
                            <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }}></div>
                        </div>

                        <button
                            type="button"
                            onClick={handleGoogleAuth}
                            disabled={loading}
                            style={{
                                width: '100%', padding: '14px 24px', borderRadius: '999px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', transition: 'all 0.2s ease', cursor: 'pointer'
                            }}
                            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--border-color)'}
                            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-primary)'}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                            </svg>
                            Google
                        </button>
                    </>
                )}

                <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    {isForgotPasswordView ? (
                        <button
                            onClick={() => { setIsForgotPasswordView(false); resetStates(); }}
                            style={{ color: 'var(--text-primary)', fontWeight: 700, textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}
                        >
                            Back to Sign in
                        </button>
                    ) : isLoginView ? (
                        <>
                            Don't have an account? <button
                                onClick={() => { setIsLoginView(false); resetStates(); }}
                                style={{ color: 'var(--text-primary)', fontWeight: 700, textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}
                            >
                                Sign up
                            </button>
                        </>
                    ) : (
                        <>
                            Already have an account? <button
                                onClick={() => { setIsLoginView(true); resetStates(); }}
                                style={{ color: 'var(--text-primary)', fontWeight: 700, textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}
                            >
                                Sign in
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
