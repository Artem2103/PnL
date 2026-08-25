# Handoff — PnL Card Studio

Written 2026-08-23, revised 2026-08-25 through the colour controls. Repo:
<https://github.com/Artem2103/PnL> (private), initial commit `5216f81`. Working directory `D:\PnL`.
Read `README.md` first for what the app *is*; this file covers what a newcomer would otherwise have
to rediscover.

The 2026-08-24 pass was a performance rebuild plus layout fixes, originally on branch
`perf/render-loop-and-square-avatar` (`a95983c`, `e3c48ee`). It has since been **verified, merged
into `main` and deployed** — see open items 7 and 8. Most of what follows about the render loop and
the recorder is new in those commits.

---

## Start here (2026-08-25)

Two things sit on branch `feat/supabase-accounts`.

**The colour and picture pass is done and verified in a browser** (`c96f703`, committed, not
pushed). The logo and avatar are back at the reference's own sizes, text can be white or black,
cherry red joined the presets, and there is a custom colour with an RGB picker behind it. All of it
is measured, not eyeballed — see **Colour, ink and the two picture slots** below, and
`dev/colour-shot.html`, which is the instrument that measured it. Nothing there is outstanding.

**Accounts are still unverified against a live project, and are currently switched off in
practice.** Sign-up, sign-in, and per-account storage of the card and its images are **written,
typechecked, built and unit-tested**. They have **not** been run against a real Supabase project,
because there are still no credentials — `.env.local` has both variables present and empty.

Because of that, and on request, **an unconfigured app now opens the studio instead of a setup
notice** — see **Local mode** below. This is not a flag: filling in the two variables restores the
sign-in screen on its own. Read that section before deploying anything, because it changes what a
credential-less production build does.

Closing the account verification is still the one thing outstanding, and the walkthrough below is
how to do it. Nothing below is a known bug.

**Three steps to see it work:**

1. Create a project at [supabase.com](https://supabase.com). In **SQL Editor → New query**, paste
   the whole of `supabase/schema.sql` and run it once.
2. Copy **Project Settings → API** into `.env.local`:
   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
3. `npm run dev`, then create an account. If **Authentication → Providers → Email → Confirm email**
   is on, you get a "check your inbox" message; turn it off to skip straight in while testing.
   Either way, add `http://localhost:5173` under **Authentication → URL Configuration**.

**Then check these six things, in this order.** They are the walkthrough, not a list of suspicions:

| | expected |
|---|---|
| sign up, then sign in | the studio opens |
| edit any field | topbar goes *Saving...* then *Saved* |
| upload a background | tile appears at once, *Saving...* badge clears |
| reload the page | card and images are still there |
| sign in from a second browser | same card, same tiles |
| delete an image | gone from the picker and from Storage |

If all six pass, it works. Merge `feat/supabase-accounts` into `main` — **but before you do**, add
the same two variables to the Vercel project and redeploy, or <https://nexocards.vercel.app> will
show the setup notice to everyone. Vite bakes those values into the bundle at build time, so
setting them without a rebuild does nothing. Add the Vercel URL to Supabase's URL Configuration too.

**If something fails**, the useful places to look: the browser console (upload and sync failures are
logged there rather than shown), the Supabase dashboard's **Table Editor** (is there a row in
`cards`? in `media`?) and **Storage → media** (are the bytes there?). A row with no object, or a
tile that never loads, means the upload half failed and the manifest half did not.

The rest of this file is background — how the pieces fit and why they are shaped that way. Read
**Authentication** and **Persistence** when you need to change them, not before.

---

## State

Working and verified end to end. `npm run dev` → <http://localhost:5173>.

```bash
npm install
npm run dev
npm test          # 144 tests, all passing
npm run typecheck
npm run build     # clean
```

The app renders one card format (840 × 570) matching the Axiom reference cards, exports PNG at
1×/2×/3×, exports MP4/WebM when the background is a clip, and stores everything client-side.

`npm test` is 144 tests as of 2026-08-25 — the colour pass added `color.test.ts` and
`themes.test.ts`, and two more cases to `draw.test.ts`.

Since 2026-08-24 the studio sits behind a Supabase email/password gate, and the card and its media
are stored **in the account**, not just in the browser. Setting the project up now takes two steps
that are not `npm install`: run `supabase/schema.sql` in the SQL editor, and fill in `.env.local`.
Without the second, the app renders a setup notice instead of a sign-in form. See
**Authentication** and **Persistence** below.

