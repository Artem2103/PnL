import type { BackgroundMedia, CardState, RenderAssets } from '../../types';
import type { CardContent } from '../content';
import type { PnlResult } from '../pnl';
import { getTheme, type Theme } from '../themes';
import { CARD, PALETTE, SPEC } from './spec';
import { placeCover } from './placement';
import {
  FONT_DISPLAY,
  coverRect,
  drawText,
  fillRoundRect,
  linearGradient,
  measureText,
  radialBloom,
  roundRectPath,
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
 */
export function drawCard(ctx: Ctx2D, width: number, height: number, input: DrawInput): void {
  const { state } = input;
  const theme = getTheme(state.display.themeId);
  const accent = input.result.isProfit ? theme.accent : theme.loss;

  ctx.save();
  ctx.clearRect(0, 0, width, height);

  drawBackground(ctx, input, theme);
  if (state.display.showLogo) drawLogo(ctx, input);
  if (state.display.showWordmark) drawWordmark(ctx, input);
  drawTitle(ctx, input);
  drawHeroBlock(ctx, input, accent);
  if (state.display.showRows) drawRows(ctx, input, accent);
  if (state.display.showHandle) drawHandle(ctx, input);
  if (state.display.showFooter) drawFooter(ctx, input);

  ctx.restore();
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

  // Near-black ground with the faint lift toward the bottom seen on the
  // reference cards.
  ctx.save();
  ctx.fillStyle = linearGradient(ctx, 0, 0, width * 0.35, height, [
    { offset: 0, color: '#010103' },
    { offset: 0.6, color: '#05080F' },
    { offset: 1, color: '#0C0E1B' },
  ]);
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  const media = assets.artwork;
  if (state.artwork.imageId && media && media.width > 0 && media.height > 0 && isPaintable(media)) {
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
    ctx.drawImage(media.element as CanvasImageSource, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();

    // The text column lives on the left, so the scrim is a horizontal ramp
    // that leaves the artwork on the right untouched.
    ctx.save();
    ctx.fillStyle = linearGradient(ctx, 0, 0, width, 0, [
      { offset: 0, color: `rgba(1, 1, 3, ${state.artwork.scrim})` },
      { offset: 0.45, color: `rgba(1, 1, 3, ${state.artwork.scrim * 0.72})` },
      { offset: 0.78, color: 'rgba(1, 1, 3, 0)' },
    ]);
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  } else {
    radialBloom(ctx, width * 0.78, height * 0.32, Math.max(width, height) * 0.72, theme.glow);
  }
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

function drawWordmark(ctx: Ctx2D, input: DrawInput): void {
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
    color: PALETTE.text,
    maxWidth: 300,
    minSize: size * 0.5,
  });
}

function drawTitle(ctx: Ctx2D, input: DrawInput): void {
  const text = input.content.title.trim();
  if (!text) return;
  const { x, baseline, size, weight, tracking, maxWidth } = SPEC.title;
  drawText(ctx, text, x, baseline, {
    size,
    weight,
    tracking,
    inkAlign: true,
    baseline: 'alphabetic',
    color: PALETTE.text,
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

  drawText(ctx, text, x + textInset, textBaseline, {
    size: textSize,
    weight: textWeight,
    tracking: textTracking,
    inkAlign: true,
    baseline: 'alphabetic',
    color: PALETTE.onAccent,
    // Never let the value spill past the block it sits in.
    maxWidth: CARD.width - x - textInset * 2,
    minSize: textSize * 0.5,
  });
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function drawRows(ctx: Ctx2D, input: DrawInput, accent: string): void {
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
      color: PALETTE.text,
      maxWidth: labelMaxWidth,
      minSize: size * 0.7,
    });
    drawText(ctx, row.value, valueX, baseline, {
      size,
      weight,
      tracking,
      inkAlign: true,
      baseline: 'alphabetic',
      color: row.accent ? accent : PALETTE.text,
      maxWidth: valueMaxWidth,
      minSize: size * 0.7,
    });
  });
}

/* ------------------------------------------------------------------ */
/* Handle and footer                                                   */
/* ------------------------------------------------------------------ */

function drawHandle(ctx: Ctx2D, input: DrawInput): void {
  const { state, assets } = input;
  const avatar = assets.avatar;
  const { x, y, size, radius } = SPEC.avatar;

  if (avatar && avatar.width > 0 && avatar.height > 0) {
    ctx.save();
    roundRectPath(ctx, x, y, size, size, radius);
    ctx.clip();
    const rect = coverRect(avatar.width, avatar.height, size, size);
    ctx.drawImage(avatar, x + rect.x, y + rect.y, rect.w, rect.h);
    ctx.restore();
  } else {
    // Placeholder keeps the layout honest when no avatar is set.
    fillRoundRect(ctx, x, y, size, size, radius, 'rgba(234, 237, 255, 0.10)');
  }

  const handle = state.brand.handle.trim();
  if (!handle) return;
  drawText(ctx, handle, SPEC.handle.x, SPEC.handle.baseline, {
    size: SPEC.handle.size,
    weight: SPEC.handle.weight,
    tracking: SPEC.handle.tracking,
    inkAlign: true,
    baseline: 'alphabetic',
    color: PALETTE.text,
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

function drawFooter(ctx: Ctx2D, input: DrawInput): void {
  const { brand } = input.state;
  const { icon, x, baseline, size, weight, tracking, gap, maxWidth } = SPEC.footer;
  const primary = brand.footerPrimary.trim();
  const secondary = brand.footerSecondary.trim();
  if (!primary && !secondary) return;

  let cursor: number = x;
  if (primary) {
    drawGlobeIcon(ctx, icon.x, icon.y, icon.width, icon.height, PALETTE.text);
    const width = drawText(ctx, primary, cursor, baseline, {
      size,
      weight,
      tracking,
      inkAlign: true,
      baseline: 'alphabetic',
      color: PALETTE.text,
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
      color: PALETTE.text,
      maxWidth: CARD.width - cursor - SPEC.marginRight,
      minSize: size * 0.75,
    });
  }
}
