/* Paste into a standalone Google Apps Script project, then run setupGoogleStorage.
 * All HTTP operations require the server secret stored in Script Properties.
 */
var CATEGORY_COLUMNS_ = ['id', 'name', 'budget'];
var PAYMENT_COLUMNS_ = ['id', 'category', 'tanggal', 'nominal', 'vendor', 'notes', 'receipt_url', 'created_at', 'receipt_file_id'];
var RECEIPT_TYPES_ = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

function setupGoogleStorage() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var properties = PropertiesService.getScriptProperties();
    var spreadsheetId = properties.getProperty('SPREADSHEET_ID');
    var spreadsheet = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.create('RAB - Rumah Kos Puri');
    properties.setProperty('SPREADSHEET_ID', spreadsheet.getId());
    spreadsheet.setSpreadsheetTimeZone('Asia/Jakarta');
    ensureSheet_(spreadsheet, 'categories', CATEGORY_COLUMNS_);
    ensureSheet_(spreadsheet, 'payments', PAYMENT_COLUMNS_);
    var folderId = properties.getProperty('RECEIPTS_FOLDER_ID');
    var folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.createFolder('RAB Puri - Bukti Pembayaran');
    properties.setProperty('RECEIPTS_FOLDER_ID', folder.getId());
    if (!properties.getProperty('API_SECRET')) properties.setProperty('API_SECRET', Utilities.getUuid() + Utilities.getUuid());
    // Optional generated migration file; existing rows are never overwritten.
    if (typeof getMigrationData === 'function') importRows_(spreadsheet, getMigrationData());
    SpreadsheetApp.flush();
    console.log('Spreadsheet: ' + spreadsheet.getUrl());
    console.log('Receipt folder: ' + folder.getUrl());
    console.log('Setup complete. Copy API_SECRET from Project Settings > Script Properties into GOOGLE_SCRIPT_SECRET on Vercel.');
  } finally { lock.releaseLock(); }
}

function doGet() {
  return json_({ ok: false, status: 405, error: 'Use the dashboard to access this service.' });
}

function doPost(event) {
  var lock;
  try {
    var request;
    try { request = JSON.parse(event.postData.contents); } catch (_) { fail_('Permintaan tidak valid.', 400); }
    var secret = PropertiesService.getScriptProperties().getProperty('API_SECRET');
    if (!secret || request.secret !== secret) fail_('Kunci koneksi Google tidak sesuai. Hubungi pengelola.', 403);
    if (['list', 'createPayment', 'deletePayment', 'updateBudget'].indexOf(request.action) === -1) fail_('Tindakan tidak dikenal.', 400);
    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) fail_('Data sedang digunakan. Silakan coba lagi.', 503);
    var spreadsheet = spreadsheet_();
    var payload = request.payload || {};
    var data;
    if (request.action === 'list') data = list_(spreadsheet);
    if (request.action === 'createPayment') data = createPayment_(spreadsheet, payload);
    if (request.action === 'deletePayment') data = deletePayment_(spreadsheet, payload);
    if (request.action === 'updateBudget') data = updateBudget_(spreadsheet, payload);
    SpreadsheetApp.flush();
    return json_({ ok: true, data: data });
  } catch (error) {
    // Do not return internal Google error details, IDs or credentials to visitors.
    if (!error.apiStatus) console.error('Storage operation failed: ' + error.message);
    return json_({ ok: false, status: error.apiStatus || 502, error: error.apiStatus ? error.message : 'Penyimpanan Google belum dapat memproses permintaan. Hubungi pengelola atau coba lagi.' });
  } finally { if (lock) lock.releaseLock(); }
}

function spreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) fail_('Penyimpanan Google belum disiapkan. Jalankan setupGoogleStorage.', 503);
  return SpreadsheetApp.openById(id);
}