---

## Authentication

```
main.tsx
  └ AuthProvider          lib/auth.tsx     — one session, held in React context
      └ AuthGate          components/AuthGate.tsx
          ├ loading       spinner while the stored session is restored
          ├ no session    components/AuthScreen.tsx  — sign in / create account
          └ session       App.tsx — the studio, unchanged
```

There is **no router**, and adding one would be the wrong instinct: the app has exactly one page and
one gate in front of it. `AuthGate` is the whole routing story.

Three things worth knowing about the gate:

1. **The loading state is not decoration.** `getSession()` is async, so on first paint there is no
   session even for someone who is signed in. Rendering `AuthScreen` during that window flashes a
   login form at a signed-in user on every reload. The gate holds a spinner instead, and
   `loading` starts `false` when Supabase is unconfigured so the setup notice is immediate.

2. **`onAuthStateChange` is what actually swaps the screen.** `signIn` and `signUp` do not set
   state themselves; they let the listener do it, which means a sign-out in another tab lands here
   too. Do not add a `setSession` next to the calls — it is the path to two sources of truth.

3. **Sign-up may or may not return a session.** With *Confirm email* on in the Supabase dashboard it
   returns a user and no session, and nothing visible happens unless the form says why —
   `signUp` returns a boolean for exactly this, and `AuthScreen` turns `false` into the
   check-your-inbox notice. Turning that setting off in the dashboard silently changes the flow, so
   both paths have to keep working.

`lib/supabase.ts` builds the client lazily and exports `null` when either variable is missing,
because `createClient` throws on an empty URL and a blank screen is a worse answer than a page
naming the two variables to set. `friendlyMessage` in `lib/auth.tsx` rewrites the three Supabase
errors a person actually hits; everything else passes through verbatim rather than being flattened
into "something went wrong".

**Not implemented, and deliberately:** password reset and OAuth providers. Per-account storage *is*
implemented — that is what the section after next is about.

### Local mode

Added 2026-08-25, on request, so the app could be used before a Supabase project existed.

With `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` missing, `AuthProvider` reports
`mode: 'local'` and `userId: LOCAL_USER_ID` (`'local'`), `AuthGate` renders the studio without
looking at the session, and a banner across the top says accounts are off. That is the whole
mechanism. Everything downstream already degraded correctly — `useCloudCard` settles on status
`local` and skips every remote call, and `library.ts` guards each of its four remote paths on
`isSupabaseConfigured` — so nothing else had to change. The app is the pre-accounts app again.

Four things to know:

1. **There is no switch, and that is the point.** Nothing turns local mode on; it is what being
   unconfigured *means*. Fill in `.env.local` and the sign-in screen is back with no code to
   revert. If this is ever made into a real flag, that property is the one to keep — a flag left on
   is how an auth gate quietly stops existing.

2. **A credential-less production build is now an open editor**, not a locked door. Until
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are in the Vercel project,
   <https://nexocards.vercel.app> would deploy as an anonymous local-only studio rather than the
   setup notice it shows today. Nothing can leak — there is no account data and nothing reaches the
   network — but it is a different thing to publish, so it is open item 17.

3. **Work done in local mode does not migrate into an account.** It lives under
   `pnl-card-studio:v2:local` and IndexedDB records stamped `userId: 'local'`. `takeOrphanCard` and
   `claimOrphans` rescue the *pre-accounts* state (the bare key, records with no user), not this,
   and deliberately so: adopting `local` would hand one person's test card to whoever signs up
   first in a shared browser. Anyone testing should expect to redo their card once accounts are on.

4. **Read the owner off `userId`, never `user?.id`.** In local mode there is no `user` object at
   all. `ImagePicker` did read `user?.id ?? ''`, which made the whole media library silently
   inert — every `refresh` and `upload` returned early on the empty string, with no error anywhere.
   That is exactly the failure this mode invites, and `userId` on the context exists so it cannot
   happen again. It is now the only correct source in either mode.

---

## Persistence

Two things sync, by the same shape: **local-first with a reconciliation behind it.** The browser
keeps a full copy, paints from it on the first frame, and settles up with the account afterwards.
Nothing in the editor ever waits on the network. That is not an optimisation bolted on — it is why
the app still feels like the version that had no backend.

