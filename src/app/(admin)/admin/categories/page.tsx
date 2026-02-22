"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { v4 as uuidv4 } from "uuid";

interface Category {
    id: string;
    name: string;
    description: string;
    image: string;
    showOnHome: boolean;
    order: number;
}

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: '12px',
    border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none',
};

const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '0.8rem', fontWeight: 600,
    color: 'var(--text-secondary)', marginBottom: '6px',
    textTransform: 'uppercase', letterSpacing: '0.04em',
};

export default function AdminCategories() {
    const [categories, setCategories] = useState<Category[]>([]);
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState<Partial<Category>>({});
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const unsub = onSnapshot(collection(db, "categories"), (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Category[];
            data.sort((a, b) => (a.order || 0) - (b.order || 0));
            setCategories(data);
            setError(null);
        }, (err) => {
            console.error("AdminCategories error", err);
            setError("Failed to load categories.");
        });
        return () => unsub();
    }, []);

    const handleAddNew = () => {
        setFormData({ id: uuidv4(), name: "", description: "", image: "", showOnHome: false, order: categories.length });
        setIsEditing(true);
    };

    const handleEdit = (cat: Category) => {
        setFormData({ ...cat });
        setIsEditing(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Delete this category?")) return;
        await deleteDoc(doc(db, "categories", id));
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name) { alert("Name is required."); return; }
        try {
            const id = formData.id || uuidv4();
            await setDoc(doc(db, "categories", id), {
                id,
                name: formData.name,
                description: formData.description || "",
                image: formData.image || "",
                showOnHome: formData.showOnHome || false,
                order: formData.order ?? categories.length,
            });
            setIsEditing(false);
            setFormData({});
        } catch (err) {
            console.error(err);
            alert("Failed to save category.");
        }
    };

    const toggleShowOnHome = async (cat: Category) => {
        await setDoc(doc(db, "categories", cat.id), { ...cat, showOnHome: !cat.showOnHome });
    };

    const cellStyle: React.CSSProperties = { padding: '16px 24px', verticalAlign: 'middle', borderBottom: '1px solid var(--border-color)' };
    const thStyle: React.CSSProperties = { ...cellStyle, fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' };

    return (
        <div className="animate-fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <h1 style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>Categories</h1>
                <button onClick={handleAddNew} style={{ padding: '10px 24px', borderRadius: '12px', border: 'none', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                    + Add Category
                </button>
            </div>

            {error && <div style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', padding: '16px', borderRadius: '12px', marginBottom: '24px', fontSize: '0.9rem' }}>{error}</div>}

            {/* Edit Form */}
            {isEditing && (
                <div style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '24px', padding: '32px', marginBottom: '32px' }}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '24px', color: 'var(--text-primary)' }}>{formData.id && categories.find(c => c.id === formData.id) ? 'Edit Category' : 'New Category'}</h2>
                    <form onSubmit={handleSave}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                            <div>
                                <label style={labelStyle}>Category Name *</label>
                                <input type="text" style={inputStyle} value={formData.name || ""} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Hoodies" required />
                            </div>
                            <div>
                                <label style={labelStyle}>Display Order</label>
                                <input type="number" style={inputStyle} value={formData.order ?? 0} onChange={e => setFormData({ ...formData, order: parseInt(e.target.value) || 0 })} />
                            </div>
                        </div>
                        <div style={{ marginBottom: '16px' }}>
                            <label style={labelStyle}>Description</label>
                            <input type="text" style={inputStyle} value={formData.description || ""} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="Short description for the category" />
                        </div>
                        <div style={{ marginBottom: '16px' }}>
                            <label style={labelStyle}>Image URL</label>
                            <input type="text" style={inputStyle} value={formData.image || ""} onChange={e => setFormData({ ...formData, image: e.target.value })} placeholder="https://..." />
                        </div>
                        <div style={{ marginBottom: '24px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                                <input type="checkbox" checked={formData.showOnHome || false} onChange={e => setFormData({ ...formData, showOnHome: e.target.checked })} style={{ width: '18px', height: '18px', accentColor: 'var(--accent)' }} />
                                Show on Home Page
                            </label>
                        </div>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button type="submit" style={{ padding: '10px 28px', borderRadius: '12px', border: 'none', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Save</button>
                            <button type="button" onClick={() => setIsEditing(false)} style={{ padding: '10px 28px', borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'transparent', color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                        </div>
                    </form>
                </div>
            )}

            {/* Table */}
            <div style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: '24px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead style={{ backgroundColor: 'var(--bg-primary)' }}>
                            <tr>
                                <th style={thStyle}>Name</th>
                                <th style={thStyle}>Description</th>
                                <th style={thStyle}>On Home</th>
                                <th style={thStyle}>Order</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody style={{ fontSize: '0.9rem' }}>
                            {categories.length === 0 && (
                                <tr><td colSpan={5} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-secondary)' }}>No categories yet. Add your first one!</td></tr>
                            )}
                            {categories.map(cat => (
                                <tr key={cat.id} style={{ transition: 'background-color 0.2s' }} onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--bg-primary)'} onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                    <td style={{ ...cellStyle, fontWeight: 600, color: 'var(--text-primary)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            {cat.image && <img src={cat.image} alt="" style={{ width: '40px', height: '40px', borderRadius: '10px', objectFit: 'cover' }} />}
                                            {cat.name}
                                        </div>
                                    </td>
                                    <td style={{ ...cellStyle, color: 'var(--text-secondary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.description || "—"}</td>
                                    <td style={cellStyle}>
                                        <button onClick={() => toggleShowOnHome(cat)} style={{
                                            padding: '4px 12px', borderRadius: '999px', border: 'none', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
                                            backgroundColor: cat.showOnHome ? 'rgba(34,197,94,0.1)' : 'rgba(148,163,184,0.1)',
                                            color: cat.showOnHome ? '#16a34a' : '#94a3b8',
                                        }}>
                                            {cat.showOnHome ? "Visible" : "Hidden"}
                                        </button>
                                    </td>
                                    <td style={{ ...cellStyle, color: 'var(--text-secondary)' }}>{cat.order}</td>
                                    <td style={{ ...cellStyle, textAlign: 'right' }}>
                                        <button onClick={() => handleEdit(cat)} style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'transparent', color: 'var(--text-primary)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', marginRight: '8px', fontFamily: 'inherit' }}>Edit</button>
                                        <button onClick={() => handleDelete(cat.id)} style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.3)', backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Delete</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
