"use client";

import { dashboardRequest, prepareReceipt } from "@/lib/dashboard-api";
import { describeError, RECEIPT_TYPES, type Category, type DashboardData, type Entry } from "@/lib/dashboard-types";
import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const ACTIVE_TAB_KEY = "dashboard-active-tab";
const ACTIVE_TAB_EVENT = "dashboard-active-tab-change";

function getActiveTabSnapshot() {
  if (typeof window === "undefined") {
    return "dashboard";
  }

  try {
    const tab = window.localStorage.getItem(ACTIVE_TAB_KEY);
    return ["dashboard", "input", "laporan", "budget"].includes(tab || "") ? tab! : "dashboard";
  } catch {
    return "dashboard";
  }
}

function subscribeToActiveTabChanges(callback: () => void) {
  const handleStorage = () => callback();

  window.addEventListener("storage", handleStorage);
  window.addEventListener(ACTIVE_TAB_EVENT, handleStorage);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(ACTIVE_TAB_EVENT, handleStorage);
  };
}

function setActiveTabSnapshot(tab: string) {
  try { window.localStorage.setItem(ACTIVE_TAB_KEY, tab); } catch { /* Storage may be disabled. */ }
  window.dispatchEvent(new Event(ACTIVE_TAB_EVENT));
}

function rupiah(amount: number) {
  return "Rp " + amount.toLocaleString("id-ID");
}

type DashboardClientProps = {
  isAdmin?: boolean;
};

