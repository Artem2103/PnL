# Handoff — PnL Card Studio

Written 2026-08-23. Repo: <https://github.com/Artem2103/PnL> (private), initial commit `5216f81`.
Working directory `D:\PnL`. Read `README.md` first for what the app *is*; this file covers what a
newcomer would otherwise have to rediscover.

---

## State

Working and verified end to end. `npm run dev` → <http://localhost:5173>.

```bash
npm install
npm run dev
npm test          # 61 tests, all passing
npm run typecheck
npm run build     # clean
```

The app renders one card format (840 × 570) matching the Axiom reference cards, exports PNG at
1×/2×/3×, exports MP4/WebM when the background is a clip, and stores everything client-side. No
backend exists or is planned.

---

## The one invariant that must not be broken

**There is exactly one function that paints the card: `drawCard()` in `src/lib/canvas/draw.ts`.**

Preview, PNG export and **every frame of a video export** call it through `renderToCanvas()`
(`src/lib/render.ts`). Scale is applied once, as a transform, in `renderToCanvas`. Nothing
downstream knows the render scale.

This is what makes "the PNG matches the preview" true by construction rather than by testing. If
you ever find yourself adding a second drawing path — an HTML-to-canvas fallback, a separate
"export renderer", a watermark applied only on export — you have broken the guarantee, and no
amount of testing will restore it.

The video export was built to keep this intact: `renderCardVideo` is a loop around `renderToCanvas`
and a `MediaRecorder`, not a renderer. It does not know what a card looks like.

Corollaries that are easy to violate by accident:

- `drawCard` must stay pure with respect to the DOM. It reads its arguments and writes pixels.
  Anything asynchronous (fonts, images) is resolved *first* by `prepareAssets()`.
- Fonts must be awaited before any paint (`src/lib/fonts.ts`). Skip it and the preview renders in
  Inter while a later export falls back to a system font.
- Nothing random per-render. Anything stochastic must be seeded and cached, or preview and export
  will differ.

### How to verify it

In a dev build:

```js
await window.__pnlCheckExport()
// { ok: true, maxDelta: 0, mismatchRatio: 0, width: 700, height: 475 }
```

It renders the export path at the preview's exact pixel size and diffs the bitmaps
(`src/lib/selftest.ts`). `maxDelta: 0` means byte-identical. It has returned 0 with no background,
with a photo, and with a photo recentred (zoom 1, offsets 0). At zoom 1.58 it returns
`maxDelta: 1, mismatchRatio: 0, ok: true` — one 1/255 channel step from the GPU's resampling of the
same image twice, under the check's 2/255 threshold. Run it after any change to the renderer.

**Two things about running it with a clip as the background.** The check pauses the clip first
(`freeze()`), and App stops preview playback before calling it, because the preview loop would
restart the clip on the next frame. And it needs the window actually in front: the preview canvas is
repainted from `requestAnimationFrame`, which does not fire in a hidden or fully covered tab, so the
on-screen bitmap would be stale and the diff meaningless. The check detects that and says so in
`note` instead of reporting a failure. If you get that note, bring the window forward and re-run.

---

## How the layout was matched, and how to extend it

All geometry lives in `src/lib/canvas/spec.ts`, in the 840 × 570 design space. **Every number in it
was measured off the reference images, not estimated** — ink bounding boxes read pixel by pixel.
Font sizes were then derived from measured ink heights using Inter's metrics (cap 0.727em,
descender ~0.21em).

Two techniques carry the fidelity:

1. **Ink alignment.** `drawText({ inkAlign: true })` positions text by its painted bounding box
   rather than the glyph origin, because the reference numbers are ink positions. Side bearings
   stop mattering. Nearly every string on the card uses it.

2. **Per-string tracking corrections.** Inter is not the reference typeface; it sets some strings
   wide and some narrow at matching cap height. Each block carries a small tracking value solved
   from the measured target width.

### The trap that cost the most time

Tracking **must** go through the native `ctx.letterSpacing`. The obvious fallback — drawing glyph
by glyph and advancing manually — silently drops kerning pairs. Applying `-0.8px` of tracking to
`+$10.1K` that way made it *wider* (201px → 203px) instead of narrower. `primitives.ts` keeps the
manual path only as a fallback for engines without `letterSpacing`, gated by `needsManualTracking()`.

### Re-calibrating after a font or size change

You do not need to download and inspect files. Measure text metrics directly in the page console:

```js
const c = document.createElement('canvas').getContext('2d');
function ink(text, weight, size, spacing) {
  c.font = `${weight} ${size}px Inter, sans-serif`;
  c.letterSpacing = `${spacing}px`;
  const m = c.measureText(text);
  return m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
}
ink('+$10.1K', 800, 53.5, -1.26);   // -> 196, the measured reference width
```

