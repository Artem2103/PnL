# Handoff — PnL Card Studio

Written 2026-08-23, revised 2026-08-24 through `e3c48ee`. Repo:
<https://github.com/Artem2103/PnL> (private), initial commit `5216f81`. Working directory `D:\PnL`.
Read `README.md` first for what the app *is*; this file covers what a newcomer would otherwise have
to rediscover.

The 2026-08-24 pass was a performance rebuild plus two layout fixes, on branch
`perf/render-loop-and-square-avatar` (`a95983c`, `e3c48ee`) — **not yet merged to `main`**. Most of
what follows about the render loop and the recorder is new in those two commits.

---

## State

Working and verified end to end. `npm run dev` → <http://localhost:5173>.

```bash
npm install
npm run dev
npm test          # 96 tests, all passing
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

### The one seam inside it: the foreground layer cache

`drawCard` is split into `drawCardBackground` (ground, artwork, scrim) and `drawCardForeground`
(everything painted over it). This is **not** a second drawing path — it is the same code, cut at
the one place that matters for speed. While a clip plays, the foreground is identical frame after
frame, and it is the expensive half: a dozen shaped, ink-aligned strings. So `renderToCanvas` paints
it once into a transparent layer the size of the target canvas and blits it 1:1 on every later
frame. Both halves are always called, in that order, by every caller.

The cache is keyed by `foregroundKey(input)`, which must read **everything** the foreground draws.
If you add an element to the foreground and forget to add its input to the key, the card will stop
responding to that control — silently, and only once a layer is warm. `src/lib/canvas/draw.test.ts`
pins this from both sides: every foreground input must move the key, every background-only input
must leave it alone. Add a case there when you add a control.

Blitting rounds premultiplied alpha once more than painting in place does, which costs at most
1/255 on a glyph's antialiased edge. Every path — preview, PNG, video frame — goes through the same
blit, so they stay byte-identical to *each other*, which is what the guarantee is about. Measured
against an unlayered `drawCard` at 1×, 2× and 3×, on both a photo and a clip: `maxDelta: 1`, zero
channels off by more than 2.

Corollaries that are easy to violate by accident:

- `drawCard` must stay pure with respect to the DOM. It reads its arguments and writes pixels.
  Anything asynchronous (fonts, images) is resolved *first* by `prepareAssets()`.
- Fonts must be awaited before any paint (`src/lib/fonts.ts`). Skip it and the preview renders in
  Inter while a later export falls back to a system font. `ensureFonts` gives up after 2.5 s so a
  dead font server cannot hold the card hostage; if the face lands later, `onFontsChanged` drops the
  text-metrics cache and the preview repaints itself. Preview and export always agree at any given
  instant, which is the property that matters.
- Text metrics are cached process-wide in `primitives.ts`, keyed by font and string. They are valid
  only because the card is drawn in design units — the scale lives in the transform, so a 1× PNG and
  a 3× PNG measure the same. Move the scale downstream and this cache turns into a bug.
- Nothing random per-render. Anything stochastic must be seeded and cached, or preview and export
  will differ.

### How to verify it

In a dev build:

```js
await window.__pnlCheckExport()
// { ok: true, maxDelta: 0, mismatchRatio: 0, width: 700, height: 475 }
```

It renders the export path at the preview's exact pixel size and diffs the bitmaps
(`src/lib/selftest.ts`). `maxDelta: 0` means byte-identical, and it still returns 0 after the
foreground-layer cache landed. It has returned 0 with no background,
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

## How the preview paints

Rebuilt on 2026-08-24. The old loop resolved assets and repainted inside one effect keyed on the
whole `state` object, so **every keystroke cancelled the animation loop and re-ran async
`prepareAssets` before anything could repaint**. With a clip selected that restarted the loop on
every slider tick. If you find yourself putting `state` in that effect's dependency array again,
this is what you are re-introducing.

The shape now, all in `src/components/CardPreview.tsx`:

- `stateRef` / `playingRef` / `cssWidthRef` are assigned during render. The loop reads refs, never
  closures, so React re-renders never tear it down.
- `request()` sets a dirty flag and schedules **one** animation frame. `useEffect(request)` with no
  dependency array runs after every commit, which is what connects "anything changed" to "repaint".
- `pump()` paints only when dirty, then re-schedules itself **only if a clip is playing**. A still
  card settles to nothing at all: no animation frame, no timer, no wake-ups on battery.
- A clip re-arms the dirty flag from `requestVideoFrameCallback`, so it paints once per decoded
  frame rather than once per display refresh. Firefox has no such callback and falls back to the
  refresh rate.
- Preview scale adapts *downward only* when frames stretch past 24 ms, recovering after 1.5 s of
  headroom. Exports are unaffected — they always render at their full scale.

Width is deliberately **not** React state; a `ResizeObserver` writing to state re-rendered the whole
editor on every observer callback during a window drag.

### Two caches you can invalidate by accident

**Text metrics** (`primitives.ts`) are memoised process-wide by font + string: measured 23.5x
faster, worth ~15.5 ms/s at 30 fps. This is only sound because the card is drawn in *design units*
and the scale lives in the canvas transform, so a 1x PNG and a 3x PNG measure identically. **Push
the scale downstream into the drawing code and this cache silently becomes a bug.** It is dropped
whenever a webfont finishes loading, which is the only other thing that can change an answer.

**The foreground layer** is described under the invariant above. Its key is the thing to keep
honest; `src/lib/canvas/draw.test.ts` pins it from both sides.

Rough per-frame cost at 2x, measured in Chrome: layered `renderToCanvas` 0.21 ms against 1.26 ms
for an unlayered `drawCard`.

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
| Avatar | x35 y446, 52 × 52, **square, no corner radius** |
| Handle | ink x103, baseline 486 |
| Footer | icon x36 y542 23 × 15, ink x59, baseline 554 |
| Colours | accent `#2FE3AC`, text `#EAEDFF`, on-accent `#020307` |

