// Dev-only. Reads frame cadence straight out of an MP4 the exporter produced.
// Same container reader as dev/cadence-check.html: sample durations are the
// encoded truth, and unlike playback they cannot invent a stall that is not in
// the file.
import { readFileSync } from 'node:fs';

function boxes(view, start, end) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = view.getUint32(p);
    const type = String.fromCharCode(view.getUint8(p + 4), view.getUint8(p + 5), view.getUint8(p + 6), view.getUint8(p + 7));
    let head = 8;
    if (size === 1) { size = Number(view.getBigUint64(p + 8)); head = 16; }
    else if (size === 0) { size = end - p; }
    if (size < head || p + size > end) break;
    out.push({ type, start: p, body: p + head, end: p + size });
    p += size;
  }
  return out;
}
const find = (list, type) => list.find((b) => b.type === type);

function mp4Cadence(buf) {
  const v = new DataView(buf);
  const top = boxes(v, 0, buf.byteLength);
  const moov = find(top, 'moov');
  if (!moov) return { error: 'no moov box (not an MP4?)' };

  // Video track: the trak whose hdlr handler_type is 'vide'.
  let timescale = null, trackId = null, sttsDurations = [];
  for (const trak of boxes(v, moov.body, moov.end).filter((b) => b.type === 'trak')) {
    const tk = boxes(v, trak.body, trak.end);
    const mdia = find(tk, 'mdia');
    if (!mdia) continue;
    const md = boxes(v, mdia.body, mdia.end);
    const hdlr = find(md, 'hdlr');
    if (!hdlr) continue;
    const handler = String.fromCharCode(
      v.getUint8(hdlr.body + 8), v.getUint8(hdlr.body + 9), v.getUint8(hdlr.body + 10), v.getUint8(hdlr.body + 11),
    );
    if (handler !== 'vide') continue;
    const mdhd = find(md, 'mdhd');
    if (mdhd) {
      const version = v.getUint8(mdhd.body);
      timescale = version === 1 ? v.getUint32(mdhd.body + 4 + 8 + 8) : v.getUint32(mdhd.body + 4 + 4 + 4);
    }
    const tkhd = find(tk, 'tkhd');
    if (tkhd) {
      const version = v.getUint8(tkhd.body);
      trackId = version === 1 ? v.getUint32(tkhd.body + 4 + 8 + 8) : v.getUint32(tkhd.body + 4 + 4 + 4);
    }
    // Non-fragmented MP4 keeps per-sample deltas in stts.
    const minf = find(md, 'minf');
    const stbl = minf && find(boxes(v, minf.body, minf.end), 'stbl');
    const stts = stbl && find(boxes(v, stbl.body, stbl.end), 'stts');
    if (stts) {
      const n = v.getUint32(stts.body + 4);
      let q = stts.body + 8;
      for (let i = 0; i < n; i++) {
        const count = v.getUint32(q), delta = v.getUint32(q + 4);
        for (let k = 0; k < count; k++) sttsDurations.push(delta);
        q += 8;
      }
    }
    break;
  }
  if (!timescale) return { error: 'no video track timescale' };

  // Fragmented MP4 (what MediaRecorder writes) keeps them in moof/traf.
  let defaultDuration = 0;
  const mvex = find(boxes(v, moov.body, moov.end), 'mvex');
  if (mvex) {
    const trex = find(boxes(v, mvex.body, mvex.end), 'trex');
    if (trex && v.getUint32(trex.body + 4) === trackId) defaultDuration = v.getUint32(trex.body + 12);
  }

  const durations = [...sttsDurations];
  for (const moof of top.filter((b) => b.type === 'moof')) {
    for (const traf of boxes(v, moof.body, moof.end).filter((b) => b.type === 'traf')) {
      const tf = boxes(v, traf.body, traf.end);
      const tfhd = find(tf, 'tfhd');
      let trafDefault = defaultDuration;
      if (tfhd) {
        const flags = v.getUint32(tfhd.body) & 0xffffff;
        if (v.getUint32(tfhd.body + 4) !== trackId && trackId !== null) continue;
        let q = tfhd.body + 8;
        if (flags & 0x01) q += 8;
        if (flags & 0x02) q += 4;
        if (flags & 0x08) { trafDefault = v.getUint32(q); q += 4; }
      }
      for (const trun of tf.filter((b) => b.type === 'trun')) {
        const flags = v.getUint32(trun.body) & 0xffffff;
        const count = v.getUint32(trun.body + 4);
        let q = trun.body + 8;
        if (flags & 0x000001) q += 4;
        if (flags & 0x000004) q += 4;
        for (let i = 0; i < count; i++) {
          let d = trafDefault;
          if (flags & 0x000100) { d = v.getUint32(q); q += 4; }
          if (flags & 0x000200) q += 4;
          if (flags & 0x000400) q += 4;
          if (flags & 0x000800) q += 4;
          durations.push(d);
        }
      }
    }
  }
  if (!durations.length) return { error: 'no sample durations found' };

  const ms = durations.map((d) => (d / timescale) * 1000);
  const sorted = [...ms].sort((a, b) => a - b);
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  const sd = Math.sqrt(ms.reduce((a, b) => a + (b - mean) ** 2, 0) / ms.length);
  const total = ms.reduce((a, b) => a + b, 0);
  const onCadence = ms.filter((d) => Math.abs(d - 1000 / 30) <= 8).length;
  const histogram = {};
  for (const d of ms) {
    const k = String(Math.round(d));
    histogram[k] = (histogram[k] || 0) + 1;
  }
  return {
    ms,
    timescale,
    frames: ms.length,
    totalSeconds: +(total / 1000).toFixed(3),
    fps: +((ms.length / (total / 1000)) || 0).toFixed(2),
    meanMs: +mean.toFixed(2),
    sdMs: +sd.toFixed(2),
    minMs: +sorted[0].toFixed(2),
    medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
    maxMs: +sorted[sorted.length - 1].toFixed(2),
    onCadencePct: +((onCadence / ms.length) * 100).toFixed(1),
    histogramMs: histogram,
    firstMs: ms.slice(0, 32).map((d) => +d.toFixed(1)),
  };
}

const buf = readFileSync(process.argv[2]);
const r = mp4Cadence(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
if (r.error) { console.log(r.error); process.exit(1); }
console.log(JSON.stringify({
  frames: r.frames, seconds: r.totalSeconds, fps: r.fps, sdMs: r.sdMs,
  maxGapMs: +Math.max(...r.ms).toFixed(1),
  gapsOver200ms: r.ms.filter((d) => d > 200).length,
}, null, 1));
