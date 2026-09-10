// Dev-only. Turns the fragmented MP4 `MediaRecorder` writes into a plain,
// progressive MP4 — one `moov` with full sample tables in front of one `mdat` —
// which is the shape a phone or a camera writes. Nothing is decoded; the
// samples are copied byte for byte and only the index around them changes.
//
// Why this exists: the stall `start-check.html` chases was first measured on a
// MediaRecorder clip, and a browser demuxes a fragmented file quite differently
// from a flat one. A harness that could only ever test the fragmented shape
// would not know whether the finding carried over to the clips people upload.
//
// Handles what Chrome's muxer produces: one or two tracks, `trex` defaults,
// `tfhd` default-base-is-moof or explicit base offsets, `trun` with any of the
// per-sample fields. Composition offsets are not carried (`ctts` is never
// written), which is right for the baseline H.264 Chrome records and wrong for
// anything with B-frames — such a file is refused rather than written wrong.

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

const enc = new TextEncoder();
function box(type, ...parts) {
  const size = 8 + parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  v.setUint32(0, size);
  out.set(enc.encode(type), 4);
  let p = 8;
  for (const part of parts) { out.set(part instanceof Uint8Array ? part : new Uint8Array(part), p); p += part.byteLength; }
  return out;
}
function u32s(values) {
  const out = new Uint8Array(values.length * 4);
  const v = new DataView(out.buffer);
  values.forEach((x, i) => v.setUint32(i * 4, x));
  return out;
}
const fullHeader = (version = 0, flags = 0) => u32s([(version << 24) | flags]);

function slice(buf, b) { return new Uint8Array(buf, b.start, b.end - b.start); }

function patchDuration(bytes, kind, value) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const wide = v.getUint8(8) === 1;
  const at = { mvhd: wide ? 32 : 24, tkhd: wide ? 36 : 28, mdhd: wide ? 32 : 24 }[kind];
  if (wide) v.setBigUint64(at, BigInt(Math.round(value)));
  else v.setUint32(at, Math.min(0xffffffff, Math.round(value)));
}

/**
 * @param {ArrayBuffer} buffer a fragmented MP4
 * @returns {ArrayBuffer} the same media as a progressive MP4
 */
