/**
 * Sample-rate conversion for the export's sound.
 *
 * Chrome's AAC encoder takes 44.1 and 48 kHz and nothing else, while a clip
 * off the internet can carry AAC at 22.05, 32 or 96 kHz. Without this, those
 * clips could not take the frame-exact path at all and fell back to the live
 * recorder, with its dropped frames.
 *
 * A windowed-sinc interpolator, evaluated at each output sample's exact
 * position in the source. The kernel is symmetric, so the output is not
 * delayed by even a fraction of a sample — the sound stays on the picture's
 * timeline exactly as a clip at a native rate does. Linear interpolation (what
 * an `AudioBufferSourceNode` does at a mismatched rate) was not used: it rolls
 * off the top octave and folds images back into the audible band.
 */

/** Zero crossings of the kernel either side of centre, at the source rate. */
const HALF_TAPS = 32;
/** Pass band as a fraction of the lower Nyquist frequency. */
const ROLLOFF = 0.95;

/** How many frames `resample` returns for `frames` input frames. */
export function resampledLength(frames: number, fromRate: number, toRate: number): number {
  return Math.round((frames * toRate) / fromRate);
}

/**
 * One channel from `fromRate` to `toRate`. Output sample `j` sits at the same
 * instant as input position `j · fromRate / toRate`, so sample 0 stays at time 0.
 */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  const length = resampledLength(input.length, fromRate, toRate);
  if (fromRate === toRate) return input.slice(0, length);
  const output = new Float32Array(length);

  const step = fromRate / toRate;
  // Cut-off normalised to the source rate: the lower of the two Nyquists, so
  // downsampling filters out what the new rate cannot hold.
  const cutoff = Math.min(1, toRate / fromRate) * ROLLOFF;
  const half = Math.ceil(HALF_TAPS / cutoff);
  const table = kernelTable(cutoff, half);
  const last = input.length - 1;

  for (let j = 0; j < length; j += 1) {
    const t = j * step;
    const centre = Math.floor(t);
    let sum = 0;
    let weight = 0;
    const from = Math.max(0, centre - half + 1);
    const to = Math.min(last, centre + half);
    for (let k = from; k <= to; k += 1) {
      // Looked up between two table entries rather than computed: the kernel
      // is smooth at this resolution, and sin/cos per tap was 30 s of work
      // for a 30 s clip.
      const position = (t - k + half) * TABLE_STEPS;
      const index = Math.floor(position);
      const fraction = position - index;
      const h = table[index]! + (table[index + 1]! - table[index]!) * fraction;
      sum += input[k]! * h;
      weight += h;
    }
    // Normalising by the kernel's own sum keeps a constant level exact, and
    // stops the ends of the buffer, where the kernel is cut short, from dipping.
    output[j] = weight !== 0 ? sum / weight : 0;
  }
  return output;
}

/** Table entries per source sample of kernel width. */
const TABLE_STEPS = 512;

/** The kernel sampled from −half to +half, one spare entry at the end. */
function kernelTable(cutoff: number, half: number): Float32Array {
  const size = 2 * half * TABLE_STEPS + 2;
  const table = new Float32Array(size);
  for (let i = 0; i < size; i += 1) table[i] = kernel(i / TABLE_STEPS - half, cutoff, half);
  return table;
}

function kernel(distance: number, cutoff: number, half: number): number {
  const u = distance / half;
  if (u <= -1 || u >= 1) return 0;
  const x = Math.PI * cutoff * distance;
  const sinc = x === 0 ? 1 : Math.sin(x) / x;
  // Blackman window: sidelobes under −58 dB.
  const window = 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
  return sinc * window;
}