```
                 card                              media
  edit  -> localStorage now                  IndexedDB now, tile appears
        -> cards row after 900 ms idle       Storage upload in the background
  load  -> chooseCardVersion(local, remote)  manifest pull; bytes on first draw
  out   -> clearLocalCard(user)              purgeUser(user)
```

### The four files

| | |
|---|---|
| `lib/images.ts` | the IndexedDB **cache**. Was the whole library; is now one half. |
| `lib/remote/*.ts` | the raw Supabase calls, one file per table. |
| `lib/library.ts` | media as the app sees it. The only file that knows both halves exist. |
| `lib/useCloudCard.ts` | the card, merged against the account. |

### Five things to know before changing this

1. **A `MediaRecord` may have no `blob`.** That is what a file uploaded on another device looks like
   in this browser: metadata and a `storagePath`, no bytes. `ensureBlob` downloads it on first use
   and caches it. Any new code that reaches into a record's `blob` must handle its absence —
   `loadMedia` and `openVideoForExport` are the two that already do.

2. **`storagePath` is the upload flag, and the only one.** A local record that has one has been
   uploaded; one that has not, has not. Every reconciliation branch in `syncLibrary` reads that and
   nothing else. In particular it is what tells "deleted on another device" (has a path, absent from
   the manifest → delete locally) from "upload never landed" (no path → retry it). Getting those two
   the wrong way round deletes people's files, so leave that flag alone.

3. **`dirty` on the card snapshot is not redundant with `updatedAt`.** `updatedAt` only moves when a
   save *succeeds*, so a browser holding unsaved edits has a timestamp *behind* the server's.
   Comparing timestamps alone would read that as stale and discard the edits. `chooseCardVersion`
   checks `dirty` first for exactly this, and `useCloudCard.test.ts` sweeps every timestamp
   combination to pin it.

4. **Bytes are never pulled during sync.** `syncLibrary` writes metadata-only records and stops.
   Downloading eagerly would have someone signing in on a phone pull the whole library over cellular
   before a single tile appeared. The cost is that a background chosen elsewhere takes a moment to
   paint the first time — the right trade, but do not "fix" it by prefetching.

5. **Uploads do not block the picker.** `addMedia` resolves on the local write and pushes in the
   background, so a 40 MB clip can be positioned while it uploads. The window where a file exists
   here and not in the account is closed by `syncLibrary` on the next sign-in, which retries
   anything without a `storagePath`.

### Deletion order, both ways

Bytes before rows on the way in; rows after bytes on the way out. A `media` row is a promise that
the object exists, so it is written last and deleted last. The failure that leaves is an orphaned
object with no row — invisible, costs a little storage. The other order leaves a row pointing at
nothing, which the picker renders as a permanently broken tile. Postgres cannot reach into the
storage API, so no trigger can clean up after a half-failed delete; the client ordering is the whole
guarantee.

### What is deliberately not built

- **Merging.** Two devices editing at once is last-write-wins. Real merging needs per-field history
  and is a great deal of machinery for a single-user card editor.
- **Multiple cards.** The `cards` table is keyed per card and indexed `(user_id, updated_at desc)`,
  so a card list is a UI change and not a migration. Today's app resolves exactly one row.
- **Offline queueing beyond one card.** A failed save retries on the next edit and on the next
  sign-in. There is no durable outbox.

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
| Logo | x35 y34, slot 49 × 41, contain |
| Avatar | x35 y446, 54 × 54, **square, no corner radius** |
| Handle | ink x104, baseline 486 |
| Footer | icon x36 y521 23 × 15, ink x59, baseline 533 |
| Colours | accent `#2FE3AC`, text `#EAEDFF` / `#05070B`, on-accent picked from the accent |

Three values **deliberately differ** from the reference, all on request:

- **wordmark 34px** (reference 42px); tracking scaled with the size. This is the only remaining
  size deviation, and it is text rather than a picture — the logo and avatar were put *back* to the
  reference's sizes on 2026-08-25.
- avatar x35 (was 30.5) with square corners (was radius 12), so its left edge shares the accent
  block's and the title's. Handle at 104, holding the reference's 15px gap off it.