export function flattenFragmentedMp4(buffer) {
  const view = new DataView(buffer);
  const top = boxes(view, 0, buffer.byteLength);
  const ftyp = find(top, 'ftyp');
  const moov = find(top, 'moov');
  if (!ftyp || !moov) throw new Error('not an MP4');
  const inMoov = boxes(view, moov.body, moov.end);
  const mvhd = find(inMoov, 'mvhd');
  const mvhdWide = view.getUint8(mvhd.body) === 1;
  const movieTimescale = view.getUint32(mvhd.body + (mvhdWide ? 20 : 12));

  const tracks = new Map();
  for (const trak of inMoov.filter((b) => b.type === 'trak')) {
    const inTrak = boxes(view, trak.body, trak.end);
    const tkhd = find(inTrak, 'tkhd');
    const mdia = find(inTrak, 'mdia');
    const inMdia = boxes(view, mdia.body, mdia.end);
    const mdhd = find(inMdia, 'mdhd');
    const minf = find(inMdia, 'minf');
    const inMinf = boxes(view, minf.body, minf.end);
    const stbl = find(inMinf, 'stbl');
    const stsd = find(boxes(view, stbl.body, stbl.end), 'stsd');
    const id = view.getUint32(tkhd.body + (view.getUint8(tkhd.body) === 1 ? 20 : 12));
    tracks.set(id, {
      id,
      timescale: view.getUint32(mdhd.body + (view.getUint8(mdhd.body) === 1 ? 20 : 12)),
      tkhd: slice(buffer, tkhd),
      mdhdAndHdlr: inMdia.filter((b) => b.type !== 'minf').map((b) => slice(buffer, b)),
      minfHead: inMinf.filter((b) => b.type !== 'stbl').map((b) => slice(buffer, b)),
      stsd: slice(buffer, stsd),
      samples: [], // { offset, size, duration, sync }
      chunks: [],  // { firstSample, count }
      defaults: { duration: 0, size: 0, flags: 0 },
    });
  }
  const mvex = find(inMoov, 'mvex');
  if (mvex) for (const trex of boxes(view, mvex.body, mvex.end).filter((b) => b.type === 'trex')) {
    const t = tracks.get(view.getUint32(trex.body + 4));
    if (t) t.defaults = { duration: view.getUint32(trex.body + 12), size: view.getUint32(trex.body + 16), flags: view.getUint32(trex.body + 20) };
  }

  for (const moof of top.filter((b) => b.type === 'moof')) {
    for (const traf of boxes(view, moof.body, moof.end).filter((b) => b.type === 'traf')) {
      const inTraf = boxes(view, traf.body, traf.end);
      const tfhd = find(inTraf, 'tfhd');
      const flags = view.getUint32(tfhd.body) & 0xffffff;
      const track = tracks.get(view.getUint32(tfhd.body + 4));
      if (!track) continue;
      let p = tfhd.body + 8;
      let base = moof.start;
      if (flags & 0x01) { base = Number(view.getBigUint64(p)); p += 8; }
      if (flags & 0x02) p += 4;
      const def = { ...track.defaults };
      if (flags & 0x08) { def.duration = view.getUint32(p); p += 4; }
      if (flags & 0x10) { def.size = view.getUint32(p); p += 4; }
      if (flags & 0x20) { def.flags = view.getUint32(p); p += 4; }
      for (const trun of inTraf.filter((b) => b.type === 'trun')) {
        const tflags = view.getUint32(trun.body) & 0xffffff;
        const count = view.getUint32(trun.body + 4);
        let q = trun.body + 8;
        let offset = base;
        if (tflags & 0x01) { offset += view.getInt32(q); q += 4; }
        let firstFlags = null;
        if (tflags & 0x04) { firstFlags = view.getUint32(q); q += 4; }
        const firstSample = track.samples.length;
        for (let i = 0; i < count; i++) {
          let duration = def.duration, size = def.size, sflags = def.flags, cts = 0;
          if (tflags & 0x100) { duration = view.getUint32(q); q += 4; }
          if (tflags & 0x200) { size = view.getUint32(q); q += 4; }
          if (tflags & 0x400) { sflags = view.getUint32(q); q += 4; }
          if (tflags & 0x800) { cts = view.getInt32(q); q += 4; }
          if (i === 0 && firstFlags !== null) sflags = firstFlags;
          if (cts !== 0) throw new Error('composition offsets present; this flattener does not carry ctts');
          track.samples.push({ offset, size, duration, sync: (sflags & 0x10000) === 0 });
          offset += size;
        }
        if (count) track.chunks.push({ firstSample, count });
      }
    }
  }

  // Lay the samples out: chunk by chunk in the order the fragments had them,
  // which interleaves the tracks the way a real file does.
  const order = [];
  for (const track of tracks.values()) track.chunks.forEach((chunk, i) => order.push({ track, chunk, i }));
  // Fragments were walked in file order per track; merge by original offset.
  order.sort((a, b) => a.track.samples[a.chunk.firstSample].offset - b.track.samples[b.chunk.firstSample].offset);

  const buildMoov = (chunkOffsets) => {
    let longestMovie = 0;
    const traks = [];
    for (const track of tracks.values()) {
      const durations = track.samples.map((s) => s.duration);
      const total = durations.reduce((a, b) => a + b, 0);
      longestMovie = Math.max(longestMovie, (total / track.timescale) * movieTimescale);

      const stts = [];
      for (let i = 0; i < durations.length; ) {
        let j = i;
        while (j < durations.length && durations[j] === durations[i]) j++;
        stts.push(j - i, durations[i]);
        i = j;
      }
      const syncs = track.samples.map((s, i) => (s.sync ? i + 1 : 0)).filter(Boolean);
      const allSync = syncs.length === track.samples.length;
      const stsc = [];
      track.chunks.forEach((chunk, i) => {
        const prev = track.chunks[i - 1];
        if (!prev || prev.count !== chunk.count) stsc.push(i + 1, chunk.count, 1);
      });
      const offsets = chunkOffsets.get(track) || track.chunks.map(() => 0);

      const stbl = box(
        'stbl',
        track.stsd,
        box('stts', fullHeader(), u32s([stts.length / 2]), u32s(stts)),
        ...(allSync ? [] : [box('stss', fullHeader(), u32s([syncs.length]), u32s(syncs))]),
        box('stsc', fullHeader(), u32s([stsc.length / 3]), u32s(stsc)),
        box('stsz', fullHeader(), u32s([0, track.samples.length]), u32s(track.samples.map((s) => s.size))),
        box('stco', fullHeader(), u32s([offsets.length]), u32s(offsets)),
      );
      const tkhd = new Uint8Array(track.tkhd);
      patchDuration(tkhd, 'tkhd', (total / track.timescale) * movieTimescale);
      const mdhdAndHdlr = track.mdhdAndHdlr.map((b) => new Uint8Array(b));
      const mdhd = mdhdAndHdlr.find((b) => String.fromCharCode(b[4], b[5], b[6], b[7]) === 'mdhd');
      patchDuration(mdhd, 'mdhd', total);
      traks.push(box('trak', tkhd, box('mdia', ...mdhdAndHdlr, box('minf', ...track.minfHead, stbl))));
    }
    const mvhdBytes = new Uint8Array(slice(buffer, mvhd));
    patchDuration(mvhdBytes, 'mvhd', longestMovie);
    return box('moov', mvhdBytes, ...traks);
  };

  const ftypBytes = slice(buffer, ftyp);
  const moovSize = buildMoov(new Map()).byteLength;
  const mdatBodyStart = ftypBytes.byteLength + moovSize + 8;
  const chunkOffsets = new Map();
  let cursor = mdatBodyStart;
  const pieces = [];
  for (const { track, chunk } of order) {
    if (!chunkOffsets.has(track)) chunkOffsets.set(track, []);
    chunkOffsets.get(track).push(cursor);
    for (let i = chunk.firstSample; i < chunk.firstSample + chunk.count; i++) {
      const s = track.samples[i];
      pieces.push(new Uint8Array(buffer, s.offset, s.size));
      cursor += s.size;
    }
  }
  // stco lists chunks in track order, and the chunks of one track were pushed
  // in ascending time, so the per-track offset lists line up with `chunks`.
  const moovBytes = buildMoov(chunkOffsets);
  if (moovBytes.byteLength !== moovSize) throw new Error('moov size changed between passes');
  const mdatSize = 8 + (cursor - mdatBodyStart);
  const out = new Uint8Array(mdatBodyStart + (cursor - mdatBodyStart));
  out.set(ftypBytes, 0);
  out.set(moovBytes, ftypBytes.byteLength);
  new DataView(out.buffer).setUint32(ftypBytes.byteLength + moovSize, mdatSize);
  out.set(enc.encode('mdat'), ftypBytes.byteLength + moovSize + 4);
  let p = mdatBodyStart;
  for (const piece of pieces) { out.set(piece, p); p += piece.byteLength; }
  return out.buffer;
}
