/**
 * A progressive MP4 writer for what WebCodecs hands back.
 *
 * `MediaRecorder` writes a fragmented MP4 as it goes and leaves its headers
 * blank (see `lib/mp4.ts` for the repairs that cost). Recording through
 * WebCodecs instead means holding every encoded chunk until the end and then
 * writing the file in one piece, which is the shape a phone or a camera
 * writes: `ftyp`, one `moov` with complete sample tables, one `mdat`. Every
 * player reads that without guessing, and every platform re-encodes it
 * without complaint.
 *
 * Scope: one H.264 video track (`avc1` with the encoder's `avcC`) and at most
 * one AAC-LC audio track (`mp4a` with an `esds` carrying the encoder's
 * AudioSpecificConfig). Sample timestamps are microseconds, as WebCodecs
 * reports them. Composition offsets are written when the encoder reordered
 * frames and omitted when it did not.
 */

export interface MuxSample {
  data: Uint8Array;
  /** Presentation time, microseconds, from the start of the recording. */
  timestamp: number;
  /** Microseconds. */
  duration: number;
  key: boolean;
}

export interface MuxVideoTrack {
  width: number;
  height: number;
  /** `avcC` box payload, from the encoder's `decoderConfig.description`. */
  description: Uint8Array;
  /** In decode order, as the encoder emitted them. */
  samples: MuxSample[];
}

export interface MuxAudioTrack {
  sampleRate: number;
  channels: number;
  /** AudioSpecificConfig, from the encoder's `decoderConfig.description`. */
  description: Uint8Array;
  samples: MuxSample[];
}

export interface MuxInput {
  video: MuxVideoTrack;
  audio?: MuxAudioTrack | null;
}

export interface MuxResult {
  buffer: ArrayBuffer;
  /** Seconds, as the file states them. */
  durationSeconds: number;
  videoSeconds: number;
  audioSeconds: number;
}

const VIDEO_TIMESCALE = 90_000;
const MOVIE_TIMESCALE = 1_000;

/* ------------------------------------------------------------------ */
/* Byte helpers                                                        */
/* ------------------------------------------------------------------ */

const encoder = new TextEncoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(size);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.byteLength;
  }
  return out;
}

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  const out = new Uint8Array(8 + body.byteLength);
  new DataView(out.buffer).setUint32(0, out.byteLength);
  out.set(encoder.encode(type), 4);
  out.set(body, 8);
  return out;
}

function fullBox(type: string, version: number, flags: number, ...parts: Uint8Array[]): Uint8Array {
  return box(type, u32((version << 24) | (flags & 0xffffff)), ...parts);
}

function u8(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function u16(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint16(i * 2, v));
  return out;
}

function u32(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v >>> 0));
  return out;
}

function i32(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setInt32(i * 4, v));
  return out;
}

function u64(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(Math.round(value)));
  return out;
}

/** 16.16 fixed point. */
const fixed16 = (v: number) => u32(Math.round(v * 65536));

/** Seconds since 1904-01-01, as MP4 wants its creation times. */
function mp4Now(): number {
  return Math.floor(Date.now() / 1000) + 2_082_844_800;
}

/* ------------------------------------------------------------------ */
/* Sample tables                                                       */
/* ------------------------------------------------------------------ */

interface Timed {
  /** Decode time in track timescale units. */
  dts: number;
  /** Composition offset (pts - dts) in track timescale units. */
  cts: number;
  /** Duration in track timescale units. */
  duration: number;
  size: number;
  key: boolean;
  data: Uint8Array;
}

/** The earliest presentation timestamp in a track, microseconds. */
function trackStart(samples: MuxSample[]): number {
  return Math.min(...samples.map((s) => s.timestamp));
}

/**
 * Lays a track's samples out on its timescale. Samples arrive in decode
 * order with presentation timestamps; decode times are rebuilt as a running
 * sum of durations, and the difference becomes the composition offset. With
 * no reordering every offset is zero and `ctts` is left out.
 */
function timeSamples(samples: MuxSample[], timescale: number): Timed[] {
  if (!samples.length) return [];
  const origin = trackStart(samples);
  const toTicks = (us: number) => Math.round((us / 1_000_000) * timescale);
  // Durations from the presentation timeline, so that a held frame keeps
  // its real length; the last sample keeps what the encoder said. Taken as
  // differences of already-rounded tick positions, so the running sum of
  // durations lands exactly on each frame's position and an unreordered
  // stream gets composition offsets of exactly zero.
  const inOrder = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  const durationByStamp = new Map<number, number>();
  inOrder.forEach((s, i) => {
    const next = inOrder[i + 1];
    const ticks = next
      ? toTicks(next.timestamp - origin) - toTicks(s.timestamp - origin)
      : toTicks(Math.max(1, s.duration));
    durationByStamp.set(s.timestamp, Math.max(1, ticks));
  });
  let dts = 0;
  return samples.map((s) => {
    const duration = durationByStamp.get(s.timestamp) ?? 1;
    const timed: Timed = {
      dts,
      cts: toTicks(s.timestamp - origin) - dts,
      duration,
      size: s.data.byteLength,
      key: s.key,
      data: s.data,
    };
    dts += duration;
    return timed;
  });
}

