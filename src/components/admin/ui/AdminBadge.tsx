"use client";

import React from "react";

interface AdminBadgeProps {
    children: React.ReactNode;
    variant?: "paid" | "pending" | "shipped" | "delivered" | "cancelled" | "quarantined" | "visible" | "hidden" | "neutral";
    className?: string;
}

export function AdminBadge({ children, variant = "neutral", className = "" }: AdminBadgeProps) {
    const variantClass = {
        paid: "admin-status-paid",
        pending: "admin-status-pending",
        shipped: "admin-status-shipped",
        delivered: "admin-status-delivered",
        cancelled: "admin-status-cancelled",
        quarantined: "admin-status-quarantined",
        visible: "admin-status-visible",
        hidden: "admin-status-hidden",
        neutral: "",
    }[variant];

    return (
        <span
            className={`admin-status-badge ${variantClass} ${className}`.trim()}
            role="status"
            aria-label={typeof children === "string" ? children : undefined}
        >
            {children}
        </span>
    );
}

export default AdminBadge;
