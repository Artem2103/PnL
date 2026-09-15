/**
 * An MP4 demuxer: the sample tables of a file, read into a list of samples
 * WebCodecs can decode.
 *
 * This exists for `lib/offline.ts`, which exports a card by decoding the
 * background clip's own frames instead of recording a `<video>` element in
 * real time. A `<video>` plays back whatever the machine can manage — on a
 * laptop already busy encoding, that was 10–20 of a 60 fps clip's frames a
 * second, and those were the frames that reached the file. `VideoDecoder`
 * hands over every frame, in order, with its own timestamp, and it needs the
 * bytes of each sample and where they sit in the file. That is what this
 * reads.
 *
 * Scope: the two layouts a clip arrives in. A **progressive** file — `moov`
 * with full `stbl` tables, the way a phone or a downloader writes it — and a
 * **fragmented** one — `moof`/`trun` per fragment, the way `MediaRecorder`
 * writes it. One video track (H.264 in `avc1`/`avc3`, HEVC in `hvc1`/`hev1`)
 * and at most one audio track (AAC in `mp4a`). Anything else comes back with
 * `codec: null`, and the caller records the old way.
 *
 * Nothing here decodes. Timestamps are converted to microseconds, which is the
 * unit WebCodecs speaks; offsets are byte positions in the buffer.
 */

export interface DemuxedSample {
  /** Byte position of the sample in the file. */
  offset: number;
  size: number;
  /** Decode time, microseconds. */
  dts: number;
  /** Presentation time, microseconds, with the track's edit applied. */
  pts: number;
  /** Microseconds. */
  duration: number;
  key: boolean;
}

export interface DemuxedVideoTrack {
  kind: 'video';
  id: number;
  /** WebCodecs codec string, or null when the codec is not one this reads. */
  codec: string | null;
  /** The `avcC` / `hvcC` payload, as `VideoDecoderConfig.description`. */
  description: Uint8Array | null;
  /** Coded size, as the decoder produces it. */
  codedWidth: number;
  codedHeight: number;
  /** Rotation from the track matrix: 0, 90, 180 or 270, clockwise. */
  rotation: 0 | 90 | 180 | 270;
  /** Frames per second, estimated from the sample durations. */
  fps: number;
  /** In decode order. */
  samples: DemuxedSample[];
}

export interface DemuxedAudioTrack {
  kind: 'audio';
  id: number;
  codec: string | null;
  /** AudioSpecificConfig, as `AudioDecoderConfig.description`. */
  description: Uint8Array | null;
  sampleRate: number;
  channels: number;
  samples: DemuxedSample[];
}

export interface DemuxedMovie {
  video: DemuxedVideoTrack | null;
  audio: DemuxedAudioTrack | null;
  /** Seconds, from the longest track. */
  duration: number;
}

/* ------------------------------------------------------------------ */
/* Boxes                                                               */
/* ------------------------------------------------------------------ */

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
      if (p + 16 > end) break;
      size = Number(view.getBigUint64(p + 8));
      head = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < head || p + size > end) break;
    out.push({ type, start: p, body: p + head, end: p + size });
    p += size;
  }
  return out;
}

const find = (list: Box[], type: string): Box | undefined => list.find((box) => box.type === type);
const all = (list: Box[], type: string): Box[] => list.filter((box) => box.type === type);

