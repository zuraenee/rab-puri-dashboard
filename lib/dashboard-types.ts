export type Category = { id: string | number; name: string; budget: number };

export type Entry = {
  id: string | number;
  category: string;
  tanggal: string;
  nominal: number;
  vendor: string | null;
  notes: string | null;
  receipt_url: string | null;
  created_at: string;
};

export type DashboardData = { categories: Category[]; entries: Entry[] };

export const RECEIPT_MAX_BYTES = 3 * 1024 * 1024;
export const RECEIPT_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf",
];

export function describeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Terjadi kesalahan. Silakan coba lagi.";
  if (/fetch|network|timeout|aborted/i.test(message)) {
    return "Tidak dapat terhubung ke server. Periksa koneksi internet, lalu coba lagi.";
  }
  return message;
}