/** Run-length pairs `[count, value]` over one field of the samples. */
function runs(timed: Timed[], field: (t: Timed) => number): [number, number][] {
  const out: [number, number][] = [];
  for (const t of timed) {
    const value = field(t);
    const last = out[out.length - 1];
    if (last && last[1] === value) last[0] += 1;
    else out.push([1, value]);
  }
  return out;
}

function stts(timed: Timed[]): Uint8Array {
  const table = runs(timed, (t) => t.duration);
  return fullBox('stts', 0, 0, u32(table.length), u32(...table.flat()));
}

function ctts(timed: Timed[]): Uint8Array | null {
  if (timed.every((t) => t.cts === 0)) return null;
  // Version 1: signed offsets, so a frame presented before its decode slot
  // needs no edit list to say so.
  const table = runs(timed, (t) => t.cts);
  const out: Uint8Array[] = [u32(table.length)];
  for (const [count, offset] of table) out.push(u32(count ?? 0), i32(offset ?? 0));
  return fullBox('ctts', 1, 0, ...out);
}

function stss(timed: Timed[]): Uint8Array | null {
  const keys = timed.map((t, i) => (t.key ? i + 1 : 0)).filter(Boolean);
  if (keys.length === timed.length) return null;
  return fullBox('stss', 0, 0, u32(keys.length), u32(...keys));
}

function stsz(timed: Timed[]): Uint8Array {
  return fullBox('stsz', 0, 0, u32(0, timed.length), u32(...timed.map((t) => t.size)));
}

/** One chunk per sample: the layout is then just the list of offsets. */
function stsc(): Uint8Array {
  return fullBox('stsc', 0, 0, u32(1), u32(1, 1, 1));
}

function stco(offsets: number[]): Uint8Array {
  return fullBox('stco', 0, 0, u32(offsets.length), u32(...offsets));
}

/* ------------------------------------------------------------------ */
/* Sample entries                                                      */
/* ------------------------------------------------------------------ */

function avc1(width: number, height: number, avcC: Uint8Array): Uint8Array {
  const compressorName = new Uint8Array(32);
  return box(
    'avc1',
    u8(0, 0, 0, 0, 0, 0), // reserved
    u16(1), // data_reference_index
    u16(0, 0), // pre_defined, reserved
    u32(0, 0, 0), // pre_defined
    u16(width, height),
    fixed16(72),
    fixed16(72), // resolution
    u32(0), // reserved
    u16(1), // frame_count
    compressorName,
    u16(0x0018), // depth
    u16(0xffff), // pre_defined
    box('avcC', avcC),
  );
}

/** MPEG-4 descriptor with the class tag and a 4-byte expandable length. */
function descriptor(tag: number, body: Uint8Array): Uint8Array {
  const size = body.byteLength;
  return concat([
    u8(tag, 0x80 | ((size >> 21) & 0x7f), 0x80 | ((size >> 14) & 0x7f), 0x80 | ((size >> 7) & 0x7f), size & 0x7f),
    body,
  ]);
}

function esds(asc: Uint8Array, bitrate: number): Uint8Array {
  const decoderSpecific = descriptor(0x05, asc);
  const decoderConfig = descriptor(
    0x04,
    concat([
      u8(0x40), // objectTypeIndication: Audio ISO/IEC 14496-3
      u8(0x15), // streamType audio (5) << 2 | reserved 1
      u8(0, 0x18, 0), // bufferSizeDB (24 bits)
      u32(bitrate, bitrate), // maxBitrate, avgBitrate
      decoderSpecific,
    ]),
  );
  const slConfig = descriptor(0x06, u8(0x02));
  const es = descriptor(0x03, concat([u16(1), u8(0), decoderConfig, slConfig]));
  return fullBox('esds', 0, 0, es);
}

