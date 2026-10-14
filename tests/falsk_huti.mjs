/* En falsk huti-MCP til proeverne (tests/huti.test.mjs). Svarer som den rigtige
 * huti/app/mcp.js: POST /mcp, JSON-RPC 2.0 (ogsaa en batch), Bearer-noegle, 401 uden
 * gyldig noegle, 403 ved en fremmed Origin, `tools/list` viser kun det, scopet maa,
 * `tools/call` returnerer { content:[{type:'text',text}], structuredContent } og
 * isError ved afvisning. `pantry_for_planning` har samme felter som hutis.
 *
 * `f.tilstand` styrer fejlstierne: 'ok' | 'sse' | '401' | 'timeout' | 'html' | '500'
 * | 'redirect' | 'ondsindet'. `f.kald` gemmer hvert kald (headere + krop). */
import http from 'node:http';

export const LAESENOEGLE = 'huti_laes_proeve_0123456789abcdef';
export const SKRIVENOEGLE = 'huti_skriv_proeve_0123456789abcdef';
export const HEMMELIG_KROP = 'HEMMELIG-HUTI-KROP-MAA-ALDRIG-VISES';

export const VARER = () => [
  { id: 11, name: 'Hjortekølle', word: 'hjortekølle', quantity: 1, unit: 'pcs', category: 'game', place: 'Fryser › Skuffe 2', mode: 'freezer',
    status: 'eat_soon', pastLimit: false, daysLeft: 5, bestBefore: null, frozenAt: '2025-11-01', ageDays: 347,
    origin: { species: 'red_deer', killedOn: '2025-10-30', area: 'Revir Nord' } },
  { id: 12, name: 'Hakket vildt 500 g', word: 'hakket vildt', quantity: 2, unit: 'bags', category: 'game_minced', place: 'Fryser › Skuffe 1', mode: 'freezer',
    status: 'eat_soon', pastLimit: true, daysLeft: -3, bestBefore: null, frozenAt: '2025-01-01', ageDays: 650, origin: null },
  { id: 13, name: 'Arla piskefløde', word: 'piskefløde', quantity: 1, unit: 'pcs', category: 'dairy', place: 'Køleskab', mode: 'bestbefore',
    status: 'ok', pastLimit: false, daysLeft: 8, bestBefore: '2026-10-22', frozenAt: '2026-10-10', ageDays: 4, origin: null },
  { id: 14, name: 'Kyllingebryst', word: 'kyllingebryst', quantity: 4, unit: 'pcs', category: 'poultry', place: 'Fryser', mode: 'freezer',
    status: 'ok', pastLimit: false, daysLeft: 200, bestBefore: null, frozenAt: '2026-09-01', ageDays: 43 }   // uden origin-felt
];

const ONDSINDET = () => [
  { id: 21, name: '<img src=x onerror=alert(1)>Laks', word: '<b>laks</b>', quantity: 'mange', unit: '<script>', place: 'javascript:alert(1)',
    status: 'eat_soon', bestBefore: 'i morgen', ageDays: 1e12, origin: { species: '"><script>', area: '<i>x</i>' } },
  { id: 'javascript:alert(1)', name: 'Uden gyldigt id' },
  { id: 22, name: '\u0000\u2028Torsk' + 'x'.repeat(500), word: 'torsk', quantity: 1e9, unit: 'kg', status: 'ok' }
];

export async function startFalskHuti() {
  /* `andre`: ikke-madvarer (huti v3: kind != food). pantry_for_planning viser dem ALDRIG,
   * men take_stock tager dem gerne ud - sikkerhedsreviewet viste ammunition. */
  const f = { tilstand: 'ok', kald: [], varer: VARER(), andre: [{ id: 77, name: 'Riffelpatroner 9,3x62', quantity: 20, unit: 'pcs' }], taget: [] };
  const server = http.createServer((req, res) => {
    const dele = [];
    req.on('data', (d) => dele.push(d));
    req.on('end', () => {
      const tekst = Buffer.concat(dele).toString('utf8');
      let krop = null;
      try { krop = JSON.parse(tekst); } catch (e) { /* tom */ }
      f.kald.push({ url: req.url, metode: req.method, headere: req.headers, krop });
      if (req.url === '/andet/mcp') { f.andetRamt = true; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return; }
      if (req.url !== '/mcp' || req.method !== 'POST') { res.writeHead(404); res.end(); return; }
      if (f.tilstand === 'timeout') return;                       // svarer aldrig
      if (f.tilstand === 'redirect') { res.writeHead(302, { location: '/andet/mcp' }); res.end(); return; }
      if (f.tilstand === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<html><body>${HEMMELIG_KROP}</body></html>`); return; }
      if (f.tilstand === '500') { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: HEMMELIG_KROP })); return; }
      if (req.headers.origin) { res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"bad_origin"}'); return; }
      const auth = String(req.headers.authorization || '');
      const scope = auth === `Bearer ${LAESENOEGLE}` ? 'read' : auth === `Bearer ${SKRIVENOEGLE}` ? 'write' : null;
      if (!scope || f.tilstand === '401') {
        res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="huti"' });
        res.end(JSON.stringify({ error: 'invalid_token', message: HEMMELIG_KROP }));
        return;
      }
      if (!krop) { res.writeHead(400); res.end(); return; }
      const svar = (Array.isArray(krop) ? krop : [krop]).map((b) => behandl(f, b, scope));
      const ud = Array.isArray(krop) ? svar : svar[0];
      if (f.tilstand === 'sse') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`event: message\ndata: ${JSON.stringify(ud)}\n\n`);
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(ud));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  f.base = `http://127.0.0.1:${server.address().port}`;
  f.stop = () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); });
  return f;
}

function behandl(f, b, scope) {
  const { id, method, params } = b || {};
  if (method === 'tools/list') {
    const alle = [{ name: 'pantry_for_planning', annotations: { readOnlyHint: true } }, { name: 'freezer_contents', annotations: { readOnlyHint: true } }];
    if (scope === 'write') alle.push({ name: 'take_stock', annotations: { readOnlyHint: false } });
    return { jsonrpc: '2.0', id, result: { tools: alle } };
  }
  if (method !== 'tools/call') return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
  const navn = params && params.name;
  const a = (params && params.arguments) || {};
  if (navn === 'pantry_for_planning') {
    const items = f.tilstand === 'ondsindet' ? ONDSINDET() : f.varer;
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Food: ${items.length} item(s)` }],
      structuredContent: { today: '2026-10-14', total: items.length, eatSoon: items.filter((x) => x.status === 'eat_soon').length, items } } };
  }
  if (navn === 'take_stock') {
    if (scope !== 'write') return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: 'take_stock changes data, but this connection only has read access.' }] } };
    const sid = Number(String(a.stock || '').replace(/^#/, ''));
    const v = f.varer.find((x) => x.id === sid) || f.andre.find((x) => x.id === sid);
    if (!v) return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `No stock #${sid}.` }] } };
    const taget = a.amount || 1;
    v.quantity = Math.max(0, v.quantity - taget);
    f.taget.push({ id: sid, amount: a.amount, how: a.how });
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Took' }], structuredContent: { stock: { id: v.id, name: v.name, quantity: v.quantity, unit: v.unit }, taken: taget } } };
  }
  return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${navn}` } };
}
