/**
 * Container repair for the files `MediaRecorder` hands back.
 *
 * Chrome writes MP4 as a *fragmented* MP4, emitted as it records: the header
 * goes out before a single frame exists, so `mvhd`, `tkhd` and `mdhd` all
 * carry a duration of zero and nothing ever goes back to fill them in. Players
 * are left to guess how long the file is, and they guess badly — a 15 s export
 * opened as an 11 s file and stopped there.
 *
 * The same "written as it goes" property causes the second fault. The two
 * tracks do not start together: the canvas is already painted when the
 * recorder starts, so the picture begins at once, while the audio encoder can
 * take well over a second to deliver its first packet. Both tracks are stamped
 * from zero regardless, so the sound is pulled forward by exactly the time it
 * was late — it runs ahead of the picture for the whole file and stops early.
 * That is what "the sound is done after the first few seconds, it's delayed"
 * turned out to be. Measured on the exports that prompted this: the first
 * fragment of one held 3.340 s of picture against 2.004 s of sound, and every
 * fragment after it advanced both by the same amount, so the entire 1.348 s
 * deficit was a late start rather than anything lost along the way.
 *
 * Both faults are repaired here, after recording, by rewriting fields that are
 * already in the file. No box changes size, so this is a handful of in-place
 * stores rather than a remux — and anything that does not parse exactly as
 * expected is handed back untouched.
 */

/** Below this the tracks are as aligned as a real-time recorder ever gets. */
const MIN_SHIFT_SECONDS = 0.05;
/**
 * Above this the file is not "the sound started late", it is broken in some
 * way this code has not seen, and inventing ten seconds of silence would make
 * it worse rather than better.
 */
const MAX_SHIFT_SECONDS = 10;

export interface RecordingRepair {
  /** False when the buffer was handed back exactly as it arrived. */
  patched: boolean;
  /** Seconds of picture the fragments actually carry. */
  videoSeconds: number;
  /** Seconds of sound the fragments actually carry. */
  audioSeconds: number;
  /** Silence written in front of the sound to line it up with the picture. */
  audioLeadSeconds: number;
  /** What the file will now report as its length. */
  durationSeconds: number;
}

export interface RepairResult {
  buffer: ArrayBuffer;
  repair: RecordingRepair;
}

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

/** Where a 32- or 64-bit field lives, so it can be read and written once. */
interface Slot {
  at: number;
  wide: boolean;
}

function readSlot(view: DataView, slot: Slot): number {
  return slot.wide ? Number(view.getBigUint64(slot.at)) : view.getUint32(slot.at);
}

function writeSlot(view: DataView, slot: Slot, value: number): void {
  const clamped = Math.max(0, Math.round(value));
  if (slot.wide) {
    view.setBigUint64(slot.at, BigInt(clamped));
    return;
  }
  // A 32-bit field cannot hold more than this, and saturating beats wrapping
  // round to a duration of nearly nothing.
  view.setUint32(slot.at, Math.min(clamped, 0xffffffff));
}

interface Track {
  id: number;
  handler: string;
  timescale: number;
  tkhdDuration: Slot;
  mdhdDuration: Slot;
  /** Sum of every sample duration in the fragments, in `timescale` units. */
  samples: number;
  /** Every `tfdt` this track has, so the whole track slides at once. */
  decodeTimes: Slot[];
}

interface Header {
  timescale: number;
  duration: Slot;
  tracks: Track[];
}

/**
 * Reads the movie header and every track header. Answers null the moment
 * anything is missing rather than guessing: the caller's fallback — leave the
 * file alone — is always safe, and a wrong offset is not.
 */
function readHeader(view: DataView, moov: Box): Header | null {
  const inMoov = boxes(view, moov.body, moov.end);
  const mvhd = find(inMoov, 'mvhd');
  if (!mvhd) return null;
  const mvhdWide = view.getUint8(mvhd.body) === 1;
  const movieTimescale = view.getUint32(mvhd.body + (mvhdWide ? 20 : 12));
  if (!movieTimescale) return null;

  const tracks: Track[] = [];
  for (const trak of inMoov.filter((box) => box.type === 'trak')) {
    const inTrak = boxes(view, trak.body, trak.end);
    const tkhd = find(inTrak, 'tkhd');
    const mdia = find(inTrak, 'mdia');
    if (!tkhd || !mdia) return null;
    const tkhdWide = view.getUint8(tkhd.body) === 1;

    const inMdia = boxes(view, mdia.body, mdia.end);
    const mdhd = find(inMdia, 'mdhd');
    const hdlr = find(inMdia, 'hdlr');
    if (!mdhd || !hdlr) return null;
    const mdhdWide = view.getUint8(mdhd.body) === 1;
    const timescale = view.getUint32(mdhd.body + (mdhdWide ? 20 : 12));
    if (!timescale) return null;

    tracks.push({
      id: view.getUint32(tkhd.body + (tkhdWide ? 20 : 12)),
      handler: String.fromCharCode(
        view.getUint8(hdlr.body + 8),
        view.getUint8(hdlr.body + 9),
        view.getUint8(hdlr.body + 10),
        view.getUint8(hdlr.body + 11),
      ),
      timescale,
      tkhdDuration: { at: tkhd.body + (tkhdWide ? 28 : 20), wide: tkhdWide },
      mdhdDuration: { at: mdhd.body + (mdhdWide ? 24 : 16), wide: mdhdWide },
      samples: 0,
      decodeTimes: [],
    });
  }
  if (!tracks.length) return null;
  return {
    timescale: movieTimescale,
    duration: { at: mvhd.body + (mvhdWide ? 24 : 16), wide: mvhdWide },
    tracks,
  };
}