function bytes(view: DataView, start: number, end: number): Uint8Array {
  return new Uint8Array(view.buffer.slice(view.byteOffset + start, view.byteOffset + end));
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();

/* ------------------------------------------------------------------ */
/* Codec strings                                                       */
/* ------------------------------------------------------------------ */

/** `avc1.PPCCLL` from the first three bytes after the avcC version. */
export function avcCodecString(avcC: Uint8Array): string | null {
  if (avcC.byteLength < 4) return null;
  return `avc1.${hex2(avcC[1] ?? 0)}${hex2(avcC[2] ?? 0)}${hex2(avcC[3] ?? 0)}`;
}

/**
 * The HEVC string the way ISO/IEC 14496-15 spells it: profile space, profile,
 * the compatibility flags reversed and in hex, tier and level, then the
 * constraint bytes with trailing zeros dropped — `hvc1.1.6.L120.B0` for a
 * plain Main-profile clip.
 */
export function hevcCodecString(hvcC: Uint8Array, entry: 'hvc1' | 'hev1' = 'hvc1'): string | null {
  if (hvcC.byteLength < 13) return null;
  const b1 = hvcC[1] ?? 0;
  const space = b1 >> 6;
  const tier = (b1 >> 5) & 1;
  const profile = b1 & 0x1f;
  let compat = 0;
  for (let i = 0; i < 4; i += 1) compat = (compat << 8) | (hvcC[2 + i] ?? 0);
  // The flags are transmitted most-significant first; the string wants them
  // reversed, so general_profile_compatibility_flag[1] lands on bit 1.
  let reversed = 0;
  for (let i = 0; i < 32; i += 1) reversed = (reversed << 1) | ((compat >>> i) & 1);
  const constraints: number[] = [];
  for (let i = 0; i < 6; i += 1) constraints.push(hvcC[6 + i] ?? 0);
  while (constraints.length > 1 && constraints[constraints.length - 1] === 0) constraints.pop();
  const level = hvcC[12] ?? 0;
  const parts = [
    `${['', 'A', 'B', 'C'][space] ?? ''}${profile}`,
    (reversed >>> 0).toString(16).toUpperCase(),
    `${tier ? 'H' : 'L'}${level}`,
    ...constraints.map((c) => c.toString(16).toUpperCase()),
  ];
  return `${entry}.${parts.join('.')}`;
}

/* ------------------------------------------------------------------ */
/* esds → AudioSpecificConfig                                          */
/* ------------------------------------------------------------------ */

/** MPEG-4 "expandable" length: up to four bytes, seven bits each. */
function descriptorLength(view: DataView, at: number): { length: number; next: number } {
  let length = 0;
  let p = at;
  for (let i = 0; i < 4; i += 1) {
    const b = view.getUint8(p);
    p += 1;
    length = (length << 7) | (b & 0x7f);
    if (!(b & 0x80)) break;
  }
  return { length, next: p };
}

interface AudioConfig {
  codec: string;
  description: Uint8Array;
  sampleRate: number;
  channels: number;
}

const AAC_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

/** The AudioSpecificConfig inside an `esds` box, read down through the descriptors. */
export function readEsds(view: DataView, body: number, end: number): AudioConfig | null {
  // Full box header, then ES_Descriptor (tag 3).
  let p = body + 4;
  if (p >= end || view.getUint8(p) !== 0x03) return null;
  let d = descriptorLength(view, p + 1);
  p = d.next + 2; // ES_ID
  const esFlags = view.getUint8(p);
  p += 1;
  if (esFlags & 0x80) p += 2; // dependsOn_ES_ID
  if (esFlags & 0x40) p += view.getUint8(p) + 1; // URL
  if (esFlags & 0x20) p += 2; // OCR_ES_Id
  // DecoderConfigDescriptor (tag 4).
  if (p >= end || view.getUint8(p) !== 0x04) return null;
  d = descriptorLength(view, p + 1);
  const objectType = view.getUint8(d.next);
  p = d.next + 13;
  // DecoderSpecificInfo (tag 5) — the AudioSpecificConfig itself.
  if (p >= end || view.getUint8(p) !== 0x05) return null;
  d = descriptorLength(view, p + 1);
  const asc = bytes(view, d.next, Math.min(end, d.next + d.length));
  if (objectType !== 0x40 || asc.byteLength < 2) return null;
  return { ...parseAudioSpecificConfig(asc), description: asc };
}

/**
 * The AudioSpecificConfig in an AAC encoder's `decoderConfig.description`.
 * Chrome hands over the ASC itself (`12 10`). Safari hands over Apple's magic
 * cookie, a whole ES descriptor (`03 … 04 … 05 … 12 10 06 …`) — written into
 * `esds` as it was, it nested one descriptor in another, and every player,
 * the iPhone's and Windows' alike, refused the sound ("mp4a is not
 * supported"). No valid ASC starts with 0x03: that is object type 0.
 * Null when neither reading gives an AAC configuration.
 */
export function audioSpecificConfigFrom(description: Uint8Array): Uint8Array | null {
  let asc: Uint8Array | null = description;
  if (description[0] === 0x03) {
    // readEsds expects a full box body: four bytes of version and flags first.
    const wrapped = new Uint8Array(description.byteLength + 4);
    wrapped.set(description, 4);
    try {
      asc = readEsds(new DataView(wrapped.buffer), 0, wrapped.byteLength)?.description ?? null;
    } catch {
      asc = null;
    }
  }
  if (!asc || asc.byteLength < 2) return null;
  return asc[0]! >> 3 >= 1 ? asc : null;
}

/** Object type, sample rate and channel count out of an AudioSpecificConfig. */
export function parseAudioSpecificConfig(asc: Uint8Array): {
  codec: string;
  sampleRate: number;
  channels: number;
} {
  let bit = 0;
  const read = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i += 1) {
      const byte = asc[bit >> 3] ?? 0;
      v = (v << 1) | ((byte >> (7 - (bit & 7))) & 1);
      bit += 1;
    }
    return v >>> 0;
  };
  let objectType = read(5);
  if (objectType === 31) objectType = 32 + read(6);
  const rateIndex = read(4);
  const sampleRate = rateIndex === 15 ? read(24) : (AAC_RATES[rateIndex] ?? 44100);
  const channelConfig = read(4);
  // Configurations 1–6 map to 1–6 channels; 7 is 7.1; 0 means "in the stream".
  const channels = channelConfig === 7 ? 8 : channelConfig === 0 ? 2 : channelConfig;
  return { codec: `mp4a.40.${objectType}`, sampleRate, channels: Math.max(1, channels) };
}

