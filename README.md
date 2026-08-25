# PnL Card Studio

A web app for traders to turn a closed trade — or a whole month — into a shareable card, and
download it as a high-resolution PNG or, over a background clip, an MP4. Every pixel is still drawn
in the browser — there is no server-side rendering — but the card and the images behind it now live
in a Supabase account, so they are there when you open the app somewhere else.

```bash
npm install
cp .env.example .env.local   # then fill in the two Supabase values, see below
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle into dist/
npm test           # unit tests for the PnL math, formatting, card content and sync
npm run typecheck
```

Setting up a fresh Supabase project takes two one-off steps: paste `supabase/schema.sql` into the
SQL editor, and put the project's URL and anon key in `.env.local`. Details below.

## Accounts

The app is one page — the studio — behind one gate. `AuthGate` renders the sign-in screen when
there is no session and the studio when there is; there is no router, because there is nowhere else
to go.

Set up a project at [supabase.com](https://supabase.com), then copy **Project Settings → API** into
`.env.local`:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Vite inlines `VITE_`-prefixed variables at build time, so restart the dev server after editing this
file. Both values are meant to reach the browser: the anon key is the public half of the pair, and
what it can read is decided by row-level security rather than by keeping the key secret. The
`service_role` key must never be put in a `VITE_` variable. With either value missing the sign-in
screen renders a setup notice instead of a form that could only fail.

Two dashboard settings decide how registration feels:

- **Authentication → Providers → Email** — with *Confirm email* on, `signUp` returns a user but no
  session, and the form says to check the inbox before signing in. With it off, the new account is
  signed in immediately and lands straight on the studio.
- **Authentication → URL Configuration** — the confirmation link returns to the site URL, so every
  origin the app is served from (including `http://localhost:5173`) has to be listed there, or the
  link bounces.

Sessions persist in `localStorage` and refresh themselves, so a reload does not ask again. While
that stored session is being restored the gate shows a spinner rather than the form — flashing a
sign-in screen at someone who is already signed in is worse than a short wait.

### The schema

Run `supabase/schema.sql` once, whole, in the dashboard's SQL editor. It is written to be
re-runnable, so applying it again after a change is harmless. It creates:

| | what it holds |
|---|---|
| `profiles` | one row per account, created by a trigger on sign-up |
| `cards` | the card state as JSON, one row per card |
| `media` | one row per uploaded file — the manifest a second device syncs from |
| `media` bucket | the bytes, private, partitioned as `<user id>/<file id>` |

Every table has row-level security keyed to `auth.uid()`, and the storage policies match on the
first path segment. That is the entire security model: the anon key in the browser is not a secret,
so those policies are the only thing standing between one account and another's. If you change how
objects are named, change the policies in the same commit.

### What syncs, and when

Both the card and the media library are **local-first**: this browser keeps a copy and the account
is reconciled behind it, so the editor paints on the first frame instead of after a round trip.

- **The card.** Every edit is written to `localStorage` immediately and pushed to `cards` after a
  900 ms pause in typing. The topbar shows *Saved* / *Saving...* / *Not saved*. On load the two
  copies are merged by `chooseCardVersion`: unsaved local edits always win, otherwise the account
  does. Concurrent edits on two devices are last-write-wins, and nothing here pretends to merge them.
- **Media.** An upload is written to IndexedDB and appears in the picker at once, then goes up to
  Storage in the background (the tile shows *Saving...* while it does). Signing in pulls the
  account's manifest, so files added elsewhere appear as tiles immediately — but their **bytes are
  only downloaded when something actually draws them**, which is what keeps signing in on a phone
  from pulling every clip in the library over cellular.

Signing out clears this browser's cached card and media. They are safe in the account, and leaving
one person's uploads in a shared browser's IndexedDB is not worth the download it saves.

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
- **Six accents, or any colour at all.** The reference cards keep a constant near-black ground and
  vary only the accent per artwork, so a theme here is just that: an accent plus a matching ambient
  glow. Mint, cyan, violet, gold, cherry red and bone are built in; **Custom** opens a colour well,
  a hex field and red/green/blue sliders for anything else. On the four light presets a negative
  result switches the block and the percentage to red — cherry and a custom colour stay as picked,
  because a card someone deliberately coloured should not repaint itself on a bad month.
- **White text or black.** The ink for everything outside the block. Black turns the whole card
  over: the plain background goes light and the scrim over a photo lightens instead of darkening,
  so the words stay readable either way.
- **Nothing goes unreadable.** The big value picks black or white from whichever reads better on
  the block, and the percentage row is lifted or darkened if the accent would otherwise disappear
  into the ground. The block itself always keeps the exact colour that was chosen.
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

Two parts of the bottom-left corner are deliberately *not* the reference's:

- The avatar sat at x=30.5 while the accent block and the title sit at x=35, so that corner was out
  of column with the rest of the card. It is now a sharp-cornered square on x=35, sharing the
  block's left edge, with the handle following at the same 15px gap it has in the reference. Its
  **size** is the reference's own, 54 × 54.
- The footer sat 8px under the avatar with a 48px dead band beneath it. It now sits 19 blank rows
  below, half the 42 that separate the avatar from the last stat row, so the avatar/handle line and
  the footer read as one identity block. Measured off painted ink rather than baselines, since
  antialiasing puts a row's visible bottom about 2px below its baseline. The bottom margin comes out
  at 33px against 35px on the left.

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

That table is the record of the original calibration, measured against the reference's own strings.
Two of those elements have since been **moved** on purpose, as described above: the handle 4px right
(x100 → x104, holding its gap off a wider avatar), and the footer 14px down (baseline y519 → y533,
ink now y519–536). The widths and letterforms are unchanged — only the positions.

**The pictures are the reference's own size.** The logo slot is 49 × 41 at (35, 34) and the avatar is
54 × 54 — both re-measured on 2026-08-25 from half-coverage edges rather than a luminance threshold,
which is what the first pass used and which loses a pixel of the antialiased edge on each side. The
logo was briefly grown to 66 × 54; at the reference size its optical centre lines up with the
wordmark's again. One value deviates on purpose and is text rather than a picture: the wordmark is
34px rather than the reference's 42px. It is a single number in `spec.ts`.

`dev/colour-shot.html` renders into both slots with deliberately wide and tall probe images and
checks the resulting boxes against `spec.ts`, which is the only way to observe a slot; it also pins
the colour behaviour above. `dev/layout-shot.html` measures the vertical gaps the same way.

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

**This changed when accounts landed, and the previous version of this section said the opposite.**
Uploads now leave the device — that is the point of them being in your account. What follows is what
actually happens to them.

A selected photo is decoded and re-encoded through a canvas, capping the long edge and **stripping
EXIF, including GPS**, *before* anything is sent. The file that reaches Storage is not the file off
your camera, and it does not carry where the picture was taken.

Video is stored **as uploaded**. Re-encoding a clip in the browser would cost minutes and quality,
and there is no EXIF block in a video file; its container metadata is left as the camera wrote it
and goes up with it. Worth knowing before uploading a clip straight off a phone. The exported card
is re-encoded, so only frames and audio survive into that.

The bucket is **private**. Nothing in it is reachable by URL alone: thumbnails are shown through
signed URLs that expire after an hour, and the storage policies only match objects whose path begins
with the requesting account's own id. Two accounts cannot see each other's files, and that is
enforced by row-level security in Postgres rather than by the client asking nicely — which matters,
because the client is a bundle anyone can read.

What the account holds: your email address, your card's contents, and the images and clips you
upload. What it does not: anything rendered on a server. Every card is still drawn by the canvas
renderer in your own browser, and the PNG or MP4 you download never touches the network.

The trade-off worth stating plainly, in the other direction now: your media is on someone else's
computer. It follows you to a new device, and it is also there to be breached, subpoenaed, or lost
if the project is deleted. If that is the wrong trade for a particular file, do not upload it.

## Layout

```
src/
  types.ts               card state
  lib/
    supabase.ts          the Supabase client, or null when unconfigured
    auth.tsx             session context: sign up / in / out, library sync
    library.ts           the media library the app talks to: cache + account
    useCloudCard.ts      card state, merged against the account          (tested)
    remote/
      cards.ts           the cards table
      media.ts           the media table and the storage bucket
    pnl.ts               trade and period math                      (tested)
    content.ts           state -> the exact strings on the card     (tested)
    format.ts            price, money, compact money, percentages   (tested)
    color.ts             hex, luminance, contrast, readable ink      (tested)
    themes.ts            accents, presets and the custom one         (tested)
    fonts.ts             webfont readiness gate
    images.ts            IndexedDB cache for the media library
    defaults.ts          card defaults, hydration, per-account cache     (tested)
    render.ts            the single paint entry point, preview + export
    share.ts             PNG download / clipboard / Web Share
    video.ts             clip trim window + MediaRecorder export        (tested)
    selftest.ts          preview-vs-export pixel diff (dev only)
    canvas/
      spec.ts            measured geometry
      placement.ts       cover fit, zoom and pan for the background     (tested)
      primitives.ts      ink-aligned text, tracking, rounded rects
      draw.ts            the card itself
  components/
    AuthGate.tsx         session? studio : sign-in screen
    AuthScreen.tsx       the registration and login form
    ...                  preview, controls, inputs
```

## Notes and limits

- The liquidation price is a plain isolated-margin approximation: it ignores fees, funding and the
  maintenance-margin tier. It is a sanity check, not a risk tool, and it never appears on the card.
- Cards illustrate numbers the user types in. Nothing is verified against an exchange, so a card is
  not evidence of a trade.
- The loss colour is an assumption — every reference card shows a profit, so there was nothing to
  measure. It is one value per preset in `themes.ts` if you want to change it, and cherry and the
  custom slot deliberately opt out of it entirely.
- The readability floor for the percentage row is WCAG's 3:1, which is the threshold for text this
  size. A near-black accent on the dark card is lifted only as far as that, so it stays recognisably
  the colour that was picked — legible, but still a quiet row.
- Browser canvases are capped at 8192px per edge; `clampScale` lowers the export scale rather than
  producing a blank image.
- Video export needs `MediaRecorder` and `canvas.captureStream`. Where they are missing the clip
  still previews and still exports as a PNG of the frame on screen; the app says so instead of
  offering a button that cannot work.
- A clip is accepted up to 120 s and 80 MB, and the card plays at most 15 s of it. The limit is the
  format's, not the encoder's: these cards are meant to be posted.
