# Handoff — PnL Card Studio

Written 2026-08-23, revised 2026-08-26. Repo: <https://github.com/Artem2103/PnL> (private), initial
commit `5216f81`. Working directory `D:\PnL`. Read `README.md` first for what the app *is*; this
file covers what a newcomer would otherwise have to rediscover.

Four passes have landed since the first release, and knowing which is which makes the rest of this
file easier to read:

| | what it was | where it is |
|---|---|---|
| 2026-08-24 | render-loop rebuild, square avatar, video judder fix | `a95983c`, `e3c48ee` → `main` |
| 2026-08-25 (a) | accounts: Supabase auth, per-account card and media | `62b4a5b` → `main` |
| 2026-08-25 (b) | reference-sized pictures, white/black text, cherry and custom colour | `c96f703` → `main` |
| 2026-08-25 (c) | local mode, and the scroll fix that came out of testing it | `f3d739d`, `45c4b95` → `main` |

All of it is on `main` and deployed. Most of what follows about the render loop and the recorder is
new in the first pass; **Authentication** and **Persistence** cover the second, **Colour, ink and
the two picture slots** the third, and **Local mode** and **The scroll trap in the editor shell**
the fourth.

---

## Start here (2026-09-14)

**Sound toggle on the preview, and a new sample card — on `main` and deployed** as `99ec233`; the
live bundle `assets/index-Bg7IcgZV.js` carries "Sound on" and "Save 10% off fees".

### Why uploads are not showing up in Supabase (2026-09-14)

**The live site is built without Supabase credentials, so it runs in local mode.** Every upload stays
in the visitor's IndexedDB and nothing reaches Storage or the `media` table. That is by design when
the variables are missing, not a failure.

