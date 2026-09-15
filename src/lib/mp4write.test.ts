import { describe, expect, it } from 'vitest';
import { writeMp4, type MuxSample } from './mp4write';

/* A small box reader, independent of the writer, to check what came out. */
interface Box {
  type: string;
  start: number;
  body: number;
  end: number;
}
function boxes(view: DataView, start: number, end: number): Box[] {
  const out: Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = view.getUint32(p);
    const type = String.fromCharCode(
      view.getUint8(p + 4),
      view.getUint8(p + 5),
      view.getUint8(p + 6),
      view.getUint8(p + 7),
    );
    let head = 8;
    if (size === 1) {
      size = Number(view.getBigUint64(p + 8));
      head = 16;
    } else if (size === 0) size = end - p;
    if (size < head || p + size > end) break;
    out.push({ type, start: p, body: p + head, end: p + size });
    p += size;
  }
  return out;
}
const find = (list: Box[], type: string) => list.find((b) => b.type === type);
const must = (list: Box[], type: string): Box => {
  const b = find(list, type);
  if (!b) throw new Error(`no ${type}`);
  return b;
};

function readU32s(view: DataView, at: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => view.getUint32(at + i * 4));
}

function frames(count: number, fps: number, bytes: (i: number) => Uint8Array, keyEvery = 30): MuxSample[] {
  const step = 1_000_000 / fps;
  return Array.from({ length: count }, (_, i) => ({
    data: bytes(i),
    timestamp: Math.round(i * step),
    duration: Math.round(step),
    key: i % keyEvery === 0,
  }));
}

const avcC = Uint8Array.from([1, 0x64, 0x00, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 3, 0x68, 0xee, 0x3c]);
const asc = Uint8Array.from([0x11, 0x90]); // AAC-LC, 48 kHz, stereo

function tables(buffer: ArrayBuffer, trackIndex: number) {
  const view = new DataView(buffer);
  const top = boxes(view, 0, buffer.byteLength);
  const moov = must(top, 'moov');
  const traks = boxes(view, moov.body, moov.end).filter((b) => b.type === 'trak');
  const trak = traks[trackIndex];
  if (!trak) throw new Error(`no track ${trackIndex}`);
  const mdia = must(boxes(view, trak.body, trak.end), 'mdia');
  const inMdia = boxes(view, mdia.body, mdia.end);
  const mdhd = must(inMdia, 'mdhd');
  const minf = must(inMdia, 'minf');
  const stbl = must(boxes(view, minf.body, minf.end), 'stbl');
  const inStbl = boxes(view, stbl.body, stbl.end);
  const mdhdWide = view.getUint8(mdhd.body) === 1;
  const timescale = view.getUint32(mdhd.body + (mdhdWide ? 20 : 12));
  const duration = mdhdWide
    ? Number(view.getBigUint64(mdhd.body + 24))
    : view.getUint32(mdhd.body + 16);
  const stts = must(inStbl, 'stts');
  const sttsCount = view.getUint32(stts.body + 4);
  const sttsRuns = readU32s(view, stts.body + 8, sttsCount * 2);
  const stsz = must(inStbl, 'stsz');
  const sampleCount = view.getUint32(stsz.body + 8);
  const sizes = readU32s(view, stsz.body + 12, sampleCount);
  const stco = must(inStbl, 'stco');
  const offsets = readU32s(view, stco.body + 8, view.getUint32(stco.body + 4));
  const stss = find(inStbl, 'stss');
  const syncs = stss ? readU32s(view, stss.body + 8, view.getUint32(stss.body + 4)) : null;
  const ctts = find(inStbl, 'ctts');
  const stsd = must(inStbl, 'stsd');
  const entry = boxes(view, stsd.body + 8, stsd.end)[0];
  if (!entry) throw new Error('no sample entry');
  return { view, top, timescale, duration, sttsRuns, sizes, offsets, syncs, ctts, entry, inStbl };
}

