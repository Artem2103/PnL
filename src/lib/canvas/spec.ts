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
    /**
     * Re-measured 2026-09-12 against all five reference cards: the caps and
     * the lining figures run y128–158, so the baseline is 158 and the cap
     * height 30, not the 156 / 28.7 the first pass read (it had taken the
     * x-height letters' bottom, which overshoots less). Two pixels, but it is
     * the one row on the card whose position the eye checks against the
     * accent block right under it: 19 blank rows there, not 21.
     */
    baseline: 158,
    size: 40.5,
    weight: 400,
    /**
     * The reference face is a little wider than Inter at the same cap height;
     * this brings "August 2026" back to its measured 250px of ink. Re-solved
     * for the 40.5px size (it was 1.08 at 39.5).
     */
    tracking: 0.6,
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
   * Square, sharp-cornered, at the reference's own x30.5 — four and a half
   * pixels left of the title and the accent block, which is where every one of
   * the five reference cards puts it. It sat on x35 from 2026-08-24 to
   * 2026-09-12 so the column would line up; put back on request, the ask being
   * that the card match the references item for item.
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
    x: 30.5,
    y: 446,
    size: 54.5,
  },

  /**
   * The red badge frame around the avatar, traced off `reference/frame.png`.
   *
   * Every number is a fraction of the frame's outer side, so the whole badge
   * scales with `avatar.size` and nothing here has to be re-solved if the slot
   * ever moves.
   *
   * They were measured on the reference at its own scale, where the ring's
   * outer square runs x11.74–99.03 and y32.67–120.20, so 87.3 × 87.5 — call it
   * 87.4, the divisor every ratio below is written over. Edges came from
   * unmixing each pixel's **red** channel against the background rather than
   * thresholding it: the ground is blue at R≈45 and both reds sit at R≈210–235,
   * so red separates ink from ground almost independently of which red it is.
   * Trying the same with a single assumed foreground colour reads every
   * light-red edge as 82% covered and shrinks the shape it is measuring — that
   * is what first put the pip 0.5px short in both directions.
   *
   * The reference is a soft-edged screenshot, so no single row is a reliable
   * edge; each number here is a coverage sum across the whole soft edge, which
   * a symmetric blur leaves alone.
   *
   * The frame fills the existing 54px slot rather than growing outside it. The
   * avatar's footprint is load-bearing — it sets the left edge shared with the
   * title and the accent block, the 15px gap to the handle, and the 19 blank
   * rows down to the footer, all of which were measured by hand and are
   * documented above. Wrapping 54px of picture in a frame would have pushed
   * the left edge out to x30.7 and closed the handle gap to 10.7. So the badge
   * is 54 across and the picture inside it is 45.3 — which is what a frame
   * does to a picture anyway, and leaves the card's composition untouched.
   */
  avatarFrame: {
    /** Ring thickness. */
    stroke: 3.22 / 87.4,
    /** Clear space between the ring's inner edge and the picture. */
    gap: 3.85 / 87.4,
    /** Outer corner radius. */
    radius: 8.0 / 87.4,
    /** The picture's own corners are all but square on the reference. */
    pictureRadius: 2.0 / 87.4,

    /**
     * The badge above the ring: a wedge cut into a tip and a base. The two
     * flanks are close to parallel but not quite — the tip's widen by 1.174
     * per row against the base's 1.092 — so they are measured separately
     * rather than derived from one another.
     *
     * Distances are up from the ring's outer top edge, half-widths off the
     * ring's centre line, and both are outer edges: the base's outline is
     * inside these numbers, not added to them.
     */
    pip: {
      /** Tip: apex at y5.13 on the reference, base at y17.93. */
      tipRise: 14.74 / 87.4,
      tipHeight: 12.8 / 87.4,
      tipHalfWidth: 7.51 / 87.4,
      /** Base: top at y21.24, bottom at y30.93. */
      baseRise: 1.74 / 87.4,
      baseHeight: 9.69 / 87.4,
      baseBottomHalfWidth: 14.58 / 87.4,
      baseTopHalfWidth: 9.29 / 87.4,
      /** The lighter outline the base carries; the tip is that colour solid. */
      baseStroke: 1.4 / 87.4,
    },
  },

  /**
   * The frame the reference cards themselves wear: a tan ring with a loop on
   * top, like the tab on a luggage tag. Traced 2026-09-12 off the four
   * reference cards averaged together (same frame on each, different artwork
   * behind it, so the ground averages out), in the same way as the badge above.
   *
   * Fractions of the slot's outer side, like `avatarFrame`. The ring is a
   * stroke inside the slot; between it and the picture the ground shows
   * through, which is the thin dark line around the picture on the reference,
   * not a stroke of its own.
   */
  avatarTag: {
    stroke: 2.2 / 54.5,
    gap: 1.55 / 54.5,
    radius: 6.8 / 54.5,
    pictureRadius: 3.7 / 54.5,
    /**
     * The loop: a rounded rectangle centred over the ring, drawn as nested
     * bands from the outside in — light, dark, light again, then the dark
     * fill that reads as the hole. Its bottom runs under the ring.
     */
    loop: {
      width: 16 / 54.5,
      /** From the ring's outer top edge up to the loop's top. */
      rise: 20.7 / 54.5,
      radius: 5 / 54.5,
      /** Band widths, outer to inner. */
      outerBand: 1.5 / 54.5,
      darkBand: 1 / 54.5,
      innerBand: 1.5 / 54.5,
      /**
       * The outer band runs down under the ring; the bands inside it close
       * this far above the ring's top, so the hole reads as a hole and not as
       * a slot cut into the ring.
       */
      innerFoot: 1.5 / 54.5,
    },
  },

  handle: {
    /**
     * Left edge of the ink, holding the reference's gap off the avatar: there
     * the slot ends at x85 and the ink starts at x100, so 15. With the avatar
     * back at the reference's x30.5 the two numbers are the reference's own.
     *
     * It has read 100, then 103, then 104 while the avatar sat at x35, and is
     * 100 again. The gap is the thing being held; the number follows from
     * wherever the avatar's right edge lands.
     */
    x: 100,
    /**
     * 488, re-measured 2026-09-12: the reference's lowercase sits on y488.5
     * (the "a" and "u" bottoms, overshoot included), and a handle is nearly
     * all lowercase. The first pass held 486 because the "@" glyphs lined up
     * there — but the reference face draws its "@" higher over the baseline
     * than Inter does, so matching the "@" had put every letter two pixels
     * high.
     */
    baseline: 488,
    size: 40,
    weight: 400,
    tracking: 0.24,
    maxWidth: 330,
  },

  /**
   * Where the reference puts it: ink from y506, six blank rows under the
   * avatar's y500. It sat 14 rows lower than this from 2026-08-25 to
   * 2026-09-12 (icon y521, baseline 533 — the "halve the gap" pass, which had
   * been asked for), and was moved back on request when the ask became that
   * the card match the references item for item. If the 8-row gap reads as
   * cramped again, 521/533 is the number to go back to; nothing else depends
   * on it.
   *
   * All of these are measured off the painted ink rather than the baselines,
   * since that is what the eye reads: antialiasing puts a row's visible bottom
   * about 2px below its baseline. The avatar ends at y=500 and the footer ink
   * starts at 506.
   *
   * History worth keeping, because this number has been in three places. The
   * reference's 507/519 was read first as the footer being stuck to the
   * handle with a dead band underneath, and was over-corrected to 542/554,
   * matching the 42-row gap above the avatar exactly — arithmetically tidy,
   * but it pushed the ink to y=557 on a 570px card and left a 12px bottom
   * margin against 35px on the left. Halving that gap gave 521/533, a 33px
   * bottom margin, and stood until the ask changed to matching the reference
   * outright.
   */
  footer: {
    /**
     * The globe's ink: 15 × 15 at (36, 507) on every reference card, stroke
     * included — `drawGlobeIcon` keeps the stroke inside this box.
     */
    icon: { x: 36, y: 507, width: 15, height: 15 },
    /** Left edge of the ink: the reference's "a" starts at x56, 5 past the globe. */
    x: 56,
    /**
     * Back on the reference's row (ink y506–520, so the baseline is 519.5)
     * as of 2026-09-12. See the history below for the two other places this
     * has been.
     */
    baseline: 519.5,
    /** 18 set "axiom.trade" two pixels short of the reference's 100px of ink. */
    size: 18.3,
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

/**
 * The avatar badge's reds, read straight off `reference/frame.png`.
 *
 * The ring is not a flat colour and not a plain linear ramp either. Walking
 * the stroke's midline by arc length and reading it out, the colour runs
 * dark -> vivid -> dark -> vivid -> light -> vivid -> dark over one lap: the
 * ramp follows the border path rather than any axis across it, which is why
 * fitting a two-point linear gradient to it fails on the second corner.
 *
 * `ringStops` is that walk at 32 evenly spaced positions, converted from arc
 * length to the angle a conic gradient wants. The two are not the same
 * parametrisation — a square's corners take more angle per pixel than its
 * edges do — so the stops are dense enough that what happens between any two
 * of them barely matters. Six stops at the measured turning points left the
 * top edge up to 13 levels dark; at 32 the worst error is under 5.
 *
 * Each sample is the most saturated pixel within 1.6px of the walk, not the
 * pixel the walk lands on. At the corners the midline of a stroked round rect
 * and the arc this walk follows drift apart by about a pixel, and reading the
 * drifted pixel picks up the ring's antialiased edge — which is a blend with
 * the background, and reads as a dark stop that is not there.
 *
 * Offset 0 is due east, the middle of the right edge. Its colour is the only
 * interpolated one: it falls between the last sample and the first.
 */
export const AVATAR_FRAME = {
  ringStops: [
    { offset: 0, color: '#82060C' },
    { offset: 0.01846, color: '#75070C' },
    { offset: 0.05477, color: '#5A090D' },
    { offset: 0.08604, color: '#490B0D' },
    { offset: 0.11139, color: '#650B0E' },
    { offset: 0.13829, color: '#820C14' },
    { offset: 0.16347, color: '#9D0910' },
    { offset: 0.19454, color: '#B7070F' },
    { offset: 0.23066, color: '#C9060F' },
    { offset: 0.26886, color: '#CB1720' },
    { offset: 0.30503, color: '#CC2B33' },
    { offset: 0.33617, color: '#CF3F47' },
    { offset: 0.36143, color: '#D1595E' },
    { offset: 0.38780, color: '#D7585C' },
    { offset: 0.41294, color: '#CD4047' },
    { offset: 0.44400, color: '#CC2D35' },
    { offset: 0.48016, color: '#CA1922' },
    { offset: 0.51846, color: '#C9050F' },
    { offset: 0.55477, color: '#B8050E' },
    { offset: 0.58604, color: '#9F070F' },
    { offset: 0.61139, color: '#86090F' },
    { offset: 0.63829, color: '#610E15' },
    { offset: 0.66347, color: '#490D11' },
    { offset: 0.69454, color: '#5B0C11' },
    { offset: 0.73066, color: '#750A10' },
    { offset: 0.76886, color: '#8F080F' },
    { offset: 0.80503, color: '#A9050E' },
    { offset: 0.83617, color: '#C3030D' },
    { offset: 0.86143, color: '#D20008' },
    { offset: 0.88780, color: '#CE020A' },
    { offset: 0.91294, color: '#C90108' },
    { offset: 0.94400, color: '#AE0309' },
    { offset: 0.98016, color: '#90050B' },
    { offset: 1, color: '#82060C' },
  ],
  /** The pip's tip, solid, and the outline around its base. */
  pipLight: '#EB4C52',
  /**
   * The pip base's fill, across its width.
   *
   * Not flat: averaging the base's interior rows column by column, the left
   * half is a dead-even #D20008 and the right half carries a soft highlight
   * that peaks a little past halfway out and falls back toward the flank. A
   * flat vivid fill is what made the first render's base read as a sticker
   * next to the reference's.
   *
   * Offsets run across the base's widest span — the bottom edge — so 0.5 is
   * the centre line. The last stop holds rather than falling back to vivid:
   * the reference's own last two measured columns are flat, and what happens
   * past them is under the outline anyway.
   */
  pipFillStops: [
    { offset: 0, color: '#D20008' },
    { offset: 0.5, color: '#D20008' },
    { offset: 0.706, color: '#DC373D' },
    { offset: 0.843, color: '#D71E25' },
    { offset: 1, color: '#D71E25' },
  ],
} as const;

/**
 * The tag frame's colours, read off the reference cards the same way as the
 * badge's: `ringStops` is a walk around the ring's midline at 32 points,
 * converted to conic-gradient angles. Tan almost all the way round, lighter
 * on the right and dark at the bottom-right corner, with a flat rose patch
 * over the bottom-left quarter — that patch is on every reference card, so it
 * is the frame and not the artwork behind it. The point under the loop was
 * replaced by its neighbours' mean, since what is there is the loop.
 */
export const AVATAR_TAG = {
  ringStops: [
    { offset: 0, color: '#DFB682' },
    { offset: 0.03720, color: '#D7AE7B' },
    { offset: 0.07072, color: '#C59D6A' },
    { offset: 0.09871, color: '#AD8654' },
    { offset: 0.12495, color: '#D3AB77' },
    { offset: 0.15115, color: '#DDB480' },
    { offset: 0.17916, color: '#D1A875' },
    { offset: 0.21273, color: '#C69E6B' },
    { offset: 0.25000, color: '#BB9461' },
    { offset: 0.28727, color: '#B18A57' },
    { offset: 0.32084, color: '#D9817D' },
    { offset: 0.34885, color: '#D9817D' },
    { offset: 0.37505, color: '#D9817D' },
    { offset: 0.40129, color: '#D9817D' },
    { offset: 0.42928, color: '#D9817D' },
    { offset: 0.46280, color: '#BE8564' },
    { offset: 0.50000, color: '#BC9562' },
    { offset: 0.53720, color: '#C79F6C' },
    { offset: 0.57072, color: '#D2AA76' },
    { offset: 0.59871, color: '#DDB480' },
    { offset: 0.62495, color: '#D3AB77' },
    { offset: 0.65115, color: '#A98350' },
    { offset: 0.67916, color: '#C29A67' },
    { offset: 0.71273, color: '#D7AE7B' },
    { offset: 0.75000, color: '#C89E68' },
    { offset: 0.78727, color: '#BD9561' },
    { offset: 0.82084, color: '#C39963' },
    { offset: 0.84885, color: '#C99E65' },
    { offset: 0.87505, color: '#CEA167' },
    { offset: 0.90129, color: '#C99E65' },
    { offset: 0.92928, color: '#C39963' },
    { offset: 0.96280, color: '#BE9561' },
    { offset: 1, color: '#DFB682' },
  ],
  /** The loop's bands, outside in. */
  loopLight: '#CBA574',
  loopDark: '#735126',
  loopMid: '#A78252',
} as const;
