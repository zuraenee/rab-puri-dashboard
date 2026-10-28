// Optional local browser check: start the production server on port 3100 and
// a disposable headless Chrome profile with --remote-debugging-port=9223.
// Google responses are simulated. No live records or files are changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const pages = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = pages.find(item => item.type === 'page');
  if (!page) throw Error('No disposable Chrome page found.');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const nextId = ++id;
      const timeout = setTimeout(() => { pending.delete(nextId); reject(Error('CDP timed out: ' + method)); }, 15000);
      pending.set(nextId, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id: nextId, method, params }));
    });
  }
  const categories = [{ id: '1', name: 'Pondasi', budget: 10000000 }, { id: '2', name: 'Struktur', budget: 20000000 }];
  const entries = [];
  const requests = [];
  const exceptions = [];
  let mode = 'success';
  let mocking = false;
  socket.addEventListener('message', async event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const call = pending.get(message.id);
      pending.delete(message.id);
      if (call) {
        clearTimeout(call.timeout);
        message.error ? call.reject(message.error) : call.resolve(message.result);
      }
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    if (!mocking) { await send('Fetch.continueRequest', { requestId }); return; }
    let status = 200;
    let result = { ok: true, data: { categories, entries } };
    if (mode === 'offline') { status = 503; result = { ok: false, error: 'Simulated connection error' }; }
    else if (mode === 'empty') result.data = { categories: [], entries: [] };
    else if (request.method === 'POST') {
      requests.push(request);
      if (mode === 'save-fail') { status = 502; result = { ok: false, error: 'Simulated save failure' }; }
      else if (mode === 'budget') { categories[0].budget = 12000000; result.data = { budget: 12000000 }; }
      else {
        const entry = { id: 'payment-' + requests.length, category: 'Struktur', tanggal: '2026-10-28', nominal: 250000, vendor: 'Test', notes: '', receipt_url: 'https://drive.google.com/file/d/test/view', created_at: new Date().toISOString() };
        entries.unshift(entry);
        result.data = entry;
      }
    }
    await send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(result)).toString('base64') });
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('Timed out: ' + expression + '\n' + await evaluate('document.body.innerText'));
  };
  const navigate = async (url = '/') => {
    await send('Page.navigate', { url: 'http://127.0.0.1:3100' + url });
    await waitFor('document.querySelector(".tabs") && !document.body.innerText.includes("Memuat data...")');
  };
  const tab = text => evaluate(`Array.from(document.querySelectorAll('.tabs button')).find(button => button.textContent === ${JSON.stringify(text)}).click()`);
  const fill = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`);
  async function attach(file) {
    const { root } = await send('DOM.getDocument');
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#receipt' });
    await send('DOM.setFileInputFiles', { nodeId, files: [path.resolve(file)] });
  }
  async function fillForm() { await fill('#category', 'Struktur'); await fill('#tanggal', '2026-10-28'); await fill('#nominal', '250000'); }
  const fixtures = path.resolve('.next/browser-fixtures');
  fs.mkdirSync(fixtures, { recursive: true });
  fs.writeFileSync(path.join(fixtures, 'receipt.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6CkAAAAASUVORK5CYII=', 'base64'));
  fs.writeFileSync(path.join(fixtures, 'large-photo.png'), Buffer.concat([fs.readFileSync(path.join(fixtures, 'receipt.png')), Buffer.alloc(3 * 1024 * 1024)]));
  fs.writeFileSync(path.join(fixtures, 'receipt.pdf'), '%PDF-1.4\n%%EOF');
  fs.writeFileSync(path.join(fixtures, 'large.pdf'), new Uint8Array(3 * 1024 * 1024 + 1));
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    const validPng = await evaluate(`(() => { const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 20; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#eeeeee'; ctx.fillRect(0, 0, 20, 20); return canvas.toDataURL('image/png').split(',')[1]; })()`);
    fs.writeFileSync(path.join(fixtures, 'large-photo.png'), Buffer.concat([Buffer.from(validPng, 'base64'), Buffer.alloc(3 * 1024 * 1024)]));
    await send('Fetch.enable', { patterns: [{ urlPattern: '*127.0.0.1:3100/api/dashboard*' }] });
    await navigate();
    assert.match(await evaluate('document.body.innerText'), /Google belum terhubung/);
    console.log('PASS actual server shows Google setup state');
    mocking = true;
    await evaluate('document.querySelector(".status-message button").click()');
    await waitFor('!document.body.innerText.includes("Memuat data...") && !document.body.innerText.includes("Data belum berhasil dimuat")');
    await tab('Dashboard');
    assert.match(await evaluate('document.querySelector(".hero").innerText'), /Rp 30.000.000/);
    await tab('Input Realisasi');
    await fillForm();
    await evaluate(`(() => {
      const originalFetch = window.fetch;
      window.__submissions = [];
      window.fetch = (input, options) => {
        if (options?.body instanceof FormData) {
          const file = options.body.get('receipt');
          window.__submissions.push({ id: options.body.get('id'), size: file?.size, type: file?.type });
        }
        return originalFetch(input, options);
      };
    })()`);
    assert.equal(await evaluate('document.querySelector("#category").value'), 'Struktur');
    console.log('PASS category dropdown and budget totals');
    await attach(path.join(fixtures, 'receipt.png'));
    await waitFor('!!document.querySelector(".receipt-preview img")');
    await evaluate('document.querySelector(".attachment-details button").click()');
    assert.equal(await evaluate('document.querySelector("#receipt").files.length'), 0);
    await attach(path.join(fixtures, 'large.pdf'));
    await waitFor('document.querySelector("#receipt-error").textContent.length > 0');
    assert.equal(await evaluate('document.querySelector("button[type=submit]").disabled'), true);
    console.log('PASS photo preview, removal and oversized PDF rejection');
    await attach(path.join(fixtures, 'receipt.pdf'));
    await evaluate('document.querySelector("button[type=submit]").click(); document.querySelector("button[type=submit]").click()');
    await waitFor('document.body.innerText.includes("Realisasi berhasil disimpan")');
    assert.equal(requests.length, 1);
    assert.match(await evaluate('document.querySelector(".receipt-link").href'), /drive.google.com/);
    console.log('PASS receipt submission, report link and duplicate-submit guard');
    await tab('Input Realisasi');
    assert.equal(await evaluate('document.querySelector("#nominal").value'), '');
    await fillForm();
    await attach(path.join(fixtures, 'receipt.png'));
    mode = 'save-fail';
    await evaluate('document.querySelector("button[type=submit]").click()');
    await waitFor('document.body.innerText.includes("Simulated save failure")');
    assert.equal(await evaluate('document.querySelector("#nominal").value'), '250000');
    assert.ok(await evaluate('!!document.querySelector(".receipt-preview")'));
    console.log('PASS failed save retains draft and attachment');
    await attach(path.join(fixtures, 'large-photo.png'));
    mode = 'success';
    await evaluate('document.querySelector("button[type=submit]").click()');
    await waitFor('document.body.innerText.includes("Realisasi berhasil disimpan")');
    const submissions = await evaluate('window.__submissions');
    assert.equal(submissions[1].id, submissions[2].id);
    assert.equal(submissions[2].type, 'image/jpeg');
    assert.ok(submissions[2].size < 3 * 1024 * 1024);
    console.log('PASS large-photo compression and request-ID reuse on retry');
    mode = 'offline';
    await tab('Input Realisasi');
    await navigate();
    assert.equal(await evaluate('document.querySelector("#category").disabled'), true);
    mode = 'success';
    await evaluate('document.querySelector(".status-message button").click()');
    await waitFor('!document.body.innerText.includes("Memuat data...") && !document.body.innerText.includes("Data belum berhasil dimuat")');
    assert.equal(await evaluate('document.querySelector("#category").disabled'), false);
    console.log('PASS connection error and retry');
    mode = 'empty';
    await navigate();
    assert.equal(await evaluate('document.querySelector("#category").disabled'), true);
    mode = 'success';
    await navigate('/admin');
    await tab('Budget');
    await fill('#budget-1', '12000000');
    mode = 'budget';
    await evaluate('document.querySelector(".budget-row button").click()');
    await waitFor('document.querySelector(".budget-row button").disabled && document.querySelector(".budget-row button").textContent === "Simpan"');
    assert.equal(categories[0].budget, 12000000);
    await navigate('/');
    await waitFor('!!document.querySelector(".hero")');
    assert.equal(exceptions.length, 0);
    console.log('PASS empty categories, budget saving, public tab recovery and no uncaught errors');
  } finally {
    await send('Fetch.disable');
    await send('Browser.close');
    socket.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
