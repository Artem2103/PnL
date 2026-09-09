// Dev-only. Evaluates an expression in the driven Chrome, optionally as a user
// gesture, so the real buttons can be pressed the way a person presses them.
const list = await fetch('http://127.0.0.1:9223/json/list').then((r) => r.json());
const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'));
if (!page) { console.log('open pages: ' + list.map((t) => t.url).join(', ')); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const r = await send('Runtime.evaluate', {
  expression: process.argv[2],
  awaitPromise: !process.argv.includes('--nowait'),
  returnByValue: true,
  userGesture: process.argv.includes('--gesture'),
});
console.log(JSON.stringify(r.result?.exceptionDetails?.exception?.description ?? r.result?.result?.value ?? null));
ws.close();