- footer at icon y521 / baseline 533, against the reference's 507/519. It has moved twice and the
  history matters, because both earlier values were wrong in opposite directions. The reference's
  507/519 left only 8 blank rows under the avatar and read as the footer being stuck to the handle
  with a dead band underneath. That was corrected to 542/554, giving 42 blank rows — exactly the gap
  above the avatar — which was arithmetically tidy but pushed the ink to y557 on a 570px card,
  leaving a 12px bottom margin against 35px on the left. On request the gap was then **halved**,
  moving the footer up 21px without touching the avatar, so the avatar/handle row and the footer
  read as one identity block. That also fixed the margin: the bottom comes out at 33px, near enough
  the 35px left margin to read as symmetric. All measured **off painted ink, not baselines**,
  because that is what the eye reads — verified bands as of 2026-08-25: last row 381–403, avatar
  446–**499**, footer 519–536, gaps 42 above the avatar and **19** below. The gap below was 21
  until the avatar grew two pixels to its reference size; the footer deliberately stayed put, since
  19 against 21 is not a difference the eye can find and the number that was requested was
  "half", not "exactly 21".

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

## Colour, ink and the two picture slots

Added 2026-08-25 on request: the pictures at the reference's own size, a white/black text switch,
cherry red, and a custom colour with an RGB picker. Four files carry it — `lib/color.ts` (new),
`lib/themes.ts`, `lib/canvas/spec.ts` and `lib/canvas/draw.ts` — plus the picker in `ui.tsx` and the
section in `ControlPanel.tsx`.

### The measurement that started it

The first pass measured the reference's picture slots with a luminance threshold, which loses a
pixel of the antialiased edge on each side. Re-measured by **half-coverage edges** — find the pixel
whose value sits halfway between the ground and the fill, and put the edge there — the reference
gives:

| | first pass | actual |
|---|---|---|
| logo ink | 47 × 38 at (36, 37) | 48.5 × 40.5 at (35, 34), slot **49 × 41** |
| avatar slot | 52 × 52 at (32, 446) | x30.5–85.0, y446.2–500.6, so **54.5 × 54.4** |
| handle ink → avatar gap | "16" | **15** (avatar ends x85, ink starts x100) |

All five reference cards agree on the avatar to within a tenth of a pixel. The logo had also been
grown ~35% on an earlier request, to 66 × 54; that is what pulled its optical centre to y64 while
the wordmark's stayed near y55, which is open item 1's complaint about the header. **Putting the
logo back at 49 × 41 closes that item** — the centre is 54 now.

If you re-measure, do it the same way. The script that produced the table above is four lines: read
the PNG, take a strip of rows through the flat part of an edge, and solve
`(value - ground) / (fill - ground)` for the boundary pixel's coverage. A threshold will hand you
the old numbers back.

### The one rule the tone switch has to obey

`display.textTone` is `'light' | 'dark'`, and it does **not** just change the ink. It changes three
things together, in `draw.ts`:

1. the ink for everything outside the block (`inkFor`),
2. the plain ground, which flips to `GROUND.light` (`groundFor`),
3. the artwork scrim, which veils toward near-white instead of near-black.

Change one without the others and you get a card that is merely ugly rather than obviously broken —
black text on the near-black ground is a blank card, and it will not look like a bug in a
screenshot, it will look like a rendering failure. The scrim is the subtle one: its slider means
"make the text readable", and over a photo that has to mean *lighten* when the ink is dark.

### Two places a colour is chosen rather than fixed

Both exist because the accent is no longer guaranteed to be light.

- **`readableOn(accent, dark, light)`** picks the hero value's ink from whichever of `PALETTE.onAccent`
  and `PALETTE.onAccentLight` has more contrast with the block. Cherry red is the first preset a
  fixed near-black would have swallowed. `color.test.ts` sweeps 4096 colours and asserts the result
  never drops below 3:1.
- **`ensureContrast(color, ground)`** lifts or darkens the accent **only where it is used as ink** —
  the percentage row. The block keeps the exact colour that was picked; that is the whole point of
  a custom colour. It walks away from the ground in 5% steps rather than jumping to black or white,
  so a colour that only just fails stays recognisably itself, and it returns its input untouched
  whenever it already passes, which is every preset on the dark card.

The floor is 3:1, WCAG's threshold for text at that size, not 4.5:1. A near-black custom accent on
the dark card therefore comes out legible but quiet — `#1B1F3B` becomes about `#5F6276`. That is
deliberate: pushing it to 4.5 would leave a colour the person did not choose.