The evidence: `ba1b9a2` (profile menu) was pushed, and Vercel built `assets/index-3fx-C-qc.js`. That
bundle has the profile menu in it but **not** the project ref `zwrpcaoestatmshuconp`, no
`*.supabase.co` project URL, and no key (publishable or legacy JWT). Vite replaces
`import.meta.env.VITE_*` at build time, so if the variables were visible to that build, they would
be in the file. The bundle before it (`index-Bg7IcgZV.js`, after Artem's manual redeploy) had none
either.

Common reasons, in the order to check them in Vercel → Project → *Settings → Environment Variables*:
1. **Wrong names.** They must be exactly `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Without
   the `VITE_` prefix, Vite does not expose them to the browser code.
2. **Wrong environment.** The checkbox for **Production** has to be ticked. Preview-only variables do
   not reach `nexocards.vercel.app`.
3. **Wrong project.** They were added to a different Vercel project or team than the one serving
   `nexocards.vercel.app`.
4. **Values.** The URL should be `https://zwrpcaoestatmshuconp.supabase.co`, with no quotes and no
   leading space. (A leading space would still work, since `supabase.ts` trims, but it is worth
   removing.)

After fixing them, redeploy **without** the build cache (*Deployments → ⋯ → Redeploy*, untick
*Use existing Build Cache*), or push any commit. Check the result: the live bundle should contain
`zwrpcaoestatmshuconp`, and the site should open on the sign-in screen, not the "Accounts are off"
banner.

**Where uploads appear once it works:** Supabase → *Storage → media*, one folder per user id, with
each file named by its media id (plus `<id>.poster` for video thumbnails). There is also one row per
file in *Table Editor → media*. Uploads made while the site was in local mode are **not** migrated.
They exist only in the browsers they were made in, and have to be uploaded again after signing in.

**One more limit to know about:** the bucket allows 100 MB, but Supabase's Free plan caps any single
upload at **50 MB** (*Project Settings → Storage → Upload file size limit*). Larger videos will
fail to upload, with a toast saying "Upload failed: …", even once accounts work. The app itself
accepts up to 80 MB.

### Profile menu (2026-09-14, later)

- **`src/components/ProfileMenu.tsx`** is a round blank-avatar button at the far right of the
  topbar; Reset now sits to its left. Clicking it opens a card with the avatar, name, email and
  **Log out**. It closes on an outside click or Escape. In local mode it says "Not signed in" and
  has no log-out button. It replaces the old email text and *Sign out* button.
- **Name:** sign-up has an optional *Name* field, stored as `user_metadata.display_name` on the
  auth user (no schema change, and the session already carries it). Accounts without a name show
  the part of the email before the @.
- **Blank avatar, redrawn:** the first version was lopsided. It used a 24-unit shape nudged down and
  scaled by CSS, so the circle cropped it unevenly. It is now drawn on a centred 40×40 viewBox, with
  shoulders that run off the bottom edge, filling its circle with no transforms. Checked in Chrome
  in both the button and the menu.
- **Topbar CSS:** `contain: layout paint` became `contain: layout`. Paint containment was clipping
  the menu to the height of the bar.
- **Uploads already go to the account.** When signed in, `addMedia` saves to IndexedDB first and
  then uploads to Storage and the `media` table. Uploads that fail are retried on the next sign-in.
  Deploys only keep pictures in the browser when they are built without the two `VITE_` variables —
  that is the case on Vercel right now.
- Checked in Chrome: the icon and menu (in local mode, on a second dev server with blank keys) and
  the Name field on the sign-up form (with the real keys). **The signed-in menu has not been seen**,
  because that needs a confirmed account.

### Accounts check (2026-09-14, after Artem added keys to `.env.local`)

- **Keys work.** Project `zwrpcaoestatmshuconp`; the new-style `sb_publishable_…` key is accepted
  (supabase-js 2.112.3). The space after `=` in `.env.local` is harmless: `supabase.ts` trims.
- **Schema is applied.** `profiles`, `cards`, `media` all answer `200 []` to the anon key, as RLS
  should. The storage bucket can't be seen without a session. It is created by the same script, so
  it should be there, but that is not confirmed.
- **Email sign-ups need confirmation** (`mailer_autoconfirm: false`), so registering sends an email.
  Supabase's built-in sender allows only a few emails an hour.
- A build using these keys switches into account mode (the project URL is baked into the bundle).
- **Deleting uploads already exists:** the ✕ on each tile in the background picker calls
  `deleteMedia`, which removes the Storage object, its poster and the `media` row, then the local
  copy. Uploads are per account and appear on every device the account signs in on.
- **Still to do for the live site:** add the two `VITE_` variables in Vercel and redeploy (step 7
  below). The Vercel CLI isn't installed here, so this has to be done in the dashboard.
- **Not yet tested end to end** (register → upload → reload → delete). Doing that needs a real
  inbox, because of email confirmation.

### Turning on accounts (register / login) — steps for Artem

The sign-up/sign-in screen, sessions and per-account syncing are **already built** (`AuthGate`,
`AuthScreen`, `src/lib/auth.tsx`, `supabase/schema.sql`). They switch on by themselves once two
environment variables exist. Checked 2026-09-14: the **live site has no Supabase credentials**, so
it currently runs in local mode — an open editor with no login. A `.env.local` exists on this
machine (contents not read).

1. **Create the project.** supabase.com → New project. Any name and region; save the database
   password somewhere.
2. **Create the tables.** Dashboard → *SQL Editor* → New query → paste the whole of
   `supabase/schema.sql` → *Run*. It makes `profiles`, `cards`, `media`, the private `media`
   storage bucket and the row-level security policies. Safe to run again.
3. **Copy the keys.** *Project Settings → API*: the **Project URL** and the **anon public** key.
   Never the `service_role` key.
4. **Local dev.** In `D:\PnL\.env.local`:
   ```
   VITE_SUPABASE_URL=https://<your-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon public key>
   ```
   Restart `npm run dev`. The "Accounts are off" banner is gone and the sign-in screen appears.
5. **Email settings.** *Authentication → Providers → Email*:
   - *Confirm email* **on**: after registering, the form says to check the inbox; sign in after
     clicking the link.
   - *Confirm email* **off**: registering signs you straight in. Easiest for testing.
   Supabase's built-in email sender is heavily rate-limited (a few emails an hour). For real users,
   set up custom SMTP under *Authentication → Emails → SMTP Settings*.
6. **Redirect URLs.** *Authentication → URL Configuration*: set *Site URL* to
   `https://nexocards.vercel.app` and add `http://localhost:5173` under *Redirect URLs*. Otherwise
   confirmation links bounce.
7. **Production.** Vercel → the project → *Settings → Environment Variables*: add the same two
   `VITE_` variables for Production (and Preview if wanted). Then *Deployments → ⋯ → Redeploy*.
   Vite bakes them in at build time, so an existing build will not pick them up.
8. **Test.** Register an account, edit the card, upload a background, sign out, sign in on another
   browser: the card and the media should be there. The topbar shows *Saved / Saving... / Not saved*.

Things to know: cards made in local mode do **not** move into a new account. Signing out clears
that browser's cached copy (the account keeps it). Security is the RLS policies in `schema.sql`,
not the secrecy of the anon key.

### What changed in `99ec233`

- **Sound on / Sound off** sits beside Play/Pause in the clip bar (video backgrounds only). It sets
  `muted` on the preview's own `<video>` inside `CardPreview`'s paint loop (`soundOn` prop, read
  through a ref like `playing`). Not saved: every visit starts silent, because browsers refuse to
  autoplay sound before a click anyway. A clip that leaves the card is re-muted as it is paused,
  since the library keeps it alive. The exporter records from its own element, so the toggle never
  changes an export — whether an export has audio is still the *Keep audio* checkbox.
- **Defaults** (`createDefaultState`): start and end balance both 10,000; wordmark empty (hidden);
  footer right reads "Save 10% off fees"; the pin frame starts white (`#FFFFFF`). Only new cards
  and *Reset* see this — saved cards keep their values. `DEFAULT_FRAME_COLOR` in `frames.ts` is
  deliberately still the reference red: the badge palette is fitted against it.
- Placeholders in *Identity* follow suit ("Empty hides it", "Save 10% off fees").
- Two tests in `content.test.ts` checked the reference strings through the old defaults; they now
  pass the reference balances (10,680 / 20,800) explicitly. Typecheck clean; `npm test` 180/180.
- **Not yet checked in a browser**: that the button actually unmutes the clip in the preview.

## Start here (2026-09-12, second pass)

**The avatar frame is now a choice, and the red badge takes any colour — on `main` and deployed**
as `cf080be`; <https://nexocards.vercel.app> rebuilt within a minute of the push and the live bundle
(`assets/index-DcjcOQKf.js`) carries the picker's `frame-swatch` class. Seven frames in a picker
under *Identity → Avatar frame*; the pin (the red badge from `reference/frame.png`, the default
and what every existing card keeps) gets a colour picker beneath the grid, the other six do not.
Requested as: make the red frame's colour changeable with the gradient working itself out from
one base colour; copy the frame the reference cards wear; add some of your own; let people choose,
with colour only on ours.

| id | what it is | colour |
|---|---|---|
| `none` | the picture fills the slot, square, as before 2026-09-11 | — |
| `pin` | the red badge, ring ramp and pip derived from one colour | **picker** |
| `tag` | the reference cards' own frame: tan ring, loop on top, traced off the cards | fixed |
| `gilt` | a bevelled gold ring | fixed |
| `halo` | a crisp ring with a soft glow | the card's accent |
| `stamp` | a perforated postage-stamp border | the card's ink |
| `corners` | four viewfinder brackets | the card's ink |

**How one colour becomes the whole badge.** `badgePalette` in `src/lib/frames.ts` describes every
measured stop of the reference badge — 32 around the ring, 5 across the pip's base, the tip's light
tone — as `base × keep + white × lift`, two numbers fitted by least squares against the reference
red once at module load. A new base colour gets the same 38 pairs applied to it, so its ring darkens
and lightens where the red one does. Two numbers rather than a plain mix toward black or white,
because the reference's light tones lose red on the way up — a one-number mix missed the pip's tip
by 26 levels; the pair lands within 14 on every stop, and the test in `frames.test.ts` holds that
bound. A white base comes out as a greyscale badge, a gold one as a gold badge; both are on the
sheet from `dev/frames-shot.html`.

**The tag.** Traced 2026-09-12 off the four reference cards averaged together — the same frame on
each, different artwork behind it, so the ground averages out. Ring 2.2px with a 1.55px gap of
ground showing through (the dark line around the reference picture is not a stroke), corner radius
6.8, picture corners 3.7; the loop is 16 wide, rises 20.7 above the ring, and is four nested
rounded rectangles — light, dark, light, dark fill — whose inner three close 1.5px above the ring
while the outer runs under it. The ring's colour is a 32-point walk like the badge's: tan almost
all round, lighter on the right, dark at the bottom-right corner, and a flat rose patch over the
bottom-left quarter that is on every card and so is the frame, not the artwork. All in
`SPEC.avatarTag` and `AVATAR_TAG`.

**Where things moved.** The badge code left `draw.ts` for `src/lib/canvas/avatarFrames.ts`, which
holds all seven behind one `drawAvatarFrame(ctx, x, y, size, style) → PictureSlot`; `drawHandle`
calls that and clips the picture into what comes back. The picker's tiles are painted by the same
function (`src/components/FramePicker.tsx`), so a tile is the export. `display.frameId` and
`display.frameColor` are new state; `hydrateState` fills them for old saves, `foregroundKey` reads
both (two new cases in `draw.test.ts`). No frame grows outside the 54.5px slot sideways or below —
the footprint sets the column and the handle gap — and only the pin and the tag rise above it, as
on the references.

Verified on a contact sheet of all seven plus four pin colours and two frames on the light card
(`dev/frames-shot.html`, new), and in the driven editor: seven tiles, clicking one changes
`frameId`, the colour picker appears for the pin only. Typecheck, build and all 180 unit tests
pass. Touches `src/types.ts`, `src/lib/defaults.ts`, `src/lib/frames.ts` (new),
`src/lib/frames.test.ts` (new), `src/lib/canvas/spec.ts`, `src/lib/canvas/avatarFrames.ts` (new),
`src/lib/canvas/draw.ts`, `src/lib/canvas/draw.test.ts`, `src/components/FramePicker.tsx` (new),
`src/components/ControlPanel.tsx`, `src/styles/global.css`, `dev/frames-shot.html` (new),
`README.md`.

## Start here (2026-09-12)

**The card's geometry now matches the five `monthly-calendar-pnl` reference cards item for item,
on `main` and deployed** as `b859ce1`; <https://nexocards.vercel.app> rebuilt within a minute of
the push and the live bundle (`assets/index-sBbAYwOV.js`) carries the new footer baseline
`519.5`, which no earlier build had. Measured from `reference/ourpnl.png` (a 3x export of the app's card) laid against them. The block,
the three stat rows and the hero value were already exact. Four things were not, and all four were
the deliberate departures earlier passes had made. Each is now back on the reference's number:

| element | was | now | reference |
|---|---|---|---|
| title | baseline 156, size 39.5 (ink y127-156) | baseline 158, size 40.5 (ink y128-158) | ink y128-158 |
| avatar | x35, 54 x 54 | x30.5, 54.5 x 54.5 | x30.5-85, y446-500.6 |
| handle | ink x104, baseline 486 | ink x100, baseline 488 | ink x100, lowercase on y488.5 |
| footer | icon y521, baseline 533, ink x59, 18px | globe 15 x 15 at (36, 507), baseline 519.5, ink x56, 18.3px | globe x36-51 y507-522, ink x56, y506-520 |

The globe's stroke also moved inside its box (`drawGlobeIcon`): it used to straddle the edge, so a
15px box painted 16.4px of ink. Nothing else on the card moved. The wordmark and logo were left
alone on request, since the references carry someone else's mark, and so was the avatar frame,
which is ours.

Verified with `dev/align-shot.html` (new): it renders the card with the references' own strings
over the plain ground at 3x, and the script that measured the reference measured the render.
Every ink box above lands within a pixel; the rows, block and hero value are unchanged and still
exact. The remaining differences are letterform, not position: the reference face is not Inter,
and its "@" sits two pixels higher over the baseline. Typecheck, build and all 172 unit tests pass.

**One thing to know before trusting the other instruments.** `layout-shot.html` and
`colour-shot.html` guarded against measuring in the fallback font with
`document.fonts.check('400 40px Inter')`, but neither page links the Google Fonts stylesheet
`index.html` does, and `fonts.check` answers *yes* for a family with no `@font-face` rule at all.
So both were measuring the fallback stack, about ten percent narrower than Inter, and saying it
was fine. Both now link the stylesheet and look for a loaded `Inter` face instead. Any width
measured with them before 2026-09-12 was taken in the wrong font; the vertical bands were barely
affected (the fallback's cap height is close), which is why the gap measurements in this file
still hold.

**Reverses two earlier requests, on request.** The avatar at x35 (2026-08-24) and the footer at
521/533 (2026-08-25, "halve the gap") were both asked for at the time; the ask on 2026-09-12 was
that the card match the references, and those were the differences. If the 5-row gap under the
avatar reads as cramped again, both old numbers are recorded in `spec.ts` next to the new ones.

Touches `src/lib/canvas/spec.ts`, `src/lib/canvas/draw.ts`, `dev/align-shot.html` (new),
`dev/layout-shot.html`, `dev/colour-shot.html`, `README.md`.

## Start here (2026-09-11, second pass)

**The freeze half a second into every exported video is fixed, on `main` and deployed** as
`5e843d1`; <https://nexocards.vercel.app> rebuilt within 30 s of the push and the live bundle
(`assets/index-BlLsLbV6.js`) holds `registerProcessor('pnl-tap'`, `isomiso2avc1mp41` and
`avc1.640028`, none of which existed before. Reported as *"at around 0.5 s of the beginning of the
video there is a lag, no matter the background video"*. Read
*The lag at 0.5 s, reported 2026-09-11* under **Background placement and video** — it is long,
because the cause turned out to be two causes, neither of them where the code was looking, and the
fix is a different recorder.

The short version:

- **What it was.** Two things froze the clip's decoder during the first second of every take, and
  the exporter had been built so that both landed inside the file. One call to
  `requestVideoFrameCallback` on the export's detached `<video>` freezes it for ~250 ms about 1.05 s
  later — the old warm-up play made exactly one such call, so the freeze fell 0.4 s into every file.
  And an encoder coming up (MediaRecorder's or WebCodecs', hardware) starves the same decoder for
  100–250 ms a quarter of a second after it is handed its first frame. The pause-and-seek-back
  warm-up, which the handoff below still describes as the fix for the sound offset, was not itself
  the cause; it was only where the first freeze was scheduled from.
- **What changed.** `src/lib/video.ts` no longer waits on `requestVideoFrameCallback` anywhere
  (`nextDecodedFrame` polls `currentTime`), no longer warms up by playing, pausing and seeking back,
  and no longer talks to `MediaRecorder` directly. It drives a `CardRecorder` from the new
  `src/lib/recorders.ts`: **`WebCodecsRecorder`** where the browser has `VideoEncoder` and
  `AudioEncoder` (Chrome, Edge — this machine), which pre-rolls the encoder on the still first frame
  before the clip plays, throws those frames away, forces a key frame on the first frame of the
  take, and writes a progressive MP4 itself through the new `src/lib/mp4write.ts` (H.264 High,
  AAC 192 kbit/s, key frame every 2 s, real durations, no repair needed); and **`MediaStreamRecorder`**
  as the fallback, which is the old MediaRecorder path with `repairFragmentedMp4` after it.
- **What was measured.** A new instrument, `dev/start-check.html`, exports a card over a clip whose
  every frame carries its own number in a pixel code, then reads the finished file frame by frame.
  Before: the picture held for 5–13 frames at 0.15–0.6 s and jumped to catch up, with 50–310 ms of
  silence in the sound at the same moment, in every one of ten runs. After: 179 of 179 source
  frames in order, no hold over two frames, sound from the first 10 ms with no gap, in four runs
  over both a fragmented and a progressive source; `dev/mp4-cadence.mjs` reads the file at 30.17
  fps with 2.5 ms jitter and no gap over one frame, against 5.5 ms before. The hidden-window pause
  was exercised too (window minimised for 3 s mid-take): all 359 frames of a 12 s clip in order,
  file 11.93 s.

Touches `src/lib/video.ts`, `src/lib/recorders.ts` (new), `src/lib/mp4write.ts` (new),
`src/lib/recorders.test.ts` and `src/lib/mp4write.test.ts` (new), `README.md`, `dev/start-check.html`
(new), `dev/flatten-mp4.js` (new), `dev/audio-check.html` (reads progressive files now). Typecheck,
build and all 172 unit tests pass. **The MediaRecorder fallback has not been run end to end in this
pass** — it is the previous code behind an interface, and every browser this was tested on took the
WebCodecs path; see open item 17.

On the other two asks — fps, quality, audio: the WebCodecs path records High profile instead of
Baseline at the same bitrate, sound at 192 kbit/s AAC instead of MediaRecorder's default, and frame
timing that is exact to the slot rather than sampled. Frame rate stays at 30: the clips people
upload are 30 fps, the card itself does not move, and 60 would double encode load for duplicated
frames. It is one constant (`VIDEO_FPS`) if a 60 fps source ever warrants it.

## Start here (2026-09-11)

**The red avatar badge from `reference/frame.png` is implemented, on `main` and deployed** as
`7620351`. Read *The avatar
badge, traced from a screenshot* under **How the layout was matched**. It touches
`src/lib/canvas/spec.ts`, `src/lib/canvas/draw.ts` and `src/lib/canvas/primitives.ts` (a new
`conicGradient`), plus `dev/frame-shot.html` (new). Typecheck, build and all 160 unit tests pass;
the badge was differenced against the reference in a driven Chrome and the card's ink bands were
re-scanned to prove the layout did not move.

The one judgement call in it: the badge **fills** the 54px avatar slot instead of wrapping it, so
the picture inside is 45.3 rather than 54. That keeps the avatar's left edge on the title's column
and the 15px gap to the handle intact. If wrapping is wanted instead, `avatar.size` is the only
number that has to change — every badge ratio is written over the frame's outer side.

## Start here (2026-09-10)

**Two more export bugs were reported later the same day and are fixed, on `main` and deployed** as
`82f2eea`. The sound in an exported MP4 ran ahead of the picture and
stopped early, players disagreed with each other about how long the file was, and the clip window
was capped at 15 s when the clip was 23 s. Read *The sound and the length, reported 2026-09-10
(second pass)* and *The clip window went from 15 s to 30 s* under **Background placement and video**.
The short version: `MediaRecorder` writes a fragmented MP4 that never states its own duration and
stamps a late-starting sound track as if it had started on time, so both are now repaired in the
container by `src/lib/mp4.ts`; the recorder is also primed before it starts so there is usually
nothing left to repair. Touches `src/lib/mp4.ts` (new), `src/lib/video.ts`, `src/lib/images.ts`,
`src/lib/defaults.ts`, `README.md`, plus `src/lib/mp4.test.ts` (new) and `dev/audio-check.html`
(new). Typecheck, build and 160 unit tests pass, and both fixes were measured in a driven Chrome.

**The earlier two export bugs from the same day are on `main` and pushed** as
`61195fb`. It touches
`src/lib/video.ts`, `src/lib/share.ts`, `src/lib/images.ts` and `src/App.tsx`, plus
`src/lib/share.test.ts` and two dev instruments. Typecheck, build and all 151 unit tests pass, and
both fixes were verified against the real UI in a driven Chrome. Vercel deploys from `main`, so the
site picks this up on its own — confirm the new build is live before assuming anyone else has it.
What was wrong and what changed:

- **"Recording failed when trying to export MP4"** and **"sharing doesn't work"** — read
  *The two export failures reported on 2026-09-10* under **Background placement and video**, then
  *Closing the resume seam* and *What was verified in the browser, 2026-09-10* directly after it.
  The short version: a browser does not decode video in a window that is behind another one, and
  three different code paths blamed the clip for it; and `navigator.share` on Windows can hang for
  ever, which left every export button disabled until a reload.

Everything described in this file is **on `main` and deployed**. There is no work sitting on a
branch — `avatar-badge` was merged fast-forward and can be deleted.
<https://nexocards.vercel.app> rebuilt on its own within a couple of minutes of each of the
three pushes: after the first the live bundle was `assets/index-sfzXDYKB.js` and held both new
strings, "has to be in front to record" and "share sheet never opened"; after the second it was
`assets/index-C6Q_ZLd8.js` and held `tfdt`, `moof` and `mvhd` from the new container repair, with
the clip cap inlined as 30 and the source cap as 120; after the badge it is
`assets/index-DoPk1HDM.js` and holds the ring's stop table verbatim
(`{offset:.3878,color:"#D7585C"}`) along with `baseBottomHalfWidth:14.58/87.4` and the two gradient
cache keys. Note that hash is **not** the one a local `npm run build` produces — Vercel bakes
different env into the bundle, so compare what the file contains, not what it is called. That is
what was actually checked, rather than trusting the dashboard.

One trap in checking it that way, found doing exactly this: **do not grep the bundle for a string
built from a constant.** "the card plays 30 s of it" is a template literal, so the bundle holds
`(the card plays ${xe} s of it)` and a search for the assembled sentence answers no on a deploy that
has perfectly well landed. Grep for a plain literal — a box type, an error message — or read the
constant out of the bundle (`grep -o "xe=[0-9]*"`).

Note the deployed bundle hash does **not** match a local `npm run build` (`index-bl-0MmQG.js` here).
That is not a mismatch worth chasing: Vite inlines `VITE_`-prefixed variables, and this machine's
`.env.local` is empty while the Vercel project's environment is whatever it is, so the two builds
differ by content. Grep the bundle for a string you just wrote; do not compare hashes.

**The app currently has no sign-in.** That is deliberate and was requested: there is still no
Supabase project to register against, so registration and login are paused until there is one. With
`VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` missing, the studio opens straight away and keeps
everything in the browser under the id `local`, with a banner across the top saying so. See **Local
mode** under *Authentication*. This is not a flag anyone has to remember to flip back: it is what
being unconfigured *means*, so filling in the two variables restores the sign-in screen by itself.

**The one thing outstanding is that accounts have never run against a live project.** Sign-up,
sign-in, and per-account storage of the card and its images are written, typechecked, built and
unit-tested, and the merge policy is covered by `useCloudCard.test.ts` — but no account has been
created, no row written and no file uploaded, because there have never been credentials. Nothing
below is a known bug; this is untested, not broken.

### Turning accounts on

1. Create a project at [supabase.com](https://supabase.com). In **SQL Editor → New query**, paste
   the whole of `supabase/schema.sql` and run it once.
2. Copy **Project Settings → API** into `.env.local`:
   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
3. `npm run dev`. The banner is gone and the sign-in screen is back — that alone confirms the
   variables are being read. Create an account. If **Authentication → Providers → Email → Confirm
   email** is on, you get a "check your inbox" message; turn it off to skip straight in while
   testing. Either way, add `http://localhost:5173` under **Authentication → URL Configuration**.

**Then check these six things, in this order.** They are the walkthrough, not a list of suspicions:

| | expected |
|---|---|
| sign up, then sign in | the studio opens |
| edit any field | topbar goes *Saving...* then *Saved* |
| upload a background | tile appears at once, *Saving...* badge clears |
| reload the page | card and images are still there |
| sign in from a second browser | same card, same tiles |
| delete an image | gone from the picker and from Storage |

Two things that will look like failures and are not. The card you made while accounts were off does
**not** come with you — it lives under the id `local` and is deliberately not adopted, so expect to
start from the sample card. And the first sign-in on a second browser paints tiles before their
bytes exist, because `syncLibrary` pulls the manifest and not the files; a background chosen
elsewhere takes a moment to appear the first time.

**If something fails**, the useful places to look: the browser console (upload and sync failures are
logged there rather than shown), the Supabase dashboard's **Table Editor** (is there a row in
`cards`? in `media`?) and **Storage → media** (are the bytes there?). A row with no object, or a
tile that never loads, means the upload half failed and the manifest half did not.

### Before the next deploy

Production has no environment variables, so it is running in local mode — an open, anonymous,
browser-only editor rather than a locked door. Nothing can leak, because there are no accounts and
nothing reaches the network, but it is a different thing to be publishing than a sign-in screen.

Once the six checks pass, add the same two variables to the **Vercel** project and redeploy. Vite
inlines them at build time, so setting them without a rebuild does nothing. Add the Vercel origin
to Supabase's **Authentication → URL Configuration** as well, or confirmation emails link somewhere
the app is not. Until both are done, every deploy of `main` republishes the open editor. That is
open item 10.

The rest of this file is background — how the pieces fit and why they are shaped that way. Read
**Authentication** and **Persistence** when you need to change them, not before.

---

## State

Working, and deployed. `npm run dev` → <http://localhost:5173>. Everything except the account round
trip has been exercised in a real browser; that one exception is open item 9.

```bash
npm install
npm run dev
npm test          # 172 tests, all passing
npm run typecheck
npm run build     # clean
```

The app renders one card format (840 × 570) matching the Axiom reference cards, exports PNG at
1×/2×/3×, exports MP4/WebM when the background is a clip, and can store everything either in the
browser alone or in a Supabase account.

`npm test` is 172 as of 2026-09-11 — the colour pass added `color.test.ts` and `themes.test.ts`
(144), the export passes added `mp4.test.ts` (160), and the recorder split added `mp4write.test.ts`
and `recorders.test.ts` (172).

**With no `.env.local`, `npm install && npm run dev` is the whole setup** and the studio opens with
no sign-in. That is local mode; see **Authentication**. Wiring up an account adds two steps that
are not `npm install`: run `supabase/schema.sql` in the SQL editor, and fill in `.env.local`. See
**Authentication** and **Persistence** below, and **Start here** for the order to do it in.

---

## Authentication

```
main.tsx
  └ AuthProvider          lib/auth.tsx     — one session, held in React context
      └ AuthGate          components/AuthGate.tsx
          ├ local mode    App.tsx — straight through, no session consulted
          ├ loading       spinner while the stored session is restored
          ├ no session    components/AuthScreen.tsx  — sign in / create account
          └ session       App.tsx — the studio, unchanged
```

There is **no router**, and adding one would be the wrong instinct: the app has exactly one page and
one gate in front of it. `AuthGate` is the whole routing story.

The first branch is checked before the other three and is decided entirely by whether the two
environment variables exist — see **Local mode**.

Three things worth knowing about the gate:

1. **The loading state is not decoration.** `getSession()` is async, so on first paint there is no
   session even for someone who is signed in. Rendering `AuthScreen` during that window flashes a
   login form at a signed-in user on every reload. The gate holds a spinner instead, and
   `loading` starts `false` when Supabase is unconfigured, so local mode opens the studio on the
   first frame rather than spinning for a session that is never coming.

2. **`onAuthStateChange` is what actually swaps the screen.** `signIn` and `signUp` do not set
   state themselves; they let the listener do it, which means a sign-out in another tab lands here
   too. Do not add a `setSession` next to the calls — it is the path to two sources of truth.

3. **Sign-up may or may not return a session.** With *Confirm email* on in the Supabase dashboard it
   returns a user and no session, and nothing visible happens unless the form says why —
   `signUp` returns a boolean for exactly this, and `AuthScreen` turns `false` into the
   check-your-inbox notice. Turning that setting off in the dashboard silently changes the flow, so
   both paths have to keep working.

`lib/supabase.ts` builds the client lazily and exports `null` when either variable is missing,
because `createClient` throws on an empty URL and every unconfigured path downstream keys off that
null rather than off a half-built client. `friendlyMessage` in `lib/auth.tsx` rewrites the three
Supabase errors a person actually hits; everything else passes through verbatim rather than being
flattened into "something went wrong".

One piece of `AuthScreen` is currently unreachable and was kept on purpose: the `configured ?
null : (...)` branch that renders the "Supabase is not configured" notice. Local mode means the
screen is never mounted while unconfigured, so that notice cannot appear — but the branch is three
lines, and deleting it would have to be undone by anyone who reintroduces a gate before
credentials. Do not read its presence as evidence the notice still shows.

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

2. **A credential-less production build is an open editor**, not a locked door — and that is what
   <https://nexocards.vercel.app> is serving right now, since the Vercel project has no environment
   variables. Nothing can leak: there are no accounts, no bucket and nothing reaches the network.
   But it is a different thing to be publishing than a sign-in screen, and every deploy of `main`
   republishes it. Open item 10.

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

### The avatar badge, traced from a screenshot (2026-09-11)

`reference/frame.png` is a 107 × 123 screenshot of a red badge — a rounded ring with a two-piece pip
above it — supplied as "the red frame that should be around the avatar", to be copied exactly. It is
now `SPEC.avatarFrame` plus `AVATAR_FRAME` in `spec.ts`, painted by `drawPin` in
`canvas/avatarFrames.ts` (it was `drawAvatarBadge` in `draw.ts` until the frames became a choice on
2026-09-12; the colours now come through `badgePalette` rather than straight from `AVATAR_FRAME`).

**It fills the existing 54px avatar slot rather than wrapping it.** The picture inside is 45.3.
Wrapping 54px of picture in the frame would have pushed the avatar's left edge to x30.7, off the
column it shares with the title and the accent block, and closed the 15px gap to the handle to 10.7
— both numbers this file spends paragraphs defending. Every ratio is written over the frame's outer
side, so if that call is ever reversed only `avatar.size` has to change. `layout-shot.html` confirms
the bands did not move: the avatar is still 446–499, the footer still 19 blank rows below it, the
bottom margin still 33. The pip lands at 430–444, in what used to be a 42-row gap.

Three things about the tracing are worth keeping, because each one was got wrong first:

1. **Measure by unmixing the red channel, not by thresholding.** The ground is blue at R≈45 and both
   of the badge's reds sit at R≈210–235, so red separates ink from ground almost regardless of which
   red it is. The first pass unmixed against a single assumed foreground, which reads every
   light-red edge as 82% covered and shrinks the shape being measured — it put the pip half a pixel
   short at both ends. The reference is soft-edged, so no single row is an edge; every number is a
   coverage sum across the whole soft edge, which a symmetric blur leaves alone.

2. **The ring's ramp follows the border path, not an axis across it.** Walked by arc length it runs
   dark → vivid → dark → vivid → light → vivid → dark in one lap, which no two-point linear gradient
   can produce — it fails on the second corner. It is stored as 32 samples converted to the angles a
   conic gradient wants. Arc length and angle are not the same parametrisation, so the stops are
   dense enough that the difference between them stops mattering; six stops at the measured turning
   points left the top edge up to 13 levels dark, and 32 brings the worst error under 5.

3. **Spec numbers are outer edges, so the base's outline is a second fill and not a stroke.** A
   stroke is centred on its path, so stroking the measured trapezoid put half the outline outside it
   and painted the shape 14% too big. Filling the measured trapezoid in the outline colour and an
   inset one in the fill colour puts the outer edge where it was measured. Insetting a trapezoid is
   not "subtract the width from each edge" either — the flanks lean, so the same perpendicular step
   moves them further sideways; `drawAvatarPip` takes that off the flanks' own slope.

The base's fill is also not flat: its right half carries a soft highlight peaking a little past
halfway out. A flat vivid fill made the first render read as a sticker beside the reference.

**How it was verified.** `dev/frame-shot.html` paints the badge alone at the reference's own scale
and offset, on the reference's own blue — any other ground and the diff reports the reference's
antialiased blends as errors. Against the reference the pip matches to 1% on area and 0.03px on
centroid, and the ring's gradient to a maximum of 9 levels on any channel (mean 4.4). What is left
is the reference's blur against a crisp vector render, which is not a defect to chase.

The badge reads no card state, so `foregroundKey` did not need a case. It is a fixed red on every
theme, which is what the reference shows; on the near-black ground the ring's dark quarter reads as
a shadowed bevel rather than the shadow it was on the reference's blue.

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
| Title | ink x35, baseline 158, 40.5px, tracking 0.6 |
| Avatar | x30.5 y446, 54.5 × 54.5, **square, no corner radius**, the red badge inside it |
| Handle | ink x100, baseline 488 |
| Footer | globe 15 × 15 at (36, 507), ink x56, baseline 519.5, 18.3px |
| Colours | accent `#2FE3AC`, text `#EAEDFF` / `#05070B`, on-accent picked from the accent |

One value **deliberately differs** from the reference, on request: **wordmark 34px** (reference
42px), tracking scaled with the size. It is text rather than a picture; the logo and avatar were
put *back* to the reference's sizes on 2026-08-25.

Two more used to, and their history matters because the same complaint may come back:

- **avatar x35 (2026-08-24 to 2026-09-12)**, so its left edge shared the accent block's and the
  title's, with the handle at x104 holding the reference's 15px gap. Back at the reference's x30.5
  and x100 since 2026-09-12, when the ask became that the card match the references item for item.
- **footer at icon y521 / baseline 533 (2026-08-25 to 2026-09-12)**, against the reference's
  507/519. The reference's row was first read as the footer being stuck to the handle with a dead
  band underneath, and was corrected to 542/554: 42 blank rows, exactly the gap above the avatar,
  which pushed the ink to y557 on a 570px card and left a 12px bottom margin. On request the gap
  was then halved to 521/533 (bottom margin 33px). On 2026-09-12 it went back to the reference's
  row, same request as the avatar. Ink bands now: last row 381-403, avatar 446-500, footer 506-522;
  42 blank rows above the avatar, 5 below it.

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

- **Make sure Inter is actually loaded before believing any width.** `ensureFonts()` gives up
  after 2.5 s and paints in the fallback stack, which is about ten percent narrower than Inter on
  this machine. A measurement taken in that window looks like a layout regression and is not one.
  And `document.fonts.check('400 40px Inter')` is **not** the way to make sure: a page that does
  not link the Google Fonts stylesheet has no `@font-face` for Inter, and `fonts.check` answers
  yes for any family it has no rule for. Link the stylesheet `index.html` uses and look for a
  `FontFace` whose family is `Inter` with `status === 'loaded'`; `dev/align-shot.html` shows the
  check. The measurements above were taken that way.
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

### The two export failures reported on 2026-09-10, and what they were

Both reproduced against the real UI in a driven Chrome, both caused by the same thing the earlier
verification passes had to disable flags to avoid: **a window that is not in front**. Chrome marks
a page hidden the moment another app covers it — a Zoom window is enough, it does not have to be a
background tab — and a hidden page does not decode `<video>` at all. `readyState` stays 0 and
stays there.

Three things followed from that, and all three lied about the cause:

1. **Picking a clip with the window covered removed the video UI.** `loadMedia` answered null, App
   read that as "no background", and the trim controls and the `Download MP4` button were simply not
   rendered. The export looked missing, not postponed. Fixed by reading the *record* first
   (`describeMedia`, no decoder involved) and letting the decode refine it: the record already knows
   it is a clip, and only the pixels have to wait.
2. **Exporting with the window covered waited 20 s and then blamed the clip** — `readVideoMetadata`
   timed out into "That video took too long to open. Try a shorter clip." Now `blockedByVisibility`
   refuses in the click handler, immediately, and says which window to bring forward. The timeout
   message itself also names the real cause when the page is hidden.
3. **Covering the window *during* a recording ruined the file.** It records in real time, so the
   frames for however long you were away were frozen — or the whole thing died on the deadline with
   "The clip stalled while recording". The recorder and the clip are now paused together on
   `visibilitychange` and resumed when the window comes back, with the deadline and the wall-clock
   tail both slid by the time away, and a `MAX_HIDDEN_SECONDS` cap so an abandoned export says so
   instead of hanging.

The first version of that pause left a **0.4 s gap at the join** — one long frame where the recorder
had been resumed but the decoder had not yet handed over a picture. That is fixed too; see the next
section for what caused it and what the file measures now.

### Closing the resume seam (the 0.4 s gap)

Pausing on hidden fixed the ruined file but left one visible stutter, and it is worth knowing why,
because the naive ordering is the obvious one and it is wrong.

Coming back, `video.play()` returns long before the decoder produces a frame — a few hundred
milliseconds on this machine. The first cut resumed the recorder immediately on `visibilitychange`,
so that warm-up was inside the recording: the last frame before the pause was held on screen until
the first new picture arrived, and the container recorded a single sample 418 ms long.

**The recorder must stay paused until there are fresh pixels to hand it.** A paused recorder
contributes nothing to the timeline, so the warm-up costs nothing instead of costing a frame. The
resume is now a small state machine — `phase: 'recording' | 'paused' | 'resuming'` — and the order
is exactly:

1. `video.play()`.
2. Wait for a genuinely decoded frame: `requestVideoFrameCallback` where it exists, a moving
   `currentTime` where it does not, and a 1.2 s guard so a clip that will not restart falls through
   to the deadline instead of hanging here.
3. Re-check visibility — the window can go away again during the warm-up, and resuming into one that
   is not there would start the whole problem over.
4. `renderToCanvas`, so the canvas holds the new frame *before* the recorder is running.
5. Slide `deadline` and `tailAt` by the whole gap, warm-up included.
6. Resume the audio context, then the recorder, then `requestFrame()` on the canvas track —
   otherwise `captureStream` waits for its own next sampling instant, which is up to another frame
   of dead time at the join.

Going the other way, the recorder is paused **before** the video: anything painted between the two
would be encoded as part of the pause.

`tick` paints only in `'recording'`, so nothing is captured while the export is held, and the
`MAX_HIDDEN_SECONDS` cap applies to `'paused'` only — a resume in progress is not an abandoned one.

### What was verified in the browser, 2026-09-10

Driven Chrome, real UI, real `Download MP4` button, 8 s synthetic clip, frame durations read out of
each finished file with `dev/mp4-cadence.mjs`. Runs marked *minimised* had the window minimised
2 s in and restored 5 s later — the machine was in a video call throughout, which is the ambient
load these numbers carry.

| run | frames | length | fps | jitter (sd) | worst gap | gaps > 200 ms |
|---|---|---|---|---|---|---|
| window in front | 238 | 7.960 s | 29.90 | 7.66 ms | 60.1 ms | 0 |
| window in front | 239 | 7.986 s | 29.93 | 9.05 ms | 56.1 ms | 0 |
| **minimised 5 s** | 235 | 7.945 s | 29.58 | 9.39 ms | 73.5 ms | 0 |
| **minimised 5 s** | 238 | 7.952 s | 29.93 | 8.36 ms | 69.1 ms | 0 |
| **minimised 5 s** | 231 | 7.948 s | 29.06 | 11.09 ms | 87.9 ms | 0 |

An interrupted export is now within a frame of an uninterrupted one: the seam costs about 30 ms over
baseline, against 418 ms before, and nothing in any file exceeds 200 ms. Length is right in every
case — 7.95 s for an 8 s window, short by the recorder's start/stop latency, as open item 6 records.

Two cautions on reading this table:

- **The first export after a page load is the worst one.** A run taken straight after a reload
  measured 27.13 fps, sd 18.8 ms, worst gap 143.8 ms, on an uninterrupted window — cold decoder and
  a cold foreground-layer cache, not a regression. Warm runs are the ones above. Discard the first.
- **The residual ~56–60 ms baseline gap is the machine, not the code.** The quiet-machine number
  from 2026-08-24 was 44.1 ms. Two frame intervals under load is ambient jitter.

**Sharing hung forever.** `navigator.share` is allowed never to settle, and in Chrome on Windows it
does exactly that when the sheet cannot open — an unfocused window is enough. No sheet, no resolve,
no reject. `handleShare`'s `finally` never ran, so `busy` stayed `'share'` and *every* export button
stayed disabled until a reload; the button read "Sharing…" indefinitely. Reproduced twice. The call
is now raced against a 12 s timeout, and `shareCard` returns an outcome
(`shared`/`cancelled`/`unsupported`/`pending`/`timeout`) rather than a boolean — the boolean was why
a sheet that never opened was reported as "Sharing was cancelled.", which is the one thing that
definitely had not happened. `shareMessage()` holds the wording and is unit-tested.

A share left pending is pending for the life of the page: `sharePending` stays set and later clicks
answer `'pending'`, because `navigator.share` would only throw `InvalidStateError` at them anyway.
That is correct, and the message points at Download PNG.

### The sound and the length, reported 2026-09-10 (second pass)

Reported after the first pass shipped: *"the sound after the first few seconds is DONE, it's
lagging, it's delayed... the video is 11 seconds, I need it to be full 23 seconds."* Three
complaints, two causes, and neither is in the frames — the picture measured clean in the very same
files.

**What the file actually said.** `7d-realized-pnl.mp4`, the export that prompted the report, read
with the box walk from `dev/mp4-cadence.mjs` extended to both tracks:

| | |
|---|---|
| `mvhd` duration | **0** — the file does not state its own length |
| `tkhd` / `mdhd` durations | 0.111 s and 0.042 s, which are not durations at all |
| picture | 452 samples, 15.055 s, 30.02 fps, sd 10.8 ms, no gap over 200 ms |
| sound | 643 AAC frames, **13.707 s** |

So "11 seconds" was never a claim about the frames. Chrome writes a **fragmented** MP4 as it
records: the header is emitted before a single frame exists and nothing ever goes back to fill the
durations in. Every player is left to estimate, and they estimate differently — hence a 15.06 s file
opening as an 11 s one and stopping there.

**And the sound was 1.348 s short — all of it at the front.** Walking the fragments is what settles
that, because a late start and a lost tail look identical in the totals:

| fragment | picture | sound |
|---|---|---|
| 1 | 0 → 3.340 | 0 → **2.004** |
| 2 | 3.346 → 6.708 | 2.005 → 5.373 |
| 3 | 6.714 → 10.077 | 5.376 → 8.723 |
| 4 | 10.079 → 13.437 | 8.725 → 12.093 |
| 5 | 13.441 → 15.073 | 12.096 → 13.716 |

The whole deficit is in fragment 1; from fragment 2 on both tracks advance by the same amount. The
sound started 1.348 s after the picture, the muxer stamped both tracks from zero regardless, and the
result is sound that runs *ahead* of the picture by a constant 1.35 s for the entire file and stops
early. That is exactly "delayed, lagging, and done after the first few seconds".

It is a race, not a constant: the same walk over `august-2026-pnl.mp4` from 2026-08-24 shows a first
fragment holding one frame of each and the two tracks within 20 ms of each other for the rest of the
file. Nothing in the audio path changed between those two builds. It is timing, so it is not
something a reading of the code would have found.

**Both faults are fixed after recording, in the container.** `src/lib/mp4.ts` —
`repairFragmentedMp4` — writes the measured durations into `mvhd`, `tkhd` and `mdhd`, and adds the
shortfall to every audio `tfdt` so the sound sits back under the picture it belongs to. No box
changes size, so it is a handful of in-place stores rather than a remux, and anything that does not
parse exactly as expected is handed back untouched. `VideoExportResult.duration` is now measured
from the finished file rather than assumed from the window, so the toast states what the file holds.

Two guards on the shift, both in the file: below 0.05 s the tracks are as aligned as a real-time
recorder gets, and above 10 s the file is broken in some way this code has not seen and inventing
ten seconds of silence would make it worse. `src/lib/mp4.test.ts` builds fragmented MP4s by hand and
covers both, plus the no-sound case, a WebM, and a truncated file.

**The race is also narrowed at the source, so the repair usually has nothing to move.** Two changes
in `renderCardVideo`:

- The clip now runs for `PRIME_MS` (500 ms) and is then paused, seeked back and played again before
  `recorder.start()`. `play()` resolves well before either decoder is delivering, and whatever is
  not delivering when recording begins is simply missing from the front of that track.
- `attachAudio` connects a `ConstantSourceNode` at 1e-5 into the stream destination. A destination
  whose only input is an element that has not started decoding has nothing to hand anyone; a source
  that is always running keeps the track live from the moment it exists. -100 dBFS is a third of a
  bit at 16 bits.

**Verified in a driven Chrome**, real `renderCardVideo`, over a real 12 s clip with real sound —
`dev/audio-check.html`, which is the instrument for this the way `dev/cadence-check.html` is the one
for cadence (that one records with `muteAudio: true` and has never had an opinion about sound):

| | before, 15 s export | after, 12 s export | after, 20 s export |
|---|---|---|---|
| file states its length | no (`mvhd` 0) | **yes — 12.048 s** | **yes — 19.969 s** |
| `<video>` reports | guesswork | 12.126 s | 20.002 s |
| picture | 15.055 s from 0 | 12.048 s from 0 | 19.969 s from 0 |
| sound | 13.707 s from 0 — **1.348 s adrift** | 11.978 s from 0.070 s | 19.953 s from 0 |
| lead the recorder lost | 1.348 s | 0.070 s | **0.016 s** |

The 20 s run is the interesting one twice over: it is past the old 15 s ceiling, so it also confirms
the cap change end to end, and the recorder lost 16 ms — under the repair's 0.05 s floor, so nothing
was moved at all and the tracks came out aligned on their own. The 70 ms on the 12 s run was still
moved, and the two tracks then ended within 1 ms of each other. Against 1.348 s before, either is a
different order of problem.

Frame cadence was re-measured with `dev/cadence-check.html` after the change and is unaffected:
29.85 fps, sd 4.24 ms, 91.1 % on cadence, against a control of 28.94 fps and sd 13.82 ms.

`dev/audio-check.html` needs a clip with sound at `dev/sample-clip.mp4`. That path is gitignored on
purpose — someone else's clip is not this project's to redistribute — so drop any MP4 there before
running it.

### The lag at 0.5 s, reported 2026-09-11

*"At around 0.5 s of the beginning of the video there is a lag, no matter the background video."*
It was real, it was in every file, and nothing in the two sections above would have found it: the
cadence harness deliberately measures 2–5 s of its window, and the sound harness reads totals.
Sample durations in the container were fine. What froze was the **content** — the canvas kept being
repainted and the recorder kept sampling it, but the frame the `<video>` handed `drawImage` did not
change for a quarter of a second, and then jumped.

**The instrument, first, because everything below came out of it.** `dev/start-check.html` records
a synthetic clip whose every frame carries its own frame number as a 12-bit black-and-white code in
the top-right corner (past the scrim's last stop, so the card leaves it alone), exports a card over
it through the real `renderCardVideo`, and then reads the finished file three ways: the container
(every sample duration, both tracks), the picture (the file is *seeked* frame by frame and the code
read back — seeking cannot drop a frame the way playback can), and the sound (decoded, and its level
read in 10 ms windows). A held frame is the code not advancing; a jump is it advancing by more than
one; a hole in the sound is a run of silent windows. The same read is done on the source over the
window the card used, so the source's own defects can be told from the exporter's — and the
synthetic source *has* defects: MediaRecorder's own start-up freeze sits in its first two seconds,
which is why the default window starts at 3 s and why a `clipStart` under 2 s in that harness
measures the source, not the exporter.

**What the shipping export looked like**, ten runs, both a fragmented and a progressive
(`?flat=1`, through `dev/flatten-mp4.js`) source:

| | |
|---|---|
| picture | code held for 5–13 frames beginning at 0.15–0.4 s, then jumps of 3–5 to catch up; a second hold of 3–8 frames at ~1.0 s |
| sound | 50–310 ms of digital silence (not the −100 dBFS keep-alive floor: zeros) starting at 0.23–0.32 s, i.e. under the picture hold |
| container | clean — no sample over 60 ms in the first second |
| Chrome's own media log (CDP `Media` domain) | nothing: no buffering change, no decoder change, no underflow |

Both picture and sound stopping while the clock ran on — frames then dropped to catch up — with the
pipeline logging nothing, means the pipeline was being held from outside. The rest was finding by
what.

**Pulling the start apart.** The harness runs a set of *controls* before the export: a bare
`<video>` on the same clip and a canvas, the code read on every animation frame, while one thing is
done to it. Twenty-odd of these, one variable at a time, gave the following, and the interesting
part is that the first answer was wrong:

1. The shipping sequence (play 0.5 s, pause, seek back, play) held for ~230 ms at 0.37 s after the
   second play, every run. A cold start (one seek, one play) never did. A rest of ≥ 400 ms paused
   after the seek-back made it clean; 200 ms did not. *So: the seek-back.* Except that a pause with
   no seek at all stalled too, and so did a seek while playing, and so did a rate change — and a
   rest hid all of them. Something was being scheduled, not caused.
2. Lining up every stalled run against the one call they shared: **`requestVideoFrameCallback`.**
   Every sequence that stalled had called it ~1.05 s before the stall; every clean one had not,
   including the rests (the stall fell inside them). `rvfc-only` — one call right after play, nothing
   else, no recorder — freezes the clip 263 ms at 1.07 s. `rvfc-late` — the same call 2 s into
   playback — freezes it at 3.12 s. The freeze follows the call. This is on a detached element; the
   preview, whose element is in the document, uses it per frame and has never shown this. The old
   warm-up used it once, right after its first play; the seek-back put the take's zero 0.65 s later;
   1.05 − 0.65 ≈ 0.4 s into every file.
3. With that removed a second, smaller beat remained: 100–250 ms, 0.25–0.4 s after a recorder
   starts. MediaRecorder or WebCodecs, MP4 or WebM, with or without audio, full size or quarter
   size — but *not* with a software H.264 encoder, and not if the recorder starts once the clip has
   been playing for 0.6 s or more. It is the hardware encoder coming up in the GPU process and
   starving the hardware decoder next to it. A throwaway recorder beforehand does not remove it
   (the real one still pays ~120 ms). Starting the recorder on the still frame *before* the clip
   plays, paused, and resuming at the take, removes it entirely (`preroll-*`: clean, zero dropped
   frames, seven runs) — for MediaRecorder at the cost of the pre-roll frames being in the file,
   a third of a second of still at the front, and with a further trap: pause it before its encoder
   is up and the pause leaks (frames drawn during it are encoded, the timeline shifts, the whole
   take stutters). WebCodecs has no such cost: pre-roll chunks are simply not written, and the
   first frame of the take is asked to be a key frame.

**So the fix is a different recorder**, and `renderCardVideo` now drives an interface,
`CardRecorder` in `src/lib/recorders.ts`, with two implementations:

- **`WebCodecsRecorder`** — `VideoEncoder` (H.264 High at level 4.0, falling to Main or Baseline
  if the machine's encoder will not, `latencyMode: 'realtime'`, variable bitrate at the same budget
  as before) and `AudioEncoder` (AAC-LC, 192 kbit/s) fed from an `AudioWorklet` tap spliced into the
  same `attachAudio` graph (element → source → tap → stream destination). `preroll()` encodes the
  still canvas at 30 fps until the encoder has produced output (or 1.5 s, in which case it answers
  false and the exporter falls back before the take). `begin()` marks the take's zero; `frame()` is
  called after every paint and takes at most one frame per 1/30 s slot, stamped on the slot grid;
  pre-roll frames sit below the take's zero and their chunks are dropped. `pause`/`resume` shift
  both clocks by the time away and force a key frame at the join. `finish()` flushes (bounded to
  5 s) and hands the chunks to `writeMp4`.
- **`MediaStreamRecorder`** — the old path: `MediaRecorder` on `captureStream`, started at the take,
  `repairFragmentedMp4` after. It cannot pre-roll without polluting the file, so it still pays the
  encoder's start-up freeze; it is what a browser without WebCodecs gets.

`src/lib/mp4write.ts` writes the WebCodecs output as a **progressive MP4** — `ftyp`, one `moov` with
full tables, one `mdat` with the tracks interleaved sample by sample: `avc1` + the encoder's `avcC`,
`mp4a` + an `esds` around its AudioSpecificConfig, `stts` from the slot timestamps (a held frame
keeps its real length), `stss` from the key frames, `ctts` version 1 only if the encoder ever
reordered (it does not, in realtime mode), and an `elst` empty edit for whichever track starts
after the other. Durations are real, so nothing is repaired and `VideoExportResult.duration` is the
file's. Unit-tested by parsing what it writes back (`mp4write.test.ts`).

**Two WebCodecs traps met on the way, both fatal to the export and both now avoided:**

- **Negative timestamps hang the hardware encoder.** The first pre-roll used timestamps below zero
  so the take could start at zero; the encoder produced five frames, queued thirteen, and its
  `flush()` never resolved — the export sat forever. Pre-roll frames are now at 0, 33 ms, 66 ms …
  and the take begins one empty slot after them; the muxer takes the take's first timestamp as
  the movie's zero.
- **`latencyMode: 'quality'` does the same.** Same symptom, same hang. `realtime` is what the
  canvas is anyway, and it is what was measured clean.

Both are also guarded: `preroll()` refuses an encoder that has produced nothing after 1.5 s, and
`finish()` gives up waiting on a flush after 5 s and writes what it has.

**Verified**, driven Chrome 152 on this machine, isolated profile, fresh profile per run:

| | before (shipping) | after (WebCodecs) |
|---|---|---|
| source frames in order, first 3 s | held 5–13 frames at 0.15–0.6 s, jumps of 3–5 | **179/179, no hold over 2 frames** (4 runs, both source shapes) |
| sound, first 3 s | 50–310 ms of zeros at ~0.25 s | **onset ≤ 10 ms, no gaps** |
| `dev/mp4-cadence.mjs` on the file | 29.85 fps, 5.5 ms jitter | **30.17 fps, 2.5 ms jitter, longest gap 33.3 ms** |
| file | fragmented, `mvhd` 0 until repaired | progressive, 5.995 s stated, key frames at 1, 61, 121 |
| window minimised 3 s mid-take, 12 s clip | not re-measured | 359/359 frames in order, 11.93 s; one 5-frame hold at the join |
| wall time, 6 s clip | 7.1 s | 6.85 s |

The one residual is at the hidden-window join: after the window comes back the decoder takes a few
frames to flow again, and the recorder resumes on the first moving `currentTime`, so the join shows a
~170 ms hold and a catch-up jump. The old path had the same, measured only by cadence. Waiting longer
before resuming would trade the hold for a skip in the footage; neither is better, and it only
happens when someone hides the window during an export. Left as is, noted in open item 17.

**What this changes for the other sections above.** *The sound and the length* still describes the
MediaRecorder path faithfully and that path is still there as the fallback, but on any browser with
WebCodecs none of it runs: there is no fragmented file, nothing to repair, and the "prime" it
describes as narrowing the race no longer exists. The two traps in *Four traps that cost time here*
about the audio context and about painting faster than the sampler still apply to both paths.

### The clip window went from 15 s to 30 s

`MAX_CLIP_SECONDS` in `src/lib/images.ts` is now 30. The Length slider, the upload hint and the
"clip is too long" message all read that constant, so they moved with it; `MAX_SOURCE_SECONDS` is
still 120.

The part worth knowing is the migration. 15 was both the ceiling *and* the default, so a card with
`clipLength: 15` saved against the old build does not mean "fifteen seconds, chosen" — it means "all
of it", written down while the ceiling was there. `hydrateState` carries exactly that value up to
the new ceiling and leaves every other value alone, so a 23 s clip plays its full 23 s without
anyone touching the slider, and someone who deliberately picked 6 s still gets 6 s. `resolveClip`
still trims to what the clip actually holds, so a shorter clip is unaffected either way.

A 30 s export takes 30 s of real time and needs the window in front for all of it. The pause/resume
machinery from the first pass covers a window that goes away; `MAX_HIDDEN_SECONDS` is unchanged.

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
6. **~~The exported file's length is right.~~ Half of this was wrong, and was fixed 2026-09-10.**
   The *frames* were right all along — a 3.0 s window produces 2.971 s of frame durations, a hair
   short by the recorder's start/stop latency, and that part still stands. What was never checked is
   that the file **did not state its length at all**: `mvhd` was zero, so every player estimated, and
   one of them called a 15.06 s export 11 s. `repairFragmentedMp4` writes the measured duration in.
   Reading a container for frame cadence is not the same as reading it for duration; this note is
   the reminder that it was measured one way and assumed the other.
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
   moved footer, and the judder fix. Everything since has been deployed the same way and checked the
   same way — most recently `1658528` on 2026-08-25, served as `assets/index-6NyeXdXR.js`, SHA-256
   `232eee72…9203`.
9. **None of the Supabase work has been run against a live project.** Both auth screens render, the
   merge policy is unit-tested, the build is clean and the unconfigured path is verified — but no
   account has been created, no row written and no file uploaded, because there were no credentials
   to do it with. **This is the only open item that is work rather than a note.** The walkthrough is
   in **Start here**; the short version is sign up and confirm, edit the card and watch the topbar
   reach *Saved*, upload a background and watch the tile's *Saving...* badge clear, reload and
   confirm both came back, sign in from a second browser and confirm the card and the tiles are
   there, delete a file and confirm it is gone from Storage as well as the picker. Note that until
   the two variables are set you cannot even reach the sign-in screen — local mode opens the studio
   instead — so step one is always `.env.local`.
10. **Production is an open editor until two variables are set in Vercel.** `.env.local` is
    gitignored and Vercel does not read it, so <https://nexocards.vercel.app> has no accounts —
    which since local mode landed means an anonymous browser-only studio rather than the setup
    notice it used to show. Nothing can leak, because there are no accounts and nothing reaches the
    network, but it is a different thing to be publishing, and **every deploy of `main` republishes
    it**. Fixing it needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the project's
    environment variables **and a redeploy** — Vite inlines them at build time, so an env change
    alone does nothing. The Vercel origin also has to be listed under Supabase's
    **Authentication → URL Configuration**, or confirmation emails link somewhere the app is not.
    Close this at the same time as item 9.
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

---

17. **The video export has two recorders and only one has been run since the split (2026-09-11).**
    `WebCodecsRecorder` is what every browser tested here takes and is what *The lag at 0.5 s*
    measures. `MediaStreamRecorder` is the old MediaRecorder path moved behind the `CardRecorder`
    interface unchanged — start at the take, repair the container after — and has not been driven
    end to end since; a browser without `VideoEncoder`/`AudioEncoder` (older Safari, Firefox before
    130) is where it would run, and where it would still show the encoder's start-up freeze at
    ~0.3 s, because MediaRecorder cannot pre-roll without writing the pre-roll into the file.
    Three smaller notes under the same heading: the hidden-window join still costs a ~170 ms hold
    and a catch-up jump while the decoder gets going again (measured; see the end of that section);
    the preview loop still uses `requestVideoFrameCallback` on its in-document element, which has
    never shown the detached-element freeze but has not been looked at with the same instrument;
    and `dev/start-check.html` cannot measure a `clipStart` under 2 s without measuring the
    synthetic source's own start-up freeze — a source written through `mp4write.ts` from WebCodecs
    would fix that, and would be the first use of the writer outside the exporter.

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
- **`dev/mp4-cadence.mjs <file.mp4>`** reads frames, length, fps, jitter and worst gap out of a
  finished export, from the command line — the same container reader as `cadence-check.html`,
  without the browser. This is how the pause-on-hidden fix was measured; reach for it before
  believing anything about a file from watching it play.
- **`dev/audio-check.html`** is the sound half of the same idea, added 2026-09-10: it exports a card
  over a real clip with `muteAudio: false` and reports what the finished file says about itself —
  the durations in the container, where each track starts, and what a `<video>` element makes of it.
  `cadence-check.html` records with `muteAudio: true`, so it never had an opinion about any of this,
  which is how a 1.35 s sound offset survived two passes of "verified in the browser". It needs a
  clip with sound at `dev/sample-clip.mp4`; that path is gitignored, so drop one there first.
- **`dev/app-probe.mjs "<expression>" [--gesture] [--nowait]`** evaluates an expression in the
  driven Chrome over CDP (port 9223). `--gesture` sets `userGesture: true`, which is what lets the
  real buttons be pressed the way a person presses them — `navigator.share`, autoplay and the
  download anchor all behave differently without it. This is how both 2026-09-10 bugs were
  reproduced against the shipping UI rather than against a harness.
  - Two traps, both of which cost a run here: **match picker tiles by label, not by index** (an
    index-based click landed on a tile's `×` and deleted the test clip), and **`Get-ChildItem
    -Filter "*-pnl.mp4"` does not match `name (4).mp4`** — a successful export looked like a failed
    one twice before that was noticed.
- **`dev/cadence-check.html` called `images.addImage`/`deleteImage`**, which the accounts commit
  renamed to `addLocalMedia(file, role, userId)` and `deleteRecord(id)`. Fixed 2026-09-10; the
  harness had been dead since `62b4a5b` and would have failed on its first line of real work.
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

- **`dev/start-check.html` is the instrument for anything at the start of an export**, added
  2026-09-11, and the only one that reads the *picture* rather than timestamps. Its source clip has
  a frame number in every frame; the export is seeked frame by frame and the numbers read back. It
  also runs *controls* — one thing done to a bare `<video>` at a time, listed in `SEQUENCES` —
  which is how `requestVideoFrameCallback` was found to freeze a detached element a second later
  and a hardware encoder's start to freeze the decoder next to it. Reach for the controls before
  changing anything in the start sequence: `?controls=cold,rvfc-only,preroll-50-norvfc&export=0`
  answers in forty seconds what a reading of Chrome's source would not. Two things it needs: the
  isolated Chrome (below) and, because `addLocalMedia` caps the library at 12 clips, a fresh
  profile per run — a run that was killed mid-way leaves its clip behind, and the thirteenth run
  fails with "You can keep 12 artwork files". The scratch launcher used here deleted
  `--user-data-dir` before every launch.
- **Do not edit a source file while a harness run is in progress.** Vite reloads the page on any
  change to something it imports, the run restarts from the top, and the numbers that come back are
  from the new code with the old page's state. This is the HMR trap from `cadence-check` again, but
  it bit harder this time because `video.ts` was being edited between runs.
- **Chrome's own media log is reachable over CDP** (`Media.enable`, then `Media.playerEventsAdded`,
  `playerPropertiesChanged`, `playerMessagesLogged`) — the same data as `chrome://media-internals`,
  per player, with decoder names and buffering-state changes. It was the thing that showed the
  pipeline logging *nothing* during the freeze, which pointed outside it. Note the events arrive
  batched, so their timestamps are the batch's, not the event's.
- **Console output of the driven page is reachable the same way** (`Runtime.enable` + `Log.enable`
  replay what is buffered; `Runtime.consoleAPICalled` streams what follows). A `console.debug` at
  each phase of the export, read this way, is how the WebCodecs `flush()` hang was placed in under a
  minute; the debug lines were removed once it was.
- **WebCodecs on this machine (Chrome 152, hardware H.264):** `avc1.640028`, `avc1.4D0028` and
  `avc1.42E028` all report supported at 1680 × 1140 and 30 fps, so does 60 fps at Baseline; AAC-LC
  and Opus both encode; `MediaStreamTrackProcessor` exists but the recorder uses an `AudioWorklet`
  tap instead, which every browser with WebCodecs also has. Two configurations *report* supported
  and then hang: negative frame timestamps, and `latencyMode: 'quality'`. Both are described under
  *The lag at 0.5 s*; do not reintroduce either.

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
    video.ts             trim window + the export loop, driving a recorder (tested)
    recorders.ts         WebCodecsRecorder (preferred) and MediaStreamRecorder
                         behind one CardRecorder interface              (tested)
    mp4write.ts          progressive MP4 writer for the WebCodecs output (tested)
    mp4.ts               rewrites the durations and the sound offset
                         MediaRecorder gets wrong (fallback path only)  (tested)
    selftest.ts          preview-vs-export pixel diff (dev only)
    canvas/
      spec.ts            measured geometry — change layout here, not in draw.ts
      placement.ts       cover fit, zoom, pan — shared by draw and drag  (tested)
      primitives.ts      ink-aligned text, tracking, cached metrics
      draw.ts            the card itself + foregroundKey                 (tested)
      avatarFrames.ts    the seven avatar frames, one drawAvatarFrame entry
    frames.ts            the frame list and badgePalette (one colour -> badge) (tested)
  components/
    AuthGate.tsx         session? studio : sign-in screen
    AuthScreen.tsx       registration + login form
    FramePicker.tsx      the avatar-frame tiles, painted by drawAvatarFrame
    ...                  preview, controls, media picker, inputs
dev/
  start-check.html       browser harness: what happens in the FIRST second of an
                         export — frame-numbered source, file read frame by frame,
                         plus the controls that separated the two causes  (dev only)
  flatten-mp4.js         rewrites a fragmented MP4 as a progressive one, so the
                         harness can test the shape a phone writes        (dev only)
  cadence-check.html     browser harness: does the exported file judder?  (dev only)
  audio-check.html       browser harness: is the sound in step, and does
                         the file state its own length?                  (dev only)
  layout-shot.html       renders the card and scans ink bands to measure gaps (dev only)
  align-shot.html        renders the card with the reference cards' own strings, to
                         be measured against reference/monthly-calendar-pnl.png (dev only)
  frame-shot.html        paints the avatar badge at the reference's own scale,
                         to be differenced against reference/frame.png    (dev only)
  frames-shot.html       every avatar frame, the pin in four colours, two on the
                         light card, on one contact sheet                  (dev only)
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
