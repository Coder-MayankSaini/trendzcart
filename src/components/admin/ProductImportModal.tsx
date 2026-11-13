"use client";

import { useState, useRef, useEffect } from "react";
import { auth } from "@/lib/firebase/config";
import type {
    ImportMode,
    ColumnMappingResult,
    ImportPreviewSummary,
    ProductImportBatchRecord,
    ImportValidationError,
    ImportValidationWarning,
} from "@/lib/products/import/types";
import { BAZAARVILLA_TEMPLATES } from "@/lib/products/import/templates";

interface ProductImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImportSuccess?: () => void;
}

type WizardStep = "upload" | "mapping" | "preview" | "confirm" | "importing" | "complete" | "history";

export default function ProductImportModal({ isOpen, onClose, onImportSuccess }: ProductImportModalProps) {
    const [currentStep, setCurrentStep] = useState<WizardStep>("upload");
    const [importMode, setImportMode] = useState<ImportMode>("create_and_update");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [csvContent, setCsvContent] = useState<string>("");
    const [sourceFileName, setSourceFileName] = useState<string>("");
    const [fileChecksum, setFileChecksum] = useState<string>("");

    // Preview and Mapping State
    const [mappingResult, setMappingResult] = useState<ColumnMappingResult | null>(null);
    const [previewSummary, setPreviewSummary] = useState<ImportPreviewSummary | null>(null);
    const [fileErrors, setFileErrors] = useState<ImportValidationError[]>([]);
    const [fileWarnings, setFileWarnings] = useState<ImportValidationWarning[]>([]);

    // Execution & Progress State
    const [batchId, setBatchId] = useState<string>("");
    const [isProcessing, setIsProcessing] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [confirmedNotice, setConfirmedNotice] = useState(false);
    const [confirmPriceChanges, setConfirmPriceChanges] = useState(false);
    const [confirmInventoryChanges, setConfirmInventoryChanges] = useState(false);
    const [confirmExistingProductUpdates, setConfirmExistingProductUpdates] = useState(false);
    const [allowPublishNewProducts, setAllowPublishNewProducts] = useState(false);
    const [commitProgress, setCommitProgress] = useState<{ processed: number; total: number }>({ processed: 0, total: 0 });
    const [completedBatch, setCompletedBatch] = useState<ProductImportBatchRecord | null>(null);

    // History State
    const [historyBatches, setHistoryBatches] = useState<ProductImportBatchRecord[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [selectedHistoryBatch, setSelectedHistoryBatch] = useState<ProductImportBatchRecord | null>(null);

    // Active preview tab
    const [previewTab, setPreviewTab] = useState<"all" | "new" | "updates" | "issues">("all");

    const fileInputRef = useRef<HTMLInputElement>(null);

    // Reset when modal opens
    useEffect(() => {
        if (isOpen) {
            setCurrentStep("upload");
            setErrorMessage(null);
            setConfirmedNotice(false);
            setConfirmPriceChanges(false);
            setConfirmInventoryChanges(false);
            setConfirmExistingProductUpdates(false);
            setAllowPublishNewProducts(false);
            setCommitProgress({ processed: 0, total: 0 });
        }
    }, [isOpen]);

    if (!isOpen) return null;

    // Helper: get Firebase auth token
    const getIdToken = async () => {
        const user = auth.currentUser;
        if (!user) throw new Error("Administrator is not logged in.");
        return await user.getIdToken();
    };

    // File selection handler
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
            setErrorMessage("Please select a valid .csv file.");
            return;
        }

        setSelectedFile(file);
        setSourceFileName(file.name);
        setErrorMessage(null);

        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            setCsvContent(text);
        };
        reader.onerror = () => {
            setErrorMessage("Failed to read the selected file.");
        };
        reader.readAsText(file);
    };

    // Step 1: Upload and Analyze CSV
    const handleAnalyzeCsv = async () => {
        if (!csvContent.trim()) {
            setErrorMessage("Please select a CSV file before analyzing.");
            return;
        }

        setIsProcessing(true);
        setErrorMessage(null);

        try {
            const token = await getIdToken();
            const res = await fetch("/api/admin/products/import/preview", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    csvText: csvContent,
                    mode: importMode,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to analyze CSV file.");
            }

            setMappingResult(data.mappingResult);
            setPreviewSummary(data.previewSummary);
            setFileChecksum(data.fileChecksum);
            setFileErrors(data.fileErrors || []);
            setFileWarnings(data.fileWarnings || []);
            setBatchId(data.batchId || crypto.randomUUID());

            // Advance to mapping inspection
            setCurrentStep("mapping");
        } catch (err: any) {
            setErrorMessage(err.message || "An unexpected error occurred during CSV analysis.");
        } finally {
            setIsProcessing(false);
        }
    };

    // Step 4: Execute Batch Commit (Bounded Resumable Execution)
    const handleExecuteCommit = async () => {
        if (!previewSummary || !batchId) return;

        if (!confirmedNotice) {
            setErrorMessage("You must explicitly review and confirm the proposed catalog changes before importing.");
            return;
        }

        if (previewSummary.priceChangeCount > 0 && !confirmPriceChanges) {
            setErrorMessage(`Confirmation Required: The CSV updates prices on ${previewSummary.priceChangeCount} existing products. You must explicitly verify and check 'Confirm Price Changes'.`);
            return;
        }

        if (previewSummary.inventoryChangeCount > 0 && !confirmInventoryChanges) {
            setErrorMessage(`Confirmation Required: The CSV adjusts inventory on ${previewSummary.inventoryChangeCount} existing products. You must explicitly verify and check 'Confirm Inventory Changes'.`);
            return;
        }

        if (previewSummary.existingProducts > 0 && importMode !== "create_only" && !confirmExistingProductUpdates) {
            setErrorMessage(`Confirmation Required: The CSV updates ${previewSummary.existingProducts} existing products. You must explicitly check 'Confirm Existing Product Updates'.`);
            return;
        }

        setIsProcessing(true);
        setCurrentStep("importing");
        setErrorMessage(null);
        setCommitProgress({ processed: 0, total: previewSummary.totalProducts });

        try {
            let hasMore = true;
            let finalRecord: ProductImportBatchRecord | null = null;

            while (hasMore) {
                const token = await getIdToken();
                const res = await fetch("/api/admin/products/import/commit", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        batchId,
                        fileChecksum,
                        confirmations: {
                            confirmedNotice: true,
                            confirmPriceChanges,
                            confirmInventoryChanges,
                            confirmExistingProductUpdates,
                            allowPublishNewProducts,
                        },
                        chunkSize: 10,
                    }),
                });

                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || "Failed to commit product import.");
                }

                finalRecord = data.batchRecord;
                hasMore = Boolean(data.hasMore);
                setCommitProgress({
                    processed: data.processedCount || 0,
                    total: data.totalProducts || previewSummary.totalProducts,
                });

                if (data.isIdempotentReplay) {
                    break;
                }
            }

            setCompletedBatch(finalRecord);
            setCurrentStep("complete");
            if (onImportSuccess) {
                onImportSuccess();
            }
        } catch (err: any) {
            setErrorMessage(err.message || "Import commit failed.");
            setCurrentStep("confirm");
        } finally {
            setIsProcessing(false);
        }
    };

    // Download Error Report CSV
    const handleDownloadErrorReport = async () => {
        if (!previewSummary) return;

        try {
            const token = await getIdToken();
            const allErrors = [
                ...fileErrors,
                ...previewSummary.productPreviews.flatMap((p) => p.errors),
            ];
            const allWarnings = [
                ...fileWarnings,
                ...previewSummary.productPreviews.flatMap((p) => p.warnings),
            ];

            const res = await fetch("/api/admin/products/import/error-report", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ errors: allErrors, warnings: allWarnings }),
            });

            if (!res.ok) throw new Error("Failed to generate error report.");

            const blob = await res.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = downloadUrl;
            a.download = `bazaarvilla-import-errors-${Date.now()}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(downloadUrl);
        } catch (err: any) {
            alert(`Error report download failed: ${err.message}`);
        }
    };

    // Load Audit History
    const handleLoadHistory = async () => {
        setIsLoadingHistory(true);
        setCurrentStep("history");
        try {
            const token = await getIdToken();
            const res = await fetch("/api/admin/products/import/history", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (res.ok) {
                setHistoryBatches(data.batches || []);
            }
        } catch (err) {
            console.error("Failed to load import history", err);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                backgroundColor: "rgba(15, 23, 42, 0.75)",
                backdropFilter: "blur(4px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px",
            }}
            data-testid="product-import-modal-overlay"
        >
            <div
                style={{
                    backgroundColor: "var(--bg-primary, #ffffff)",
                    borderRadius: "16px",
                    width: "100%",
                    maxWidth: "1040px",
                    maxHeight: "92vh",
                    display: "flex",
                    flexDirection: "column",
                    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
                    border: "1px solid var(--border-color, #e2e8f0)",
                    overflow: "hidden",
                }}
                data-testid="product-import-modal-content"
            >
                {/* MODAL HEADER */}
                <div
                    style={{
                        padding: "16px 24px",
                        borderBottom: "1px solid var(--border-color, #e2e8f0)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        backgroundColor: "var(--bg-secondary, #f8fafc)",
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div
                            style={{
                                width: "36px",
                                height: "36px",
                                borderRadius: "8px",
                                backgroundColor: "#006B3C",
                                color: "#ffffff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                        </div>
                        <div>
                            <h2 style={{ fontSize: "1.15rem", fontWeight: 700, margin: 0, color: "var(--text-primary, #0f172a)" }}>
                                Bulk Product Importer
                            </h2>
                            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary, #64748b)", margin: 0 }}>
                                Shopify Compatible & Bazaarvilla Template Importer with Catalog Safety
                            </p>
                        </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {currentStep !== "history" ? (
                            <button
                                type="button"
                                onClick={handleLoadHistory}
                                className="admin-btn admin-btn-secondary"
                                style={{ fontSize: "0.82rem", padding: "6px 12px" }}
                            >
                                Import History
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setCurrentStep("upload")}
                                className="admin-btn admin-btn-secondary"
                                style={{ fontSize: "0.82rem", padding: "6px 12px" }}
                            >
                                Back to Importer
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                padding: "8px",
                                color: "var(--text-secondary, #64748b)",
                                borderRadius: "8px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                            aria-label="Close modal"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* STEP WIZARD INDICATOR */}
                {currentStep !== "history" && (
                    <div
                        style={{
                            display: "flex",
                            borderBottom: "1px solid var(--border-color, #e2e8f0)",
                            backgroundColor: "var(--bg-primary, #ffffff)",
                            overflowX: "auto",
                        }}
                    >
                        {[
                            { key: "upload", label: "1. Upload CSV" },
                            { key: "mapping", label: "2. Column Mapping" },
                            { key: "preview", label: "3. Dry-Run Preview" },
                            { key: "confirm", label: "4. Confirm Changes" },
                            { key: "complete", label: "5. Results" },
                        ].map((step, idx) => {
                            const isCurrent = currentStep === step.key;
                            return (
                                <div
                                    key={step.key}
                                    style={{
                                        padding: "10px 16px",
                                        fontSize: "0.84rem",
                                        fontWeight: isCurrent ? 700 : 500,
                                        color: isCurrent ? "#006B3C" : "var(--text-secondary, #64748b)",
                                        borderBottom: isCurrent ? "2px solid #006B3C" : "2px solid transparent",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {step.label}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* MODAL BODY (SCROLLABLE) */}
                <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
                    {errorMessage && (
                        <div
                            style={{
                                padding: "12px 16px",
                                borderRadius: "8px",
                                backgroundColor: "rgba(239, 68, 68, 0.1)",
                                border: "1px solid rgba(239, 68, 68, 0.25)",
                                color: "#ef4444",
                                fontSize: "0.88rem",
                                marginBottom: "16px",
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                            }}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            <span>{errorMessage}</span>
                        </div>
                    )}

                    {/* ========================================================================= */}
                    {/* STEP 1: UPLOAD & TEMPLATES */}
                    {/* ========================================================================= */}
                    {currentStep === "upload" && (
                        <div>
                            {/* Import Mode Radio Group */}
                            <div style={{ marginBottom: "20px" }}>
                                <label style={{ display: "block", fontSize: "0.88rem", fontWeight: 700, marginBottom: "8px", color: "var(--text-primary)" }}>
                                    Select Import Mode:
                                </label>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "10px" }}>
                                    <label
                                        style={{
                                            border: `1.5px solid ${importMode === "create_and_update" ? "#006B3C" : "var(--border-color)"}`,
                                            backgroundColor: importMode === "create_and_update" ? "rgba(0, 107, 60, 0.04)" : "var(--bg-primary)",
                                            padding: "12px 16px",
                                            borderRadius: "10px",
                                            cursor: "pointer",
                                            display: "flex",
                                            alignItems: "flex-start",
                                            gap: "10px",
                                        }}
                                    >
                                        <input
                                            type="radio"
                                            name="importMode"
                                            value="create_and_update"
                                            checked={importMode === "create_and_update"}
                                            onChange={() => setImportMode("create_and_update")}
                                            style={{ marginTop: "3px", accentColor: "#006B3C" }}
                                        />
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--text-primary)" }}>
                                                Create New & Update Existing
                                            </div>
                                            <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                                                Creates new products (as drafts) and updates matching catalog items with field-by-field safety.
                                            </div>
                                        </div>
                                    </label>

                                    <label
                                        style={{
                                            border: `1.5px solid ${importMode === "create_only" ? "#006B3C" : "var(--border-color)"}`,
                                            backgroundColor: importMode === "create_only" ? "rgba(0, 107, 60, 0.04)" : "var(--bg-primary)",
                                            padding: "12px 16px",
                                            borderRadius: "10px",
                                            cursor: "pointer",
                                            display: "flex",
                                            alignItems: "flex-start",
                                            gap: "10px",
                                        }}
                                    >
                                        <input
                                            type="radio"
                                            name="importMode"
                                            value="create_only"
                                            checked={importMode === "create_only"}
                                            onChange={() => setImportMode("create_only")}
                                            style={{ marginTop: "3px", accentColor: "#006B3C" }}
                                        />
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--text-primary)" }}>
                                                Create New Products Only
                                            </div>
                                            <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                                                Safeguards existing products; skips any row matching existing handles.
                                            </div>
                                        </div>
                                    </label>

                                    <label
                                        style={{
                                            border: `1.5px solid ${importMode === "update_only" ? "#006B3C" : "var(--border-color)"}`,
                                            backgroundColor: importMode === "update_only" ? "rgba(0, 107, 60, 0.04)" : "var(--bg-primary)",
                                            padding: "12px 16px",
                                            borderRadius: "10px",
                                            cursor: "pointer",
                                            display: "flex",
                                            alignItems: "flex-start",
                                            gap: "10px",
                                        }}
                                    >
                                        <input
                                            type="radio"
                                            name="importMode"
                                            value="update_only"
                                            checked={importMode === "update_only"}
                                            onChange={() => setImportMode("update_only")}
                                            style={{ marginTop: "3px", accentColor: "#006B3C" }}
                                        />
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--text-primary)" }}>
                                                Update Existing Products Only
                                            </div>
                                            <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                                                Only modifies products already present in catalog.
                                            </div>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            {/* CSV File Upload Dropzone */}
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                style={{
                                    border: "2px dashed var(--border-color, #cbd5e1)",
                                    borderRadius: "12px",
                                    padding: "32px 20px",
                                    textAlign: "center",
                                    cursor: "pointer",
                                    backgroundColor: selectedFile ? "rgba(0, 107, 60, 0.03)" : "var(--bg-secondary, #f8fafc)",
                                    marginBottom: "24px",
                                    transition: "all 0.2s ease",
                                }}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".csv,text/csv"
                                    style={{ display: "none" }}
                                    onChange={handleFileChange}
                                />
                                <div style={{ display: "inline-flex", padding: "12px", borderRadius: "50%", backgroundColor: "var(--bg-primary)", marginBottom: "8px", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#006B3C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                        <polyline points="14 2 14 8 20 8" />
                                        <line x1="12" y1="18" x2="12" y2="12" />
                                        <line x1="9" y1="15" x2="15" y2="15" />
                                    </svg>
                                </div>
                                <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)" }}>
                                    {selectedFile ? selectedFile.name : "Click to select or drop a CSV file"}
                                </div>
                                <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                                    {selectedFile
                                        ? `${(selectedFile.size / 1024).toFixed(1)} KB · Ready to analyze`
                                        : "Accepts standard Shopify product exports & Bazaarvilla format (max 10MB)"}
                                </div>
                            </div>

                            {/* Downloadable Templates Section */}
                            <div style={{ marginTop: "16px" }}>
                                <h3 style={{ fontSize: "0.92rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "10px" }}>
                                    Need a Template? Download official Bazaarvilla CSV formats:
                                </h3>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
                                    {Object.values(BAZAARVILLA_TEMPLATES).map((tmpl) => (
                                        <div
                                            key={tmpl.id}
                                            style={{
                                                padding: "14px",
                                                borderRadius: "10px",
                                                border: "1px solid var(--border-color)",
                                                backgroundColor: "var(--bg-primary)",
                                                display: "flex",
                                                flexDirection: "column",
                                                justifyContent: "space-between",
                                            }}
                                        >
                                            <div>
                                                <div style={{ fontWeight: 700, fontSize: "0.86rem", color: "var(--text-primary)" }}>
                                                    {tmpl.name}
                                                </div>
                                                <p style={{ fontSize: "0.76rem", color: "var(--text-secondary)", margin: "4px 0 8px" }}>
                                                    {tmpl.description}
                                                </p>
                                                <div style={{ fontSize: "0.72rem", color: "#64748b" }}>
                                                    <strong>Required:</strong> {tmpl.minimumColumns.slice(0, 4).join(", ")}
                                                </div>
                                            </div>
                                            <a
                                                href={`/api/admin/products/import/templates?type=${tmpl.id}`}
                                                download={tmpl.filename}
                                                className="admin-btn admin-btn-secondary"
                                                style={{ marginTop: "10px", fontSize: "0.78rem", padding: "6px 10px", textAlign: "center" }}
                                            >
                                                Download Template (.csv)
                                            </a>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ========================================================================= */}
                    {/* STEP 2: COLUMN MAPPING & FORMAT INSPECTION */}
                    {/* ========================================================================= */}
                    {currentStep === "mapping" && mappingResult && (
                        <div>
                            {/* Format Detection Banner */}
                            <div
                                style={{
                                    padding: "14px 18px",
                                    borderRadius: "10px",
                                    backgroundColor: "rgba(0, 107, 60, 0.06)",
                                    border: "1px solid rgba(0, 107, 60, 0.2)",
                                    marginBottom: "18px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    flexWrap: "wrap",
                                    gap: "10px",
                                }}
                            >
                                <div>
                                    <span style={{ fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", color: "#006B3C" }}>
                                        Format Auto-Detected:
                                    </span>
                                    <div style={{ fontSize: "1rem", fontWeight: 800, color: "#006B3C" }}>
                                        {mappingResult.formatDetected === "shopify_standard"
                                            ? "Shopify Current Export Format"
                                            : mappingResult.formatDetected === "shopify_legacy"
                                            ? "Shopify Legacy Export Format"
                                            : mappingResult.formatDetected === "bazaarvilla_template"
                                            ? "Bazaarvilla Standard Template"
                                            : "Custom / Generic CSV"}
                                    </div>
                                </div>
                                <div style={{ fontSize: "0.82rem", color: "#1e293b" }}>
                                    {mappingResult.recognizedHeaders.length} recognized columns mapped
                                </div>
                            </div>

                            {/* Third Option Alert if detected */}
                            {mappingResult.hasThirdOption && (
                                <div
                                    style={{
                                        padding: "12px 16px",
                                        borderRadius: "8px",
                                        backgroundColor: "rgba(234, 179, 8, 0.1)",
                                        border: "1px solid rgba(234, 179, 8, 0.3)",
                                        color: "#854d0e",
                                        fontSize: "0.84rem",
                                        marginBottom: "16px",
                                    }}
                                >
                                    <strong>Shopify 3rd Attribute Notice:</strong> This CSV includes a third option ({mappingResult.thirdOptionName || "Option 3"}). Bazaarvilla natively supports Size and Color. If this option has varied values, review the preview before proceeding.
                                </div>
                            )}

                            {/* Unsupported Columns Warning */}
                            {mappingResult.unsupportedHeaders.length > 0 && (
                                <div
                                    style={{
                                        padding: "12px 16px",
                                        borderRadius: "8px",
                                        backgroundColor: "var(--bg-secondary)",
                                        border: "1px solid var(--border-color)",
                                        marginBottom: "18px",
                                    }}
                                >
                                    <div style={{ fontSize: "0.84rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "6px" }}>
                                        Unsupported Commercial Columns ({mappingResult.unsupportedHeaders.length} ignored):
                                    </div>
                                    <p style={{ fontSize: "0.76rem", color: "var(--text-secondary)", margin: 0, marginBottom: "8px" }}>
                                        The following columns were detected but will not be imported into Bazaarvilla product records:
                                    </p>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                        {mappingResult.unsupportedHeaders.map((u, i) => (
                                            <span
                                                key={i}
                                                style={{
                                                    fontSize: "0.72rem",
                                                    padding: "3px 8px",
                                                    borderRadius: "4px",
                                                    backgroundColor: "var(--bg-primary)",
                                                    border: "1px solid var(--border-color)",
                                                    color: "#64748b",
                                                }}
                                                title={u.reason}
                                            >
                                                {u.header}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Column Mapping Table */}
                            <div style={{ overflowX: "auto", border: "1px solid var(--border-color)", borderRadius: "10px" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                                    <thead>
                                        <tr style={{ backgroundColor: "var(--bg-secondary)", borderBottom: "1px solid var(--border-color)", textAlign: "left" }}>
                                            <th style={{ padding: "10px 14px", fontWeight: 700 }}>Source CSV Column</th>
                                            <th style={{ padding: "10px 14px", fontWeight: 700 }}>Bazaarvilla Target Field</th>
                                            <th style={{ padding: "10px 14px", fontWeight: 700 }}>Sample Row Value</th>
                                            <th style={{ padding: "10px 14px", fontWeight: 700 }}>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {mappingResult.mappings.map((m, i) => (
                                            <tr key={i} style={{ borderBottom: "1px solid var(--border-color)" }}>
                                                <td style={{ padding: "8px 14px", fontWeight: 600 }}>{m.sourceColumn}</td>
                                                <td style={{ padding: "8px 14px", color: m.targetField ? "#006B3C" : "#94a3b8" }}>
                                                    {m.targetField || "— Not Imported —"}
                                                </td>
                                                <td style={{ padding: "8px 14px", color: "var(--text-secondary)", maxWidth: "240px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {m.sampleValue || "—"}
                                                </td>
                                                <td style={{ padding: "8px 14px" }}>
                                                    <span
                                                        style={{
                                                            fontSize: "0.72rem",
                                                            padding: "2px 6px",
                                                            borderRadius: "4px",
                                                            fontWeight: 600,
                                                            backgroundColor: m.confidence === "exact" ? "#EAF8EE" : m.confidence === "alias" ? "#fef3c7" : "#f1f5f9",
                                                            color: m.confidence === "exact" ? "#006B3C" : m.confidence === "alias" ? "#b45309" : "#64748b",
                                                        }}
                                                    >
                                                        {m.confidence}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* ========================================================================= */}
                    {/* STEP 3: DRY-RUN PREVIEW & CONFLICT INSPECTION */}
                    {/* ========================================================================= */}
                    {(currentStep === "preview" || currentStep === "confirm") && previewSummary && (
                        <div>
                            {/* Summary KPI Grid */}
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px", marginBottom: "20px" }}>
                                <div style={{ padding: "12px", borderRadius: "10px", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)" }}>
                                    <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", textTransform: "uppercase" }}>Total Rows</div>
                                    <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--text-primary)" }}>{previewSummary.totalRows}</div>
                                </div>
                                <div style={{ padding: "12px", borderRadius: "10px", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)" }}>
                                    <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", textTransform: "uppercase" }}>Products</div>
                                    <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--text-primary)" }}>{previewSummary.totalProducts}</div>
                                </div>
                                <div style={{ padding: "12px", borderRadius: "10px", border: "1px solid #bbf7d0", backgroundColor: "#f0fdf4" }}>
                                    <div style={{ fontSize: "0.72rem", color: "#166534", textTransform: "uppercase" }}>New Products</div>
                                    <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#166534" }}>{previewSummary.newProducts}</div>
                                </div>
                                <div style={{ padding: "12px", borderRadius: "10px", border: "1px solid #bae6fd", backgroundColor: "#f0f9ff" }}>
                                    <div style={{ fontSize: "0.72rem", color: "#0369a1", textTransform: "uppercase" }}>Existing Updates</div>
                                    <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#0369a1" }}>{previewSummary.existingProducts}</div>
                                </div>
                                <div style={{ padding: "12px", borderRadius: "10px", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)" }}>
                                    <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", textTransform: "uppercase" }}>Variants</div>
                                    <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--text-primary)" }}>{previewSummary.totalVariants}</div>
                                </div>
                                <div style={{ padding: "12px", borderRadius: "10px", border: "1px solid var(--border-color)", backgroundColor: "var(--bg-secondary)" }}>
                                    <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", textTransform: "uppercase" }}>R2 Transfers</div>
                                    <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--text-primary)" }}>{previewSummary.expectedR2Transfers}</div>
                                </div>
                                <div style={{ padding: "12px", borderRadius: "10px", border: "1px solid #fecaca", backgroundColor: previewSummary.errorCount > 0 ? "#fef2f2" : "var(--bg-secondary)" }}>
                                    <div style={{ fontSize: "0.72rem", color: previewSummary.errorCount > 0 ? "#991b1b" : "var(--text-secondary)", textTransform: "uppercase" }}>Errors</div>
                                    <div style={{ fontSize: "1.3rem", fontWeight: 800, color: previewSummary.errorCount > 0 ? "#991b1b" : "var(--text-primary)" }}>{previewSummary.errorCount}</div>
                                </div>
                            </div>

                            {/* Download Error Report Bar if errors/warnings exist */}
                            {(previewSummary.errorCount > 0 || previewSummary.warningCount > 0) && (
                                <div
                                    style={{
                                        padding: "10px 16px",
                                        borderRadius: "8px",
                                        backgroundColor: previewSummary.errorCount > 0 ? "rgba(239, 68, 68, 0.08)" : "rgba(234, 179, 8, 0.08)",
                                        border: "1px solid rgba(239, 68, 68, 0.2)",
                                        marginBottom: "16px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        flexWrap: "wrap",
                                        gap: "10px",
                                    }}
                                >
                                    <div style={{ fontSize: "0.82rem", color: previewSummary.errorCount > 0 ? "#b91c1c" : "#854d0e" }}>
                                        Found {previewSummary.errorCount} fatal errors and {previewSummary.warningCount} warnings across CSV rows.
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleDownloadErrorReport}
                                        className="admin-btn admin-btn-secondary"
                                        style={{ fontSize: "0.78rem", padding: "4px 10px" }}
                                    >
                                        Download Error Report (.csv)
                                    </button>
                                </div>
                            )}

                            {/* Filter Tabs */}
                            <div style={{ display: "flex", gap: "8px", marginBottom: "14px", borderBottom: "1px solid var(--border-color)", paddingBottom: "8px" }}>
                                <button
                                    type="button"
                                    onClick={() => setPreviewTab("all")}
                                    className={`admin-filter-pill ${previewTab === "all" ? "active" : ""}`}
                                    style={{ fontSize: "0.8rem", padding: "4px 12px" }}
                                >
                                    All ({previewSummary.productPreviews.length})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPreviewTab("new")}
                                    className={`admin-filter-pill ${previewTab === "new" ? "active" : ""}`}
                                    style={{ fontSize: "0.8rem", padding: "4px 12px" }}
                                >
                                    New Drafts ({previewSummary.newProducts})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPreviewTab("updates")}
                                    className={`admin-filter-pill ${previewTab === "updates" ? "active" : ""}`}
                                    style={{ fontSize: "0.8rem", padding: "4px 12px" }}
                                >
                                    Updates ({previewSummary.existingProducts})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPreviewTab("issues")}
                                    className={`admin-filter-pill ${previewTab === "issues" ? "active" : ""}`}
                                    style={{ fontSize: "0.8rem", padding: "4px 12px" }}
                                >
                                    Errors & Warnings ({previewSummary.errorCount + previewSummary.warningCount})
                                </button>
                            </div>

                            {/* Product Previews List */}
                            <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "380px", overflowY: "auto" }}>
                                {previewSummary.productPreviews
                                    .filter((p) => {
                                        if (previewTab === "new") return p.status === "new";
                                        if (previewTab === "updates") return p.status === "existing_update";
                                        if (previewTab === "issues") return p.errors.length > 0 || p.warnings.length > 0;
                                        return true;
                                    })
                                    .map((p, idx) => (
                                        <div
                                            key={idx}
                                            style={{
                                                padding: "12px 16px",
                                                borderRadius: "10px",
                                                border: "1px solid var(--border-color)",
                                                backgroundColor: p.errors.length > 0 ? "rgba(239, 68, 68, 0.02)" : "var(--bg-primary)",
                                            }}
                                        >
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", flexWrap: "wrap" }}>
                                                <div>
                                                    <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--text-primary)" }}>
                                                        {p.title || p.handle}
                                                    </div>
                                                    <div style={{ fontSize: "0.76rem", color: "var(--text-secondary)" }}>
                                                        Slug: <code>{p.handle}</code> · {p.variantCount} variants · {p.imagesCount} images · Base Price: ₹{p.parsedGroup.basePrice}{typeof p.parsedGroup.compareAtPrice === "number" && p.parsedGroup.compareAtPrice > 0 ? ` · Original: ₹${p.parsedGroup.compareAtPrice}` : ""}
                                                    </div>
                                                </div>

                                                <span
                                                    style={{
                                                        fontSize: "0.72rem",
                                                        fontWeight: 700,
                                                        padding: "3px 8px",
                                                        borderRadius: "4px",
                                                        backgroundColor:
                                                            p.status === "new"
                                                                ? "#EAF8EE"
                                                                : p.status === "existing_update"
                                                                ? "#E0F2FE"
                                                                : p.status === "conflict"
                                                                ? "#FEF3C7"
                                                                : "#FEE2E2",
                                                        color:
                                                            p.status === "new"
                                                                ? "#006B3C"
                                                                : p.status === "existing_update"
                                                                ? "#0284C7"
                                                                : p.status === "conflict"
                                                                ? "#D97706"
                                                                : "#DC2626",
                                                    }}
                                                >
                                                    {p.status === "new"
                                                        ? "Create New (Draft)"
                                                        : p.status === "existing_update"
                                                        ? "Update Existing"
                                                        : p.status === "conflict"
                                                        ? "Skipped (Exists)"
                                                        : "Invalid"}
                                                </span>
                                            </div>

                                            {/* Field Diffs for existing updates */}
                                            {p.diffs.length > 0 && p.status === "existing_update" && (
                                                <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px dashed var(--border-color)", fontSize: "0.78rem" }}>
                                                    {p.diffs.map((d, dIdx) => (
                                                        <div key={dIdx} style={{ display: "flex", gap: "6px", color: "var(--text-secondary)", marginBottom: "2px" }}>
                                                            <strong style={{ color: "var(--text-primary)" }}>{d.label}:</strong>
                                                            <span>{String(d.oldValue)}</span>
                                                            <span>→</span>
                                                            <strong style={{ color: "#006B3C" }}>{String(d.newValue)}</strong>
                                                            {d.warning && <span style={{ color: "#b45309" }}>({d.warning})</span>}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Errors list */}
                                            {p.errors.length > 0 && (
                                                <div style={{ marginTop: "8px", color: "#ef4444", fontSize: "0.76rem" }}>
                                                    {p.errors.map((e, eIdx) => (
                                                        <div key={eIdx}>
                                                            • Row {e.rowNumber} [{e.field}]: {e.message}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                            </div>

                            {/* Confirmation Dialog on Step 4 */}
                            {currentStep === "confirm" && (
                                <div
                                    style={{
                                        marginTop: "20px",
                                        padding: "16px",
                                        borderRadius: "10px",
                                        backgroundColor: "rgba(0, 107, 60, 0.05)",
                                        border: "1.5px solid #006B3C",
                                    }}
                                >
                                    <h4 style={{ fontSize: "0.92rem", fontWeight: 700, margin: "0 0 8px 0", color: "#006B3C" }}>
                                        Administrator Confirmation Checkpoint
                                    </h4>
                                    <p style={{ fontSize: "0.82rem", color: "var(--text-primary)", margin: "0 0 12px 0" }}>
                                        No CSV data will overwrite prices, stock, or photos without this explicit confirmation. Review the summary above:
                                    </p>
                                    <ul style={{ fontSize: "0.78rem", color: "var(--text-secondary)", margin: "0 0 14px 18px", padding: 0 }}>
                                        <li>{previewSummary.newProducts} new products will be created as <strong>Drafts (invisible to storefront shoppers by default)</strong>.</li>
                                        <li>{previewSummary.existingProducts} existing products will be safely merged with concurrency safeguards.</li>
                                        <li>{previewSummary.expectedR2Transfers} remote product photographs will be ingested and stored in Cloudflare R2.</li>
                                    </ul>

                                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", borderTop: "1px dashed var(--border-color)", paddingTop: "12px" }}>
                                        <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", fontSize: "0.86rem", fontWeight: 700, color: "var(--text-primary)" }}>
                                            <input
                                                type="checkbox"
                                                checked={confirmedNotice}
                                                onChange={(e) => setConfirmedNotice(e.target.checked)}
                                                style={{ width: "18px", height: "18px", accentColor: "#006B3C", marginTop: "2px" }}
                                            />
                                            <span>I confirm that I have reviewed the proposed catalog modifications and authorize the import.</span>
                                        </label>

                                        {previewSummary.priceChangeCount > 0 && (
                                            <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", fontSize: "0.84rem", fontWeight: 600, color: "#b45309" }}>
                                                <input
                                                    type="checkbox"
                                                    checked={confirmPriceChanges}
                                                    onChange={(e) => setConfirmPriceChanges(e.target.checked)}
                                                    style={{ width: "18px", height: "18px", accentColor: "#d97706", marginTop: "2px" }}
                                                />
                                                <span>Confirm Price Changes: I authorize updating prices on {previewSummary.priceChangeCount} existing catalog products.</span>
                                            </label>
                                        )}

                                        {previewSummary.inventoryChangeCount > 0 && (
                                            <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", fontSize: "0.84rem", fontWeight: 600, color: "#0369a1" }}>
                                                <input
                                                    type="checkbox"
                                                    checked={confirmInventoryChanges}
                                                    onChange={(e) => setConfirmInventoryChanges(e.target.checked)}
                                                    style={{ width: "18px", height: "18px", accentColor: "#0284c7", marginTop: "2px" }}
                                                />
                                                <span>Confirm Inventory Changes: I authorize updating stock on {previewSummary.inventoryChangeCount} existing catalog products.</span>
                                            </label>
                                        )}

                                        {previewSummary.existingProducts > 0 && importMode !== "create_only" && (
                                            <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", fontSize: "0.84rem", fontWeight: 600, color: "var(--text-primary)" }}>
                                                <input
                                                    type="checkbox"
                                                    checked={confirmExistingProductUpdates}
                                                    onChange={(e) => setConfirmExistingProductUpdates(e.target.checked)}
                                                    style={{ width: "18px", height: "18px", accentColor: "#006B3C", marginTop: "2px" }}
                                                />
                                                <span>Confirm Existing Product Updates: I authorize modifying {previewSummary.existingProducts} existing catalog products.</span>
                                            </label>
                                        )}

                                        {previewSummary.newProducts > 0 && (
                                            <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                                                <input
                                                    type="checkbox"
                                                    checked={allowPublishNewProducts}
                                                    onChange={(e) => setAllowPublishNewProducts(e.target.checked)}
                                                    style={{ width: "16px", height: "16px", accentColor: "#006B3C", marginTop: "2px" }}
                                                />
                                                <span>Publish newly imported products immediately (default: draft/hidden).</span>
                                            </label>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ========================================================================= */}
                    {/* STEP 5: IMPORTING PROGRESS (BOUNDED RESUMABLE) */}
                    {/* ========================================================================= */}
                    {currentStep === "importing" && (
                        <div style={{ textAlign: "center", padding: "48px 20px" }}>
                            <div className="admin-spinner" style={{ margin: "0 auto 16px", width: "40px", height: "40px", border: "3px solid var(--border-color)", borderTopColor: "#006B3C", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 6px 0" }}>
                                Importing Products to Catalog...
                            </h3>
                            <p style={{ fontSize: "0.84rem", color: "var(--text-secondary)", margin: "0 0 16px 0" }}>
                                Ingesting remote images to Cloudflare R2 and committing transactional catalog updates. Please do not close this window.
                            </p>
                            {commitProgress.total > 0 && (
                                <div style={{ maxWidth: "360px", margin: "0 auto" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
                                        <span>Progress</span>
                                        <span>{commitProgress.processed} of {commitProgress.total} ({Math.round((commitProgress.processed / Math.max(1, commitProgress.total)) * 100)}%)</span>
                                    </div>
                                    <div style={{ height: "8px", borderRadius: "4px", backgroundColor: "var(--border-color, #e2e8f0)", overflow: "hidden" }}>
                                        <div style={{ height: "100%", width: `${Math.round((commitProgress.processed / Math.max(1, commitProgress.total)) * 100)}%`, backgroundColor: "#006B3C", transition: "width 0.3s ease" }} />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ========================================================================= */}
                    {/* STEP 6: COMPLETE RESULTS */}
                    {/* ========================================================================= */}
                    {currentStep === "complete" && completedBatch && (
                        <div>
                            <div style={{ textAlign: "center", padding: "20px 0" }}>
                                <div style={{ display: "inline-flex", padding: "12px", borderRadius: "50%", backgroundColor: "#EAF8EE", marginBottom: "10px" }}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#006B3C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                </div>
                                <h3 style={{ fontSize: "1.2rem", fontWeight: 800, color: "var(--text-primary)", margin: "0 0 4px 0" }}>
                                    Import Batch Completed!
                                </h3>
                                <p style={{ fontSize: "0.84rem", color: "var(--text-secondary)", margin: 0 }}>
                                    Batch ID: <code>{completedBatch.id}</code> · {completedBatch.status}
                                </p>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", margin: "16px 0 24px" }}>
                                <div style={{ padding: "12px", borderRadius: "10px", backgroundColor: "#f0fdf4", textAlign: "center", border: "1px solid #bbf7d0" }}>
                                    <div style={{ fontSize: "0.72rem", color: "#166534", textTransform: "uppercase" }}>Created</div>
                                    <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#166534" }}>{completedBatch.createdCount}</div>
                                </div>
                                <div style={{ padding: "12px", borderRadius: "10px", backgroundColor: "#f0f9ff", textAlign: "center", border: "1px solid #bae6fd" }}>
                                    <div style={{ fontSize: "0.72rem", color: "#0369a1", textTransform: "uppercase" }}>Updated</div>
                                    <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#0369a1" }}>{completedBatch.updatedCount}</div>
                                </div>
                                <div style={{ padding: "12px", borderRadius: "10px", backgroundColor: "var(--bg-secondary)", textAlign: "center", border: "1px solid var(--border-color)" }}>
                                    <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", textTransform: "uppercase" }}>Skipped</div>
                                    <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--text-primary)" }}>{completedBatch.skippedCount}</div>
                                </div>
                                <div style={{ padding: "12px", borderRadius: "10px", backgroundColor: completedBatch.failedCount > 0 ? "#fef2f2" : "var(--bg-secondary)", textAlign: "center", border: "1px solid var(--border-color)" }}>
                                    <div style={{ fontSize: "0.72rem", color: completedBatch.failedCount > 0 ? "#991b1b" : "var(--text-secondary)", textTransform: "uppercase" }}>Failed</div>
                                    <div style={{ fontSize: "1.4rem", fontWeight: 800, color: completedBatch.failedCount > 0 ? "#991b1b" : "var(--text-primary)" }}>{completedBatch.failedCount}</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ========================================================================= */}
                    {/* HISTORY AUDIT TAB */}
                    {/* ========================================================================= */}
                    {currentStep === "history" && (
                        <div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                                <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
                                    Import Batches Audit Trail (Append-Only)
                                </h3>
                                <button
                                    type="button"
                                    onClick={handleLoadHistory}
                                    className="admin-btn admin-btn-secondary"
                                    style={{ fontSize: "0.78rem", padding: "4px 8px" }}
                                    disabled={isLoadingHistory}
                                >
                                    {isLoadingHistory ? "Refreshing..." : "Refresh Logs"}
                                </button>
                            </div>

                            {historyBatches.length === 0 ? (
                                <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                                    No past product import batches recorded.
                                </div>
                            ) : (
                                <div style={{ overflowX: "auto", border: "1px solid var(--border-color)", borderRadius: "10px" }}>
                                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                                        <thead>
                                            <tr style={{ backgroundColor: "var(--bg-secondary)", borderBottom: "1px solid var(--border-color)", textAlign: "left" }}>
                                                <th style={{ padding: "8px 12px" }}>Batch ID</th>
                                                <th style={{ padding: "8px 12px" }}>Date</th>
                                                <th style={{ padding: "8px 12px" }}>Source File</th>
                                                <th style={{ padding: "8px 12px" }}>Mode</th>
                                                <th style={{ padding: "8px 12px" }}>Created / Updated</th>
                                                <th style={{ padding: "8px 12px" }}>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {historyBatches.map((b) => (
                                                <tr key={b.id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                                                    <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{b.id.slice(0, 8)}...</td>
                                                    <td style={{ padding: "8px 12px" }}>{new Date(b.createdAt).toLocaleDateString()} {new Date(b.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                                    <td style={{ padding: "8px 12px" }}>{b.sourceFileName}</td>
                                                    <td style={{ padding: "8px 12px" }}>{b.importMode}</td>
                                                    <td style={{ padding: "8px 12px" }}>+{b.createdCount} / ~{b.updatedCount}</td>
                                                    <td style={{ padding: "8px 12px" }}>
                                                        <span
                                                            style={{
                                                                fontSize: "0.72rem",
                                                                padding: "2px 6px",
                                                                borderRadius: "4px",
                                                                fontWeight: 600,
                                                                backgroundColor: b.status === "completed" ? "#EAF8EE" : "#FEE2E2",
                                                                color: b.status === "completed" ? "#006B3C" : "#DC2626",
                                                            }}
                                                        >
                                                            {b.status}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* MODAL FOOTER ACTIONS */}
                <div
                    style={{
                        padding: "14px 24px",
                        borderTop: "1px solid var(--border-color, #e2e8f0)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        backgroundColor: "var(--bg-secondary, #f8fafc)",
                    }}
                >
                    <div>
                        {currentStep === "mapping" && (
                            <button
                                type="button"
                                onClick={() => setCurrentStep("upload")}
                                className="admin-btn admin-btn-secondary"
                                style={{ fontSize: "0.85rem" }}
                            >
                                Back to Upload
                            </button>
                        )}
                        {currentStep === "preview" && (
                            <button
                                type="button"
                                onClick={() => setCurrentStep("mapping")}
                                className="admin-btn admin-btn-secondary"
                                style={{ fontSize: "0.85rem" }}
                            >
                                Back to Mapping
                            </button>
                        )}
                        {currentStep === "confirm" && (
                            <button
                                type="button"
                                onClick={() => setCurrentStep("preview")}
                                className="admin-btn admin-btn-secondary"
                                style={{ fontSize: "0.85rem" }}
                            >
                                Back to Preview
                            </button>
                        )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        {currentStep === "upload" && (
                            <button
                                type="button"
                                onClick={handleAnalyzeCsv}
                                className="admin-btn admin-btn-primary"
                                disabled={!selectedFile || isProcessing}
                                style={{ fontSize: "0.85rem" }}
                            >
                                {isProcessing ? "Analyzing CSV..." : "Inspect & Preview CSV →"}
                            </button>
                        )}

                        {currentStep === "mapping" && (
                            <button
                                type="button"
                                onClick={() => setCurrentStep("preview")}
                                className="admin-btn admin-btn-primary"
                                style={{ fontSize: "0.85rem" }}
                            >
                                View Dry-Run Preview →
                            </button>
                        )}

                        {currentStep === "preview" && (
                            <button
                                type="button"
                                onClick={() => setCurrentStep("confirm")}
                                className="admin-btn admin-btn-primary"
                                disabled={previewSummary?.invalidProducts! > 0 || previewSummary?.errorCount! > 0}
                                style={{ fontSize: "0.85rem" }}
                            >
                                Proceed to Confirmation →
                            </button>
                        )}

                        {currentStep === "confirm" && (
                            <button
                                type="button"
                                onClick={handleExecuteCommit}
                                className="admin-btn admin-btn-primary"
                                disabled={!confirmedNotice || isProcessing}
                                style={{ fontSize: "0.85rem" }}
                            >
                                Confirm & Execute Import
                            </button>
                        )}

                        {currentStep === "complete" && (
                            <button
                                type="button"
                                onClick={onClose}
                                className="admin-btn admin-btn-primary"
                                style={{ fontSize: "0.85rem" }}
                            >
                                View Products in Catalog
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