Four values **deliberately differ** from the reference, all on request:

- logo slot 66 × 54 (was 47 × 38) and wordmark 34px (was 42px); tracking scaled with the size.
- avatar x35 (was 32) with square corners (was radius 12), so its left edge shares the accent
  block's and the title's. Handle moved 100 → 103 to hold its original 16px gap off the avatar.
- footer dropped 35px (icon y507 → 542, baseline 519 → 554) so it sits the same distance below the
  avatar as the avatar sits below the last stat row. Measured **off painted ink, not baselines**,
  because that is what the eye reads: last row ends y403, avatar starts y446 (42 blank rows); avatar
  ends y497, footer starts y540 (42). Side effect: the bottom margin is 12px against 35px on the
  left. That is the arithmetic of the equal-gap rule on a 570px card, and it was flagged as such —
  subtract 8 from both footer values for a 20px margin and a 34px gap if it ever reads too tight.

To re-measure any of this, render with no background and scan for ink bands rather than trusting the
spec numbers — antialiasing puts a row's visible bottom ~2px below its baseline, which is enough to
make "equal" gaps look unequal:

```js
await document.fonts.ready;                      // see the warning below
const render = await import('/src/lib/render.ts');
const { createDefaultState } = await import('/src/lib/defaults.ts');
const state = { ...createDefaultState(), avatarId: null, logoId: null };
const bare = { ...state, artwork: { ...state.artwork, imageId: null } };
const c = render.renderToOffscreenCanvas(bare, await render.prepareAssets(bare), 1); // 1x = design px
// then threshold luminance per row over the text column and group consecutive inked rows
```

Two things will hand you wrong numbers here:

- **Check `document.fonts.check('400 40px Inter')` before believing any width.** `ensureFonts()`
  gives up after 2.5 s and paints in the fallback stack, which is wider than Inter. A measurement
  taken in that window looks like a layout regression and is not one.
- **The README's reference/render table was measured against the reference cards' own strings**,
  not against the default sample state. `@yourhandle` is ~35px wider than the handle those numbers
  describe, so measuring the default card and comparing to that table will look like a mismatch.
  Set the same strings first, or compare only against a render you measured the same way.

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
- The preview paints **on demand**, not on every tick — see *How the preview paints* below. A
  paused clip therefore holds its last painted frame, which is still what lets the export check
  compare against a held frame, but nothing repaints until something marks the card dirty.
