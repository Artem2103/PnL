import type { BackgroundMedia, CardState, RenderAssets } from '../../types';
import type { CardContent } from '../content';
import type { PnlResult } from '../pnl';
import { ensureContrast, readableOn, withAlpha } from '../color';
import { resolveTheme, type Theme } from '../themes';
import { CARD, GROUND, PALETTE, SPEC } from './spec';
import { placeCover } from './placement';
import {
  FONT_DISPLAY,
  cachedGradient,
  coverRect,
  drawText,
  measureText,
  radialBloom,
  type Ctx2D,
} from './primitives';

export interface DrawInput {
  state: CardState;
  content: CardContent;
  result: PnlResult;
  assets: RenderAssets;
}

/**
 * Paints the whole card into `ctx`, in the 840×570 design space defined in
 * `spec.ts`.
 *
 * Pure with respect to the DOM: it reads nothing but its arguments and writes
 * nothing but pixels. Preview and export both call it, which is what
 * guarantees the download matches what is on screen.
 *
 * The two halves below are also exported separately. That is not a second
 * drawing path — it is this same code, split at the one seam that matters for
 * speed: everything above the background is identical from frame to frame
 * while a clip plays, so `renderToCanvas` can cache it. Both halves are always
 * called, in this order, by every caller.
 */
export function drawCard(ctx: Ctx2D, width: number, height: number, input: DrawInput): void {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  drawCardBackground(ctx, input);
  drawCardForeground(ctx, input);
  ctx.restore();
}

/** Ground, artwork and scrim — the only part of the card a moving clip changes. */
export function drawCardBackground(ctx: Ctx2D, input: DrawInput): void {
  drawBackground(ctx, input, resolveTheme(input.state.display));
}

/**
 * The ink for everything outside the accent block, and the ground it sits on.
 *
 * The two move together on purpose. `textTone: 'dark'` alone would paint
 * near-black strings onto the near-black ground and produce a blank card, so
 * the plain ground inverts with it and the artwork scrim lightens instead of
 * darkening. Over a photo the tone is a genuine choice; with no photo it is
 * the difference between a dark card and a light one.
 */
function inkFor(state: CardState): string {
  return state.display.textTone === 'dark' ? PALETTE.textDark : PALETTE.text;
}

/** The three-stop ramp the ink and the accent row have to read against. */
function groundFor(state: CardState): (typeof GROUND)['dark'] {
  return state.display.textTone === 'dark' ? GROUND.light : GROUND.dark;
}

/** Everything painted over the background. Fixed for a given card state. */
export function drawCardForeground(ctx: Ctx2D, input: DrawInput): void {
  const { state } = input;
  const theme = resolveTheme(state.display);
  const accent = input.result.isProfit ? theme.accent : theme.loss;
  const ink = inkFor(state);
  // On the block the accent is a fill and anything goes. On the percentage row
  // it is ink, and there it has to clear the ground behind it — a dark custom
  // accent on the dark card, or mint on the light one, is otherwise a row you
  // cannot read. The block keeps the exact colour that was picked.
  const accentInk = ensureContrast(accent, groundFor(state)[1]);

  ctx.save();
  if (state.display.showLogo) drawLogo(ctx, input);
  if (state.display.showWordmark) drawWordmark(ctx, input, ink);
  drawTitle(ctx, input, ink);
  drawHeroBlock(ctx, input, accent);
  if (state.display.showRows) drawRows(ctx, input, accentInk, ink);
  if (state.display.showHandle) drawHandle(ctx, input, ink);
  if (state.display.showFooter) drawFooter(ctx, input, ink);
  ctx.restore();
}

/**
 * Identity of everything `drawCardForeground` reads. Two inputs with the same
 * key paint the same pixels, so a cached layer can be reused across frames.
 */
export function foregroundKey(input: DrawInput): string {
  const { state, content, result, assets } = input;
  const d = state.display;
  // Joined on NUL, which cannot appear in a card string — so no two different
  // cards can collide on a key by running adjacent fields together.
  return [
    content.title,
    content.hero,
    ...content.rows.flatMap((row) => [row.label, row.value, row.accent ? 1 : 0]),
    state.brand.wordmark,
    state.brand.handle,
    state.brand.footerPrimary,
    state.brand.footerSecondary,
    d.themeId,
    // Only meaningful for the custom slot, but cheap and unconditional beats a
    // branch that has to stay in step with `resolveTheme`.
    d.customAccent,
    d.textTone,
    result.isProfit ? 1 : 0,
    d.showLogo ? 1 : 0,
    d.showWordmark ? 1 : 0,
    d.showRows ? 1 : 0,
    d.showHandle ? 1 : 0,
    d.showFooter ? 1 : 0,
    assets.avatar?.src ?? '',
    assets.logo?.src ?? '',
  ].join('\u0000');
}

