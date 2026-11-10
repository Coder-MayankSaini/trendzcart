"use client";

import React from "react";
import { formatPurchaseActivityBadge } from "@/lib/orders/purchaseActivityTypes";
import type { PurchaseActivityPeriod } from "@/lib/orders/purchaseActivityTypes";

export interface PurchaseActivityProps {
    activity?: {
        enabled?: boolean;
        periodDays?: PurchaseActivityPeriod;
        displayThreshold?: number;
        unitsSold?: number;
        lastCalculatedAt?: number;
    } | null;
    isSimulated?: boolean;
    simulatedCount?: number;
    simulatedPeriod?: PurchaseActivityPeriod;
    className?: string;
    style?: React.CSSProperties;
}

export default function ProductPurchaseActivity({
    activity,
    isSimulated = false,
    simulatedCount,
    simulatedPeriod,
    className = "",
    style = {},
}: PurchaseActivityProps) {
    // 1. Simulation Mode (Private Admin Preview)
    if (isSimulated) {
        const count = typeof simulatedCount === "number" ? Math.max(0, simulatedCount) : 24;
        const period = (simulatedPeriod || 30) as PurchaseActivityPeriod;
        const label = formatPurchaseActivityBadge(count, period);

        return (
            <div
                className={`purchase-activity-simulation-wrapper ${className}`}
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    padding: "12px",
                    background: "#fefce8",
                    border: "1.5px dashed #ca8a04",
                    borderRadius: "8px",
                    ...style,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span
                        style={{
                            fontSize: "0.7rem",
                            fontWeight: 700,
                            letterSpacing: "0.05em",
                            textTransform: "uppercase",
                            background: "#ca8a04",
                            color: "#ffffff",
                            padding: "2px 6px",
                            borderRadius: "4px",
                        }}
                    >
                        Simulated Preview
                    </span>
                    <span style={{ fontSize: "0.75rem", color: "#854d0e", fontWeight: 500 }}>
                        Private admin preview only — never rendered on live storefront
                    </span>
                </div>

                <div
                    className="purchase-activity-badge"
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "8px",
                        background: "#EAF8EE",
                        border: "1px solid rgba(21, 153, 71, 0.25)",
                        borderRadius: "6px",
                        padding: "6px 12px",
                        color: "#006B3C",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        lineHeight: 1.4,
                        width: "fit-content",
                    }}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        style={{ flexShrink: 0, color: "#15803d" }}
                    >
                        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                        <polyline points="17 6 23 6 23 12" />
                    </svg>
                    <span>{label}</span>
                </div>
            </div>
        );
    }

    // 2. Public Storefront Mode
    const isEnabled = activity?.enabled ?? true;
    const periodDays = (activity?.periodDays ?? 30) as PurchaseActivityPeriod;
    const threshold = typeof activity?.displayThreshold === "number" ? activity.displayThreshold : 5;
    const unitsSold = typeof activity?.unitsSold === "number" ? activity.unitsSold : 0;

    // Do not render anything if disabled or below display threshold
    if (!isEnabled || unitsSold < threshold || unitsSold <= 0) {
        return null;
    }

    const label = formatPurchaseActivityBadge(unitsSold, periodDays);

    return (
        <div
            className={`purchase-activity-badge ${className}`}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                background: "#EAF8EE",
                border: "1px solid rgba(21, 153, 71, 0.22)",
                borderRadius: "6px",
                padding: "6px 12px",
                color: "#006B3C",
                fontSize: "0.85rem",
                fontWeight: 600,
                lineHeight: 1.4,
                width: "fit-content",
                marginTop: "4px",
                marginBottom: "8px",
                ...style,
            }}
            role="status"
            aria-label={label}
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{ flexShrink: 0, color: "#15803d" }}
            >
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
            </svg>
            <span>{label}</span>
        </div>
    );
}