/* ------------------------------------------------------------------ */
/* Tracks                                                              */
/* ------------------------------------------------------------------ */

interface Edit {
  /** Subtracted from every pts, track timescale: the media time that plays at the movie's start, less any delay before it. */
  offset: number;
}

function readEdit(view: DataView, trak: Box[], movieTimescale: number, trackTimescale: number): Edit {
  const edts = find(trak, 'edts');
  const elst = edts && find(boxes(view, edts.body, edts.end), 'elst');
  if (!elst) return { offset: 0 };
  const version = view.getUint8(elst.body);
  const count = view.getUint32(elst.body + 4);
  const entryBytes = version === 1 ? 20 : 12;
  let p = elst.body + 8;
  /** Movie timescale: how long the track waits before its first real edit. */
  let delay = 0;
  for (let i = 0; i < count && p + entryBytes <= elst.end; i += 1) {
    const segment = version === 1 ? Number(view.getBigUint64(p)) : view.getUint32(p);
    const mediaTime = version === 1 ? Number(view.getBigInt64(p + 8)) : view.getInt32(p + 4);
    p += entryBytes;
    // An empty edit (-1) is a delay before the track starts — how a sound
    // track that begins after the picture says so. Ignoring it put that sound
    // early by the whole delay. The first real entry says where in the media
    // the start lands.
    if (mediaTime < 0) {
      delay += segment;
      continue;
    }
    const delayTicks = movieTimescale ? Math.round((delay * trackTimescale) / movieTimescale) : 0;
    return { offset: mediaTime - delayTicks };
  }
  return { offset: 0 };
}

function readRotation(view: DataView, tkhd: Box): 0 | 90 | 180 | 270 {
  const version = view.getUint8(tkhd.body);
  // matrix sits after: flags(3) + times + id + reserved + duration + reserved(8) + layer/group/volume/reserved(8)
  const matrixAt = tkhd.body + (version === 1 ? 4 + 8 + 8 + 4 + 4 + 8 : 4 + 4 + 4 + 4 + 4 + 4) + 8 + 8;
  const a = view.getInt32(matrixAt) / 65536;
  const b = view.getInt32(matrixAt + 4) / 65536;
  const c = view.getInt32(matrixAt + 12) / 65536;
  const d = view.getInt32(matrixAt + 16) / 65536;
  if (a === 0 && d === 0) {
    if (b > 0 && c < 0) return 90;
    if (b < 0 && c > 0) return 270;
  }
  if (a < 0 && d < 0) return 180;
  return 0;
}