### The custom slot is not in `THEMES`

`themeId: 'custom'` has no entry in the list; `customTheme(hex)` builds one from
`display.customAccent`. **Everything that draws must call `resolveTheme(display)`, never
`getTheme(id)`** — `getTheme('custom')` finds nothing and falls back to `THEMES[0]`, so the card
would silently paint mint. `themes.test.ts` pins exactly that.

Two deliberate asymmetries in the theme data:

- Cherry and the custom slot set `loss` equal to `accent`. Every other preset keeps the shared
  `#FF4D6D`. A card someone deliberately coloured red or purple flipping to pink on a bad month
  reads as a bug, not as a signal, and for cherry the red already carries the meaning.
- `customAccent` is stored even when the custom slot is not selected, so switching to a preset and
  back does not lose the colour.

### What this adds to the foreground-key contract

`textTone` and `customAccent` are both read by the foreground, so both are in `foregroundKey`.
`customAccent` is the interesting one: it is the only field that changes the card **without changing
`themeId`**, so a key that read the id alone would freeze a clip's entire foreground on whichever
colour was picked first. `draw.test.ts` has a case for it by name.

### How it was verified

`dev/colour-shot.html`, new, run in an isolated Chrome exactly the way `cadence-check.html` is run.
It does two things no unit test can:

- **Measures the slots by rendering into them.** A slot is not observable any other way. It uploads
  a 400 × 100 probe and a 100 × 400 probe as logo marks — a wide mark is limited by the slot's width
  and a tall one by its height, so the two together pin both numbers; a square probe reports only
  the smaller. Results on 2026-08-25: wide `{35, 48, 49, 13}`, tall `{35, 34, 10, 41}`, avatar
  `{35, 446, 54, 54}`, all matching `spec.ts`.
- **Samples the ground, the block fill, the hero ink and the title ink** across five
  colour/tone combinations, and posts a PNG of each so the numbers can be checked against a card
  someone actually looked at.

Two traps it hit first, both worth knowing before writing anything similar:

- **Do not find ink with a luminance threshold against one reference pixel.** The ground is a
  diagonal gradient, so a pixel sampled at the top right is the wrong ground colour at the top left
  by more than the tolerance, and the whole card reads as ink. The first run reported the logo box
  as `{0, 0, 233, 120}`. Render twice with the element on and off and **diff the bitmaps** — that is
  the technique the layout notes already recommend, and it is immune to the gradient.
- **Expectations have to allow for fractional geometry.** A 49-wide slot at 4:1 is 12.25px tall,
  centred on a fractional top, and touches 13 rows. Rounding the height first gives 12 and looks
  exactly like an off-by-one bug.

`dev/controls.html` is also new. It was written because the studio then sat behind the Supabase
gate and there was no way to reach a control without credentials — **local mode**, added later the
same day, has since made the real app reachable too, so this is now the narrower tool: just the
panel and a card, no topbar, no persistence, no library. It mounts the real `ControlPanel` against
local state with the real renderer beside it, wrapped in `AuthProvider` because `ImagePicker` calls
`useAuth` and throws outside one. Prefer `npm run dev` for anything involving saving or uploading;
prefer this for looking at a control in isolation.

Both dev pages had to be repointed at the post-accounts media API while doing this —
`addImage`/`listImages`/`deleteImage` became `addLocalMedia`/`listRecords`/`deleteRecord` and take a
user id. `layout-shot.html` had been silently broken since accounts landed. They both use the id
`dev-harness` so they never touch a real account's cache.

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

## The scroll trap in the editor shell

Fixed 2026-08-25 after a report that the page stopped scrolling partway down when the window was
about half a screen wide. It was two bugs wearing one coat, and both were `overscroll-behavior:
contain` on `.layout__controls`.

**Two columns (above 980px).** The controls column is a sticky, independently scrolling panel.
`contain` stops the wheel chaining to the page once that panel reaches its own end, so with the
pointer anywhere over the panel the window simply stopped. Measured: 25 wheel events over the panel
moved `window.scrollY` by 0 against an available 75.