/** `trex` carries the sample duration a `traf` uses when it states none. */
function readTrexDefaults(view: DataView, moov: Box): Map<number, number> {
  const defaults = new Map<number, number>();
  const mvex = find(boxes(view, moov.body, moov.end), 'mvex');
  if (!mvex) return defaults;
  for (const trex of boxes(view, mvex.body, mvex.end).filter((box) => box.type === 'trex')) {
    defaults.set(view.getUint32(trex.body + 4), view.getUint32(trex.body + 12));
  }
  return defaults;
}

/** Totals each track's samples and collects its `tfdt`s, fragment by fragment. */
function readFragments(
  view: DataView,
  top: Box[],
  byId: Map<number, Track>,
  trexDefaults: Map<number, number>,
): boolean {
  for (const moof of top.filter((box) => box.type === 'moof')) {
    for (const traf of boxes(view, moof.body, moof.end).filter((box) => box.type === 'traf')) {
      const inTraf = boxes(view, traf.body, traf.end);
      const tfhd = find(inTraf, 'tfhd');
      if (!tfhd) return false;
      const flags = view.getUint32(tfhd.body) & 0xffffff;
      const trackId = view.getUint32(tfhd.body + 4);
      const track = byId.get(trackId);
      if (!track) return false;

      let p = tfhd.body + 8;
      if (flags & 0x01) p += 8; // base_data_offset
      if (flags & 0x02) p += 4; // sample_description_index
      let defaultDuration = trexDefaults.get(trackId) ?? 0;
      if (flags & 0x08) {
        defaultDuration = view.getUint32(p);
        p += 4;
      }

      const tfdt = find(inTraf, 'tfdt');
      if (tfdt) {
        track.decodeTimes.push({ at: tfdt.body + 4, wide: view.getUint8(tfdt.body) === 1 });
      }

      for (const trun of inTraf.filter((box) => box.type === 'trun')) {
        const trunFlags = view.getUint32(trun.body) & 0xffffff;
        const count = view.getUint32(trun.body + 4);
        let q = trun.body + 8;
        if (trunFlags & 0x000001) q += 4; // data_offset
        if (trunFlags & 0x000004) q += 4; // first_sample_flags
        for (let i = 0; i < count; i += 1) {
          let duration = defaultDuration;
          if (trunFlags & 0x000100) {
            duration = view.getUint32(q);
            q += 4;
          }
          if (trunFlags & 0x000200) q += 4; // sample_size
          if (trunFlags & 0x000400) q += 4; // sample_flags
          if (trunFlags & 0x000800) q += 4; // composition_time_offset
          if (q > trun.end) return false;
          track.samples += duration;
        }
      }
    }
  }
  return true;
}

const UNTOUCHED: RecordingRepair = {
  patched: false,
  videoSeconds: 0,
  audioSeconds: 0,
  audioLeadSeconds: 0,
  durationSeconds: 0,
};

/**
 * Writes the real durations into an MP4 `MediaRecorder` left blank, and slides
 * a late-starting sound track back under the picture it belongs to.
 *
 * The buffer is modified in place and handed back; pass a copy if the original
 * still matters. Anything that is not a fragmented MP4 — a WebM from the
 * fallback path, say — comes back untouched with `patched: false`.
 */
export function repairFragmentedMp4(buffer: ArrayBuffer): RepairResult {
  const untouched: RepairResult = { buffer, repair: UNTOUCHED };
  const view = new DataView(buffer);

  let header: Header;
  let top: Box[];
  try {
    top = boxes(view, 0, buffer.byteLength);
    if (!find(top, 'ftyp')) return untouched;
    const moov = find(top, 'moov');
    if (!moov) return untouched;
    const read = readHeader(view, moov);
    if (!read) return untouched;
    header = read;
    const byId = new Map(header.tracks.map((track) => [track.id, track]));
    if (!readFragments(view, top, byId, readTrexDefaults(view, moov))) return untouched;
  } catch {
    // A truncated or unfamiliar file. The recording is still playable as it
    // stands, so the only wrong move here is to write into it half-understood.
    return untouched;
  }

  const video = header.tracks.find((track) => track.handler === 'vide');
  const audio = header.tracks.find((track) => track.handler === 'soun');
  const secondsOf = (track: Track | undefined) => (track ? track.samples / track.timescale : 0);
  const videoSeconds = secondsOf(video);
  const audioSeconds = secondsOf(audio);
  if (videoSeconds <= 0 && audioSeconds <= 0) return untouched;

  // The sound is short by exactly the time it took to start, so that shortfall
  // *is* the offset: put it back in front and the two line up again.
  const deficit = videoSeconds - audioSeconds;
  const lead =
    video && audio && deficit >= MIN_SHIFT_SECONDS && deficit <= MAX_SHIFT_SECONDS ? deficit : 0;

  if (lead > 0 && audio) {
    const ticks = Math.round(lead * audio.timescale);
    for (const slot of audio.decodeTimes) writeSlot(view, slot, readSlot(view, slot) + ticks);
    audio.samples += ticks;
  }

  const longest = Math.max(videoSeconds, audioSeconds + lead);
  for (const track of header.tracks) {
    writeSlot(view, track.mdhdDuration, track.samples);
    writeSlot(view, track.tkhdDuration, (track.samples / track.timescale) * header.timescale);
  }
  writeSlot(view, header.duration, longest * header.timescale);

  return {
    buffer,
    repair: {
      patched: true,
      videoSeconds: +videoSeconds.toFixed(3),
      audioSeconds: +audioSeconds.toFixed(3),
      audioLeadSeconds: +lead.toFixed(3),
      durationSeconds: +longest.toFixed(3),
    },
  };
}
