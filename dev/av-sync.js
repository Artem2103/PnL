// Dev-only, run through dev/probe.mjs --file=dev/av-sync.js in the driven
// Chrome. Decodes the sound of a source clip and of an export of it with the
// browser's own player (decodeAudioData), takes 2 ms RMS envelopes of both and
// cross-correlates them over ±300 ms. `bestLagMs` is how far the export's
// sound sits from the source's: positive means late. Set `window.__srcFrom`
// (seconds into the source the export's window starts) and `window.__seconds`
// (how much to compare) first when the export is a trimmed window. The two
// files are fetched as /dev/tmp-clip60.mp4 and /dev/tmp-export.mp4 — drop
// them in dev/ (that pattern is gitignored). See HANDOFF.md, 2026-09-14.
(async () => {
  const ac = new OfflineAudioContext(1, 44100, 44100);
  const load = async (url) => { const buf = await (await fetch(url)).arrayBuffer(); return await ac.decodeAudioData(buf); };
  const [src, out] = await Promise.all([load('/dev/tmp-clip60.mp4'), load('/dev/tmp-export.mp4')]);
  const env = (ab, from, seconds, step) => { const ch = ab.getChannelData(0); const r = ab.sampleRate; const n = Math.floor(seconds / step); const e = new Float32Array(n); for (let i = 0; i < n; i++) { const a = Math.floor((from + i * step) * r), b = Math.floor((from + (i + 1) * step) * r); let s = 0; for (let k = a; k < b && k < ch.length; k++) s += ch[k] * ch[k]; e[i] = Math.sqrt(s / Math.max(1, b - a)); } return e; };
  const step = 0.002, seconds = window.__seconds || 20;
  const a = env(src, window.__srcFrom || 0, seconds, step), b = env(out, 0, seconds, step);
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length; const ma = mean(a), mb = mean(b);
  let best = { lag: 0, corr: -Infinity };
  const maxLag = Math.round(0.3 / step);
  for (let lag = -maxLag; lag <= maxLag; lag++) { let s = 0, na = 0, nb = 0; for (let i = Math.max(0, -lag); i < a.length && i + lag < b.length; i++) { const x = a[i] - ma, y = b[i + lag] - mb; s += x * y; na += x * x; nb += y * y; } const c = s / Math.sqrt(na * nb); if (c > best.corr) best = { lag, corr: c }; }
  return { source: { duration: +src.duration.toFixed(3), rate: src.sampleRate, channels: src.numberOfChannels }, export: { duration: +out.duration.toFixed(3), rate: out.sampleRate, channels: out.numberOfChannels }, bestLagMs: best.lag * step * 1000, corr: +best.corr.toFixed(4), exportPeak: +Math.max(...b).toFixed(4), sourcePeak: +Math.max(...a).toFixed(4) };
})()
