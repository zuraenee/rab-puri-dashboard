import { BackendError, callGoogleBackend } from "@/lib/google-backend";
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES } from "@/lib/dashboard-types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };
function failure(error: unknown) {
  if (error instanceof BackendError) return Response.json({ ok: false, error: error.message }, { status: error.status, headers });
  return Response.json({ ok: false, error: "Permintaan tidak dapat diproses. Silakan coba lagi." }, { status: 500, headers });
}
function text(form: FormData, key: string, max = 2000) {
  const value = form.get(key);
  if (value !== null && typeof value !== "string") throw new BackendError("Isian formulir tidak valid.", 400);
  const result = (value || "").trim();
  if (result.length > max) throw new BackendError("Isian formulir terlalu panjang.", 400);
  return result;
}
function id(value: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new BackendError("ID tidak valid.", 400);
  return value;
}
function amount(value: string, allowZero = false) {
  const number = Number(value);
  if (!value || !Number.isSafeInteger(number) || number < (allowZero ? 0 : 1)) throw new BackendError("Nominal tidak valid.", 400);
  return number;
}
function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new BackendError("Tanggal pembayaran tidak valid.", 400);
  return value;
}

export async function GET() {
  try {
    const data = await callGoogleBackend("list");
    return Response.json({ ok: true, data }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    // The browser only sends to its own host. The Apps Script secret stays here.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new BackendError("Asal permintaan tidak diizinkan.", 403);
    if (Number(request.headers.get("content-length")) > RECEIPT_MAX_BYTES + 100000) throw new BackendError("Lampiran terlalu besar. Maksimal 3 MB setelah foto diperkecil.", 413);
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new BackendError("Format formulir tidak valid.", 400);
    let form: FormData;
    try { form = await request.formData(); } catch { throw new BackendError("Formulir tidak valid.", 400); }
    const action = text(form, "action", 30);
    let payload;
    if (action === "createPayment") {
      const attachment = form.get("receipt");
      let receipt = null;
      if (attachment instanceof File && attachment.size > 0) {
        if (attachment.size > RECEIPT_MAX_BYTES) throw new BackendError("Lampiran terlalu besar. Maksimal 3 MB.", 413);
        if (!RECEIPT_TYPES.includes(attachment.type)) throw new BackendError("Jenis lampiran tidak didukung.", 400);
        receipt = { name: attachment.name.slice(0, 150), mimeType: attachment.type, base64: Buffer.from(await attachment.arrayBuffer()).toString("base64") };
      } else if (attachment !== null) throw new BackendError("Lampiran tidak valid atau kosong.", 400);
      payload = {
        id: id(text(form, "id", 80)),
        category: text(form, "category", 200),
        tanggal: date(text(form, "tanggal", 10)),
        nominal: amount(text(form, "nominal", 30)),
        vendor: text(form, "vendor", 300),
        notes: text(form, "notes"),
        receipt,
      };
      if (!payload.category) throw new BackendError("Pilih tahapan pekerjaan.", 400);
    } else if (action === "deletePayment") {
      payload = { id: id(text(form, "id", 80)) };
    } else if (action === "updateBudget") {
      payload = { id: id(text(form, "id", 80)), budget: amount(text(form, "budget", 30), true) };
    } else throw new BackendError("Tindakan tidak dikenal.", 400);
    const data = await callGoogleBackend(action, payload);
    return Response.json({ ok: true, data }, { headers });
  } catch (error) { return failure(error); }
}