Tracking is linear in ink width: measure at two values, solve, done. The reference ink widths are
in the README table.

To isolate one element in a rendered card (used to confirm the logo size change), render twice with
the relevant toggle flipped and diff the two bitmaps — the differing region *is* the element. This
works where brightness thresholds fail, e.g. when artwork fills the card.

### Current spec values worth knowing

| | |
|---|---|
| Card | 840 × 570 |
| Accent block | x35 y177, 385 × 79, sharp corners, text ink inset 19 |
| Rows | label x55, value x301, baselines 319 / 360 / 401 |
| Colours | accent `#2FE3AC`, text `#EAEDFF`, on-accent `#020307` |

Two header values **deliberately differ** from the reference, on request: logo slot 66 × 54 (was
47 × 38) and wordmark 34px (was 42px). Their tracking was scaled with the size.

---

## Background placement and video

Added after the first release, on request: adjustable placement for the background, and clips that
export as video.

### Placement

`ArtworkState` carries `zoom` (1–3), `offsetX` and `offsetY` (−1…1). The math is one pure function,
`placeCover()` in `src/lib/canvas/placement.ts`, used by two callers that must agree: `draw.ts` to
paint, and `CardPreview` to turn a drag in screen pixels into a pan value. Split it and dragging
stops moving the photo by the distance the pointer travelled.

Pan is a **share of the available overflow**, not a pixel offset — so a slider behaves the same for
any source aspect ratio and the photo can never be dragged off the card leaving a gap. `+1` slides
the photo right (revealing its left side); vertical is inert until zoom or a tall source creates
slack, which the copy under the sliders says out loud so it does not read as a bug.

### Video

- `images.ts` is now a media library. Records carry `kind: 'image' | 'video'` and `duration`;
  missing fields read as `'image'` / `0`, so records written before this change still load. Video is
  stored **as uploaded** — see the README on what that means for metadata.
- `RenderAssets.artwork` is a `BackgroundMedia` (`{ kind, element, width, height, duration }`), not
  an `HTMLImageElement`. `drawCard` draws whichever it is handed, and skips a clip whose
  `readyState < 2` — a clip that has not buffered a frame would paint nothing and blank the card.
- The preview keeps its own cached `<video>`; the exporter opens a **separate** one
  (`openVideoForExport`), so recording never disturbs what is on screen.
- The preview redraws every rAF tick while a clip is selected, even when paused. That is what lets
  the export check compare a held frame.

### Three traps that cost time here

1. **Never route a playing element into a suspended `AudioContext`.** `createMediaElementSource`
   hands the element's output to the context permanently; if that context is not running, the sink
   never drains and decoding crawls. A 5 s clip took 37 s to record and produced 37 s of frozen
   frames. The context is now started *first* and the element is only routed in once
   `state === 'running'`; otherwise the export goes silent. It is not recoverable after the fact —
   the source node cannot be undone.
2. **`requestAnimationFrame` does not fire in a hidden or covered tab, but media keeps playing.**
   rAF alone therefore records the right duration of a still picture. The loop is driven by rAF
   *and* a `setInterval` backstop, with a wall-clock deadline that fails the export loudly rather
   than writing a minutes-long file. The same trap applies to any test you write here — check
   `document.visibilityState` before believing a timing result.
3. **Start the recorder after `play()`, and bound the tail on the wall clock.** Starting it first
   opened the file on a held frame, and letting the paint loop detect the end meant overrunning by
   however long it had slept: a 3.0 s window produced a 3.8 s file. With both fixed it produces
   2.98 s.

### What was verified in the browser

Chrome on this machine, with a synthetic 5 s MP4 (a canvas recording, so no personal media was
used): clip preview plays under the card; drag pans horizontally and, once zoomed, vertically;
`Recentre` resets; trim start/length take effect; the real `Download MP4` button produced
`march-2026-pnl.mp4`, 1680 × 1140, 2.98 s for a 3.0 s window, with an audio track; `Download PNG`
still produced a 1680 × 1140 PNG with a clip selected; console clean.

## Design decisions that look wrong until you know why

- **Position size is not an input.** It differs per platform (MT5 lots, contracts, base units) and
  only scales the money — the percentage is `price move × leverage` regardless. So the profit is
  typed in directly. Do not "helpfully" add a lot-size field and compute the money from it; the
  user trades MT5 and that was the reported pain point.
