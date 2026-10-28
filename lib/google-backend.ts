// Imported only by the server route. Never expose these values with NEXT_PUBLIC_.
export class BackendError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

export async function callGoogleBackend(action: string, payload: unknown = {}) {
  const endpoint = process.env.GOOGLE_SCRIPT_URL;
  const secret = process.env.GOOGLE_SCRIPT_SECRET;
  if (!endpoint || !secret) {
    throw new BackendError("Penyimpanan Google belum terhubung. Minta pengelola menyelesaikan pengaturan Google Sheets dan Drive.", 503);
  }
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new BackendError("Alamat koneksi Google belum benar. Hubungi pengelola.", 503); }
  if (url.protocol !== "https:" || url.hostname !== "script.google.com" || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname) || url.search || url.hash) {
    throw new BackendError("Gunakan URL deployment Google Apps Script yang berakhir dengan /exec.", 503);
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, action, payload }),
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new BackendError("Google belum merespons. Coba lagi; permintaan pembayaran yang sama tidak akan disimpan dua kali.");
  }
  let result;
  try { result = await response.json(); } catch {
    throw new BackendError("Koneksi Google belum siap. Periksa deployment Apps Script dan izin aksesnya.");
  }
  if (!response.ok || !result || typeof result !== "object") throw new BackendError("Google belum dapat memproses permintaan.");
  if (!result.ok) {
    const status = Number(result.status);
    throw new BackendError(String(result.error || "Permintaan Google gagal."), [400, 403, 404, 409, 503].includes(status) ? status : 502);
  }
  return result.data;
}