**One column (980px and below).** The media query drops `position: sticky` and `max-height` but left
`overflow-y: auto` behind. An element with `overflow-y: auto` and *nothing to scroll* is still a
scroll container, and with `overscroll-behavior: contain` it swallows every wheel event that lands
on it rather than passing it up. Since the column is the full height of the controls at that width,
almost the whole page was covered by it. Measured: the page stopped at `scrollY` 300 out of 2722,
which is exactly the report — you reach the point where the column slides under the pointer, and
after that only the scrollbar works.

The fix is to drop `overscroll-behavior` entirely and to set `overflow-y: visible` in the
single-column query. `contain: layout paint` stays; that one is about painting, not about scroll
intent, and the comment that used to sit above both conflated them.

Two things to keep in mind if this area is touched again:

- **`overflow-y: auto` is not free when there is nothing to overflow.** It makes the element a
  scroller for event-routing purposes whatever its content height is. If a column only needs to
  scroll at some widths, turn the overflow *off* at the others rather than relying on the height.
- **Measure it with synthetic wheels, not by hand.** `Input.dispatchMouseEvent` with
  `type: 'mouseWheel'` at a chosen x/y, then read `window.scrollY` and the panel's `scrollTop`
  against `scrollHeight - clientHeight`. Hovering different regions by hand is how this survived as
  long as it did: over the stage everything looked fine.

`--topbar-h` was added at the same time. The controls column hangs off the topbar's height twice,
as its sticky offset and as the height it has left, and the two were separate hard-coded `67px`.

One known cosmetic edge, not worth code: in local mode the banner sits above the columns and is not
sticky, so at scroll position zero the controls column overhangs the viewport bottom by the banner's
height. It resolves the moment the banner scrolls away, and now that the wheel chains properly it
costs nothing.

---

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

1. **~~Symmetry.~~ Closed 2026-08-25.** The 2026-08-24 pass resolved the bottom-left corner: the
   avatar lines up with the accent block's left edge (x30.5 → x35, square corners) and the footer
   sits below it at half the gap above. The header half — the logo spanning y37–91 against a
   wordmark baseline of 70, optical centres 64 against 55 — is closed by the same change that put
   the logo back at the reference's 49 × 41: it now spans y34–75, centre 54, and the two line up
   the way they do on the reference cards. Nothing was done to the wordmark to achieve it.
2. **Loss state is unverified.** All five reference cards show a profit, so the red used for a
   negative result is an assumption, not a measurement. One value per theme in `themes.ts` — and
   note that cherry and the custom slot now opt out of it entirely, using their own accent for both
   directions.
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
8. **~~Nothing on this branch is merged.~~ Merged and deployed 2026-08-24.**
   `perf/render-loop-and-square-avatar` fast-forwarded into `main` at `c32359d` and pushed. Vercel
   rebuilt <https://nexocards.vercel.app> within about 15 s; the served bundle
   (`assets/index-Mnp3TRib.js`) is byte-identical to a local `npm run build` of that commit, SHA-256
   `18f85be6…e200c9`. Production therefore carries the render-loop rebuild, the square avatar and
   moved footer, and the judder fix.
9. **None of the Supabase work has been run against a live project.** Both auth screens render, the
   merge policy is unit-tested, the build is clean and the unconfigured path is verified — but no
   account has been created, no row written and no file uploaded, because there were no credentials
   to do it with. The checks that matter, in order: sign up and confirm; edit the card and watch the
   topbar reach *Saved*; upload a background and watch the tile's *Saving...* badge clear; reload
   and confirm both came back; sign in from a second browser and confirm the card and the tiles are
   there; delete a file and confirm it is gone from Storage as well as the picker.