- **Colour follows the entered money, not the price move.** The block is the headline. When the two
  disagree, `signsDisagree()` surfaces a warning in the editor; the number is never silently
  rewritten.
- **`formatPrice` treats its decimal tier as a floor, never a ceiling.** Forex is quoted to five
  decimals; the earlier version rounded `1.16944` to `1.1694` and ate a pip.
- **`hydrateState` copies only keys the current model knows.** Fields removed from the model get
  dropped from saved state instead of lingering forever.
- **No Axiom branding ships.** Wordmark, logo, avatar and footer strings are empty slots. The
  layout is replicated; the identity is not. Preloading their mark and domain would make this a
  generator for counterfeit cards attributed to them.
- **One format only.** Portrait/square variants existed in an earlier version and were removed
  deliberately.
- **A clip is capped at 15 s on the card, and video export at 2×.** The cap is the format's, not the
  encoder's — these cards are posted. 3× would cost far more encoding time than the pixels are
  worth, so `renderCardVideo` clamps it and the export bar shows the resolution it will use rather
  than the one the chips say.
- **The PNG of a video card is the frame on screen**, not a fixed frame. The exporter and the
  preview share the same element, so pausing the preview picks the frame.

---

## Open items

1. **Symmetry.** The user flagged "some symmetry maybe" but has not said where. Two candidates:
   the header — the logo now spans y37–91 while the wordmark baseline stayed at 70, so their
   optical centres no longer align (the reference had both near y55); or the left edge — the accent
   block starts at x35 while row labels indent to x55, which is the reference's own asymmetry.
   **Ask before changing.**
2. **Loss state is unverified.** All five reference cards show a profit, so the red used for a
   negative result is an assumption, not a measurement. One value per theme in `themes.ts`.
3. **Percentage semantics.** `PNL %` is return on *margin* for the position. If MT5 shows return
   against the whole account balance, that is a different number and would need its own input.
4. **Typeface.** The reference face is not Inter and is not on Google Fonts. Remaining visual
   difference is letterform shape only; positions and sizes match within 1–2px. If the real face is
   ever identified, re-solve the tracking values and most of them should drop to ~0.
5. **Video export is untested on Safari and Firefox.** Firefox has no MP4 recording, so it will take
   the WebM branch; Safari's MP4 branch is plausible but unverified. `videoSupport()` degrades to
   "PNG only" if neither works, which is the failure mode to confirm first.
6. **The exported file runs slightly long.** 2.98 s for a 3.0 s window is the recorder's start/stop
   latency, not drift. If it ever matters, trim on the encoder side rather than shortening the
   window — the clip would then end early on screen.

---

## Environment notes

- **`reference/` is gitignored.** The five source screenshots stay local — they are someone else's
  artwork. All measurements taken from them are recorded in `spec.ts`. A fresh clone will not have
  the folder; the README says so.
- **`gh` CLI is not installed** on this machine. The repo was created through the web UI and pushed
  over HTTPS via the `manager` credential helper.
- **Do not run `npm install --prefix <dir>`.** It injected a self-referencing `"pnl-card-studio":
  "file:"` dependency into `package.json`. Run plain `npm install` from inside the directory.
- **PowerShell here-strings do not pipe to `git commit -F -`.** Write the message to a file and
  pass its path.
- **Chrome CDP screenshots sometimes capture before the canvas composites**, showing a blank
  preview that is not a bug. Confirm by reading pixels back with `getImageData` before chasing it.

---

## Where things live

```
src/
  types.ts               card state
  lib/
    pnl.ts               trade + period math, sign-disagreement check   (tested)
    content.ts           state -> the exact strings on the card         (tested)
    format.ts            price / money / compact money / percentages    (tested)
    themes.ts            accents
    fonts.ts             webfont readiness gate
    images.ts            IndexedDB media library (photos / clips / avatar / logo)
    render.ts            THE paint entry point, preview + export
    share.ts             PNG download / clipboard / Web Share
    video.ts             trim window + MediaRecorder export             (tested)
    selftest.ts          preview-vs-export pixel diff (dev only)
    canvas/
      spec.ts            measured geometry — change layout here, not in draw.ts
      placement.ts       cover fit, zoom, pan — shared by draw and drag  (tested)
      primitives.ts      ink-aligned text, tracking, rounded rects
      draw.ts            the card itself
  components/            preview, controls, media picker, inputs
```

Tests sit next to their subjects as `*.test.ts`. There are no component tests — the renderer is
where the risk is, and `__pnlCheckExport` covers the part that matters most. The video tests cover
the parts that are pure (mime preference, the trim window, filenames); the recorder itself was
verified in the browser, described above.