- Video always records at 2x (1680 x 1140) whatever the scale chips say, and at >= 6 Mbit/s. Both
  floors exist because the file gets re-encoded by whatever platform it is posted to; see the
  recorder trap below for why the frame *cadence* matters more than either.

### Four traps that cost time here

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
4. **Paint the canvas *faster* than the recorder samples it — never at the same rate, and never
   gated on the decoder.** `captureStream(fps)` samples the canvas when it changes and enforces a
   minimum of `1/fps` between the frames it keeps. Paint at exactly `fps` and ordinary timer jitter
   lands half the paints just inside the previous interval, where they are silently discarded; the
   file then holds 15-20 *irregularly spaced* frames a second and plays back as judder. This was
   introduced deliberately in `a95983c` as an "optimisation" — gating each paint on
   `requestVideoFrameCallback` so a 24 fps clip was not drawn 144 times a second — and it made every
   export stutter. Fixed in `e3c48ee`: the recorder loop paints at `VIDEO_FPS * 2`,
   unconditionally. The saving was never worth having; a paint is ~0.2 ms now that the foreground is
   cached. **The preview keeps the per-decoded-frame gating**, because no encoder is involved there
   and the CPU saving is real. Do not unify the two loops.

### What was verified in the browser, 2026-08-24

Chrome, dev server, with the *photo* background path (a clip could not be loaded — see the hidden-tab
note in Environment):

- `__pnlCheckExport()` → `maxDelta: 0` after the foreground-layer cache landed, i.e. the PNG is
  still byte-identical to the preview.
- Layered `renderToCanvas` vs an unlayered `drawCard`, diffed at 1×/2×/3× on both the image and the
  video branch: `maxDelta: 1`, zero channels off by more than 2. The 1/255 is premultiplied alpha
  rounded once more at glyph edges; every path takes the same blit, so they stay identical to each
  other.
- Typing in the title repaints the card on each keystroke (confirmed by driving React's `onChange`
  and re-running the export diff, and visually).
- Ink-band scan confirming the avatar and footer geometry: bands at 300–323, 338–362, 379–403,
  446–497, 540–557; gaps of exactly 42 rows on either side of the avatar.
- Text metrics benchmark: 0.5397 ms → 0.0230 ms per frame's worth of measurement.

**Not verified in that pass: any clip playing, recording, or the exported file.** The tab was hidden
throughout. Covered later the same day — see below.

### What was verified in the browser, 2026-08-24 (second pass, isolated Chrome)

The clip and recorder gap above, closed. Run in a separate Chrome instance with occlusion detection
and renderer backgrounding disabled, so `hiddenEpisodes: 0` for the whole run and the numbers mean
something (the flags are in the environment notes):

- **The export does not judder.** Frame durations read out of the MP4 container: 89 frames, 29.95
  fps, 5.50 ms jitter, worst gap 44.1 ms, against a source clip measured at 30.06 fps / 4.41 ms over
  the same window. The full table and its caveats are under open item 7.
- **The control proves the measurement works.** The same export with the paint loop gated on
  `requestVideoFrameCallback`, as `a95983c` had it: 12.44 ms jitter and a 140 ms gap.
- File length: 2.971 s of frame durations, 2.992 s track, for a 3.0 s window. 2 131 196 bytes,
  1680 × 1140, `video/mp4;codecs=avc1.42E01E,mp4a.40.2`.
- `videoSupport()` picks the MP4/AVC branch on Chrome 151.
- The whole path exercised end to end: `addImage` of a clip, `openVideoForExport`, `resolveClip`
  with a non-zero `clipStart`, `renderCardVideo` at 2×, `deleteImage`.

**Still not verified: the audio branch.** The harness runs with `muteAudio: true`, so
`attachAudio()` and the suspended-`AudioContext` trap it guards against were not exercised. The
2026-08-23 manual run did produce a file with an audio track, so the path works; it has just not
been re-checked since the render loop was rebuilt.