interface SampleEntry {
  type: string;
  box: Box;
}

function readSampleEntry(view: DataView, stsd: Box): SampleEntry | null {
  const entries = boxes(view, stsd.body + 8, stsd.end);
  const entry = entries[0];
  return entry ? { type: entry.type, box: entry } : null;
}

/** Video sample entries are 78 bytes before their child boxes. */
const VISUAL_ENTRY_BYTES = 78;
/** Audio sample entries are 28 bytes, or longer in QuickTime's later versions. */
const AUDIO_ENTRY_BYTES = [28, 44, 64];

interface VideoConfig {
  codec: string | null;
  description: Uint8Array | null;
  width: number;
  height: number;
}

function readVideoEntry(view: DataView, entry: SampleEntry): VideoConfig {
  const width = view.getUint16(entry.box.body + 24);
  const height = view.getUint16(entry.box.body + 26);
  const children = boxes(view, entry.box.body + VISUAL_ENTRY_BYTES, entry.box.end);
  if (entry.type === 'avc1' || entry.type === 'avc3') {
    const avcC = find(children, 'avcC');
    if (!avcC) return { codec: null, description: null, width, height };
    const description = bytes(view, avcC.body, avcC.end);
    return { codec: avcCodecString(description), description, width, height };
  }
  if (entry.type === 'hvc1' || entry.type === 'hev1') {
    const hvcC = find(children, 'hvcC');
    if (!hvcC) return { codec: null, description: null, width, height };
    const description = bytes(view, hvcC.body, hvcC.end);
    return { codec: hevcCodecString(description, entry.type), description, width, height };
  }
  return { codec: null, description: null, width, height };
}

