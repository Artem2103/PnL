// Dev-only. Evaluates an expression (or a file) in the driven Chrome over CDP
// (port 9223), the way dev/app-probe.mjs does, with three things that one
// lacks: `--match=<url part>` picks the page (default localhost:5174, the
// local-mode server), `--download=<dir>` redirects the browser's downloads
// there before evaluating, and `--screenshot=<file.png>` captures the page
// after. `--gesture` and `--nowait` as before. See HANDOFF.md, 2026-09-14.
// probe.mjs "<expression>" [--gesture] [--nowait] [--match=localhost:5174] [--file=path.js]
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const opt = (name) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const match = opt('match') ?? 'localhost:5174';
const file = opt('file');
const expression = file ? readFileSync(file, 'utf8') : args.find((x) => !x.startsWith('--')) ?? 'null';
const list = await fetch('http://127.0.0.1:9223/json/list').then((r) => r.json());
const page = list.find((t) => t.type === 'page' && t.url.includes(match));
if (!page) { console.log('open pages: ' + list.map((t) => t.url).join(', ')); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const dl = opt('download');
if (dl) {
  const ver = await fetch('http://127.0.0.1:9223/json/version').then((r) => r.json());
  const bws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => (bws.onopen = r));
  const done = new Promise((res) => { bws.onmessage = (e) => res(JSON.parse(e.data)); });
  bws.send(JSON.stringify({ id: 1, method: 'Browser.setDownloadBehavior', params: { behavior: 'allow', downloadPath: dl, eventsEnabled: true } }));
  console.error('download behaviour:', JSON.stringify(await done));
  bws.close();
}
const r = await send('Runtime.evaluate', {
  expression, awaitPromise: !args.includes('--nowait'), returnByValue: true, userGesture: args.includes('--gesture'),
});
console.log(JSON.stringify(r.result?.exceptionDetails?.exception?.description ?? r.result?.result?.value ?? r.result, null, 1));
const shot = opt('screenshot');
if (shot) {
  const { writeFileSync } = await import('node:fs');
  const cap = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(shot, Buffer.from(cap.result.data, 'base64'));
  console.error('screenshot:', shot);
}
ws.close();