function mp4a(sampleRate: number, channels: number, asc: Uint8Array, bitrate: number): Uint8Array {
  return box(
    'mp4a',
    u8(0, 0, 0, 0, 0, 0), // reserved
    u16(1), // data_reference_index
    u32(0, 0), // reserved
    u16(channels, 16), // channelcount, samplesize
    u16(0, 0), // pre_defined, reserved
    u32(sampleRate << 16), // samplerate, 16.16
    esds(asc, bitrate),
  );
}

/* ------------------------------------------------------------------ */
/* Track and movie                                                     */
/* ------------------------------------------------------------------ */

interface TrackPlan {
  id: number;
  kind: 'video' | 'audio';
  timescale: number;
  timed: Timed[];
  entry: Uint8Array;
  width: number;
  height: number;
  /**
   * How long after the movie starts this track's first sample is presented,
   * microseconds. Written as an empty edit in front of the track, which is
   * how a track that begins a little after the other says so.
   */
  delayUs: number;
  /** Filled in once the mdat layout is known. */
  offsets: number[];
}

/** Anything under this is inside one audio frame and not worth an edit list. */
const MIN_DELAY_US = 1_000;

function trak(plan: TrackPlan, now: number): Uint8Array {
  const duration = plan.timed.reduce((n, t) => n + t.duration, 0);
  const mediaMovieDuration = Math.round((duration / plan.timescale) * MOVIE_TIMESCALE);
  const delayMovie = plan.delayUs >= MIN_DELAY_US ? Math.round((plan.delayUs / 1_000_000) * MOVIE_TIMESCALE) : 0;
  const movieDuration = mediaMovieDuration + delayMovie;
  const isVideo = plan.kind === 'video';

  const tkhd = fullBox(
    'tkhd',
    1,
    0x000003, // enabled, in movie
    u64(now),
    u64(now),
    u32(plan.id),
    u32(0),
    u64(movieDuration),
    u32(0, 0), // reserved
    u16(0), // layer
    u16(0), // alternate_group
    u16(isVideo ? 0 : 0x0100), // volume
    u16(0), // reserved
    u32(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000), // matrix
    fixed16(isVideo ? plan.width : 0),
    fixed16(isVideo ? plan.height : 0),
  );

  const mdhd = fullBox(
    'mdhd',
    1,
    0,
    u64(now),
    u64(now),
    u32(plan.timescale),
    u64(duration),
    u16(0x55c4), // 'und'
    u16(0),
  );

  const hdlr = fullBox(
    'hdlr',
    0,
    0,
    u32(0),
    encoder.encode(isVideo ? 'vide' : 'soun'),
    u32(0, 0, 0),
    encoder.encode(isVideo ? 'VideoHandler\0' : 'SoundHandler\0'),
  );

  const mediaHeader = isVideo
    ? fullBox('vmhd', 0, 1, u16(0, 0, 0, 0))
    : fullBox('smhd', 0, 0, u16(0, 0));

  const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));

  const tables: Uint8Array[] = [
    fullBox('stsd', 0, 0, u32(1), plan.entry),
    stts(plan.timed),
  ];
  const composition = ctts(plan.timed);
  if (composition) tables.push(composition);
  const sync = isVideo ? stss(plan.timed) : null;
  if (sync) tables.push(sync);
  tables.push(stsc(), stsz(plan.timed), stco(plan.offsets));

  const parts: Uint8Array[] = [tkhd];
  if (delayMovie > 0) {
    // An empty edit (media_time -1) for the delay, then the whole track.
    parts.push(
      box(
        'edts',
        fullBox(
          'elst',
          0,
          0,
          u32(2),
          u32(delayMovie),
          i32(-1),
          u32(0x00010000),
          u32(mediaMovieDuration),
          u32(0),
          u32(0x00010000),
        ),
      ),
    );
  }
  parts.push(box('mdia', mdhd, hdlr, box('minf', mediaHeader, dinf, box('stbl', ...tables))));
  return box('trak', ...parts);
}

function moov(plans: TrackPlan[], now: number): Uint8Array {
  const longest = Math.max(
    0,
    ...plans.map(
      (p) =>
        ((p.timed.reduce((n, t) => n + t.duration, 0) / p.timescale) +
          (p.delayUs >= MIN_DELAY_US ? p.delayUs / 1_000_000 : 0)) *
        MOVIE_TIMESCALE,
    ),
  );
  const mvhd = fullBox(
    'mvhd',
    1,
    0,
    u64(now),
    u64(now),
    u32(MOVIE_TIMESCALE),
    u64(Math.round(longest)),
    u32(0x00010000), // rate
    u16(0x0100), // volume
    u16(0),
    u32(0, 0), // reserved
    u32(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000), // matrix
    u32(0, 0, 0, 0, 0, 0), // pre_defined
    u32(plans.length + 1), // next_track_ID
  );
  return box('moov', mvhd, ...plans.map((p) => trak(p, now)));
}