function ensureSheet_(spreadsheet, name, columns) {
  var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (!sheet.getLastRow()) {
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  validateSheet_(sheet, columns);
  return sheet;
}

function validateSheet_(sheet, columns) {
  if (!sheet || sheet.getRange(1, 1, 1, columns.length).getValues()[0].join('|') !== columns.join('|')) {
    fail_('Judul kolom spreadsheet berubah. Hubungi pengelola untuk memperbaikinya.', 503);
  }
}

function rows_(spreadsheet, name, columns) {
  var sheet = spreadsheet.getSheetByName(name);
  validateSheet_(sheet, columns);
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, columns.length).getValues()
    .filter(function (row) { return row[0] !== ''; })
    .map(function (row) {
      var result = {};
      columns.forEach(function (key, i) {
        result[key] = row[i] instanceof Date ? Utilities.formatDate(row[i], 'Asia/Jakarta', key === 'tanggal' ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ssXXX") : row[i];
      });
      result.id = String(result.id);
      if (name === 'categories') {
        result.name = String(result.name);
        result.budget = Number(result.budget);
        if (!result.name || !Number.isSafeInteger(result.budget) || result.budget < 0) fail_('Periksa nama dan budget pada spreadsheet categories.', 503);
      } else {
        result.nominal = Number(result.nominal);
        if (!Number.isSafeInteger(result.nominal) || result.nominal <= 0) fail_('Periksa nominal pada spreadsheet payments.', 503);
        result.receipt_url = result.receipt_url || null;
      }
      return result;
    });
}

function list_(spreadsheet) {
  var categories = rows_(spreadsheet, 'categories', CATEGORY_COLUMNS_);
  var names = categories.map(function (item) { return item.name; });
  if (names.some(function (name, i) { return names.indexOf(name) !== i; })) fail_('Nama tahapan pada spreadsheet harus unik.', 503);
  var entries = rows_(spreadsheet, 'payments', PAYMENT_COLUMNS_).map(publicPayment_);
  entries.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  return { categories: categories, entries: entries };
}

function createPayment_(spreadsheet, payload) {
  var id = id_(payload.id);
  var existing = rows_(spreadsheet, 'payments', PAYMENT_COLUMNS_).filter(function (row) { return row.id === id; })[0];
  // The client retains this ID on failure, so a retry returns the original row.
  if (existing) return publicPayment_(existing);
  var categories = rows_(spreadsheet, 'categories', CATEGORY_COLUMNS_);
  var category = text_(payload.category, 200);
  if (!categories.some(function (item) { return item.name === category; })) fail_('Tahapan pekerjaan tidak ditemukan. Muat ulang data.', 400);
  var entry = {
    id: id,
    category: category,
    tanggal: date_(payload.tanggal),
    nominal: amount_(payload.nominal, false),
    vendor: text_(payload.vendor || '', 300),
    notes: text_(payload.notes || '', 2000),
    receipt_url: '',
    created_at: new Date().toISOString(),
    receipt_file_id: ''
  };
  var file;
  if (payload.receipt) {
    var receipt = payload.receipt;
    if (RECEIPT_TYPES_.indexOf(receipt.mimeType) === -1 || typeof receipt.base64 !== 'string' || receipt.base64.length > 4194304 || !/^[A-Za-z0-9+/]*={0,2}$/.test(receipt.base64)) fail_('Lampiran tidak valid. Maksimal 3 MB.', 400);
    var bytes = Utilities.base64Decode(receipt.base64);
    if (!bytes.length || bytes.length > 3145728) fail_('Lampiran terlalu besar atau kosong. Maksimal 3 MB.', 400);
    var folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('RECEIPTS_FOLDER_ID'));
    var name = text_(receipt.name, 150).replace(/[\\/\x00-\x1f]/g, '_') || 'receipt';
    file = folder.createFile(Utilities.newBlob(bytes, receipt.mimeType, id + '-' + name));
    // Inherit the folder's sharing settings; never make receipts public here.
    entry.receipt_url = file.getUrl();
    entry.receipt_file_id = file.getId();
  }
  try {
    append_(spreadsheet.getSheetByName('payments'), PAYMENT_COLUMNS_, entry);
    SpreadsheetApp.flush();
  } catch (error) {
    // A flush may fail after the append succeeded. Keep a committed receipt.
    var committed = rows_(spreadsheet, 'payments', PAYMENT_COLUMNS_).some(function (row) { return row.id === id; });
    if (committed) return publicPayment_(entry);
    if (file) { try { file.setTrashed(true); } catch (_) { console.error('Receipt cleanup requires attention: ' + id); } }
    throw error;
  }
  return publicPayment_(entry);
}

function deletePayment_(spreadsheet, payload) {
  var id = id_(payload.id);
  var sheet = spreadsheet.getSheetByName('payments');
  validateSheet_(sheet, PAYMENT_COLUMNS_);
  var rowNumber = findRow_(sheet, id);
  if (rowNumber) sheet.deleteRow(rowNumber);
  // Keep the receipt in Drive as an archive; deleting a report is not a
  // request to permanently delete the original supporting document.
  return { id: id };
}

function updateBudget_(spreadsheet, payload) {
  var id = id_(payload.id);
  var budget = amount_(payload.budget, true);
  var sheet = spreadsheet.getSheetByName('categories');
  validateSheet_(sheet, CATEGORY_COLUMNS_);
  var rowNumber = findRow_(sheet, id);
  if (!rowNumber) fail_('Tahapan pekerjaan tidak ditemukan.', 404);
  sheet.getRange(rowNumber, 3).setValue(budget);
  return { id: id, budget: budget };
}

function findRow_(sheet, id) {
  if (sheet.getLastRow() < 2) return 0;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) if (String(values[i][0]) === id) return i + 2;
  return 0;
}

function importRows_(spreadsheet, backup) {
  [['categories', CATEGORY_COLUMNS_, backup.categories || []], ['payments', PAYMENT_COLUMNS_, backup.entries || []]].forEach(function (group) {
    var sheet = spreadsheet.getSheetByName(group[0]);
    group[2].forEach(function (row) {
      if (!findRow_(sheet, String(row.id))) append_(sheet, group[1], row);
    });
  });
}

function append_(sheet, columns, data) {
  var values = columns.map(function (key) {
    var value = data[key] == null ? '' : data[key];
    // Store user-entered text literally, never as a spreadsheet formula.
    return typeof value === 'string' && /^[=+@-]/.test(value) ? "'" + value : value;
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, columns.length).setValues([values]);
}

function publicPayment_(entry) {
  var result = {};
  PAYMENT_COLUMNS_.forEach(function (key) { if (key !== 'receipt_file_id') result[key] = entry[key]; });
  result.receipt_url = result.receipt_url || null;
  return result;
}

function id_(value) {
  var result = String(value || '');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(result)) fail_('ID tidak valid.', 400);
  return result;
}
function text_(value, max) {
  if (typeof value !== 'string' || value.length > max) fail_('Isian formulir tidak valid.', 400);
  return value.trim();
}
function amount_(value, zeroAllowed) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (zeroAllowed ? 0 : 1)) fail_('Nominal tidak valid.', 400);
  return value;
}
function date_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail_('Tanggal pembayaran tidak valid.', 400);
  return value;
}
function fail_(message, status) { var error = new Error(message); error.apiStatus = status; throw error; }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
