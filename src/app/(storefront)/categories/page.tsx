"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

interface Category {
    id: string;
    name: string;
    description: string;
    image: string;
    order: number;
}

export default function CategoriesPage() {
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchCategories = async () => {
            try {
                const q = query(collection(db, "categories"), orderBy("order", "asc"));
                const snap = await getDocs(q);
                setCategories(snap.docs.map(d => ({ id: d.id, ...d.data() } as Category)));
            } catch (err) {
                console.error("Failed to fetch categories", err);
            } finally {
                setLoading(false);
            }
        };
        fetchCategories();
    }, []);

    if (loading) {
        return (
            <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', color: 'var(--text-secondary)', gap: '12px' }}>
                <div className="co-spinner" style={{ width: 24, height: 24 }} />
                Loading categories...
            </div>
        );
    }

    return (
        <div className="page-container">
            <div className="catalog-header" style={{ marginBottom: '64px' }}>
                <h1 style={{ fontSize: '3rem', fontWeight: 800, letterSpacing: '-0.04em', marginBottom: '16px' }}>Shop by Category</h1>
                <p style={{ fontSize: '1.125rem', color: 'var(--text-secondary)' }}>Find exactly what you&apos;re looking for.</p>
            </div>

            {categories.length === 0 ? (
                <div className="empty-state">No categories available yet.</div>
            ) : (
                <div className="product-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '48px' }}>
                    {categories.map((category) => (
                        <Link href={`/products?category=${encodeURIComponent(category.name)}`} key={category.id} style={{ display: 'block' }} className="product-card">
                            <div style={{ aspectRatio: '16/9', overflow: 'hidden', borderRadius: '16px', marginBottom: '24px', backgroundColor: 'var(--bg-secondary)' }}>
                                {category.image ? (
                                    <img
                                        src={category.image}
                                        alt={category.name}
                                        style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.4s ease' }}
                                        onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                                        onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                                    />
                                ) : (
                                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>No Image</div>
                                )}
                            </div>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '8px' }}>{category.name}</h2>
                            {category.description && <p style={{ color: 'var(--text-secondary)' }}>{category.description}</p>}
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
