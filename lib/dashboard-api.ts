import { RECEIPT_MAX_BYTES } from "./dashboard-types";

export async function dashboardRequest<T>(options?: RequestInit): Promise<T> {
  const response = await fetch("/api/dashboard", {
    ...options,
    cache: "no-store",
    signal: AbortSignal.timeout(55000),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(response.status === 413
      ? "Lampiran terlalu besar. Pilih file maksimal 3 MB."
      : "Server belum dapat memproses permintaan. Silakan coba lagi.");
  }
  if (!response.ok || !result.ok) throw new Error(result.error || "Permintaan gagal. Silakan coba lagi.");
  return result.data as T;
}

// Keep the multipart upload below Vercel's payload limit. Large photos are
// resized locally; originals are never sent to a third-party image service.
export async function prepareReceipt(file: File): Promise<File> {
  if (file.size <= RECEIPT_MAX_BYTES) return file;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("PDF dan foto HEIC harus maksimal 3 MB. Pilih file lebih kecil atau gunakan foto JPG.");
  }
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch {
    throw new Error("Foto tidak dapat dibaca. Pilih foto lain atau file yang lebih kecil.");
  }
  try {
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Foto tidak dapat diproses. Pilih foto lebih kecil.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .82));
    if (!blob || blob.size > RECEIPT_MAX_BYTES) throw new Error("Foto masih terlalu besar. Pilih foto lebih kecil.");
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
