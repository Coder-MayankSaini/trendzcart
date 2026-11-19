"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";
import { v4 as uuidv4 } from "uuid";
import imageCompression from "browser-image-compression";
import AdminPageHeader from "@/components/admin/ui/AdminPageHeader";
import AdminBadge from "@/components/admin/ui/AdminBadge";

interface Category {
    id: string;
    name: string;
    description: string;
    image: string;
    showOnHome: boolean;
    order: number;
}

export default function AdminCategories() {
    const [categories, setCategories] = useState<Category[]>([]);
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState<Partial<Category>>({});
    const [error, setError] = useState<string | null>(null);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);

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
        setImageFile(null);
        setIsEditing(true);
    };

    const handleEdit = (cat: Category) => {
        setFormData({ ...cat });
        setImageFile(null);
        setIsEditing(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this category?")) return;
        try {
            await deleteDoc(doc(db, "categories", id));
        } catch (err) {
            console.error(err);
            alert("Failed to delete category.");
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name?.trim()) {
            alert("Category name is required.");
            return;
        }
        setUploading(true);
        try {
            const id = formData.id || uuidv4();
            let imageUrl = formData.image || "";

            if (imageFile) {
                const options = {
                    maxSizeMB: 0.5,
                    maxWidthOrHeight: 800,
                    useWebWorker: true,
                };
                const compressedFile = await imageCompression(imageFile, options);

                const user = auth.currentUser;
                const idToken = user ? await user.getIdToken() : "";
                const authRes = await fetch("/api/uploads/authorize", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
                    body: JSON.stringify({
                        folder: "categories",
                        subId: id,
                        contentType: compressedFile.type || "image/jpeg",
                        sizeBytes: compressedFile.size,
                        originalName: compressedFile.name,
                    }),
                });

                if (!authRes.ok) {
                    const err = await authRes.json().catch(() => ({}));
                    throw new Error(err.error || "Failed to authorize category upload");
                }

                const { uploadUrl, key, sessionId, publicUrl, headers: presignedHeaders } = await authRes.json();
                await fetch(uploadUrl, {
                    method: "PUT",
                    headers: (presignedHeaders && typeof presignedHeaders === "object") ? presignedHeaders : { "Content-Type": compressedFile.type || "image/jpeg" },
                    body: compressedFile,
                });

                await fetch("/api/uploads/complete", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
                    body: JSON.stringify({ sessionId, key }),
                });

                imageUrl = publicUrl || `/api/media/public?key=${encodeURIComponent(key)}`;
            }

            await setDoc(doc(db, "categories", id), {
                id,
                name: formData.name.trim(),
                description: formData.description || "",
                image: imageUrl,
                showOnHome: formData.showOnHome || false,
                order: formData.order ?? categories.length,
            });
            setIsEditing(false);
            setFormData({});
            setImageFile(null);
        } catch (err) {
            console.error(err);
            alert("Failed to save category.");
        } finally {
            setUploading(false);
        }
    };

    const toggleShowOnHome = async (cat: Category) => {
        try {
            await setDoc(doc(db, "categories", cat.id), { ...cat, showOnHome: !cat.showOnHome });
        } catch (err) {
            console.error(err);
            alert("Failed to update category visibility.");
        }
    };

    return (
        <div className="animate-fade-in">
            <AdminPageHeader
                title="Category Management"
                subtitle={`Organize store catalog hierarchy (${categories.length} total categories)`}
            >
                <button
                    type="button"
                    onClick={handleAddNew}
                    className="admin-btn admin-btn-primary"
                    aria-label="Add new category"
                >
                    + Add Category
                </button>
            </AdminPageHeader>

            {error && (
                <div style={{ backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#ef4444", padding: "16px 20px", borderRadius: "16px", marginBottom: "24px", fontSize: "0.9rem", fontWeight: 500, border: "1px solid rgba(239, 68, 68, 0.2)" }}>
                    {error}
                </div>
            )}

            {/* Edit / Add Category Form */}
            {isEditing && (
                <div className="admin-form-card" style={{ marginBottom: "28px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                        <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
                            {formData.id && categories.find(c => c.id === formData.id) ? "Edit Category" : "New Category"}
                        </h2>
                        <button
                            type="button"
                            onClick={() => setIsEditing(false)}
                            className="admin-btn admin-btn-secondary admin-btn-sm"
                            disabled={uploading}
                        >
                            Cancel
                        </button>
                    </div>

                    <form onSubmit={handleSave}>
                        <div className="admin-form-grid-2">
                            <div className="admin-form-group">
                                <label htmlFor="cat-name">Category Name *</label>
                                <input
                                    id="cat-name"
                                    type="text"
                                    className="admin-form-input"
                                    value={formData.name || ""}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g. Hoodies, Accessories"
                                    required
                                />
                            </div>
                            <div className="admin-form-group">
                                <label htmlFor="cat-order">Display Order</label>
                                <input
                                    id="cat-order"
                                    type="number"
                                    inputMode="numeric"
                                    className="admin-form-input"
                                    value={formData.order ?? 0}
                                    onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value) || 0 })}
                                />
                            </div>
                        </div>

                        <div className="admin-form-group">
                            <label htmlFor="cat-desc">Description</label>
                            <input
                                id="cat-desc"
                                type="text"
                                className="admin-form-input"
                                value={formData.description || ""}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder="Short description for storefront display..."
                            />
                        </div>

                        {/* Image upload */}
                        <div className="admin-form-group">
                            <label>Category Image</label>
                            <div style={{ display: "flex", gap: "16px", alignItems: "flex-start", flexWrap: "wrap", marginBottom: "12px" }}>
                                {(imageFile || formData.image) && (
                                    <div style={{ width: "90px", height: "90px", borderRadius: "14px", overflow: "hidden", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-primary)", flexShrink: 0 }}>
                                        <img
                                            src={imageFile ? URL.createObjectURL(imageFile) : formData.image}
                                            alt="Category preview"
                                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                        />
                                    </div>
                                )}
                                <div style={{ flex: 1, minWidth: "220px" }}>
                                    <label style={{
                                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                                        padding: "10px 18px", borderRadius: "12px", border: "1px solid var(--border-color)",
                                        backgroundColor: "var(--bg-primary)", cursor: "pointer", color: "var(--text-primary)",
                                        fontSize: "0.88rem", fontWeight: 600, gap: "8px", minHeight: "44px"
                                    }}>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                                        Upload Image File
                                        <input
                                            type="file"
                                            accept="image/*"
                                            style={{ display: "none" }}
                                            onChange={(e) => {
                                                if (e.target.files?.[0]) {
                                                    setImageFile(e.target.files[0]);
                                                }
                                            }}
                                        />
                                    </label>
                                    <div style={{ marginTop: "8px", fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                                        Or provide an image URL:
                                    </div>
                                    <input
                                        type="url"
                                        className="admin-form-input"
                                        style={{ marginTop: "4px" }}
                                        value={formData.image || ""}
                                        onChange={(e) => { setFormData({ ...formData, image: e.target.value }); setImageFile(null); }}
                                        placeholder="https://..."
                                    />
                                </div>
                            </div>
                        </div>

                        <div style={{ marginBottom: "24px" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "0.92rem", fontWeight: 600, color: "var(--text-primary)" }}>
                                <input
                                    type="checkbox"
                                    checked={formData.showOnHome || false}
                                    onChange={(e) => setFormData({ ...formData, showOnHome: e.target.checked })}
                                    style={{ width: "20px", height: "20px", accentColor: "var(--accent)" }}
                                />
                                Show in Homepage Category Showcase
                            </label>
                        </div>

                        {/* Desktop Form Actions */}
                        <div style={{ display: "flex", gap: "12px" }}>
                            <button
                                type="submit"
                                className="admin-btn admin-btn-primary"
                                disabled={uploading}
                            >
                                {uploading ? "Saving..." : "Save Category"}
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsEditing(false)}
                                className="admin-btn admin-btn-secondary"
                                disabled={uploading}
                            >
                                Cancel
                            </button>
                        </div>

                        {/* Mobile Sticky Actions */}
                        <div className="admin-mobile-sticky-actions">
                            <button
                                type="button"
                                onClick={() => setIsEditing(false)}
                                className="admin-btn admin-btn-secondary"
                                disabled={uploading}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="admin-btn admin-btn-primary"
                                disabled={uploading}
                            >
                                {uploading ? "Saving..." : "Save Category"}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Categories Table / Mobile Cards */}
            <div className="admin-card">
                {/* Desktop View: Table (>= 768px) */}
                <div className="admin-table-container">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th style={{ width: "64px" }}>Media</th>
                                <th>Category Name</th>
                                <th>Description</th>
                                <th>Home Showcase</th>
                                <th>Order</th>
                                <th style={{ textAlign: "right" }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {categories.length === 0 && (
                                <tr>
                                    <td colSpan={6} style={{ padding: "48px 20px", textAlign: "center", color: "var(--text-secondary)" }}>
                                        No categories found. Click &quot;+ Add Category&quot; above to create one.
                                    </td>
                                </tr>
                            )}
                            {categories.map((cat) => (
                                <tr key={cat.id}>
                                    <td>
                                        <div style={{ width: "44px", height: "44px", borderRadius: "10px", overflow: "hidden", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-primary)" }}>
                                            {cat.image ? (
                                                <img src={cat.image} alt={cat.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                            ) : (
                                                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: "0.7rem" }}>No img</div>
                                            )}
                                        </div>
                                    </td>
                                    <td style={{ fontWeight: 700, color: "var(--text-primary)" }}>{cat.name}</td>
                                    <td style={{ color: "var(--text-secondary)", maxWidth: "240px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {cat.description || "—"}
                                    </td>
                                    <td>
                                        <button
                                            type="button"
                                            onClick={() => toggleShowOnHome(cat)}
                                            style={{ cursor: "pointer" }}
                                            aria-label={`Toggle homepage visibility for ${cat.name}`}
                                        >
                                            <AdminBadge variant={cat.showOnHome ? "visible" : "hidden"}>
                                                {cat.showOnHome ? "Visible on Home" : "Hidden"}
                                            </AdminBadge>
                                        </button>
                                    </td>
                                    <td style={{ fontWeight: 600, color: "var(--text-secondary)" }}>{cat.order}</td>
                                    <td style={{ textAlign: "right" }}>
                                        <button
                                            type="button"
                                            onClick={() => handleEdit(cat)}
                                            className="admin-btn admin-btn-secondary admin-btn-sm"
                                            style={{ marginRight: "6px" }}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(cat.id)}
                                            className="admin-btn admin-btn-danger admin-btn-sm"
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Mobile View: Cards (< 768px) */}
                <div className="admin-mobile-cards-list">
                    {categories.length === 0 && (
                        <div style={{ padding: "36px 16px", textAlign: "center", color: "var(--text-secondary)" }}>
                            No categories found. Click &quot;+ Add Category&quot; above to create one.
                        </div>
                    )}
                    {categories.map((cat) => (
                        <div key={cat.id} className="admin-mobile-item-card">
                            <div className="admin-mobile-card-top">
                                <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                                    <div style={{ width: "56px", height: "56px", borderRadius: "12px", overflow: "hidden", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-primary)", flexShrink: 0 }}>
                                        {cat.image ? (
                                            <img src={cat.image} alt={cat.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                        ) : (
                                            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: "0.75rem" }}>No img</div>
                                        )}
                                    </div>
                                    <div>
                                        <h4 style={{ fontSize: "1rem", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>{cat.name}</h4>
                                        <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                                            Order priority: #{cat.order}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => toggleShowOnHome(cat)}
                                    aria-label={`Toggle homepage visibility for ${cat.name}`}
                                >
                                    <AdminBadge variant={cat.showOnHome ? "visible" : "hidden"}>
                                        {cat.showOnHome ? "On Home" : "Hidden"}
                                    </AdminBadge>
                                </button>
                            </div>

                            {cat.description && (
                                <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.4 }}>
                                    {cat.description}
                                </p>
                            )}

                            <div className="admin-mobile-card-actions">
                                <button
                                    type="button"
                                    onClick={() => handleEdit(cat)}
                                    className="admin-btn admin-btn-primary admin-btn-sm"
                                    style={{ flex: 1 }}
                                >
                                    Edit Category
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDelete(cat.id)}
                                    className="admin-btn admin-btn-danger admin-btn-sm"
                                    style={{ padding: "6px 12px" }}
                                    aria-label={`Delete ${cat.name}`}
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