/* ------------------------------------------------------------------ */
/* Background                                                          */
/* ------------------------------------------------------------------ */

/**
 * A clip that has not buffered a frame yet would paint nothing and silently
 * blank the card, so the themed ground is shown until it can.
 */
function isPaintable(media: BackgroundMedia): boolean {
  return media.kind !== 'video' || (media.element as HTMLVideoElement).readyState >= 2;
}

function drawBackground(ctx: Ctx2D, input: DrawInput, theme: Theme): void {
  const { state, assets } = input;
  const { width, height } = CARD;
  const light = state.display.textTone === 'dark';
  const ground = groundFor(state);

  const media = assets.artwork;
  const showArtwork = Boolean(
    state.artwork.imageId && media && media.width > 0 && media.height > 0 && isPaintable(media),
  );

  ctx.save();
  if (showArtwork) {
    // The artwork covers the card edge to edge, so the themed ramp underneath
    // it would never be seen. A flat fill still backs any clip that carries an
    // alpha channel, at a fraction of the cost of building and rasterising a
    // gradient thirty times a second.
    ctx.fillStyle = ground[0];
  } else {
    // Near-black ground with the faint lift toward the bottom seen on the
    // reference cards — or its mirror image, when the ink is dark.
    ctx.fillStyle = cachedGradient(ctx, `ground:${light ? 'light' : 'dark'}`, (target) => {
      const gradient = target.createLinearGradient(0, 0, width * 0.35, height);
      gradient.addColorStop(0, ground[0]);
      gradient.addColorStop(0.6, ground[1]);
      gradient.addColorStop(1, ground[2]);
      return gradient;
    });
  }
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  if (!showArtwork || !media) {
    radialBloom(ctx, width * 0.78, height * 0.32, Math.max(width, height) * 0.72, theme.glow);
    return;
  }

  const rect = placeCover(
    media.width,
    media.height,
    width,
    height,
    state.artwork.zoom,
    state.artwork.offsetX,
    state.artwork.offsetY,
  );
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  // A clip is resampled every frame, and `high` picks a filter that costs
  // several milliseconds on a 4K source. A still is resampled once, so it can
  // afford the better one. Preview, PNG and video all take the same branch for
  // the same media, so the three stay identical to each other.
  ctx.imageSmoothingQuality = media.kind === 'video' ? 'medium' : 'high';
  ctx.drawImage(media.element as CanvasImageSource, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();

  // The text column lives on the left, so the scrim is a horizontal ramp
  // that leaves the artwork on the right untouched. It veils the photo *away*
  // from the ink: near-black under light text, near-white under dark, so the
  // slider means the same thing — "make the text readable" — in both.
  const scrim = state.artwork.scrim;
  const veil = light ? '253, 253, 255' : '1, 1, 3';
  ctx.save();
  ctx.fillStyle = cachedGradient(ctx, `scrim:${veil}:${scrim}`, (target) => {
    const gradient = target.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, `rgba(${veil}, ${scrim})`);
    gradient.addColorStop(0.45, `rgba(${veil}, ${scrim * 0.72})`);
    gradient.addColorStop(0.78, `rgba(${veil}, 0)`);
    return gradient;
  });
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

function drawLogo(ctx: Ctx2D, input: DrawInput): void {
  const logo = input.assets.logo;
  if (!logo || !logo.width || !logo.height) return;
  const { x, y, maxWidth, maxHeight } = SPEC.logo;
  // Contain, so a wide or tall mark keeps its proportions inside the slot.
  const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height);
  const w = logo.width * scale;
  const h = logo.height * scale;
  ctx.drawImage(logo, x, y + (maxHeight - h) / 2, w, h);
}

function drawWordmark(ctx: Ctx2D, input: DrawInput, ink: string): void {
  const text = input.state.brand.wordmark.trim();
  if (!text) return;
  const { right, baseline, size, weight, tracking } = SPEC.wordmark;
  drawText(ctx, text, right, baseline, {
    size,
    weight,
    tracking,
    align: 'right',
    inkAlign: true,
    baseline: 'alphabetic',
    color: ink,
    maxWidth: 300,
    minSize: size * 0.5,
  });
}

function drawTitle(ctx: Ctx2D, input: DrawInput, ink: string): void {
  const text = input.content.title.trim();
  if (!text) return;
  const { x, baseline, size, weight, tracking, maxWidth } = SPEC.title;
  drawText(ctx, text, x, baseline, {
    size,
    weight,
    tracking,
    inkAlign: true,
    baseline: 'alphabetic',
    color: ink,
    maxWidth,
    minSize: size * 0.55,
  });
}

/* ------------------------------------------------------------------ */
/* Hero block                                                          */
/* ------------------------------------------------------------------ */