10. **Deploying this needs two settings changed outside the repo, or production breaks.**
    `.env.local` is gitignored and Vercel does not read it, so <https://nexocards.vercel.app> has
    no accounts until `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are added to the project's
    environment variables **and it is redeployed** — Vite inlines them at build time, so an env
    change alone does nothing. Since 2026-08-25 the symptom of getting this wrong changed: it used
    to be a setup notice, and is now an open anonymous editor. See item 17. Separately, that origin has to be listed under
    Supabase's **Authentication → URL Configuration**, or confirmation emails link somewhere else.
11. **~~Accounts do not carry anything yet.~~ Done.** Cards and media are account-backed; see
    **Persistence**. It did end the "nothing is ever uploaded" property, and the README's privacy
    section was rewritten to say so rather than left quietly wrong.
12. **Nothing enforces the per-role file limits server-side.** `ROLE_LIMITS` is checked in the
    browser, and the browser is a bundle anyone can edit. A determined user could push past twelve
    backgrounds, or past the 80 MB clip cap up to the bucket's 100 MB. For a private tool that is
    fine; before this is public it wants a row-count policy or a trigger on `public.media`.
13. **Orphaned storage objects have no sweeper.** If a delete removes the object and then fails to
    remove the row, the next sync deletes the local copy and the row stays — pointing at nothing.
    The reverse (row gone, object left) just wastes space. Neither is currently detectable without
    querying both sides; a periodic reconciliation job is the fix if it ever matters.
14. **The wordmark is the last size still off the reference** — 34px against 42px, from an earlier
    request. The pictures went back to the reference's sizes on 2026-08-25 and it did not, because
    it is text and the request was about pictures. It is one number in `spec.ts`, and its tracking
    is scaled with the size, so putting it back means restoring `size: 42` and `tracking: 3.75`
    together. Ask before changing.
15. **A light card has never been checked over a real photo.** Every combination in
    `dev/colour-shot.html` renders on the plain ground, because a synthetic background proves
    nothing about how the lightened scrim reads over an actual image. The maths is symmetric with
    the dark path and the slider means the same thing, but if someone reports black text washing out
    on a bright photo, the scrim ramp in `drawBackground` is where to look — the stops are the dark
    path's, mirrored, and they may want different falloff.
16. **`ensureContrast` only ever sees the flat ground, never the artwork.** The percentage row is
    corrected against `GROUND.dark[1]` or `GROUND.light[1]`, which is right for a plain card and
    approximately right under a scrim, and wrong for a card with the scrim at zero over a busy
    photo. Sampling the actual pixels behind the row would fix it and would also cost a readback
    every frame; it has not been worth it.
17. **Local mode changes what a credential-less deploy is.** Covered under **Local mode** above and
    worth repeating here because it is the one item with a consequence outside the repo: with no
    environment variables set, a deployed build is now an open anonymous editor rather than a setup
    notice. Set the two variables in Vercel **before** the next deploy, or decide deliberately that
    an open editor is what should be published.

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
- **A driven Chrome can be screenshotted over CDP without the extension.** Launch the isolated
  instance with `--remote-debugging-port=9222`, read `http://127.0.0.1:9222/json/list`, and open the
  target's `webSocketDebuggerUrl` with node's global `WebSocket` — `Page.captureScreenshot` with
  `captureBeyondViewport: true`, and `Emulation.setDeviceMetricsOverride` first when the thing you
  want is taller than the window. This is how the control panel was verified. Note that a `clip`
  without `captureBeyondViewport` silently crops to the viewport and hands back a half-black image
  that looks like a rendering bug.
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
    color.ts             hex, luminance, contrast, readable ink         (tested)
    themes.ts            accents + the custom one                       (tested)
    fonts.ts             webfont readiness gate
    images.ts            IndexedDB media library (photos / clips / avatar / logo)
    supabase.ts          client, or null when the env vars are missing
    auth.tsx             session context + friendlier error strings
    render.ts            THE paint entry point, preview + export
    share.ts             PNG download / clipboard / Web Share
    video.ts             trim window + MediaRecorder export             (tested)
    selftest.ts          preview-vs-export pixel diff (dev only)
    canvas/
      spec.ts            measured geometry — change layout here, not in draw.ts
      placement.ts       cover fit, zoom, pan — shared by draw and drag  (tested)
      primitives.ts      ink-aligned text, tracking, cached metrics
      draw.ts            the card itself + foregroundKey                 (tested)
  components/
    AuthGate.tsx         session? studio : sign-in screen
    AuthScreen.tsx       registration + login form
    ...                  preview, controls, media picker, inputs
dev/
  cadence-check.html     browser harness: does the exported file judder?  (dev only)
  layout-shot.html       renders the card and scans ink bands to measure gaps (dev only)
  colour-shot.html       measures the picture slots and the colour rules  (dev only)
  controls.html/.tsx     the editor panel and a live card, with no account gate
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
playing, so it is worth the 34 cases. **Add a case there whenever you add a control that changes
anything above the background.**

`dev/colour-shot.html` is the equivalent for anything that changes a *colour* or a picture slot —
neither is observable without rendering. `dev/controls.html` is how the editor UI itself gets
looked at while the studio is behind the auth gate.