### What was verified in the browser, 2026-08-23

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
- **A clip is capped at 15 s on the card, and video export is pinned at 2×** — a floor as well as a
  ceiling, via `videoScaleFor()`. The 15 s cap is the format's, not the encoder's; these cards are
  posted. 3× would cost far more encoding time than the pixels are worth. 1× is worse: an 840 × 570
  video is re-encoded by every platform and arrives with its numbers smeared, which is exactly what
  was reported. The chips are shared with the PNG export, so the floor lives in `videoScaleFor`
  rather than in a hidden 1× chip, and the clip bar says "video 2×" so the difference is visible.
- **The PNG of a video card is the frame on screen**, not a fixed frame. The exporter and the
  preview share the same element, so pausing the preview picks the frame.

---

## Open items

1. **Symmetry — answered, partly.** The 2026-08-24 pass resolved what was meant: the avatar block
   was to line up with the accent block's left edge (done, x32 → x35, square corners), and the
   footer was to sit the same distance below the avatar as the avatar sits below the last stat row
   (done). **Still open from the original note:** the header. The logo spans y37–91 while the
   wordmark baseline stayed at 70, so their optical centres no longer align — the reference had both
   near y55. Not raised since. Ask before changing.
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
6. **The exported file's length is right.** Measured from the container, a 3.0 s window produces
   2.971 s of frame durations and a 2.992 s track. The earlier "runs slightly long" note had the
   sign wrong — it runs a hair *short*, by the recorder's start/stop latency. Nothing to fix; if it
   ever matters, trim on the encoder side rather than shortening the window, or the clip ends early
   on screen.
7. **~~The video export fix in `e3c48ee` has not been watched back.~~ Confirmed 2026-08-24 — it does
   not judder.** Measured with `dev/cadence-check.html` (see below), reading frame durations out of
   the MP4 container rather than trusting playback:

   | | frames | fps | jitter (sd) | worst gap |
   |---|---|---|---|---|
   | source clip, the 3 s window the card used | 90 | 30.06 | 4.41 ms | 42.1 ms |
   | **shipping loop (`e3c48ee`)** | **89** | **29.95** | **5.50 ms** | **44.1 ms** |
   | control: the old rVFC-gated loop (`a95983c`) | 86 | 28.86 | 12.44 ms | 140.1 ms |

   The shipping loop reproduces the source's own cadence almost exactly — its jitter (5.50 ms) is
   barely above the input's (4.41 ms), and no frame interval exceeds 44 ms. The control, painting
   once per decoded frame the way `a95983c` did, more than doubles the jitter and drops a 140 ms
   hole — four frame times with nothing in them. So the diagnosis in `e3c48ee` was right and the
   measurement is sensitive enough to have caught it had it been wrong.

   Two honest caveats. The control degrades clearly but *not* to the "15–20 frames a second" the
   original report described; a synthetic clip decodes far more regularly than a real
   variable-frame-rate one, so this understates the old bug rather than reproducing it at full
   strength. And ~19% of exported frames repeat a source frame (`duplicatePairs: 17` of 89) — that
   is phase drift between a 30 fps source and a 30 fps sampler, inherent to canvas capture, not the
   judder that was fixed. It is the residual to look at if anyone ever calls the motion less than
   perfectly smooth.
8. **Nothing on this branch is merged.** `perf/render-loop-and-square-avatar` sits ahead of `main`
   by `a95983c`, `e3c48ee` and the verification commit. Now that item 7 is confirmed, the branch
   has no known blocker.

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
- **A driven Chrome tab can sit at `document.visibilityState === "hidden"` indefinitely**, and that
  is not cosmetic: `requestAnimationFrame` never fires, `setTimeout` clamps to ~1 s, and **media
  will not decode at all** — a `<video>` stays at `readyState 0` / `networkState 2` forever. Every
  attempt to synthesise a test clip with `MediaRecorder` in that state produced an undecodable file.
  So the preview genuinely does not repaint while hidden (correct behaviour — it catches up on the
  next frame once visible), and any timing or media result from such a tab is meaningless. Check
  `document.visibilityState` **first**, before believing anything. Do not "fix" this by shimming
  `requestAnimationFrame` to `setTimeout` mid-session either: a real animation-frame handle already
  parked in the loop's `rafRef` never fires, so `request()` sees a pending frame and schedules
  nothing, and the preview deadlocks in a way that looks exactly like a render bug.
