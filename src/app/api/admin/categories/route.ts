import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/auth/adminAuth";
import { adminDb } from "@/lib/firebase/admin";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export interface AdminCategoryDoc {
    id: string;
    name: string;
    description: string;
    image: string;
    showOnHome: boolean;
    order: number;
    createdAt?: number;
    updatedAt?: number;
}

/**
 * GET /api/admin/categories
 * Returns all active categories ordered by sort position.
 * Requires administrator authentication.
 */
export async function GET(req: NextRequest) {
    try {
        const authResult = await verifyAdminRequest(req);
        if (!authResult.isAdmin) {
            return NextResponse.json(
                { error: authResult.error || "Unauthorized admin access required" },
                { status: 401 }
            );
        }

        if (!adminDb) {
            return NextResponse.json({ error: "Database service unavailable" }, { status: 503 });
        }

        const snapshot = await adminDb.collection("categories").get();
        const categories: AdminCategoryDoc[] = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.name || "",
                description: data.description || "",
                image: data.image || "",
                showOnHome: Boolean(data.showOnHome),
                order: typeof data.order === "number" ? data.order : 999,
                createdAt: data.createdAt,
                updatedAt: data.updatedAt,
            };
        });

        categories.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

        return NextResponse.json({ success: true, categories });
    } catch (err: any) {
        console.error("[API Admin Categories GET Error]:", err);
        return NextResponse.json(
            { error: `Failed to fetch categories: ${err.message || "Unknown error"}` },
            { status: 500 }
        );
    }
}

/**
 * POST /api/admin/categories
 * Idempotently validates and creates a new product category.
 * Requires administrator authentication.
 */
export async function POST(req: NextRequest) {
    try {
        const authResult = await verifyAdminRequest(req);
        if (!authResult.isAdmin) {
            return NextResponse.json(
                { error: authResult.error || "Unauthorized admin access required" },
                { status: 401 }
            );
        }

        if (!adminDb) {
            return NextResponse.json({ error: "Database service unavailable" }, { status: 503 });
        }

        const body = await req.json().catch(() => ({}));
        const rawName = typeof body.name === "string" ? body.name.trim() : "";
        const description = typeof body.description === "string" ? body.description.trim() : "";

        if (!rawName) {
            return NextResponse.json(
                { error: "Category name is required and cannot be empty." },
                { status: 400 }
            );
        }

        if (rawName.length < 2 || rawName.length > 100) {
            return NextResponse.json(
                { error: "Category name must be between 2 and 100 characters in length." },
                { status: 400 }
            );
        }

        // Case-insensitive duplicate check across all categories
        const allCatsSnap = await adminDb.collection("categories").get();
        const existingCatDoc = allCatsSnap.docs.find(d => {
            const catData = d.data();
            return typeof catData.name === "string" && catData.name.trim().toLowerCase() === rawName.toLowerCase();
        });

        if (existingCatDoc) {
            const data = existingCatDoc.data();
            return NextResponse.json({
                success: true,
                isExisting: true,
                message: `Category '${data.name}' already exists.`,
                category: {
                    id: existingCatDoc.id,
                    name: data.name,
                    description: data.description || "",
                    image: data.image || "",
                    showOnHome: Boolean(data.showOnHome),
                    order: data.order ?? 0,
                },
            });
        }

        // Generate clean URL slug for id
        const slug = rawName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        const categoryId = slug || `cat_${crypto.randomUUID().slice(0, 8)}`;

        // Verify id uniqueness in case of slug collision with different name
        let finalId = categoryId;
        const collisionSnap = await adminDb.collection("categories").doc(finalId).get();
        if (collisionSnap.exists) {
            finalId = `${categoryId}-${crypto.randomUUID().slice(0, 4)}`;
        }

        const newCategory: AdminCategoryDoc = {
            id: finalId,
            name: rawName,
            description,
            image: "",
            showOnHome: false,
            order: allCatsSnap.size,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        await adminDb.collection("categories").doc(finalId).set(newCategory);

        return NextResponse.json({
            success: true,
            isExisting: false,
            category: newCategory,
        }, { status: 201 });
    } catch (err: any) {
        console.error("[API Admin Categories POST Error]:", err);
        return NextResponse.json(
            { error: `Failed to create category: ${err.message || "Unknown error"}` },
            { status: 500 }
        );
    }
}
