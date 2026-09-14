import { describe, expect, it } from 'vitest';
import { resample, resampledLength } from './resample';

function sine(frequency: number, rate: number, frames: number): Float32Array {
  return Float32Array.from({ length: frames }, (_, i) => Math.sin((2 * Math.PI * frequency * i) / rate));
}

/** Largest difference from an ideal sine, away from the buffer ends. */
function worstError(signal: Float32Array, frequency: number, rate: number, margin: number): number {
  let worst = 0;
  for (let i = margin; i < signal.length - margin; i += 1) {
    worst = Math.max(worst, Math.abs(signal[i]! - Math.sin((2 * Math.PI * frequency * i) / rate)));
  }
  return worst;
}

describe('resampledLength', () => {
  it('keeps the duration', () => {
    expect(resampledLength(22050, 22050, 48000)).toBe(48000);
    expect(resampledLength(96000, 96000, 48000)).toBe(48000);
    expect(resampledLength(1024, 32000, 48000)).toBe(1536);
  });
});

describe('resample', () => {
  it('returns a copy when the rates match', () => {
    const input = Float32Array.from([0.1, -0.2, 0.3]);
    const output = resample(input, 48000, 48000);
    expect(Array.from(output)).toEqual(Array.from(input));
    expect(output).not.toBe(input);
  });

  it('holds a constant level exactly, ends included', () => {
    const output = resample(new Float32Array(2205).fill(0.5), 22050, 48000);
    expect(output.length).toBe(4800);
    for (const v of output) expect(v).toBeCloseTo(0.5, 6);
  });

  it('upsamples a tone without changing its pitch, level or timing', () => {
    // 1 kHz at 22.05 kHz, one second, to 48 kHz: compared against the ideal
    // tone at 48 kHz sample for sample, so any delay would show as error.
    const output = resample(sine(1000, 22050, 22050), 22050, 48000);
    expect(worstError(output, 1000, 48000, 200)).toBeLessThan(0.01);
  });

  it('downsamples a tone that fits under the new Nyquist', () => {
    const output = resample(sine(5000, 96000, 96000), 96000, 48000);
    expect(worstError(output, 5000, 48000, 200)).toBeLessThan(0.01);
  });

  it('removes a tone above the new Nyquist when downsampling', () => {
    // 30 kHz cannot exist at 48 kHz; letting it through would alias to 18 kHz.
    const output = resample(sine(30000, 96000, 96000), 96000, 48000);
    let peak = 0;
    for (let i = 500; i < output.length - 500; i += 1) peak = Math.max(peak, Math.abs(output[i]!));
    expect(peak).toBeLessThan(0.01);
  });

  it('keeps an impulse at the same instant', () => {
    const input = new Float32Array(3200);
    input[1600] = 1; // 50 ms at 32 kHz
    const output = resample(input, 32000, 48000);
    let at = 0;
    for (let i = 1; i < output.length; i += 1) if (output[i]! > output[at]!) at = i;
    expect(at).toBe(2400); // 50 ms at 48 kHz
  });
});