function readAudioEntry(view: DataView, entry: SampleEntry): AudioConfig | null {
  if (entry.type !== 'mp4a') return null;
  for (const skip of AUDIO_ENTRY_BYTES) {
    const children = boxes(view, entry.box.body + skip, entry.box.end);
    const esds = find(children, 'esds');
    if (esds) return readEsds(view, esds.body, esds.end);
    // QuickTime version 1/2 entries wrap the codec boxes in a `wave` box.
    const wave = find(children, 'wave');
    if (wave) {
      const inner = find(boxes(view, wave.body, wave.end), 'esds');
      if (inner) return readEsds(view, inner.body, inner.end);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Sample tables                                                       */
/* ------------------------------------------------------------------ */

interface RawSample {
  offset: number;
  size: number;
  dts: number;
  cts: number;
  key: boolean;
}

/** `stbl` of a progressive file, walked into one entry per sample. */
function readStbl(view: DataView, stbl: Box): RawSample[] | null {
  const inStbl = boxes(view, stbl.body, stbl.end);
  const stts = find(inStbl, 'stts');
  const stsz = find(inStbl, 'stsz');
  const stsc = find(inStbl, 'stsc');
  const stco = find(inStbl, 'stco') ?? find(inStbl, 'co64');
  if (!stts || !stsz || !stsc || !stco) return null;
  const wideOffsets = stco.type === 'co64';

  // A table claiming more entries than its box can hold is damaged. Refusing
  // it here stops a corrupt count from allocating gigabytes below.
  const holds = (table: Box, header: number, entries: number, entryBytes: number) =>
    table.body + header + entries * entryBytes <= table.end;

  // Sizes.
  const uniform = view.getUint32(stsz.body + 4);
  const count = view.getUint32(stsz.body + 8);
  // Every sample is at least a byte of the file.
  if (count > view.byteLength || (!uniform && !holds(stsz, 12, count, 4))) return null;
  if (!holds(stts, 8, view.getUint32(stts.body + 4), 8)) return null;
  if (!holds(stsc, 8, view.getUint32(stsc.body + 4), 12)) return null;
  if (!holds(stco, 8, view.getUint32(stco.body + 4), stco.type === 'co64' ? 8 : 4)) return null;
  const sizes = new Array<number>(count);
  for (let i = 0; i < count; i += 1) {
    sizes[i] = uniform || view.getUint32(stsz.body + 12 + i * 4);
  }

  // Decode times, from the run-length deltas.
  const dts = new Array<number>(count);
  {
    const runs = view.getUint32(stts.body + 4);
    let p = stts.body + 8;
    let t = 0;
    let i = 0;
    for (let r = 0; r < runs && i < count; r += 1) {
      const n = view.getUint32(p);
      const delta = view.getUint32(p + 4);
      p += 8;
      for (let k = 0; k < n && i < count; k += 1) {
        dts[i] = t;
        t += delta;
        i += 1;
      }
    }
    // A table shorter than the sample count: pad with the last delta.
    for (; i < count; i += 1) dts[i] = t;
  }

  // Composition offsets, when frames were reordered.
  const cts = new Array<number>(count).fill(0);
  const ctts = find(inStbl, 'ctts');
  if (ctts && holds(ctts, 8, view.getUint32(ctts.body + 4), 8)) {
    const version = view.getUint8(ctts.body);
    const runs = view.getUint32(ctts.body + 4);
    let p = ctts.body + 8;
    let i = 0;
    for (let r = 0; r < runs && i < count; r += 1) {
      const n = view.getUint32(p);
      const offset = version === 1 ? view.getInt32(p + 4) : view.getUint32(p + 4);
      p += 8;
      for (let k = 0; k < n && i < count; k += 1) {
        cts[i] = offset;
        i += 1;
      }
    }
  }

  // Sync samples: every sample when the table is absent.
  const keys = new Array<boolean>(count).fill(true);
  const stss = find(inStbl, 'stss');
  if (stss && holds(stss, 8, view.getUint32(stss.body + 4), 4)) {
    keys.fill(false);
    const n = view.getUint32(stss.body + 4);
    for (let i = 0; i < n; i += 1) {
      const index = view.getUint32(stss.body + 8 + i * 4) - 1;
      if (index >= 0 && index < count) keys[index] = true;
    }
  }

  // Offsets: chunk table × samples-per-chunk runs.
  const chunkCount = view.getUint32(stco.body + 4);
  const chunkOffsets = new Array<number>(chunkCount);
  for (let i = 0; i < chunkCount; i += 1) {
    chunkOffsets[i] = wideOffsets
      ? Number(view.getBigUint64(stco.body + 8 + i * 8))
      : view.getUint32(stco.body + 8 + i * 4);
  }
  const stscCount = view.getUint32(stsc.body + 4);
  const stscRuns: { firstChunk: number; perChunk: number }[] = [];
  for (let i = 0; i < stscCount; i += 1) {
    stscRuns.push({
      firstChunk: view.getUint32(stsc.body + 8 + i * 12) - 1,
      perChunk: view.getUint32(stsc.body + 12 + i * 12),
    });
  }
  const offsets = new Array<number>(count);
  let sample = 0;
  for (let run = 0; run < stscRuns.length && sample < count; run += 1) {
    const current = stscRuns[run]!;
    const next = stscRuns[run + 1];
    const lastChunk = next ? next.firstChunk : chunkCount;
    for (let chunk = current.firstChunk; chunk < lastChunk && sample < count; chunk += 1) {
      let at = chunkOffsets[chunk] ?? 0;
      for (let k = 0; k < current.perChunk && sample < count; k += 1) {
        offsets[sample] = at;
        at += sizes[sample] ?? 0;
        sample += 1;
      }
    }
  }
  if (sample < count) return null;

  const out: RawSample[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = { offset: offsets[i]!, size: sizes[i]!, dts: dts[i]!, cts: cts[i]!, key: keys[i]! };
  }
  return out;
}

interface TrexDefaults {
  duration: number;
  size: number;
  flags: number;
}

function readTrex(view: DataView, moov: Box): Map<number, TrexDefaults> {
  const out = new Map<number, TrexDefaults>();
  const mvex = find(boxes(view, moov.body, moov.end), 'mvex');
  if (!mvex) return out;
  for (const trex of all(boxes(view, mvex.body, mvex.end), 'trex')) {
    out.set(view.getUint32(trex.body + 4), {
      duration: view.getUint32(trex.body + 12),
      size: view.getUint32(trex.body + 16),
      flags: view.getUint32(trex.body + 20),
    });
  }
  return out;
}

const NON_SYNC_FLAG = 0x00010000;

/** Every `moof` in the file, walked into samples for one track. */
function readFragments(
  view: DataView,
  top: Box[],
  trackId: number,
  defaults: TrexDefaults | undefined,
): RawSample[] {
  const out: RawSample[] = [];
  let runningDts = 0;
  for (const moof of all(top, 'moof')) {
    for (const traf of all(boxes(view, moof.body, moof.end), 'traf')) {
      const inTraf = boxes(view, traf.body, traf.end);
      const tfhd = find(inTraf, 'tfhd');
      if (!tfhd) continue;
      const flags = view.getUint32(tfhd.body) & 0xffffff;
      if (view.getUint32(tfhd.body + 4) !== trackId) continue;

      let p = tfhd.body + 8;
      let base = moof.start;
      if (flags & 0x01) {
        base = Number(view.getBigUint64(p));
        p += 8;
      }
      if (flags & 0x02) p += 4;
      let defaultDuration = defaults?.duration ?? 0;
      let defaultSize = defaults?.size ?? 0;
      let defaultFlags = defaults?.flags ?? 0;
      if (flags & 0x08) {
        defaultDuration = view.getUint32(p);
        p += 4;
      }
      if (flags & 0x10) {
        defaultSize = view.getUint32(p);
        p += 4;
      }
      if (flags & 0x20) {
        defaultFlags = view.getUint32(p);
        p += 4;
      }

      const tfdt = find(inTraf, 'tfdt');
      if (tfdt) {
        runningDts =
          view.getUint8(tfdt.body) === 1
            ? Number(view.getBigUint64(tfdt.body + 4))
            : view.getUint32(tfdt.body + 4);
      }

      for (const trun of all(inTraf, 'trun')) {
        const version = view.getUint8(trun.body);
        const trunFlags = view.getUint32(trun.body) & 0xffffff;
        const count = view.getUint32(trun.body + 4);
        let q = trun.body + 8;
        let at = base;
        if (trunFlags & 0x000001) {
          at = base + view.getInt32(q);
          q += 4;
        }
        let firstFlags: number | null = null;
        if (trunFlags & 0x000004) {
          firstFlags = view.getUint32(q);
          q += 4;
        }
        for (let i = 0; i < count; i += 1) {
          let duration = defaultDuration;
          let size = defaultSize;
          let sampleFlags = i === 0 && firstFlags !== null ? firstFlags : defaultFlags;
          let cts = 0;
          if (trunFlags & 0x000100) {
            duration = view.getUint32(q);
            q += 4;
          }
          if (trunFlags & 0x000200) {
            size = view.getUint32(q);
            q += 4;
          }
          if (trunFlags & 0x000400) {
            sampleFlags = view.getUint32(q);
            q += 4;
          }
          if (trunFlags & 0x000800) {
            cts = version === 0 ? view.getUint32(q) : view.getInt32(q);
            q += 4;
          }
          if (q > trun.end) return out;
          out.push({ offset: at, size, dts: runningDts, cts, key: !(sampleFlags & NON_SYNC_FLAG) });
          at += size;
          runningDts += duration;
        }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The movie                                                           */
/* ------------------------------------------------------------------ */

function toSamples(raw: RawSample[], timescale: number, edit: Edit): DemuxedSample[] {
  const us = (t: number) => Math.round((t * 1_000_000) / timescale);
  const out: DemuxedSample[] = new Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    const s = raw[i]!;
    const next = raw[i + 1];
    const ticks = next ? next.dts - s.dts : (raw[i - 1] ? s.dts - raw[i - 1]!.dts : 0);
    out[i] = {
      offset: s.offset,
      size: s.size,
      dts: us(s.dts),
      pts: us(s.dts + s.cts - edit.offset),
      duration: us(Math.max(0, ticks)),
      key: s.key,
    };
  }
  return out;
}

/** Frames per second from the median presentation gap, to two decimals. */
export function estimateFps(samples: DemuxedSample[]): number {
  if (samples.length < 2) return 0;
  const pts = samples.map((s) => s.pts).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < pts.length; i += 1) {
    const gap = pts[i]! - pts[i - 1]!;
    if (gap > 0) gaps.push(gap);
  }
  if (!gaps.length) return 0;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)]!;
  return Math.round((1_000_000 / median) * 100) / 100;
}

export function demuxMp4(buffer: ArrayBuffer): DemuxedMovie | null {
  const view = new DataView(buffer);
  const top = boxes(view, 0, buffer.byteLength);
  const moov = find(top, 'moov');
  if (!moov) return null;
  const inMoov = boxes(view, moov.body, moov.end);
  const trex = readTrex(view, moov);
  const mvhd = find(inMoov, 'mvhd');
  const movieTimescale = mvhd ? view.getUint32(mvhd.body + (view.getUint8(mvhd.body) === 1 ? 20 : 12)) : 0;

  let video: DemuxedVideoTrack | null = null;
  let audio: DemuxedAudioTrack | null = null;
  let duration = 0;

  for (const trak of all(inMoov, 'trak')) {
    const inTrak = boxes(view, trak.body, trak.end);
    const tkhd = find(inTrak, 'tkhd');
    const mdia = find(inTrak, 'mdia');
    if (!tkhd || !mdia) continue;
    const tkVersion = view.getUint8(tkhd.body);
    const trackId = view.getUint32(tkhd.body + (tkVersion === 1 ? 20 : 12));
    const inMdia = boxes(view, mdia.body, mdia.end);
    const mdhd = find(inMdia, 'mdhd');
    const hdlr = find(inMdia, 'hdlr');
    const minf = find(inMdia, 'minf');
    if (!mdhd || !hdlr || !minf) continue;
    const mdVersion = view.getUint8(mdhd.body);
    const timescale = view.getUint32(mdhd.body + (mdVersion === 1 ? 20 : 12));
    if (!timescale) continue;
    const handler = String.fromCharCode(
      view.getUint8(hdlr.body + 8),
      view.getUint8(hdlr.body + 9),
      view.getUint8(hdlr.body + 10),
      view.getUint8(hdlr.body + 11),
    );
    const stbl = find(boxes(view, minf.body, minf.end), 'stbl');
    const stsd = stbl && find(boxes(view, stbl.body, stbl.end), 'stsd');
    if (!stbl || !stsd) continue;
    const entry = readSampleEntry(view, stsd);
    if (!entry) continue;

    let raw = readStbl(view, stbl);
    if (!raw || raw.length === 0) raw = readFragments(view, top, trackId, trex.get(trackId));
    if (!raw.length) continue;
    const samples = toSamples(raw, timescale, readEdit(view, inTrak, movieTimescale, timescale));
    const last = samples[samples.length - 1]!;
    duration = Math.max(duration, (last.pts + last.duration) / 1_000_000);

    if (handler === 'vide' && !video) {
      const config = readVideoEntry(view, entry);
      video = {
        kind: 'video',
        id: trackId,
        codec: config.codec,
        description: config.description,
        codedWidth: config.width,
        codedHeight: config.height,
        rotation: readRotation(view, tkhd),
        fps: estimateFps(samples),
        samples,
      };
    } else if (handler === 'soun' && !audio) {
      const config = readAudioEntry(view, entry);
      audio = {
        kind: 'audio',
        id: trackId,
        codec: config?.codec ?? null,
        description: config?.description ?? null,
        sampleRate: config?.sampleRate ?? 0,
        channels: config?.channels ?? 0,
        samples,
      };
    }
  }

  if (!video && !audio) return null;
  return { video, audio, duration };
}