describe('writeMp4', () => {
  it('writes ftyp, moov and mdat in that order, with the sample bytes where stco says', () => {
    const video = frames(60, 30, (i) => Uint8Array.from([0x65, i, i, i]));
    const audio = frames(140, 46.875, (i) => Uint8Array.from([0x21, i]), 1);
    const { buffer, durationSeconds, videoSeconds, audioSeconds } = writeMp4({
      video: { width: 1680, height: 1140, description: avcC, samples: video },
      audio: { sampleRate: 48000, channels: 2, description: asc, samples: audio },
    });
    const view = new DataView(buffer);
    const top = boxes(view, 0, buffer.byteLength);
    expect(top.map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat']);

    const v = tables(buffer, 0);
    expect(v.sizes).toHaveLength(60);
    v.offsets.forEach((at, i) => {
      expect(new Uint8Array(buffer, at, v.sizes[i] ?? -1)).toEqual(video[i]?.data);
    });
    const a = tables(buffer, 1);
    expect(a.sizes).toHaveLength(140);
    a.offsets.forEach((at, i) => {
      expect(new Uint8Array(buffer, at, a.sizes[i] ?? -1)).toEqual(audio[i]?.data);
    });
    // Every byte of the mdat body is claimed by exactly one sample.
    const mdat = must(top, 'mdat');
    const claimed: [number, number][] = [
      ...v.offsets.map((at, i): [number, number] => [at, v.sizes[i] ?? 0]),
      ...a.offsets.map((at, i): [number, number] => [at, a.sizes[i] ?? 0]),
    ].sort((x, y) => x[0] - y[0]);
    let cursor = mdat.body;
    for (const [at, size] of claimed) {
      expect(at).toBe(cursor);
      cursor += size;
    }
    expect(cursor).toBe(mdat.end);

    expect(videoSeconds).toBeCloseTo(2, 2);
    expect(audioSeconds).toBeCloseTo(140 * 1024 / 48000, 2);
    expect(durationSeconds).toBeCloseTo(Math.max(videoSeconds, audioSeconds), 3);
  });

  it('states real durations in mdhd and mvhd, on a 90 kHz video clock and the audio sample rate', () => {
    const video = frames(30, 30, () => Uint8Array.from([1]));
    const audio = frames(47, 46.875, () => Uint8Array.from([2]), 1);
    const { buffer } = writeMp4({
      video: { width: 640, height: 480, description: avcC, samples: video },
      audio: { sampleRate: 48000, channels: 2, description: asc, samples: audio },
    });
    const v = tables(buffer, 0);
    expect(v.timescale).toBe(90_000);
    expect(v.duration).toBe(90_000); // 30 frames at 30 fps
    const a = tables(buffer, 1);
    expect(a.timescale).toBe(48_000);
    expect(a.duration).toBe(47 * 1024);

    const view = new DataView(buffer);
    const moov = must(boxes(view, 0, buffer.byteLength), 'moov');
    const mvhd = must(boxes(view, moov.body, moov.end), 'mvhd');
    const wide = view.getUint8(mvhd.body) === 1;
    const movieTimescale = view.getUint32(mvhd.body + (wide ? 20 : 12));
    const movieDuration = wide ? Number(view.getBigUint64(mvhd.body + 24)) : view.getUint32(mvhd.body + 16);
    expect(movieDuration / movieTimescale).toBeCloseTo((47 * 1024) / 48000, 2);
  });

  it('lists the key frames in stss and leaves stss out of an all-sync audio track', () => {
    const video = frames(90, 30, () => Uint8Array.from([1]), 30);
    const audio = frames(10, 46.875, () => Uint8Array.from([2]), 1);
    const { buffer } = writeMp4({
      video: { width: 640, height: 480, description: avcC, samples: video },
      audio: { sampleRate: 48000, channels: 2, description: asc, samples: audio },
    });
    expect(tables(buffer, 0).syncs).toEqual([1, 31, 61]);
    expect(tables(buffer, 1).syncs).toBeNull();
  });

  it('keeps a held frame long in stts and writes no ctts when nothing was reordered', () => {
    const step = 1_000_000 / 30;
    const video: MuxSample[] = [0, 1, 2, 5, 6].map((slot, i) => ({
      data: Uint8Array.from([i]),
      timestamp: Math.round(slot * step),
      duration: Math.round(step),
      key: i === 0,
    }));
    const { buffer } = writeMp4({ video: { width: 64, height: 64, description: avcC, samples: video } });
    const v = tables(buffer, 0);
    // runs: 2 frames of 3000, 1 of 9000 (the held one), 2 of 3000
    expect(v.sttsRuns).toEqual([2, 3000, 1, 9000, 2, 3000]);
    expect(v.ctts).toBeUndefined();
  });

  it('writes signed composition offsets when the encoder reordered frames', () => {
    const step = 1_000_000 / 30;
    // Decode order I P B B: the P is presented last of the four.
    const pts = [0, 3, 1, 2];
    const video: MuxSample[] = pts.map((slot, i) => ({
      data: Uint8Array.from([i]),
      timestamp: Math.round(slot * step),
      duration: Math.round(step),
      key: i === 0,
    }));
    const { buffer } = writeMp4({ video: { width: 64, height: 64, description: avcC, samples: video } });
    const v = tables(buffer, 0);
    expect(v.ctts).toBeDefined();
    expect(v.view.getUint8(v.ctts!.body)).toBe(1); // version 1, signed
    const count = v.view.getUint32(v.ctts!.body + 4);
    const entries: number[][] = [];
    for (let i = 0; i < count; i += 1) {
      entries.push([v.view.getUint32(v.ctts!.body + 8 + i * 8), v.view.getInt32(v.ctts!.body + 12 + i * 8)]);
    }
    // dts 0,3000,6000,9000 against pts 0,9000,3000,6000; equal offsets share a run
    expect(entries).toEqual([[1, 0], [1, 6000], [2, -3000]]);
  });

  it('carries the encoder descriptions into avcC and esds', () => {
    const video = frames(2, 30, () => Uint8Array.from([1]));
    const audio = frames(2, 46.875, () => Uint8Array.from([2]), 1);
    const { buffer } = writeMp4({
      video: { width: 64, height: 64, description: avcC, samples: video },
      audio: { sampleRate: 48000, channels: 2, description: asc, samples: audio },
    });
    const v = tables(buffer, 0);
    expect(v.entry.type).toBe('avc1');
    const avcCBox = must(boxes(v.view, v.entry.body + 78, v.entry.end), 'avcC');
    expect(new Uint8Array(buffer, avcCBox.body, avcCBox.end - avcCBox.body)).toEqual(avcC);
    expect(v.view.getUint16(v.entry.body + 24)).toBe(64); // width
    expect(v.view.getUint16(v.entry.body + 26)).toBe(64); // height

    const a = tables(buffer, 1);
    expect(a.entry.type).toBe('mp4a');
    const esds = must(boxes(a.view, a.entry.body + 28, a.entry.end), 'esds');
    const bytes = new Uint8Array(buffer, esds.body, esds.end - esds.body);
    // The AudioSpecificConfig sits inside the DecoderSpecificInfo descriptor (tag 5).
    const tag5 = Array.from(bytes).findIndex((b, i) => b === 0x05 && bytes[i + 4] === asc.length);
    expect(tag5).toBeGreaterThan(0);
    expect(Array.from(bytes.slice(tag5 + 5, tag5 + 5 + asc.length))).toEqual(Array.from(asc));
  });

  it('puts an empty edit in front of a track that starts after the other', () => {
    const video = frames(30, 30, () => Uint8Array.from([1]));
    // Sound begins 40 ms after the picture.
    const audio = frames(46, 46.875, () => Uint8Array.from([2]), 1).map((s) => ({ ...s, timestamp: s.timestamp + 40_000 }));
    const { buffer, durationSeconds } = writeMp4({
      video: { width: 64, height: 64, description: avcC, samples: video },
      audio: { sampleRate: 48000, channels: 2, description: asc, samples: audio },
    });
    const view = new DataView(buffer);
    const moov = must(boxes(view, 0, buffer.byteLength), 'moov');
    const traks = boxes(view, moov.body, moov.end).filter((b) => b.type === 'trak');
    const videoTrak = traks[0];
    const audioTrak = traks[1];
    if (!videoTrak || !audioTrak) throw new Error('two tracks expected');
    expect(find(boxes(view, videoTrak.body, videoTrak.end), 'edts')).toBeUndefined();
    const edts = must(boxes(view, audioTrak.body, audioTrak.end), 'edts');
    const elst = must(boxes(view, edts.body, edts.end), 'elst');
    expect(view.getUint32(elst.body + 4)).toBe(2); // two edits
    expect(view.getUint32(elst.body + 8)).toBe(40); // 40 ms empty, movie timescale 1000
    expect(view.getInt32(elst.body + 12)).toBe(-1); // empty edit
    expect(view.getUint32(elst.body + 20)).toBe(Math.round((46 * 1024 * 1000) / 48000)); // then the track
    expect(view.getInt32(elst.body + 24)).toBe(0);
    // The sound's stated length includes its late start; the file is as long as its longest track.
    expect(durationSeconds).toBeCloseTo(0.04 + (46 * 1024) / 48000, 3);
  });

  it('hides the sound before its trim start and after its length with the edit', () => {
    const video = frames(30, 30, () => Uint8Array.from([1]));
    const step = 1024 / 0.048; // µs per packet at 48 kHz
    const edits = (trimStartUs: number, trimLengthUs?: number, lead = 0) => {
      // The first packet sits one packet before zero, as a copied clip's does.
      const audio = frames(46, 46.875, () => Uint8Array.from([2]), 1).map((s) => ({
        ...s,
        timestamp: s.timestamp - Math.round(step) + lead,
      }));
      const { buffer, durationSeconds, audioSeconds } = writeMp4({
        video: { width: 64, height: 64, description: avcC, samples: video },
        audio: { sampleRate: 48000, channels: 2, description: asc, samples: audio, trimStartUs, trimLengthUs },
      });
      const view = new DataView(buffer);
      const moov = must(boxes(view, 0, buffer.byteLength), 'moov');
      const traks = boxes(view, moov.body, moov.end).filter((b) => b.type === 'trak');
      expect(find(boxes(view, traks[0]!.body, traks[0]!.end), 'edts')).toBeUndefined();
      const edts = must(boxes(view, traks[1]!.body, traks[1]!.end), 'edts');
      const elst = must(boxes(view, edts.body, edts.end), 'elst');
      const count = view.getUint32(elst.body + 4);
      const list = Array.from({ length: count }, (_, i) => [
        view.getUint32(elst.body + 8 + i * 12),
        view.getInt32(elst.body + 12 + i * 12),
      ]);
      return { list, durationSeconds, audioSeconds };
    };

    // Priming only: presentation starts at zero, one packet into the media.
    const priming = edits(Math.round(step));
    expect(priming.list).toEqual([[Math.round((45 * 1024 * 1000) / 48000), 1024]]);
    expect(priming.audioSeconds).toBeCloseTo((45 * 1024) / 48000, 3);

    // Trimmed further in and cut short: 10 ms late, 500 ms long.
    const window = edits(Math.round(step) + 10_000, 500_000);
    expect(window.list).toEqual([
      [10, -1],
      [500, 1024 + 480],
    ]);
    expect(window.audioSeconds).toBeCloseTo(0.51, 3);
    expect(window.durationSeconds).toBeCloseTo(1, 2);
  });

  it('refuses an empty recording', () => {
    expect(() => writeMp4({ video: { width: 64, height: 64, description: avcC, samples: [] } })).toThrow();
    expect(() =>
      writeMp4({ video: { width: 64, height: 64, description: new Uint8Array(), samples: frames(1, 30, () => Uint8Array.from([1])) } }),
    ).toThrow();
  });
});