/* ------------------------------------------------------------------ */
/* The file                                                            */
/* ------------------------------------------------------------------ */

/**
 * Writes the recording as a progressive MP4.
 *
 * The `mdat` interleaves the tracks by decode time, one chunk per sample, so
 * a player reading from the front never has to jump far for the other
 * track. Offsets depend on the size of `moov`, which does not depend on the
 * offsets' values — so the header is built once with placeholders to learn
 * its size, and once more with the real numbers.
 */
export function writeMp4(input: MuxInput): MuxResult {
  const { video, audio } = input;
  if (!video.samples.length) throw new Error('nothing to write: no video samples');
  if (!video.description.byteLength) throw new Error('nothing to write: no avcC');

  const withAudio = Boolean(audio && audio.samples.length && audio.description.byteLength);
  // Both tracks are on one timeline; whichever starts first is the movie's
  // zero and the other carries its lateness as an edit.
  const movieStart = Math.min(
    trackStart(video.samples),
    withAudio && audio ? trackStart(audio.samples) : Infinity,
  );

  const plans: TrackPlan[] = [
    {
      id: 1,
      kind: 'video',
      timescale: VIDEO_TIMESCALE,
      timed: timeSamples(video.samples, VIDEO_TIMESCALE),
      entry: avc1(video.width, video.height, video.description),
      width: video.width,
      height: video.height,
      delayUs: trackStart(video.samples) - movieStart,
      offsets: [],
    },
  ];
  if (withAudio && audio) {
    const bitrate = Math.round(
      (audio.samples.reduce((n, s) => n + s.data.byteLength, 0) * 8) /
        Math.max(1e-6, audio.samples.reduce((n, s) => n + s.duration, 0) / 1_000_000),
    );
    plans.push({
      id: 2,
      kind: 'audio',
      timescale: audio.sampleRate,
      timed: timeSamples(audio.samples, audio.sampleRate),
      entry: mp4a(audio.sampleRate, audio.channels, audio.description, bitrate),
      width: 0,
      height: 0,
      delayUs: trackStart(audio.samples) - movieStart,
      offsets: [],
    });
  }

  // Interleave by decode time in seconds.
  const order: { plan: TrackPlan; index: number; at: number }[] = [];
  for (const plan of plans) {
    plan.timed.forEach((t, index) => order.push({ plan, index, at: t.dts / plan.timescale }));
  }
  order.sort((a, b) => a.at - b.at || a.plan.id - b.plan.id);

  const now = mp4Now();
  const ftyp = box('ftyp', encoder.encode('isom'), u32(0x200), encoder.encode('isomiso2avc1mp41'));

  // Pass one: placeholder offsets, to size the header.
  for (const plan of plans) plan.offsets = plan.timed.map(() => 0);
  const headerSize = ftyp.byteLength + moov(plans, now).byteLength;
  const mdatBody = headerSize + 8;

  let cursor = mdatBody;
  for (const plan of plans) plan.offsets = new Array<number>(plan.timed.length).fill(0);
  for (const { plan, index } of order) {
    plan.offsets[index] = cursor;
    cursor += plan.timed[index]?.size ?? 0;
  }
  const mdatSize = 8 + (cursor - mdatBody);

  const header = moov(plans, now);
  if (ftyp.byteLength + header.byteLength !== headerSize) {
    throw new Error('moov changed size between passes');
  }

  const out = new Uint8Array(cursor);
  out.set(ftyp, 0);
  out.set(header, ftyp.byteLength);
  new DataView(out.buffer).setUint32(headerSize, mdatSize);
  out.set(encoder.encode('mdat'), headerSize + 4);
  for (const { plan, index } of order) {
    const sample = plan.timed[index];
    const at = plan.offsets[index];
    if (sample && at !== undefined) out.set(sample.data, at);
  }

  const seconds = (plan: TrackPlan | undefined) =>
    plan
      ? plan.timed.reduce((n, t) => n + t.duration, 0) / plan.timescale +
        (plan.delayUs >= MIN_DELAY_US ? plan.delayUs / 1_000_000 : 0)
      : 0;
  const videoSeconds = seconds(plans[0]);
  const audioSeconds = seconds(plans[1]);
  return {
    buffer: out.buffer,
    durationSeconds: +Math.max(videoSeconds, audioSeconds).toFixed(3),
    videoSeconds: +videoSeconds.toFixed(3),
    audioSeconds: +audioSeconds.toFixed(3),
  };
}
