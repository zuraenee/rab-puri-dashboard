"use client";

import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";

function rupiah(amount: number) {
  return "Rp " + amount.toLocaleString("id-ID");
}

type Category = {
  id: number;
  name: string;
  budget: number;
};

type Entry = {
  id: number;
  category: string;
  tanggal: string;
  nominal: number;
  vendor: string | null;
  notes: string | null;
  created_at: string;
};

type DashboardClientProps = {
  isAdmin?: boolean;
};

export function DashboardClient({ isAdmin = false }: DashboardClientProps) {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [deletingEntryId, setDeletingEntryId] = useState<number | null>(null);
  const [form, setForm] = useState({
    category: "",
    tanggal: "",
    nominal: "",
    vendor: "",
    notes: "",
  });

  useEffect(() => {
    async function fetchCategories() {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .order("id", { ascending: true });

      if (error) {
        console.error("Error fetching categories:", error);
        return;
      }

      setCategories(data || []);

      if (data && data.length > 0) {
        setForm((currentForm) => ({
          ...currentForm,
          category: currentForm.category || data[0].name,
        }));
      }
    }

    fetchCategories();
  }, []);

  useEffect(() => {
    async function fetchPayments() {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching payments:", error);
        return;
      }

      setEntries(data || []);
    }

    fetchPayments();
  }, []);

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

  const totalRealisasi = categoriesWithRealisasi.reduce(
    (sum, item) => sum + item.realisasi,
    0
  );

  const percentage = totalBudget === 0 ? 0 : (totalRealisasi / totalBudget) * 100;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const newPayment = {
      category: form.category,
      tanggal: form.tanggal,
      nominal: Number(form.nominal),
      vendor: form.vendor,
      notes: form.notes,
    };

    const { data, error } = await supabase
      .from("payments")
      .insert(newPayment)
      .select()
      .single();

    if (error) {
      console.error("Error saving payment:", error);
      alert("Gagal menyimpan pembayaran.");
      return;
    }

    setEntries((currentEntries) => [data, ...currentEntries]);

    setForm({
      category: categories[0]?.name || "",
      tanggal: "",
      nominal: "",
      vendor: "",
      notes: "",
    });

    setActiveTab("dashboard");
  }

  async function handleDeleteEntry(entry: Entry) {
    const confirmed = window.confirm(
      `Hapus laporan ${entry.category} sebesar ${rupiah(entry.nominal)}?`
    );

    if (!confirmed) {
      return;
    }

    setDeletingEntryId(entry.id);

    const { error } = await supabase
      .from("payments")
      .delete()
      .eq("id", entry.id);

    setDeletingEntryId(null);

    if (error) {
      console.error("Error deleting payment:", error);
      alert("Gagal menghapus laporan.");
      return;
    }

    setEntries((currentEntries) =>
      currentEntries.filter((currentEntry) => currentEntry.id !== entry.id)
    );
  }

  return (
    <main>
      <header className="app-header">
        <h1>Monitoring RAB - Rumah Kos Puri</h1>
        <p>Puri, Kembangan, Jakarta Barat</p>
      </header>

      <div className="tabs">
        <button
          className={activeTab === "dashboard" ? "active" : ""}
          onClick={() => setActiveTab("dashboard")}
        >
          Dashboard
        </button>

        <button
          className={activeTab === "input" ? "active" : ""}
          onClick={() => setActiveTab("input")}
        >
          Input Realisasi
        </button>

        <button
          className={activeTab === "laporan" ? "active" : ""}
          onClick={() => setActiveTab("laporan")}
        >
          Laporan
        </button>

        {isAdmin && (
          <button
            className={activeTab === "budget" ? "active" : ""}
            onClick={() => setActiveTab("budget")}
          >
            Budget
          </button>
        )}
      </div>

      <section className="container">
        {activeTab === "dashboard" && (
          <>
            <div className="hero">
              <p className="label">Total Realisasi Biaya Konstruksi</p>
              <h2>{rupiah(totalRealisasi)}</h2>

              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${percentage}%` }}
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
                        style={{ width: `${pct}%` }}
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
              <label>Tahapan Pekerjaan</label>
              <select
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value })
                }
              >
                {categories.map((category) => (
                  <option key={category.name} value={category.name}>
                    {category.name}
                  </option>
                ))}
              </select>

              <label>Tanggal Pembayaran</label>
              <input
                type="date"
                value={form.tanggal}
                onChange={(e) => setForm({ ...form, tanggal: e.target.value })}
                required
              />

              <label>Nominal Realisasi</label>
              <input
                type="number"
                value={form.nominal}
                onChange={(e) => setForm({ ...form, nominal: e.target.value })}
                placeholder="Contoh: 5000000"
                required
              />

              <label>Vendor / Penerima</label>
              <input
                type="text"
                value={form.vendor}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                placeholder="Contoh: Toko Bangunan Jaya"
              />

              <label>Catatan</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Keterangan tambahan"
              />

              <button type="submit" className="primary-button">
                Simpan Realisasi
              </button>
            </form>
          </div>
        )}

        {activeTab === "laporan" && (
          <div className="card">
            <h3>Laporan Realisasi</h3>

            {entries.length === 0 ? (
              <p>Belum ada data realisasi.</p>
            ) : (
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th>Tahapan</th>
                    <th>Vendor</th>
                    <th>Nominal</th>
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
                        <button
                          type="button"
                          className="delete-button"
                          onClick={() => handleDeleteEntry(entry)}
                          disabled={deletingEntryId === entry.id}
                        >
                          {deletingEntryId === entry.id ? "Menghapus..." : "Hapus"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {isAdmin && activeTab === "budget" && (
          <div className="card">
            <h3>Budget Management</h3>
            {categories.map((category, index) => (
              <div key={category.id} className="budget-row">
                <span>{category.name}</span>
                <input
                  type="number"
                  value={category.budget}
                  onChange={async (e) => {
                    const newBudget = Number(e.target.value);

                    const updated = [...categories];
                    updated[index].budget = newBudget;
                    setCategories(updated);

                    const { error } = await supabase
                      .from("categories")
                      .update({ budget: newBudget })
                      .eq("id", category.id);

                    if (error) {
                      console.error("Error updating budget:", error);
                      alert("Gagal memperbarui budget.");
                    }
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
