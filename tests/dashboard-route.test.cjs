const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the real TS route and backend with only the outbound fetch replaced.
function loadRoute(env = {}, mockFetch = async () => Response.json({ ok: true, data: { categories: [], entries: [] } })) {
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const context = vm.createContext({
      exports: module.exports, module,
      require(name) { return load(path.resolve(name.startsWith('@/') ? name.slice(2) : path.join(path.dirname(file), name)) + '.ts'); },
      process: { env }, fetch: mockFetch, Response, Request, FormData, File, Buffer, URL, AbortSignal, console,
    });
    vm.runInContext(source, context, { filename: file });
    return module.exports;
  }
  return load(path.resolve('app/api/dashboard/route.ts'));
}
const configured = { GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/deployment-id/exec', GOOGLE_SCRIPT_SECRET: 'server-secret' };
function post(values, origin = 'https://dashboard.example') {
  const form = new FormData();
  Object.entries(values).forEach(([key, value]) => form.set(key, value));
  return new Request('https://dashboard.example/api/dashboard', { method: 'POST', headers: { Origin: origin }, body: form });
}
const payment = { action: 'createPayment', id: 'test-payment', category: 'Pondasi', tanggal: '2026-10-28', nominal: '200000', vendor: 'Vendor' };

test('missing configuration returns a visible setup error without leaking env values', async () => {
  const route = loadRoute();
  const response = await route.GET();
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Google belum terhubung/);
});

test('server fetch follows Google redirects and never returns the secret to the browser', async () => {
  let sent;
  const route = loadRoute(configured, async (url, init) => {
    sent = { url: String(url), ...init };
    return Response.json({ ok: true, data: { categories: [{ id: '1', name: 'Pondasi', budget: 500000 }], entries: [] } });
  });
  const response = await route.GET();
  assert.equal(response.status, 200);
  assert.equal(sent.redirect, 'follow');
  assert.equal(sent.cache, 'no-store');
  assert.equal(JSON.parse(sent.body).secret, 'server-secret');
  assert.equal((await response.text()).includes('server-secret'), false);
});

test('only an Apps Script deployment URL is accepted', async () => {
  for (const endpoint of ['https://attacker.example/exec', 'http://script.google.com/macros/s/id/exec', 'https://script.google.com/macros/s/id/dev']) {
    const route = loadRoute({ ...configured, GOOGLE_SCRIPT_URL: endpoint }, async () => { throw Error('must not fetch'); });
    assert.equal((await route.GET()).status, 503);
  }
});

test('multipart payment and attachment are validated and encoded for Drive', async () => {
  let sent;
  const route = loadRoute(configured, async (_, init) => {
    sent = JSON.parse(init.body);
    return Response.json({ ok: true, data: { id: sent.payload.id } });
  });
  const response = await route.POST(post({ ...payment, receipt: new File(['%PDF-1.4'], 'receipt.pdf', { type: 'application/pdf' }) }));
  assert.equal(response.status, 200);
  assert.equal(sent.action, 'createPayment');
  assert.equal(sent.payload.nominal, 200000);
  assert.equal(Buffer.from(sent.payload.receipt.base64, 'base64').toString(), '%PDF-1.4');
});

test('bad dates, files, amounts, actions and cross-origin writes never reach Google', async () => {
  let calls = 0;
  const route = loadRoute(configured, async () => { calls++; return Response.json({ ok: true }); });
  for (const change of [{ tanggal: '2026-02-30' }, { nominal: '-1' }, { nominal: 'NaN' }, { action: 'unknown' }, { id: '../../path' }, { receipt: new File(['html'], 'receipt.html', { type: 'text/html' }) }]) {
    assert.equal((await route.POST(post({ ...payment, ...change }))).status, 400);
  }
  assert.equal((await route.POST(post(payment, 'https://other.example'))).status, 403);
  assert.equal((await route.POST(post({ ...payment, receipt: new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'receipt.pdf', { type: 'application/pdf' }) }))).status, 413);
  assert.equal(calls, 0);
});

test('malformed Google deployment and network failures become actionable errors', async () => {
  let route = loadRoute(configured, async () => new Response('<html>Sign in</html>'));
  let response = await route.GET();
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /deployment/);
  route = loadRoute(configured, async () => { throw Error('network'); });
  response = await route.GET();
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Coba lagi/);
});