export function DashboardClient({ isAdmin = false }: DashboardClientProps) {
  const savedTab = useSyncExternalStore(
    subscribeToActiveTabChanges,
    getActiveTabSnapshot,
    () => "dashboard"
  );
  const [sessionTab, setSessionTab] = useState<string | null>(null);
  const activeTab = (sessionTab || savedTab) === "budget" && !isAdmin ? "dashboard" : sessionTab || savedTab;
  function changeTab(tab: string) {
    setSessionTab(tab);
    setActiveTabSnapshot(tab);
  }
  const [entries, setEntries] = useState<Entry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [deletingEntryId, setDeletingEntryId] = useState<string | number | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const receiptInput = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const paymentRequestId = useRef<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [formError, setFormError] = useState("");
  const [fileError, setFileError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);
  const [form, setForm] = useState({
    category: "",
    tanggal: "",
    nominal: "",
    vendor: "",
    notes: "",
  });

  useEffect(() => {
    return () => {
      if (receiptPreview) {
        URL.revokeObjectURL(receiptPreview);
      }
    };
  }, [receiptPreview]);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      const errors: string[] = [];
      try {
        const data = await dashboardRequest<DashboardData>();
        if (cancelled) return;
        setCategories(data.categories);
        setEntries(data.entries);
        setForm((current) => ({ ...current, category: data.categories.some((item) => item.name === current.category) ? current.category : "" }));
      } catch (error) {
        errors.push(describeError(error));
      }
      if (!cancelled) {
        setLoadErrors(errors);
        setIsLoading(false);
      }
    }
    void loadData();
    return () => { cancelled = true; };
  }, [loadVersion]);

  function retryLoading() {
    setIsLoading(true);
    setNotice("");
    setLoadVersion((value) => value + 1);
  }

  const categoriesWithRealisasi = categories.map((category) => {
    const realisasi = entries
      .filter((entry) => entry.category === category.name)
      .reduce((sum, entry) => sum + entry.nominal, 0);

    return {
      ...category,
      realisasi,
    };
  });

  const totalBudget = categoriesWithRealisasi.reduce(
    (sum, item) => sum + item.budget,
    0
  );

  const totalRealisasi = entries.reduce(
    (sum, item) => sum + item.nominal,
    0
  );

  const percentage = totalBudget === 0 ? 0 : (totalRealisasi / totalBudget) * 100;

  function handleReceiptChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0] || null;
    setFileError("");
    if (selectedFile && (!RECEIPT_TYPES.includes(selectedFile.type) || selectedFile.size > 10 * 1024 * 1024 || selectedFile.size === 0 || (["application/pdf", "image/heic", "image/heif"].includes(selectedFile.type) && selectedFile.size > 3 * 1024 * 1024))) {
      setFileError("Pilih foto JPG, PNG, atau WebP maksimal 10 MB; PDF atau HEIC maksimal 3 MB. File tidak boleh kosong.");
      e.target.value = "";
      setReceiptFile(null);
      setReceiptPreview(null);
      return;
    }
    setReceiptFile(selectedFile);
    setReceiptPreview(selectedFile && ["image/jpeg", "image/png", "image/webp"].includes(selectedFile.type) ? URL.createObjectURL(selectedFile) : null);
  }

  function clearReceipt() {
    setReceiptFile(null);
    setReceiptPreview(null);
    setFileError("");
    if (receiptInput.current) receiptInput.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    setFormError("");
    setNotice("");
    if (isLoading || loadErrors.length || !categories.some((category) => category.name === form.category)) {
      setFormError("Pilih tahapan pekerjaan setelah data berhasil dimuat.");
      return;
    }
    if (!form.tanggal || !Number.isSafeInteger(Number(form.nominal)) || Number(form.nominal) <= 0) {
      setFormError("Isi tanggal dan nominal berupa bilangan bulat lebih dari nol.");
      return;
    }
    if (fileError) return;
    submitting.current = true;
    setIsSaving(true);
    try {
      const body = new FormData();
      paymentRequestId.current ||= crypto.randomUUID();
      body.set("action", "createPayment");
      body.set("id", paymentRequestId.current);
      Object.entries(form).forEach(([key, value]) => body.set(key, value));
      if (receiptFile) body.set("receipt", await prepareReceipt(receiptFile));
      const data = await dashboardRequest<Entry>({ method: "POST", body });
      setEntries((currentEntries) => [data, ...currentEntries.filter((entry) => entry.id !== data.id)]);
      paymentRequestId.current = null;

      setForm({
        category: "",
        tanggal: "",
        nominal: "",
        vendor: "",
        notes: "",
      });

      clearReceipt();
      setNotice("Realisasi berhasil disimpan.");
      changeTab("laporan");
    } catch (error) {
      console.error("Error saving payment:", error);
      setFormError("Gagal menyimpan realisasi. " + describeError(error));
    } finally {
      submitting.current = false;
      setIsSaving(false);
    }
  }

  async function handleDeleteEntry(entry: Entry) {
    const confirmed = window.confirm(
      `Hapus laporan ${entry.category} sebesar ${rupiah(entry.nominal)}?`
    );

    if (!confirmed) {
      return;
    }

    setDeletingEntryId(entry.id);

    try {
      const body = new FormData();
      body.set("action", "deletePayment");
      body.set("id", String(entry.id));
      await dashboardRequest({ method: "POST", body });
      setEntries((currentEntries) => currentEntries.filter((currentEntry) => currentEntry.id !== entry.id));
      setNotice("Laporan berhasil dihapus.");
    } catch (error) {
      console.error("Error deleting payment:", error);
      setNotice("Gagal menghapus laporan. " + describeError(error));
    } finally {
      setDeletingEntryId(null);
    }
  }

  return (
    <main>
      <header className="app-header">
        <h1>Monitoring RAB - Rumah Kos Puri</h1>
        <p>Puri, Kembangan, Jakarta Barat</p>
      </header>

      <div className="tabs">
        <button
          type="button"
          className={activeTab === "dashboard" ? "active" : ""}
          onClick={() => changeTab("dashboard")}
          disabled={isSaving}
        >
          Dashboard
        </button>

        <button
          type="button"
          className={activeTab === "input" ? "active" : ""}
          onClick={() => changeTab("input")}
          disabled={isSaving}
        >
          Input Realisasi
        </button>

        <button
          type="button"
          className={activeTab === "laporan" ? "active" : ""}
          onClick={() => changeTab("laporan")}
          disabled={isSaving}
        >
          Laporan
        </button>

        {isAdmin && (
          <button
            type="button"
            className={activeTab === "budget" ? "active" : ""}
            onClick={() => changeTab("budget")}
            disabled={isSaving}
          >
            Budget
          </button>
        )}
      </div>

      <section className="container">
        {isLoading && <p className="status-message" role="status">Memuat data...</p>}
        {!isLoading && loadErrors.length > 0 && (
          <div className="status-message error-message" role="alert">
            <strong>Data belum berhasil dimuat.</strong>
            {loadErrors.map((error) => <p key={error}>{error}</p>)}
            <button type="button" className="secondary-button" onClick={retryLoading}>Coba lagi</button>
          </div>
        )}
        {!isLoading && !loadErrors.length && categories.length === 0 && (
          <div className="status-message" role="status">
            Belum ada tahapan pekerjaan yang dapat diakses. Minta pengelola menambahkan kategori dan memeriksa izin akses, lalu coba lagi.
            <button type="button" className="secondary-button" onClick={retryLoading}>Muat ulang</button>
          </div>
        )}
        {notice && <p className="status-message" role="status">{notice}</p>}
        {activeTab === "dashboard" && !isLoading && !loadErrors.length && (
          <>
            <div className="hero">
              <p className="label">Total Realisasi Biaya Konstruksi</p>
              <h2>{rupiah(totalRealisasi)}</h2>

              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
                />
              </div>

              <div className="summary-grid">
                <div>
                  <p>Budget</p>
                  <strong>{rupiah(totalBudget)}</strong>
                </div>
                <div>
                  <p>Sisa Budget</p>
                  <strong>{rupiah(totalBudget - totalRealisasi)}</strong>
                </div>
                <div>
                  <p>% Terpakai</p>
                  <strong>{percentage.toFixed(1)}%</strong>
                </div>
              </div>
            </div>

            <div className="card">
              <h3>Progres per Tahapan Pekerjaan</h3>

              {categoriesWithRealisasi.map((category) => {
                const pct =
                  category.budget === 0
                    ? 0
                    : (category.realisasi / category.budget) * 100;

                return (
                  <div className="category-row" key={category.name}>
                    <div className="category-top">
                      <strong>{category.name}</strong>
                      <span>{pct.toFixed(0)}%</span>
                    </div>

                    <div className="progress-bar light">
                      <div
                        className="progress-fill"
                        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                      />
                    </div>

                    <div className="category-numbers">
                      <span>Realisasi: {rupiah(category.realisasi)}</span>
                      <span>Budget: {rupiah(category.budget)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {activeTab === "input" && (
          <div className="card">
            <h3>Input Realisasi Pembayaran</h3>

            <form onSubmit={handleSubmit} className="form">
              <fieldset disabled={isSaving} className="form form-fields">
              <label htmlFor="category">Tahapan Pekerjaan</label>
              <select
                id="category"
                required
                disabled={isLoading || categories.length === 0 || loadErrors.length > 0}
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value })
                }
              >
                <option value="" disabled>{isLoading ? "Memuat tahapan..." : loadErrors.length ? "Tahapan gagal dimuat" : categories.length ? "Pilih tahapan pekerjaan" : "Belum ada tahapan pekerjaan"}</option>
                {categories.map((category) => (
                  <option key={category.name} value={category.name}>
                    {category.name}
                  </option>
                ))}
              </select>

              <label htmlFor="tanggal">Tanggal Pembayaran</label>
              <input
                id="tanggal"
                type="date"
                value={form.tanggal}
                onChange={(e) => setForm({ ...form, tanggal: e.target.value })}
                required
              />

              <label htmlFor="nominal">Nominal Realisasi</label>
              <input
                id="nominal"
                type="number"
                min="1"
                max={Number.MAX_SAFE_INTEGER}
                step="1"
                value={form.nominal}
                onChange={(e) => setForm({ ...form, nominal: e.target.value })}
                placeholder="Contoh: 5000000"
                required
              />

              <label htmlFor="vendor">Vendor / Penerima</label>
              <input
                id="vendor"
                type="text"
                value={form.vendor}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                placeholder="Contoh: Toko Bangunan Jaya"
              />

              <label htmlFor="notes">Catatan</label>
              <textarea
                id="notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Keterangan tambahan"
              />

              <div className="attachment-section">
              <label htmlFor="receipt">Lampiran Bukti Pembayaran (opsional)</label>
              <p id="receipt-help" className="field-help">Tambahkan satu foto struk atau kuitansi. JPG, PNG, atau WebP maksimal 10 MB; PDF atau HEIC maksimal 3 MB. Foto besar akan diperkecil otomatis.</p>
              <input
                id="receipt"
                ref={receiptInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif"
                aria-describedby="receipt-help receipt-error"
                onChange={handleReceiptChange}
              />
              <p id="receipt-error" className="field-error" role="alert">{fileError}</p>
              <p className="field-help">Bukti disimpan di Google Drive. Gunakan akun Google yang memiliki akses folder untuk membukanya.</p>
              {receiptFile && (
                <div className="attachment-details">
                  <span>{receiptFile.name} ({(receiptFile.size / 1024 / 1024).toFixed(2)} MB)</span>
                  <button type="button" className="secondary-button" onClick={clearReceipt}>Hapus lampiran</button>
                </div>
              )}

              {receiptPreview && (
                <div className="receipt-preview">
                  <Image
                    src={receiptPreview}
                    alt="Pratinjau bukti pembayaran"
                    width={960}
                    height={540}
                    unoptimized
                  />
                </div>
              )}
              </div>

              {formError && <p className="field-error" role="alert">{formError}</p>}
              <button type="submit" className="primary-button" disabled={isSaving || isLoading || !!loadErrors.length || !categories.length || !!fileError}>
                {isSaving ? "Menyimpan realisasi..." : "Simpan Realisasi"}
              </button>
              </fieldset>
            </form>
          </div>
        )}

        {activeTab === "laporan" && (
          <div className="card">
            <h3>Laporan Realisasi</h3>

            {isLoading || loadErrors.length ? (
              <p>Laporan akan ditampilkan setelah data berhasil dimuat.</p>
            ) : entries.length === 0 ? (
              <p>Belum ada data realisasi.</p>
            ) : (
              <div className="table-scroll"><table className="report-table">
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th>Tahapan</th>
                    <th>Vendor</th>
                    <th>Nominal</th>
                    <th>Bukti</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.tanggal}</td>
                      <td>{entry.category}</td>
                      <td>{entry.vendor || "-"}</td>
                      <td>{rupiah(entry.nominal)}</td>
                      <td>
                        {entry.receipt_url ? (
                          <a
                            href={entry.receipt_url}
                            target="_blank"
                            rel="noreferrer"
                            className="receipt-link"
                          >
                            Lihat
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="delete-button"
                          onClick={() => handleDeleteEntry(entry)}
                          disabled={deletingEntryId !== null}
                        >
                          {deletingEntryId === entry.id ? "Menghapus..." : "Hapus"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        )}

        {isAdmin && activeTab === "budget" && (
          <div className="card">
            <h3>Budget Management</h3>
            {!isLoading && !loadErrors.length && categories.map((category) => (
              <BudgetEditor key={`${category.id}-${category.budget}`} category={category} onSaved={(budget) => {
                setCategories((current) => current.map((item) => item.id === category.id ? { ...item, budget } : item));
              }} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function BudgetEditor({ category, onSaved }: { category: Category; onSaved: (budget: number) => void }) {
  const [value, setValue] = useState(String(category.budget));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError("");
    setSaving(true);
    try {
      const budget = Number(value);
      if (!value || !Number.isSafeInteger(budget) || budget < 0) throw new Error("Budget harus berupa bilangan bulat nol atau lebih.");
      const body = new FormData();
      body.set("action", "updateBudget");
      body.set("id", String(category.id));
      body.set("budget", String(budget));
      const data = await dashboardRequest<{ budget: number }>({ method: "POST", body });
      onSaved(data.budget);
    } catch (error) {
      setError("Gagal memperbarui budget. " + describeError(error));
    } finally { setSaving(false); }
  }
  return <form className="budget-editor" onSubmit={save}>
    <div className="budget-row">
      <label htmlFor={`budget-${category.id}`}>{category.name}</label>
      <input id={`budget-${category.id}`} type="number" min="0" step="1" max={Number.MAX_SAFE_INTEGER} required value={value} disabled={saving} onChange={(event) => setValue(event.target.value)} />
      <button className="secondary-button" disabled={saving || value === String(category.budget)}>{saving ? "Menyimpan..." : "Simpan"}</button>
    </div>
    {error && <p role="alert" className="field-error">{error}</p>}
  </form>;
}
