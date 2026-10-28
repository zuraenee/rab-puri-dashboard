const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function environment() {
  class Sheet {
    constructor() { this.rows = []; this.failAppend = false; }
    getLastRow() { return this.rows.length; }
    setFrozenRows() {}
    deleteRow(row) { this.rows.splice(row - 1, 1); }
    getRange(row, column, height = 1, width = 1) {
      const sheet = this;
      const range = {
        getValues() { return Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => {
          const value = sheet.rows[row + r - 1]?.[column + c - 1] ?? '';
          return typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value;
        })); },
        setValues(values) {
          if (sheet.failAppend && row > 1) throw Error('Write failed');
          values.forEach((valuesRow, r) => {
            sheet.rows[row + r - 1] ||= [];
            valuesRow.forEach((value, c) => { sheet.rows[row + r - 1][column + c - 1] = value; });
          });
          return range;
        },
        setValue(value) { return range.setValues([[value]]); },
        setFontWeight() { return range; },
      };
      return range;
    }
  }
  const sheets = new Map();
  const properties = new Map();
  const files = [];
  let locked = false;
  const spreadsheet = {
    getId: () => 'spreadsheet-1', getUrl: () => 'https://docs.google.com/spreadsheets/d/test',
    setSpreadsheetTimeZone() {}, getSheetByName: name => sheets.get(name),
    insertSheet(name) { const sheet = new Sheet(); sheets.set(name, sheet); return sheet; },
  };
  const folder = {
    getId: () => 'folder-1', getUrl: () => 'https://drive.google.com/drive/folders/test',
    createFile(blob) {
      const file = { blob, trashed: false, getId: () => `file-${files.length}`, getUrl: () => 'https://drive.google.com/file/d/test/view', setTrashed(value) { this.trashed = value; } };
      files.push(file); return file;
    },
  };
  const context = vm.createContext({
    console: { log() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key), setProperty: (key, value) => properties.set(key, value) }) },
    SpreadsheetApp: { create: () => spreadsheet, openById: () => spreadsheet, flush() {} },
    DriveApp: { createFolder: () => folder, getFolderById: () => folder },
    Utilities: { getUuid: () => 'generated-uuid', base64Decode: value => [...Buffer.from(value, 'base64')], newBlob: (bytes, mimeType, name) => ({ bytes, mimeType, name }), formatDate: date => date.toISOString().slice(0, 10) },
    LockService: { getScriptLock: () => ({ waitLock() { locked = true; }, tryLock() { if (locked) return false; locked = true; return true; }, releaseLock() { locked = false; } }) },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    getMigrationData: () => ({ categories: [{ id: '1', name: 'Pondasi', budget: 10000000 }, { id: '2', name: 'Struktur', budget: 20000000 }], entries: [] }),
  });
  vm.runInContext(fs.readFileSync('google-apps-script/Code.gs', 'utf8'), context);
  context.setupGoogleStorage();
  function call(action, payload = {}, secret = properties.get('API_SECRET')) {
    const result = context.doPost({ postData: { contents: JSON.stringify({ action, payload, secret }) } });
    return JSON.parse(result.text);
  }
  return { context, sheets, properties, files, call, setLocked(value) { locked = value; } };
}
const payment = (extra = {}) => ({ id: 'payment-1', category: 'Struktur', tanggal: '2026-10-28', nominal: 250000, vendor: 'Vendor', notes: 'Receipt', ...extra });
const receipt = { name: 'receipt.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-1.4').toString('base64') };

test('setup imports categories, preserves edited budgets on rerun, and lists numeric values', () => {
  const env = environment();
  assert.equal(env.call('list').data.categories.length, 2);
  assert.equal(env.call('updateBudget', { id: '1', budget: 12000000 }).ok, true);
  env.context.setupGoogleStorage();
  assert.equal(env.call('list').data.categories[0].budget, 12000000);
});

test('secret is checked before data operations; unknown actions and busy writes fail', () => {
  const env = environment();
  assert.equal(env.call('createPayment', payment(), 'wrong').status, 403);
  assert.equal(env.call('arbitraryAction').status, 400);
  env.setLocked(true);
  assert.equal(env.call('createPayment', payment()).status, 503);
  assert.equal(env.sheets.get('payments').rows.length, 1);
});

test('receipt upload and payment insertion are idempotent, including after a lost response', () => {
  const env = environment();
  const first = env.call('createPayment', payment({ receipt }));
  const retry = env.call('createPayment', payment({ receipt }));
  assert.equal(first.ok, true);
  assert.deepEqual(retry, first);
  assert.equal(env.files.length, 1);
  assert.equal(env.sheets.get('payments').rows.length, 2);
  assert.match(first.data.receipt_url, /^https:\/\/drive.google.com\//);
  assert.equal('receipt_file_id' in first.data, false);
});

test('failed spreadsheet write cleans uploaded receipt and supports a successful retry', () => {
  const env = environment();
  env.sheets.get('payments').failAppend = true;
  assert.equal(env.call('createPayment', payment({ receipt })).ok, false);
  assert.equal(env.files[0].trashed, true);
  assert.equal(env.call('list').data.entries.length, 0);
  env.sheets.get('payments').failAppend = false;
  assert.equal(env.call('createPayment', payment({ receipt })).ok, true);
});

test('unknown categories, invalid dates, amounts and files never write payments', () => {
  const env = environment();
  for (const change of [{ category: 'Missing' }, { tanggal: '2026-02-30' }, { nominal: -1 }, { nominal: 1.5 }, { nominal: '10' }, { receipt: { ...receipt, mimeType: 'text/html' } }, { receipt: { ...receipt, base64: '' } }]) {
    assert.equal(env.call('createPayment', payment(change)).status, 400);
  }
  assert.equal(env.files.length, 0);
  assert.equal(env.call('list').data.entries.length, 0);
});

test('user text is written literally, preserving its value without executing formulas', () => {
  const env = environment();
  const vendor = '=IMPORTXML("https://example.com","//a")';
  assert.equal(env.call('createPayment', payment({ vendor })).ok, true);
  assert.equal(env.sheets.get('payments').rows[1][4], "'" + vendor);
  assert.equal(env.call('list').data.entries[0].vendor, vendor);
});

test('deleting reports is retry-safe and preserves the original receipt archive', () => {
  const env = environment();
  env.call('createPayment', payment({ receipt }));
  assert.equal(env.call('deletePayment', { id: 'payment-1' }).ok, true);
  assert.equal(env.call('deletePayment', { id: 'payment-1' }).ok, true);
  assert.equal(env.call('list').data.entries.length, 0);
  assert.equal(env.files[0].trashed, false);
});

test('manual spreadsheet header mistakes produce a useful error', () => {
  const env = environment();
  env.sheets.get('categories').rows[0][1] = 'changed';
  const result = env.call('list');
  assert.equal(result.status, 503);
  assert.match(result.error, /kolom/);
});