function drawHeroBlock(ctx: Ctx2D, input: DrawInput, accent: string): void {
  const { x, y, width, height, textInset, textSize, textWeight, textTracking, textBaseline } =
    SPEC.block;
  const text = input.content.hero;

  const font = { size: textSize, weight: textWeight, family: FONT_DISPLAY, tracking: textTracking };
  const textWidth = measureText(ctx, text, font);
  // The block is a fixed width on the reference cards; it only grows when the
  // value would otherwise run past the right inset.
  const blockWidth = Math.max(width, textWidth + textInset * 2);

  ctx.save();
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, blockWidth, height);
  ctx.restore();

  // Chosen from the accent rather than fixed. Every accent the card had before
  // cherry was light enough for near-black; cherry is not, and a custom colour
  // can be anything, so the higher-contrast of the two inks wins.
  drawText(ctx, text, x + textInset, textBaseline, {
    size: textSize,
    weight: textWeight,
    tracking: textTracking,
    inkAlign: true,
    baseline: 'alphabetic',
    color: readableOn(accent, PALETTE.onAccent, PALETTE.onAccentLight),
    // Never let the value spill past the block it sits in.
    maxWidth: CARD.width - x - textInset * 2,
    minSize: textSize * 0.5,
  });
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function drawRows(ctx: Ctx2D, input: DrawInput, accent: string, ink: string): void {
  const { labelX, valueX, baselines, size, weight, tracking, labelMaxWidth, valueMaxWidth } =
    SPEC.rows;

  input.content.rows.slice(0, baselines.length).forEach((row, index) => {
    const baseline = baselines[index]!;
    drawText(ctx, row.label, labelX, baseline, {
      size,
      weight,
      tracking,
      inkAlign: true,
      baseline: 'alphabetic',
      color: ink,
      maxWidth: labelMaxWidth,
      minSize: size * 0.7,
    });
    drawText(ctx, row.value, valueX, baseline, {
      size,
      weight,
      tracking,
      inkAlign: true,
      baseline: 'alphabetic',
      color: row.accent ? accent : ink,
      maxWidth: valueMaxWidth,
      minSize: size * 0.7,
    });
  });
}

/* ------------------------------------------------------------------ */
/* Handle and footer                                                   */
/* ------------------------------------------------------------------ */

function drawHandle(ctx: Ctx2D, input: DrawInput, ink: string): void {
  const { state, assets } = input;
  const avatar = assets.avatar;
  const { x, y, size } = SPEC.avatar;

  // Square frame, sharp corners — the same corners the accent block has, off
  // the same left edge. A rect clip also beats a rounded path outright.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  if (avatar && avatar.width > 0 && avatar.height > 0) {
    const rect = coverRect(avatar.width, avatar.height, size, size);
    ctx.drawImage(avatar, x + rect.x, y + rect.y, rect.w, rect.h);
  } else {
    // Placeholder keeps the layout honest when no avatar is set. Tinted from
    // the ink, or it disappears on a light card.
    ctx.fillStyle = withAlpha(ink, 0.1);
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();

  const handle = state.brand.handle.trim();
  if (!handle) return;
  drawText(ctx, handle, SPEC.handle.x, SPEC.handle.baseline, {
    size: SPEC.handle.size,
    weight: SPEC.handle.weight,
    tracking: SPEC.handle.tracking,
    inkAlign: true,
    baseline: 'alphabetic',
    color: ink,
    maxWidth: SPEC.handle.maxWidth,
    minSize: SPEC.handle.size * 0.6,
  });
}

/** Simple globe: outline, equator, and a meridian ellipse. */
function drawGlobeIcon(ctx: Ctx2D, x: number, y: number, w: number, h: number, color: string): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 0.48, r, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawFooter(ctx: Ctx2D, input: DrawInput, ink: string): void {
  const { brand } = input.state;
  const { icon, x, baseline, size, weight, tracking, gap, maxWidth } = SPEC.footer;
  const primary = brand.footerPrimary.trim();
  const secondary = brand.footerSecondary.trim();
  if (!primary && !secondary) return;

  let cursor: number = x;
  if (primary) {
    drawGlobeIcon(ctx, icon.x, icon.y, icon.width, icon.height, ink);
    const width = drawText(ctx, primary, cursor, baseline, {
      size,
      weight,
      tracking,
      inkAlign: true,
      baseline: 'alphabetic',
      color: ink,
      maxWidth: maxWidth / 2,
      minSize: size * 0.75,
    });
    cursor += width + gap;
  } else {
    cursor = icon.x;
  }

  if (secondary) {
    drawText(ctx, secondary, cursor, baseline, {
      size,
      weight,
      tracking,
      inkAlign: true,
      baseline: 'alphabetic',
      color: ink,
      maxWidth: CARD.width - cursor - SPEC.marginRight,
      minSize: size * 0.75,
    });
  }
}
