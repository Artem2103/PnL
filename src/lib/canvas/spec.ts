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
   * Anchored top-left and grown down/right from the reference's 47×38, so the
   * top and left margins stay equal to the rest of the card.
   */
  logo: {
    x: 36,
    y: 37,
    maxWidth: 66,
    maxHeight: 54,
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
   * nearly line up. The reference's 32 was three pixels shy of it.
   */
  avatar: {
    x: 35,
    y: 446,
    size: 52,
  },

  handle: {
    /** Left edge of the ink. Holds the reference's 16px gap off the avatar. */
    x: 103,
    baseline: 486,
    size: 40,
    weight: 400,
    tracking: 0.24,
    maxWidth: 330,
  },

  /**
   * Dropped 35px from the reference's 507/519 so the footer sits the same
   * distance below the avatar as the avatar sits below the last stat row.
   * Measured off the painted ink rather than the baselines, since that is what
   * the eye reads: the last row ends at y=403 and the avatar starts at 446, so
   * 42 blank rows; the avatar ends at 497 and the footer now starts at 540,
   * also 42. It used to be 8, which read as the footer being stuck to the
   * handle with a dead band underneath it.
   */
  footer: {
    icon: { x: 36, y: 542, width: 23, height: 15 },
    /** Left edge of the ink. */
    x: 59,
    baseline: 554,
    size: 18,
    weight: 400,
    tracking: -0.15,
    /** Ink-to-ink space between the site string and the tagline. */
    gap: 21,
    maxWidth: 700,
  },
} as const;

export const PALETTE = {
  text: '#EAEDFF',
  /** Text printed on top of the accent block. */
  onAccent: '#020307',
} as const;
