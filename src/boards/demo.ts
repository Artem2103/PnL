/**
 * The board shown until the first real position is uploaded: ten columns, A to
 * J, ten positions each. The first three of A are the real GER40 trade and the
 * first three of B the real NAS100 trade, served as the original files; the rest
 * are drawn placeholders.
 */

import ger40_15m from '../assets/boards/ger40_15m.jpg';
import nq1_5m from '../assets/boards/nq1_5m.jpg';
import nq1_15m from '../assets/boards/nq1_15m.jpg';
import { demoChartSvg, demoSize } from './demoChart';
import { TIMEFRAMES, type Category, type Frame, type Position, type Timeframe } from './model';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const PER_COLUMN = 10;

/** A real file: the same original serves the canvas and the viewer. */
function photo(src: string, w: number, h: number): Frame {
  return { thumb: src, full: src, w, h };
}

/**
 * A drawn placeholder, made the first time something asks to see it: drawing all
 * three hundred up front would hold the page for no reason.
 */
class DrawnFrame implements Frame {
  private url: string | null = null;
  readonly w: number;
  readonly h: number;

  constructor(
    private readonly seed: number,
    private readonly timeframe: Timeframe,
  ) {
    [this.w, this.h] = demoSize(seed);
  }

  get thumb(): string {
    if (!this.url) {
      this.url = URL.createObjectURL(new Blob([demoChartSvg(this.seed, this.timeframe)], { type: 'image/svg+xml' }));
    }
    return this.url;
  }

  get full(): string {
    return this.thumb;
  }
}

/**
 * The real trades, each in its own column. Repeated a few times on purpose, to
 * see how a column of real screenshots behaves; the copies are the same trade.
 */
const REAL: Record<string, { frames: Position['frames']; link: string; copies: number }> = {
  A: { frames: { '15m': photo(ger40_15m, 1290, 860) }, link: 'https://t.me/c/3816809698/308', copies: 3 },
  B: {
    frames: { '5m': photo(nq1_5m, 1290, 860), '15m': photo(nq1_15m, 1290, 855) },
    link: 'https://t.me/c/3816809698/307',
    copies: 3,
  },
};

let cached: Category[] | null = null;

export function demoBoard(): Category[] {
  if (cached) return cached;
  cached = LETTERS.map((letter, column) => {
    const categoryId = `demo-${letter}`;
    const positions: Position[] = Array.from({ length: PER_COLUMN }, (_, row) => {
      const id = `${categoryId}-${row + 1}`;
      const real = REAL[letter];
      if (real && row < real.copies) return { id, categoryId, frames: real.frames, link: real.link };
      const seed = column * 1000 + row * 17 + 11;
      const frames: Position['frames'] = {};
      // Most trades have all three timeframes; some only two, as real ones will.
      for (const tf of TIMEFRAMES) {
        if (tf === '1h' && (seed % 5 === 0)) continue;
        frames[tf] = new DrawnFrame(seed, tf);
      }
      return { id, categoryId, frames };
    });
    return { id: categoryId, name: letter, positions };
  });
  return cached;
}