- **The hidden-tab problem is solvable: launch your own Chrome.** This is what unblocked the video
  verification on 2026-08-24, and it is worth knowing before losing another session to it. Driving a
  tab in the everyday browser does not work — the extension's tabs stay backgrounded, and the few
  seconds of visibility you can win by activating a tab are taken back before the next tool call
  lands. A separate instance with its own profile *and its own flags* holds still:

  ```
  chrome --user-data-dir=<scratch>/chrome-profile --no-first-run --no-default-browser-check \
         --disable-features=CalculateNativeWinOcclusion \
         --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
         --disable-background-timer-throttling --autoplay-policy=no-user-gesture-required \
         http://localhost:5173/dev/cadence-check.html
  ```

  `CalculateNativeWinOcclusion` is the load-bearing one: without it Chrome marks the page hidden the
  moment another window covers it, however briefly. With these, a full run reported
  `hiddenEpisodes: 0` while the user carried on using the machine. The flags only apply to a fresh
  process, so the separate `--user-data-dir` is required — passing them to an already-running Chrome
  silently does nothing. Have the page POST its results to a small local collector; do not try to
  read them back through the extension.

  Three traps inside that setup, each of which produced a wrong answer first:
  - **Editing the page while an old copy is open re-runs it.** Vite's HMR reloaded a stale window,
    so two `MediaRecorder`s were encoding at once and the numbers were garbage. Close old windows by
    title (`WM_CLOSE`) before every run.
  - **`MediaRecorder` stalls for about a second shortly after `start()`.** It is the encoder warming
    up, not the code under test. Record longer than you need and measure a window past it — the
    harness records 9 s and uses 2 s–5 s.
  - **`requestVideoFrameCallback` cannot measure a file's cadence.** It reports frames the player
    chose to present, so any hiccup during playback invents a gap that is not in the file. This
    faked a 2 s stall before the container parser replaced it. Read sample durations out of the MP4
    (`moof`/`traf`/`trun`, `stts` for non-fragmented) — that is the encoded truth and needs no
    playback. rVFC is still fine for "did the picture actually change", which is all the harness
    uses it for now.
- **Do not let a literal NUL byte into a source file.** A cache-key separator written as the actual
  U+0000 character, rather than as an escape sequence in the source, works perfectly at runtime —
  it compiles to the same character — but git then classifies the whole file as binary (`-text`) and
  it loses diffs, blame and merges. This happened twice here, in `primitives.ts` and `draw.ts`, and
  once more in this very file while documenting it. Check with `git ls-files --eol` (want `lf`, not
  `-text`) or scan the bytes; a `Bin 10269 -> 12973 bytes` line in `git show --stat` is the tell.

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
      primitives.ts      ink-aligned text, tracking, cached metrics
      draw.ts            the card itself + foregroundKey                 (tested)
  components/            preview, controls, media picker, inputs
dev/
  cadence-check.html     browser harness: does the exported file judder?  (dev only)
```

Tests sit next to their subjects as `*.test.ts`. There are no component tests — the renderer is
where the risk is, and `__pnlCheckExport` covers the part that matters most. The video tests cover
the parts that are pure (mime preference, the trim window, filenames, the 2× scale floor); the
recorder itself has to be verified in the browser.

`dev/cadence-check.html` is how you do that verification, and it is the only way to answer "does the
export judder" — no unit test can. It synthesises a 30 fps clip, exports a card over it through the
real `renderCardVideo`, and reads frame durations out of the MP4 container. Crucially it also
records a **control** with the paint loop gated the way `a95983c` had it, so a clean result is
demonstrably clean rather than a measurement that would have missed the bug. It is not part of the
build: Vite's only entry is `index.html`, so the page exists in dev and never ships. Run it in an
isolated Chrome — see the environment notes for the flags and for why the everyday browser cannot
give you a trustworthy answer.

`canvas/draw.test.ts` is the odd one out: it tests no drawing. It pins `foregroundKey` from both
sides — every input the foreground reads must move the key, every background-only input must leave
it alone. That is the failure mode the layer cache introduces, and it is invisible without a clip
playing, so it is worth the 31 cases. **Add a case there whenever you add a control that changes
anything above the background.**
