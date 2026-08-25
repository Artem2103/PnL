/**
 * Card geometry, measured pixel-for-pixel off the reference cards.
 *
 * The references are 840×570. Every number below is in that design space and
 * was read off the source images (bounding boxes of the glyph ink, the solid
 * accent block, the avatar and the icons) rather than eyeballed, so the layout
 * can be reproduced exactly and audited later.
 *
 * Font sizes are derived from measured ink heights using Inter's metrics
 * (cap height 0.727em, ascender ~0.75em, descender ~0.21em).
 */

export const CARD = {
  width: 840,
  height: 570,
} as const;

export const SPEC = {
  /** Left margin shared by the title, the accent block and the footer. */
  marginLeft: 36,
  marginRight: 22,

  /**
   * The reference mark's own slot, re-measured 2026-08-25 by half-coverage
   * edges rather than a luminance threshold: ink from x35 to x83.5 and y34 to
   * y74.5, so 49 × 41 at (35, 34). The left edge lands on the title's x35, not
   * the 36 the footer icon uses.
   *
   * This was briefly 66 × 54 at (36, 37) — grown ~35% on request — and is back
   * at the reference size on request. Growing it is what pulled the mark's
   * optical centre (y37–91, centre 64) away from the wordmark's (~55) and left
   * the header looking untidy; at the reference size the centre is 54 and the
   * two line up again the way they do on the reference cards.
   */
  logo: {
    x: 35,
    y: 34,
    maxWidth: 49,
    maxHeight: 41,
  },

  wordmark: {
    /** Right edge of the ink. */
    right: 818,
    /** Baseline held at the reference position as the size comes down. */
    baseline: 70,
    size: 34,
    weight: 300,
    /**
     * The reference wordmark is tracked out well past the body text. Scaled
     * with the size (3.75 was solved at 42px) so the spacing stays
     * proportional instead of looking loose at the smaller size.
     */
    tracking: 3.04,
  },

  title: {
    /** Left edge of the ink. */
    x: 35,
    baseline: 156,
    size: 39.5,
    weight: 400,
    /**
     * The reference face is a little wider than Inter at the same cap height;
     * this brings "August 2026" back to its measured 250px of ink.
     */
    tracking: 1.08,
    /** Ink may not pass this without shrinking. */
    maxWidth: 380,
  },

  /** The solid accent rectangle. Fixed width, sharp corners. */
  block: {
    x: 35,
    y: 177,
    width: 385,
    height: 79,
    /** Ink inset from the block's left edge: 55 - 35. */
    textInset: 19,
    textSize: 53.5,
    textWeight: 800,
    /** Inter sets this string a touch wide at matching cap height. */
    textTracking: -1.26,
    textBaseline: 235,
  },

  rows: {
    labelX: 55,
    valueX: 301,
    /** Baselines of the three rows. */
    baselines: [319, 360, 401] as const,
    size: 25.7,
    weight: 400,
    tracking: 0.3,
    /** Values start at valueX, so labels are clipped before they collide. */
    labelMaxWidth: 236,
    valueMaxWidth: 240,
  },

  /**
   * Square, sharp-cornered, and sharing the accent block's left edge — the
   * avatar/handle row and the block read as one column rather than two that
   * nearly line up. The reference's x30.5 was four and a half pixels shy of it.
   *
   * 54, not the 52 recorded on the first pass. Re-measured 2026-08-25 the same
   * way as the logo: the reference slot runs x30.5–85.0 and y446.2–500.6, so
   * 54.5 × 54.4 — the earlier number was taken off a luminance threshold and
   * lost a pixel of the antialiased edge on each side. All five reference
   * cards agree to within a tenth of a pixel.
   *
   * Growing it by two takes the ink to y500 and so trims the gap down to the
   * footer from 21 blank rows to 19. The footer deliberately did not move to
   * compensate: its position was set by hand and 19 against 21 is not a
   * difference the eye can find.
   */
  avatar: {
    x: 35,
    y: 446,
    size: 54,
  },

  handle: {
    /**
     * Left edge of the ink, holding the reference's gap off the avatar: there
     * the slot ends at x85 and the ink starts at x100, so 15. The avatar now
     * ends at 89, hence 104.
     *
     * It has read 100, then 103 (15 became "16" because the avatar was
     * measured two pixels narrow), and now 104. The gap is the thing being
     * held; the number follows from wherever the avatar's right edge lands.
     */
    x: 104,
    baseline: 486,
    size: 40,
    weight: 400,
    tracking: 0.24,
    maxWidth: 330,
  },

  /**
   * Sits 19 blank rows under the avatar — it was set at 21, half the 42 it used
   * to sit at, and the avatar growing two pixels to its reference size took the
   * other two. The point of the number was that the avatar/handle row and the
   * footer read as one identity block rather than two separate rows, and 19
   * does that as well as 21 did. Requested; the avatar deliberately did not
   * move, and neither did this.
   *
   * All of these are measured off the painted ink rather than the baselines,
   * since that is what the eye reads: antialiasing puts a row's visible bottom
   * about 2px below its baseline. The avatar ends at y=499 and the footer ink
   * starts at 519.
   *
   * History worth keeping, because two of these numbers have been wrong in
   * opposite directions. The reference has 507/519, which left only 8 blank
   * rows and read as the footer being stuck to the handle with a dead band
   * underneath. That was over-corrected to 542/554, matching the 42-row gap
   * above the avatar exactly — arithmetically tidy, but it pushed the ink to
   * y=557 on a 570px card and left a 12px bottom margin against 35px on the
   * left. Halving the gap fixes both complaints at once: the bottom margin
   * comes out at 33px, near enough the left margin to read as symmetric.
   */
  footer: {
    icon: { x: 36, y: 521, width: 23, height: 15 },
    /** Left edge of the ink. */
    x: 59,
    baseline: 533,
    size: 18,
    weight: 400,
    tracking: -0.15,
    /** Ink-to-ink space between the site string and the tagline. */
    gap: 21,
    maxWidth: 700,
  },
} as const;

/**
 * Two inks, not one.
 *
 * `text` is the measured reference colour — an off-white with a blue cast, not
 * pure `#FFFFFF`. `textDark` is the card's own near-black ground, which is what
 * "black" has to mean here if a light card is to look like the same design
 * rather than an inversion of it. `display.textTone` picks between them.
 *
 * `onAccent` is not part of that choice: the hero value has to stay legible on
 * whatever colour the block is, so it is chosen from the accent by
 * `readableOn` and ignores the tone entirely.
 */
export const PALETTE = {
  text: '#EAEDFF',
  textDark: '#05070B',
  /** Text printed on top of the accent block, when the accent is light. */
  onAccent: '#020307',
  /** The same, when the accent is dark enough that near-black would vanish. */
  onAccentLight: '#F7F9FF',
} as const;

/** The plain themed ground, when there is no artwork over it. */
type Ramp = readonly [string, string, string];

/**
 * The plain themed ground, when there is no artwork over it. The light ramp is
 * the dark one's mirror rather than plain white: the reference's ground has a
 * faint diagonal lift, and dropping that flattens the card.
 */
export const GROUND: { dark: Ramp; light: Ramp } = {
  dark: ['#010103', '#05080F', '#0C0E1B'],
  light: ['#FDFDFF', '#F2F4FA', '#E4E8F2'],
};
