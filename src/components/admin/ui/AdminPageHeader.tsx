"use client";

import React from "react";

interface AdminPageHeaderProps {
    title: string;
    subtitle?: string;
    children?: React.ReactNode;
}

export function AdminPageHeader({ title, subtitle, children }: AdminPageHeaderProps) {
    return (
        <div className="admin-page-header">
            <div className="admin-page-title-group">
                <h1>{title}</h1>
                {subtitle && <p>{subtitle}</p>}
            </div>
            {children && <div className="admin-page-actions">{children}</div>}
        </div>
    );
}

export default AdminPageHeader;
