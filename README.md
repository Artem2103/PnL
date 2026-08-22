# PnL Card Studio

A web app for traders to turn a closed trade — or a whole month — into a shareable card, and
download it as a high-resolution PNG or, over a background clip, an MP4. Everything runs
client-side: no backend, no account, no upload.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle into dist/
npm test           # unit tests for the PnL math, formatting and card content
npm run typecheck
```

## The card

One fixed format, **840 × 570**, matching the reference cards the layout was measured from.
Exported at 1×, 2× or 3× (up to 2520 × 1710).

> The reference images themselves are not in this repo — they are someone else's artwork, so they
> stay local (`reference/`, gitignored). Everything they were used to determine is recorded as
> numbers in `src/lib/canvas/spec.ts`.

- **Two modes, one layout.** *Period* takes a title, a start balance and an end balance. *Trade*
  takes symbol, direction, leverage, entry, exit and the profit itself. Both derive the same three
  rows, so the layout never changes shape.
- **Position size is not an input.** It differs by platform — MT5 lots, contracts, base units — and
  only scales the money, never the percentage, which is `price move × leverage` either way. So the
  profit is typed straight in as it reads on your statement, and the editor flags it when the sign
  contradicts the entry/exit prices rather than silently rewriting it.
- **Five accents** — the reference cards keep a constant near-black ground and vary only the accent
  per artwork, so themes here are just that: an accent plus a matching ambient glow. A negative
  result switches the block and the percentage to red.
- **Background: a photo or a clip.** Either fills the card, with a horizontal scrim protecting the
  text column. Placement is yours: zoom, horizontal and vertical pan, or just drag the preview and
  the background follows the cursor. `Recentre` puts it back.
- **Video backgrounds export as video.** Drop in a clip and the card records over it — up to 15
  seconds, trimmed with a start point and a length, the clip's own audio kept or dropped. The
  numbers, rows, accent and marks are painted on every frame by the same renderer that makes the
  PNG.
- **Your own marks**: wordmark, handle, avatar, logo, and both footer strings are yours to set.
- Download, copy to clipboard, or system share. `Ctrl`/`⌘` + `S` exports.
- Settings persist in `localStorage`.

## How the layout was matched

`src/lib/canvas/spec.ts` holds the geometry, and every number in it was **measured off the
reference images** rather than eyeballed — bounding boxes of the glyph ink, the solid accent block,
the avatar and the icons, read pixel by pixel. Font sizes were then derived from the measured ink
heights.

Two techniques do most of the work:

- **Ink alignment.** The reference measurements are ink positions, not advance widths, so
  `drawText({ inkAlign: true })` positions text by its painted bounding box. The visible left edge
  of "August 2026" lands on x=35 regardless of the font's side bearings.
- **Per-string tracking.** Inter is not the reference typeface and sets some strings slightly wide
  or narrow at matching cap height. Each block carries a small tracking correction solved from the
  measured target width. Tracking uses the native `ctx.letterSpacing` — the obvious fallback of
  drawing glyph by glyph loses kerning pairs, which measurably *widened* `+$10.1K` instead of
  narrowing it.

Result, reference vs. render, as ink bounding boxes:

| element | reference | render |
|---|---|---|
| accent block | x 35–419, y 177–255 | x 35–419, y 177–255 |
| hero `+$10.1K` | x 55–250, y 191–239 | x 55–248, y 191–239 |
| title | x 35–284, y 127–164 | x 36–283, y 127–164 |
| row label | x 55–204, y 382–400 | x 55–204, y 382–400 |
| handle | x 100–315, y 458–494 | x 100–314, y 458–494 |
| footer | x 59–328, y 506–519 | x 60–328, y 505–518 |

Everything is within 1–2px; several are exact. The remaining difference is letterform shape — the
reference face is not Inter and is not on Google Fonts.

Two header values deviate from the reference on purpose: the logo slot is 66×54 rather than 47×38,
and the wordmark is 34px rather than 42px. Both are single values in `spec.ts` if you want the
reference proportions back.

### What is deliberately not reproduced

The layout is matched; the *branding* is not. The wordmark, logo mark, avatar and footer strings are
empty slots you fill with your own. Shipping a generator preloaded with another company's mark and
domain would make it a tool for producing counterfeit cards attributed to them, which is a different
product from this one. Put your own mark in and the card is identical in every other respect.

## How the export is guaranteed to match the preview

The card is **not** HTML that gets screenshotted. `src/lib/canvas/draw.ts` exports a single pure
function, `drawCard(ctx, width, height, input)`, which paints the whole card in design-space units
and touches nothing but the canvas it is handed.

- The preview (`components/CardPreview.tsx`) calls it through `renderToCanvas` at the device pixel
  ratio.
- The exporter (`lib/share.ts` → `renderCardBlob`) calls the same function on a **detached** canvas
  at 1×/2×/3×, then `toBlob('image/png')`.
- The video exporter (`lib/video.ts` → `renderCardVideo`) calls the same function once per frame on
  a detached canvas while the clip plays, with `MediaRecorder` encoding `captureStream()`. A video
  frame is a PNG export that happened to be captured instead of encoded.

Scale is applied once, via a transform in `renderToCanvas`; nothing downstream knows the difference.
Because no DOM node is ever rasterised, editor UI cannot leak into the PNG. Fonts are awaited before
any paint, so the preview can never be rendering Inter while the export falls back to a system font.

### Verifying it

In a dev build the app exposes `window.__pnlCheckExport()`, which renders the export path at the
preview's exact pixel size and diffs the two bitmaps:

```js
await window.__pnlCheckExport()
// { ok: true, maxDelta: 0, mismatchRatio: 0, width: 700, height: 475 }
```

`maxDelta` is the largest per-channel difference across every pixel. It returns 0 with a plain
background, with artwork, and with artwork zoomed and panned. Downloaded files were also opened from
disk and inspected at 1×, 2× and 3×.

With a **clip** as the background the check first freezes it, because a moving background differs
between two paints for the honest reason that time passed. It also needs the window in front: the
preview canvas is repainted from `requestAnimationFrame`, which stops firing in a hidden or fully
covered tab, and the check says so in its `note` rather than reporting a false failure.

## The video export

`renderCardVideo` opens its own `<video>` for the clip (the preview keeps its own, so recording
never disturbs what is on screen), seeks to the trim point, and records the canvas in real time —
a 15 s clip takes 15 s. Points worth knowing:

- **MP4 is preferred, WebM is the fallback.** MP4 records on Chrome 126+ and Safari and posts
  everywhere without transcoding; the rest get WebM. `pickMimeType` holds the preference order.
- **Audio is routed, never played.** A `MediaElementAudioSourceNode` feeds a stream destination and
  nothing else, so the clip is silent while it records. The context is started *before* the element
  is routed into it — routing a playing element into a suspended context leaves it with a sink that
  never drains, and the clip then plays at a crawl into a recording full of frozen frames.
- **The paint loop is driven by rAF plus a timer.** rAF stops in a hidden or covered tab while media
  playback carries on, which would record the right duration of a frozen picture. The timer keeps
  painting — slowly — in that case, and a wall-clock deadline ends a genuinely stalled export with
  an error instead of a minutes-long file.
- **2× is the ceiling for video** (1680 × 1140). 3× costs far more encoding time than the pixels are
  worth; the export bar shows the resolution it will actually use.

## Media and privacy

Uploads never leave the device. A selected photo is decoded, re-encoded through a canvas (capping
the long edge and **stripping EXIF, including GPS**) and stored as a blob in this browser's
IndexedDB. There is no server and no network request involved, so media saved in one person's
browser is not reachable from anyone else's — the browser's origin/profile boundary is what enforces
it, rather than an access-control check that could be got wrong.

Video is stored **as uploaded**. Re-encoding a clip in the browser would cost minutes and quality,
and there is no EXIF block in a video file; its container metadata is left as the camera wrote it,
which is worth knowing if you share the exported file. The export itself is re-encoded, so only the
frames and the audio survive into it.

The trade-off worth stating plainly: storage is per-browser, so media does not follow you to another
device, and clearing site data removes it.

## Layout

```
src/
  types.ts               card state
  lib/
    pnl.ts               trade and period math                      (tested)
    content.ts           state -> the exact strings on the card     (tested)
    format.ts            price, money, compact money, percentages   (tested)
    themes.ts            accents
    fonts.ts             webfont readiness gate
    images.ts            IndexedDB media library: photos, clips, avatar, logo
    render.ts            the single paint entry point, preview + export
    share.ts             PNG download / clipboard / Web Share
    video.ts             clip trim window + MediaRecorder export        (tested)
    selftest.ts          preview-vs-export pixel diff (dev only)
    canvas/
      spec.ts            measured geometry
      placement.ts       cover fit, zoom and pan for the background     (tested)
      primitives.ts      ink-aligned text, tracking, rounded rects
      draw.ts            the card itself
  components/            preview, controls, inputs
```

## Notes and limits

- The liquidation price is a plain isolated-margin approximation: it ignores fees, funding and the
  maintenance-margin tier. It is a sanity check, not a risk tool, and it never appears on the card.
- Cards illustrate numbers the user types in. Nothing is verified against an exchange, so a card is
  not evidence of a trade.
- The loss colour is an assumption — every reference card shows a profit, so there was nothing to
  measure. It is one value in `themes.ts` if you want to change it.
- Browser canvases are capped at 8192px per edge; `clampScale` lowers the export scale rather than
  producing a blank image.
- Video export needs `MediaRecorder` and `canvas.captureStream`. Where they are missing the clip
  still previews and still exports as a PNG of the frame on screen; the app says so instead of
  offering a button that cannot work.
- A clip is accepted up to 120 s and 80 MB, and the card plays at most 15 s of it. The limit is the
  format's, not the encoder's: these cards are meant to be posted.
