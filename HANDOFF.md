# Handoff — Astra (formerly PnL Card Studio)

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
| 2026-09-14 (b) | frame-exact video export: every source frame, at the source's rate, sound to the sample | see **Start here** |
| 2026-09-14 (c) | renamed to Astra; editor restyled sharp black and white | `e253c3f` → `main` |
| 2026-09-15 | clips with HE-AAC or odd-rate sound no longer fall back to the laggy live recorder | see **Start here (2026-09-15)** |
| 2026-09-16 | exports made on a phone carry sound (second pass: Safari's magic cookie) | see **Start here (2026-09-16)** |
| 2026-09-17 | plans page, 1 free card a month, promo code MM33, NOWPayments checkout | pushed; **payments, limit and MM33 wait on setup** — see **Start here (2026-09-17)** and `SETUP-PLANS.txt` |
| 2026-09-19 | front page at `/`, editor moved to `/cards`, one nav in every topbar | see **Start here (2026-09-19)** |
| 2026-09-20 | *no code* — where Astra goes next: the journal/social/AI question, answered | see **Start here (2026-09-20)** |
| 2026-09-20 (b) | *no code* — **visual memory, not a journal**; supersedes most of (a) | see **Start here (2026-09-20 b)** |
| 2026-09-20 (c) | *no code* — **equipment, not analytics**: beauty + motivation; narrows (a) and (b) | see **Start here (2026-09-20 c)** |
| 2026-09-20 (d) | *no code* — **the spine**: the clan's proof-of-discipline layer. Read this one first | see **Start here (2026-09-20 d)** |
| 2026-09-20 (e) | *no code* — **decided**: native iOS, MT5 broker sync, clans and leaderboard | see **Start here (2026-09-20 e)** |
| 2026-09-20 (f) | *no code* — **the recommendation**: Strava for traders, seven pieces, $15-20/mo | see **Start here (2026-09-20 f)** |
| 2026-09-22 | *no code* — **what more to add**: eight additions beyond the seven pieces, and two holes in the plan | see **Start here (2026-09-22)** |
| 2026-09-22 (b) | **code**: the footer’s right string is fixed and out of card state; three period presets; the "too many settings" answer | see **Start here (2026-09-22 b)** |
| 2026-09-22 (c) | **code**: five built-in backgrounds, drawn by the renderer — and why the reference ones were not copied | see **Start here (2026-09-22 c)** |
| 2026-09-22 (d) | **code**: the five scenes became one — the Astra sky, bright, and the background a new card starts on | see **Start here (2026-09-22 d)** |

Everything up to 2026-09-16 is on `main` and deployed. Most of what follows about the render loop and the recorder is
new in the first pass; **Authentication** and **Persistence** cover the second, **Colour, ink and
the two picture slots** the third, and **Local mode** and **The scroll trap in the editor shell**
the fourth.

---

## Start here (2026-09-22 d) — the five scenes became one: the Astra sky

Artem, on seeing (c): *"they are completely different from the ones I need. Never mind, create only
1 Default card, like our own designed 'Astra' card background, do it on your own taste, but make it
definitely more bright than your current ones and the topic is stars."*

He is right and the correction is worth recording rather than quietly applying. The five scenes in
(c) were built to sit in the *reference cards'* genre — faceted solids, one hard light, near-black
ground — which was the wrong brief twice over: it aimed the house artwork at someone else's art
direction, and everything in that genre is dark. A background nobody reaches for is not a default.

**There is now one built-in background, it is called Astra, and it is a sky.** The app's name is
the Latin for stars and its mark is a four-pointed spark, so the house background is the thing the
name already says. **A new card starts on it** (`DEFAULT_SCENE_ID` in `scenes.ts`, read by
`createDefaultState`), which is also the first of the "make the default card already postable"
points from (b) actually landing.

#### What it is

A violet-to-blue field, brightest under the artwork and falling away across the text column; four
weak wide blooms (violet, cyan, rose, blue) rather than one strong one, because one colour reads as
a spotlight and four read as depth; a galactic band across the diagonal; 190 stars, most of them
small, a few haloed, warm and cool mixed; and four sparks — one large at the card's right-of-centre
gap, three lesser ones for company.

The whole of `scenes.ts` was rewritten. The faceted-solid renderer from (c) — vertices, camera,
painter's algorithm, half-Lambert — is **gone**, not kept for later: nothing used it, and dead code
that once drew five things nobody wants is worse than no code. `git show` on (c) has it if the
genre ever comes back.

#### Two bugs worth keeping in mind, both about compositing

1. **`destination-out` does not erase only the thing you just drew.** The band's ends were faded
   with a `destination-out` pass over its own rect, and that erased *everything already painted*
   inside the rect — ground, blooms, stars. The visible result was two hard diagonal edges across
   the sky where the erase stopped. It is now an ellipse: scaling the context turns one radial
   gradient into a soft-edged band, and no second pass is needed at all.
2. **`globalAlpha` applies to the erase too.** Before that, the same pass ran at the band's own
   alpha (0.75), so it took away only three quarters of the ends and left a quarter-strength
   rectangle behind — the same hard edges, fainter. Both were found by zooming into the render, not
   by reading the code.

Both are the kind of thing that looks fine at a glance and wrong the moment someone looks at the
card at full size. The rule that fell out of it: **if a piece of the sky needs to fade at its edges,
give it a shape whose gradient already does that, rather than cutting it out afterwards.**

#### Verified

`dev/scenes-shot.html` renders it as a whole card and runs `checkExportMatchesPreview` — the export
path builds on an OffscreenCanvas, a different context implementation, so "it looks right on screen"
is not evidence. `Astra [export matches, maxDelta 0]`, and `Plain` the same. 270 unit tests pass,
typecheck and build clean. `?wide=1` is 1:1, `?tone=dark` the light card, where the sky is veiled to
a pastel version that keeps black ink readable.

One test changed with the art: `scenes.test.ts` used to require a stroke per scene, which was true
of faceted solids and is false of a sky — it is fills all the way down. It now counts fills only.

#### If it needs changing

Everything about the picture is in one `draw` and four small helpers (`ground`, `band`, `spark`,
`stars`). The star's size and position are the two numbers most likely to want moving:
`spark(ctx, width * 0.75, height * 0.4, 168, …)` — reach 168 at 0.75/0.4 of the card. The palette
is the scene's `ground`, `light` and `rim` plus the four bloom colours in `draw`.

---

## Start here (2026-09-22 c) — five built-in backgrounds, drawn rather than shipped

Artem asked where the default backgrounds went, and the answer was that there had never been any:
no image has ever been tracked in this repo, there is no `public/`, and nothing seeds the media
library. What he remembered is the plain themed ground — the six accents' ambient glow — which is
under **Colour**, not under **Background**.

He then asked for the five `reference/monthly-calendar-pnl*.png` backgrounds to be replicated
identically and shipped as defaults. **That was declined and it should stay declined**: those five
are commissioned artwork on Axiom's cards — a blue blade with crystal shards, a white-blue spear, a
dark faceted cube with cyan and pink shards, a gold polyhedron and an illustrated serpent on a stone
pyramid. Copying them into a product Astra sells is the thing `.gitignore` and the README's *What is
deliberately not reproduced* already refuse for the wordmark and the logo. The offer instead was
three-way — upload them yourself for your own cards, replicate the measured *lighting*, or build
original artwork in the same genre — and Artem chose the third.

So: **five scenes, drawn by the renderer, in `src/lib/canvas/scenes.ts`.**

| | what it is | ground / light |
|---|---|---|
| **Blade** | a long crystal blade with a lit core, shards around it | `#05060B` / `#42509D` |
| **Shards** | pale splinters around a stretched octahedron | `#020405` / `#8694D9` |
| **Prism** | a near-black cube read by its edges, cyan and pink rims | `#08080B` / `#536380` |
| **Bullion** | a gold cube under one hard light | `#0A0903` / `#B9AC69` |
| **Tide** | a tall monolith in cold water light | `#001D30` / `#52F0FF` |

The palettes are not invented: they were measured off each reference's artwork field (x>430, below
the wordmark row) with PIL — the field's own dark, its lit edges, its peak. That is the part of
those cards that is fair to take, and it is why the five look like they belong to the same family
as the originals without being them.

#### How they are drawn

A very small faceted-solid renderer, about a hundred lines: vertices in object space, one shared
camera (yaw 0.62, pitch 0.42, weak perspective) so all five look like one set, painter's algorithm
over convex solids, and a half-Lambert term per face against one light direction. A cube and an
octahedron are the only two shapes; stretching the octahedron on Y is the blade, stretching a cube
is the monolith. Each scene then composes that with a ground, a bloom, some 2D splinters, a light
streak and a seeded scatter of motes.

Four things in there are load-bearing and are commented as such at the top of the file:

- **No `shadowBlur`, ever.** Canvas shadows are not scaled by the current transform, so a glow tuned
  in the preview would come out a third of the size in a 3× export — and preview-equals-export is
  the one invariant this renderer has. All glow is gradients.
- **The left third stays quiet.** Every subject sits right of x≈430 and the ground carries the text
  column, which is why these need no scrim to stay readable.
- **The scatter is a seeded LCG, not `Math.random`.** A background that redrew itself differently
  per frame would strobe through a video export. `scenes.test.ts` pins that two paints of the same
  scene issue the same calls.
- **The ground is a flat dark plus a pool of colour on the right**, not a corner-to-corner ramp. The
  ramp was the first version and it put a third of its colour under the title — the gold scene
  turned the whole card olive. That is the single change that fixed all five at once.

#### Verified

`dev/scenes-shot.html` renders all five as whole cards through the real renderer and, per scene,
runs `checkExportMatchesPreview` — the export path builds on an **OffscreenCanvas**, a different
context implementation, so "it looks right on screen" is not evidence. Result:

```
Plain    [export matches, maxDelta 0]      Bullion  [export matches, maxDelta 0]
Blade    [export matches, maxDelta 0]      Tide     [export matches, maxDelta 0]
Shards   [export matches, maxDelta 0]      Prism    [export matches, maxDelta 0]
```

`?wide=1` gives one card per row at 1:1, `?tone=dark` the light card. 270 unit tests pass,
typecheck and build clean.

#### Wiring

- **`artwork.sceneId`** joins `artwork.imageId` in card state. They are alternatives: each picker
  clears the other, and if a saved card somehow carries both, the upload wins — someone choosing a
  file is the stronger signal. An unknown id (a scene removed in a later version) falls back to the
  plain ground rather than to a blank card.
- **`ScenePicker`** paints each tile with the scene itself at the card's aspect ratio, the way
  `FramePicker` paints frames. There is no second drawing of anything to keep in step.
- **The scrim slider now covers both** — it used to appear only with an upload — and `drawScrim` was
  pulled out of the media branch so the two paths cannot drift.
- **`sceneId` is background-only**, and `draw.test.ts` pins that it does not move `foregroundKey`.
  Get that wrong and a card over a clip would rebuild its whole text layer every frame.

#### The one compromise, and it is visible

The scenes are built for the dark card. Under **black** ink they are veiled to a pale tint across
the *whole* card, not just the text column: the wordmark and the right end of the footer sit out
where the scrim's ramp has already fallen to zero, and black on a near-black solid is not a card
anyone would post. It reads as a deliberate pale variant rather than a broken one — but it is a
veil, not artwork designed for a light ground, and if the light card matters, five light-ground
scenes are the honest fix rather than a stronger veil.

#### What would make this better, in order

1. **Two or three more scenes**, once these have been looked at for a week. The renderer is there;
   a new one is a palette and about twenty lines.
2. **Accent-tinted variants.** Every scene has a fixed palette today. Deriving one from the card's
   accent would multiply five scenes by six accents, and the machinery (`mix`, one `light` colour)
   already exists.
3. **Motion.** A scene is a still. Slowly rotating a solid through a video export would cost one
   parameter — a time argument to `draw` — and is the obvious thing to try once someone asks why the
   background is static behind a moving card.

---

## Start here (2026-09-22 b) — the fixed footer, the period presets, and the "too many settings" note

Two changes to the editor, and an answer to a piece of user feedback that was explicitly *not* to be
acted on yet. `npm test` 264 passed, `npm run typecheck` clean, `npm run build` clean.

### 1. "Save 10% off fees" cannot be changed

It used to be `brand.footerSecondary`, a text field in **Identity** called *Footer right*. It is now
`FOOTER_SECONDARY` in `src/lib/content.ts` and **nothing else**.

The important part is not that the input was removed — it is that **the field was removed from card
state**. Deleting the control alone would have left the string in `localStorage`, in the account's
`cards` row and in the state object the bundle hands to the renderer, all three of them editable by
anyone who wanted to. With no key on `BrandState` there is nowhere for a different value to live, and
`hydrateState`'s `merge` only copies keys the current model has, so an old save carrying the old
field drops it on the way in. `src/lib/defaults.test.ts` pins exactly that: hydrate a blob with a
`footerSecondary` in it, and the string is not anywhere in the result.

| file | what changed |
|---|---|
| `src/types.ts` | `footerSecondary` gone from `BrandState`, with a comment saying where it went and why |
| `src/lib/content.ts` | `FOOTER_SECONDARY` — the one place the string exists |
| `src/lib/canvas/draw.ts` | `drawFooter` paints the constant; the field is out of `foregroundKey` |
| `src/lib/defaults.ts` | out of the default brand |
| `src/components/ControlPanel.tsx` | *Footer right* deleted; *Footer left* is full width and its hint names the fixed string, so the panel still says what the card will read |
| `src/lib/canvas/draw.test.ts` | the `footer right` key case deleted — there is no control to move the key any more |
| `dev/align-shot.html` | stops setting it; the harness still renders the same string, from the constant |

**Two consequences worth knowing.**

- `cardIdentity` in `src/lib/billing.ts` hashes `state.brand` whole, so every card's `cardKey`
  changes with the shape of `BrandState`. A free card exported before this deploy and re-exported
  after it counts as a *second* card that month. One-off, affects only whoever is mid-month on the
  free plan, and not worth a migration — but it is the reason the number could move.
- **`display.showFooter` still hides the whole footer row**, both strings, as it always has. The
  string cannot be *changed*; it can still be switched off along with the left one. If the intent is
  that every card carries it, that toggle is the remaining hole and closing it is a separate
  decision — the honest version is that the right half stops following `showFooter`, which makes the
  toggle mean something narrower than it says.

### 2. Period: three presets above the title field

`PERIOD_PRESETS` in `src/lib/content.ts` — **1D Realized**, **7D Realized**, **30D Realized** — drawn
as a `Segmented` above the existing title input. Asked for as *"3 buttons on one level, and the same
field 'text' that we have now just below it"*, so the field is untouched: the presets write into it,
a typed title clears the active chip by simply not matching one, and "August 2026" is still typeable.
The card's title is `period.title` exactly as before; nothing downstream knows a preset happened.

Two details that are not obvious from the diff:

- **The group is a `div.field`, not a `Field`.** `Field` renders a `<label>`, and two controls under
  one label means clicking the word "Title" presses the first preset. Same class, same styling, a
  plain `<span class="field__label">`, and the input carries `ariaLabel` (new optional prop on
  `TextInput`) so it is still named.
- **`.presets .segmented__item` is tightened** to 11.5px and 5px side padding in `global.css`. These
  buttons print their whole title, and *"30D Realized"* three times across is about 20px wider than
  the controls column at its 340px minimum. Tightened there rather than on `.segmented__item`, so the
  Period/Trade switch above keeps its size.

Verified in `dev/controls.html`: the three fit on one row, a click sets the title and the card, and
**Identity** now reads Wordmark / Handle / Footer left / Avatar.

### 3. "Too many settings" — suggestions only, nothing done

Artem: *"my friend said there are so many settings it looks a bit complicated and he got really
tired when he designed his first card. For me it's a pleasure to sit and try out different settings.
Don't do anything about it now, any suggestions?"*

Both are telling the truth, about different people. Artem is the tinkerer; the friend is a
first-timer who wanted a card, not a session. The mistake would be to believe the complaint means
"remove settings" — remove them and the card stops being anyone's, which is the only thing
separating Astra from a template site. **The fix is layering and arrival, not subtraction.** In
rough order of how much tiredness each one removes per hour of work:

| | | |
|---|---|---|
| 1 | **Looks: the whole style in one click** | A row of five or six complete looks — accent, ink, frame, scrim, hero format, all at once — each tile painted by `drawCard` itself at thumbnail size, so it shows the actual card rather than a colour chip. Turns eight decisions into one and leaves every control exactly where it is for whoever wants it. This is the single highest-leverage change on the list |
| 2 | **Identity is setup, not a card decision** | Wordmark, handle, avatar, logo, footer left are set once and then true forever. Asking for them inside the card panel makes them feel like part of making *this* card. Moved to a "Your marks" screen, asked once after sign-up, five controls leave the card flow permanently |
| 3 | **One fold: `Customise`** | First screen: numbers, Looks, background. Behind a disclosure: custom RGB, frame colour, frame picker, scrim, zoom/pan, export scale. Nothing is removed and the panel is half as tall on arrival |
| 4 | **Make the default card already postable** | It opens flat — `$10.0K` to `$10.0K`, no wordmark, a white pin — which reads as unfinished, and an unfinished card makes the panel feel compulsory. A default that already looks like something makes every setting optional, which is the actual goal |
| 5 | **Undo** | A lot of what reads as "tiring" is *"I changed something and I can't get back"*. Artem explores freely because he knows the way back; a newcomer does not. One `Ctrl`/`⌘`+`Z` over the card state would change how the panel feels more than deleting controls would |
| 6 | **Order the panel by how often things are touched** | Title and numbers, then background, then colour, then the rest. Avatar frames and RGB sliders are the rarest controls in the app and currently sit above things used on every card |
| 7 | **`Surprise me`** | One button that randomises the styling and leaves the numbers alone. Cheap, fun, and it hands a finished look to someone who does not want to make a single aesthetic decision |

Worth saying plainly: **do not decide this from opinion.** Nothing currently records which controls
people touch, and with accounts on, a saved card is already a row — comparing it against
`createDefaultState()` says which fields anyone ever changes, from the user's own data, without
adding a tracker. One week of that beats any amount of arguing about which settings are the
tiresome ones.

Today's two changes are already small steps in this direction, by accident rather than by plan: the
panel has one control fewer, and the most common period titles no longer have to be typed.

---

## Start here (2026-09-22) — what more to add, on top of the seven pieces

Artem: *"What more do you think we can add to our project?"* Asked after (f), so this is not another
survey of the whole product — (a)–(f) already decided the shape. This section holds only what is
**not** in the seven pieces, plus two holes in the plan that are cheaper to close before they are
built into.

No code again. `git diff --stat` since 2026-09-19 is `HANDOFF.md` alone.

#### First, the unwelcome answer: three things are already owed, and none of them is a feature

Nothing below is worth starting before these, because two of them mean the shipped product does not
currently work and the third decides whether the next one can exist at all.

| | | where |
|---|---|---|
| 1 | **Production is an open, anonymous editor.** `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are not set in Vercel, and every deploy of `main` republishes it that way | Open items 9 and 10 |
| 2 | **Nobody can pay.** The plans page, the free-card limit, `MM33` and the NOWPayments IPN are all written and all waiting on the setup steps | `SETUP-PLANS.txt`, **Start here (2026-09-17)** |
| 3 | **The MetaApi spike.** One day on a demo MT5 account, and it prices the whole product | (e), build order step 1 |

They are in this section only so that "what can we add" does not quietly become the reason they stay
open. Everything from here on assumes they are done.

#### The eight, ranked

**1. The screenshot comes back — attached to the synced trade, not instead of it.**
This is the strongest idea in this section, and it exists because (b) and (e) were both right about
different halves. Broker sync gives Astra the numbers and cannot give it **the chart** — what the
trade looked like, and the hand-drawn annotations that are the actual skill here (see the workflow
in (b): screenshot → Telegram Saved Messages, every trade). So: the trade arrives from the broker
with symbol, direction, times and result; the trader forwards the screenshot to the Astra bot and it
**attaches itself to the right trade automatically**, matched on symbol and timestamp. Nothing is
typed, nothing is classified, and the record page stops being a table of returns and becomes the
archive they already keep by hand — only searchable, and verified on the numbers side. The screenshot
mechanic that (e) killed was a way of *getting the numbers*; that is dead and should stay dead. This
is a different thing wearing the same gesture.

**2. The Telegram bot, because the rejection of a social feed implies it.**
(f) rules out a feed on the grounds that Telegram already is one. Then the conclusion is not "no
social surface", it is **go there**: the bot posts the card into the clan's group the moment a trade
closes, answers `/leaderboard` in-group, and takes the forwarded screenshot from item 1. It is also
the cheapest distribution this product will ever have — every card posted by the bot carries the
mark of the app that made it, in the exact room where the next twenty users are. It needs the
server-side renderer that is already build-order step 4, and no new client.

**3. A verifiable card link, so the card is proof outside the app.**
Today a card is a picture of numbers somebody typed — the README says so under *Notes and limits*,
and that does not change when the numbers start arriving from a broker, because the **picture** is
still just a picture once it is in a Telegram group. Give every card made from a synced trade a
short URL and a small mark on the card that points at it: a page that says this card came from a
connected account, sealed on this date, unedited. That single line is the difference between the
card being decoration and being the receipt the whole product claims to sell — and it is the one
piece of verification that survives leaving the app. Cards made by hand simply do not get the mark,
which is also the clearest possible statement of what a plan buys.

**4. Rich link previews from the same renderer.**
Consequence of 3, nearly free: those card URLs render as image previews in Telegram, X and Discord.
One `og:image` route, served by the renderer already being built, and every shared link becomes the
card rather than a grey rectangle.

**5. Clan seasons, and a trophy that stays.**
A perpetual monthly ladder goes stale the moment the same clan is on top twice, and everyone ranked
fortieth stops looking. Close the month, name a champion, mint a **season card** for the clan and a
permanent trophy row on every member's record page, then reset. It costs one table and gives three
things: a recurring share moment the product creates for itself, a reason for a mid-table clan to
care about next month, and more of the accumulated history that makes leaving expensive.

**6. The discipline score — the clan's rules, scored from the synced data.**
(d) called the clan a proof-of-discipline layer and (e) worried, rightly, that ranking on return
alone pays people to gamble. Both are answered by the same feature: a clan writes its own rules —
max trades a day, max risk per trade, nothing after a set hour, no revenge trade within an hour of a
loss — and Astra scores adherence from the trade history it already syncs. Nobody types anything; the
rule is a setting, the evidence is the feed. Rank the leaderboard on return **and** adherence, and
the thing being admired changes from the luckiest month to the steadiest one, which is the identity
the clan was described as having in the first place.

**7. Red cards, made as carefully as the green ones.**
Every reference card is a profit and the loss colour has never been measured (Open item 2). A
community that says its identity is discipline needs equipment for the bad month too: the drawdown
card, the "back to breakeven" card, the honest month. Milestone cards in (f) already catch the
recovery; what is missing is that the red card should be as beautiful as the green one rather than
the green one with a minus sign. It is a theme pass in `themes.ts`, and it buys a kind of credibility
that no amount of verification does.

**8. A vertical card format.**
The card is 840 × 570 and the places it gets posted are Stories and status — 1080 × 1920 — and square
feeds. It is reach, not polish. Flagged, not started: it touches `spec.ts` and `draw.ts`, which are
finished work, so it is Artem's call to open them and it should be a deliberate second layout rather
than a stretched first one.

#### Two holes in the plan as it stands

**The leaderboard's verification has a demo-account hole.** (e)'s four design choices — percentage
not dollars, median not total, minimum members, connected accounts only — are all right and none of
them stops the obvious attack: MetaApi connects a **demo** account exactly like a live one, and a
$50 account can print 400% in a week without anyone lying about anything. Two more rules, decided now
rather than after the first disputed season: **live accounts only**, and a **minimum equity floor**
to be ranked. Consider showing account age too. Without these the ladder is fiction in the second
month rather than the second week, which is worse, because by then people will have believed it.

**The credential ask is the funnel, and it comes before any value is delivered.** "Type your MT5
investor password" is a large thing to ask a stranger on the first screen, however read-only it is.
The fix is order, not copy: let a new account **import a statement** first — already the planned free
tier, already zero infrastructure — so the record page has their real history in it before the
connect screen is ever shown. Connecting then upgrades something they can see instead of unlocking
something they have been told about.

#### Still deliberately out

Everything (f) excluded stays excluded — no AI coach, no signals or copy trading, no in-app feed, no
manual trade-entry forms, no analytics dashboard. Two additions to that list from this pass: **no
broker execution, ever** (it is what keeps Astra out of a licensing conversation and out of App
Review's harder queue), and **no paid-signal storefront on profiles**, which is the failure mode (e)
predicted for a top-of-leaderboard profile with a Telegram link on it.

#### If only one thing gets built

Item 1. The numbers are the part a broker can hand over; the picture is the part only the trader has,
and it is the part they are already producing, every trade, by hand, into a chat with themselves.

---

## Start here (2026-09-20 f) — my recommendation, asked for plainly

Artem: *"tell me what YOU think is a good app to build... a list of ideas that make up a total of a
good and decent app that people will be willing to pay for."* So this is an opinion, not a survey.

#### The pitch, in three words

**Strava for traders.** Verified runs become verified trades, segments become the clan leaderboard,
and the beautiful shareable card is the one piece he has already built better than anyone in his
market. It is a proven model, it has never been done for the MT5/TradingView world, and the hardest
part to copy is the part that already exists.

#### What people actually pay for

Not analytics. One sentence: **"my results are verified, and my clan can see them."** Everything in
the list below either produces that sentence or supports it.

#### The seven pieces

| | | why it earns its place |
|---|---|---|
| 1 | **Read-only broker connect** | the foundation. Without verification nothing else is worth money, because every number is claimable |
| 2 | **Automatic PnL cards** | trade closes, card appears, he posts it. Zero effort. The existing crown jewel, now automatic — and it is also the entire marketing budget |
| 3 | **The record page** | permanent profile: verified return, streaks, best trades, social links. The thing that **accumulates**, which is the thing that makes leaving expensive |
| 4 | **Clans and the leaderboard** | median-based, verified-only. The retention engine. Competing with your brothers is the reason to open it on an ordinary Tuesday |
| 5 | **Steps and streaks as the daily pulse** | HealthKit steps plus a rule streak. A non-trading reason to open the app every day, and true to a community whose identity is discipline, not charts |
| 6 | **Milestone cards** | the app catches the moment: first green month, back to breakeven after a drawdown, 100 trades, one year in. Share moments the product *creates* instead of waiting for |
| 7 | **Year in Review** | once a year, enormous organic spread in a Telegram-native region, no ongoing cost |

#### What to deliberately leave out

Worth as much as the list above, and all of it was considered and rejected across (a)–(e):

- no AI coach
- no signals, no copy trading
- no social feed — Telegram already is the feed
- no manual trade-entry forms
- no analytics dashboards nobody opens

#### Pricing

**$15–20/mo, not $5.99.** The old price was set for a card generator with no marginal cost; broker
sync bills per account per month, and the thing being sold is identity and competition rather than a
picture. Free tier: manual cards and statement import, no live sync, not eligible for the
leaderboard — which makes the paywall the same line as the verification.

#### The one risk that matters

This lives or dies on **broker sync working reliably**, not on design. If MT5 connectivity is flaky
or expensive per account, every one of the seven pieces degrades at once. That is why the MetaApi
spike in (e) is the first and cheapest thing to do, and why nothing should be designed around a
price until it is measured.

---

## Start here (2026-09-20 e) — decided: native iOS, broker sync, clans

Artem made the call. This section is the spec that follows from it, plus the four things that will
bite and are cheaper to know now. It replaces the *delivery* questions left open in (d); the spine
in (d) still stands, the shape of it changed.

Still no code. `git diff --stat` all week is `HANDOFF.md` alone — nothing under `src/`, nothing in
the video compiler or the cards page.

#### What he asked for

> *"Actually I want it to be a real iOS app, and I want the PnL cards to be like TradeZella. Not by
> sending a screenshot from MT5, but by my app connecting to the broker and doing the PnL card
> itself. Steps? Just take from a health app. Also I want it to be possible to make Leaderboard of
> Clans, like which clan is more UP this month in PnL. And every profile has their own social media
> links, so that way you can connect with other top traders from other clans."*

Five decisions, all of them consistent with each other:

| | decision | consequence |
|---|---|---|
| 1 | native iOS app | HealthKit becomes trivial; App Store review and IAP become real |
| 2 | broker connection, not screenshots | the cards become **verified by construction** — this is the big one |
| 3 | steps straight from HealthKit | needs the native app, which he now has. Settled |
| 4 | clan leaderboard by monthly PnL | the retention engine, and the thing that needs designing carefully |
| 5 | profiles with social links | the cross-clan growth loop |

The screenshot mechanic from (c)/(d) is dead, and he is right that it was the lesser version — it
was a workaround for not having broker access. With a broker connection the cards fill themselves,
the leaderboard means something, and the "no typing" requirement is satisfied completely rather than
cleverly.

#### The one thing that decides the whole project: MT5 connectivity

He said the market is TradingView + MT5. So "connect to the broker" means **MT5**, not Binance or
Bybit, and that is a different and harder problem than crypto exchange APIs.

The credential that matters: **MT5 has an investor password — read-only by design.** It can view the
account and its history and it cannot trade or withdraw. That is the right thing to ask for, and
making that limitation loud is the difference between people connecting and people not.

Routes, honestly:

| route | what it is | verdict |
|---|---|---|
| **MetaApi** (metaapi.cloud) | commercial cloud API that connects to MT4/MT5 accounts via investor password. What most journals in this space actually use | **start here.** Fastest path to a working sync. Priced **per connected account per month** — check current pricing, it is the whole unit-economics question below |
| self-hosted MT5 terminal farm | run MT5 terminals server-side, one per account | cheaper at scale, heavy and fragile to operate. A later optimisation, never a starting point |
| MT5 Manager / Web API | the official server-side API | **not available to third parties** — brokers only. Rule it out |
| broker REST APIs | some brokers expose one | most CIS/offshore brokers don't. Opportunistic at best |
| statement import (HTML/XLSX export) | the user exports a report and uploads it | not live, but **zero infrastructure and zero cost.** Keep as the fallback for unsupported brokers — it will cover a real tail |

**Spike this before anything else.** Open a demo MT5 account, connect it through MetaApi, pull the
trade history, and see what the data actually looks like. It is a day of work and it decides whether
the product exists in this shape.

#### The finding that changes the business: per-account cost meets $5.99

Every plan so far assumed the marginal cost of a user was ~zero. Broker sync breaks that. A hosted
MT5 connection is billed **per account per month**, continuously, whether or not the user opens the
app — and at $5.99/mo that is the difference between a healthy margin and none.

Three levers, and he will probably need all three:

- **Price above it.** TradeZella is ~$29/mo and this is the same cost structure. $5.99 was priced
  for a card generator with no variable cost; a broker-synced journal is a different product and can
  carry a higher number.
- **Only connected accounts cost money.** Free tier = statement import and manual cards, no live
  sync. Live sync is the paid feature, which is also the cleanest paywall this product has ever had.
- **Sync on a schedule, not continuously.** Poll a few times a day rather than streaming; disconnect
  dormant accounts and reconnect on demand.

This is the single most consequential thing in this section. It should be settled before the app is
designed around a price that cannot work.

#### The clan leaderboard, and the incentive problem in it

Ranking clans by "who is most up this month" rewards, precisely and mechanically, **maximum risk** —
and a clan leaderboard adds peer pressure to gamble on the clan's behalf. The winner each month is
whoever got luckiest with the most leverage, and that account is also the one most likely to be gone
by spring.

That is his call to make and the feature is worth building. But four design choices decide whether
it survives contact with its own users, and they cost nothing to get right up front:

| choice | why |
|---|---|
| **percentage return, never absolute dollars** | otherwise the biggest account wins forever and nobody else bothers |
| **rank on the clan's *median* member, not its total** | on a total, one degenerate with 100× leverage carries the whole clan. On a median, a clan wins by **everyone** being decent — which is both a better game and much closer to the brotherhood identity the clan is actually built on |
| **minimum verified members and minimum trades to appear** | a two-man clan wins every month on variance alone |
| **connected accounts only** | an unverified leaderboard is fiction inside a week. This is why decision 2 above is load-bearing for decision 4 |

Optional and worth considering: show **max drawdown beside the return**. It stops nothing, but it
changes what gets admired, and admiration is the actual product here.

#### Profiles and social links — the growth loop, with one thing to decide on purpose

Links out to Telegram, Instagram and X are what make climbing the leaderboard worth anything, and
cross-clan connection is a genuine reason to open the app. Keep it.

The thing to decide deliberately rather than discover: **a top-of-leaderboard profile with a
Telegram link is a signal-channel funnel.** It will happen on its own, and it is the exact thing he
rejected on day one. Either that is fine and it is part of the ecosystem, or the rules say something
about it. Better chosen now than litigated after the first paid-signals scandal inside a clan.

#### Four things about shipping on iOS that change plans already made

**1. Apple takes a cut and requires IAP — the NOWPayments checkout does not work inside the app.**
`api/checkout.ts` opens a NOWPayments hosted invoice in the browser. Apple requires In-App Purchase
for digital subscriptions, so the iOS app needs **StoreKit**, and Apple takes 30% (15% under the
Small Business Program, which he will qualify for). The web checkout stays and keeps serving web
users at full margin. `SETUP-PLANS.txt` is still worth finishing — it just stops being the only
payment path. Plan for two.

**2. Review latency replaces instant deploys.** Every iteration now costs a TestFlight build and a
review queue instead of a `git push`. That is a fact to plan around, not an argument against the
decision — but it is why keeping a web surface for fast iteration is worth something even after the
app ships.

**3. Trading apps get extra scrutiny.** Astra never executes trades and never touches funds, which
is the thing that keeps this simple — it is read-only analytics. Expect questions anyway, keep the
HealthKit purpose strings honest, and don't let any marketing copy imply investment advice or
promise returns.

**4. Credentials are now the security surface.** Investor passwords must be encrypted at rest, never
in the app bundle, never in logs, never reachable from the client. This is the first part of Astra
where a mistake is not a bug but an incident.

#### Stack, and the one piece of luck

The card renderer in `src/lib/canvas/` is good, finished, and off-limits — and it does not have to
be rewritten for any of this. **Render cards on the server.** The app asks for a card and displays a
PNG; the existing canvas code runs headless behind an endpoint. That keeps every pixel of the work
already done, serves the app, the web and any future bot from one renderer, and touches nothing.

For the app itself:

| | |
|---|---|
| **Expo / React Native** *(recommended)* | reuses his TypeScript, HealthKit via `react-native-health`, and Android comes almost free later. Cards arrive as server-rendered images, so nothing needs porting |
| Swift / SwiftUI | best feel and the best App Store citizen, but it is a second codebase in a language the project doesn't use, and Android would be a full rewrite |

The video export stays exactly where it is: web, client-side, untouched.

#### Build order

| | | why here |
|---|---|---|
| 1 | **MetaApi spike on a demo MT5 account** | one day, and it decides everything. Nothing else starts first |
| 2 | settle pricing against the measured per-account cost | designing the app around $5.99 before knowing this is the expensive mistake |
| 3 | schema: `broker_accounts`, `trades`, `clans`, `clan_members`, `leaderboard_snapshots` | RLS keyed to `auth.uid()` like everything already there |
| 4 | server-side card rendering endpoint | unblocks every client, changes no existing file |
| 5 | Expo app: auth, HealthKit steps, profile + social links | the shell, and the part with no unknowns in it |
| 6 | auto-generated cards from synced trades | the moment the product becomes what he described |
| 7 | clans, membership, the leaderboard | median-based, verified-only, per the table above |
| 8 | StoreKit subscriptions | last, and only once there is something worth subscribing to |

Realistic scope: this is months, not weeks — a native app, broker infrastructure and a social layer
are each substantial on their own. The order above is arranged so the two things that can kill it
(steps 1 and 2) are answered in the first week, for almost nothing.

---

## Start here (2026-09-20 d) — the spine, and what the clan actually is

This is the synthesis of four days of direction-finding, and the section to read if you only read
one. (a), (b) and (c) are the working; this is the conclusion. Still no code — nothing under `src/`,
the video compiler or the cards page has been touched all week (`git diff --stat` is `HANDOFF.md`
alone).

#### The thing Artem said last, which reframes everything before it

> *"My idea was based on our community. We have a shared channel about mentality, high frequency,
> manifestation and all that. We also have a StepUp app that calculates our steps every day from the
> health app. And we like compete who walks more. So I thought making like an improvement sector...
> maybe making like a Threads/X social media line where every member of the clan posts their
> everyday life, but we have a Telegram chat where we talk, so no need for that probably."*

**His community is not a trading community. It is a self-improvement brotherhood that happens to
trade.** Mentality, discipline, manifestation, and a step-count competition. Trading is one
expression of a wider identity: a group of men competing to become better versions of themselves and
proving it to each other.

That is not a pivot away from the four days before it. It is the thing that makes them fit together:

- Trading well, the way he describes it, **is a discipline sport.** The edge is not in analysis, it
  is in doing the same disciplined thing over and over. That is precisely why every analysis feature
  proposed this week was rejected — the bottleneck was never analysis.
- The step competition and the trading are **the same game**: did you do the thing today, and can
  you prove it to your brothers.
- A PnL card and a step count are **the same object**: proof of doing, made beautiful, witnessed by
  peers.

So Astra is not a trading app with a fitness feature bolted on. It is **the clan's proof-of-
discipline layer, where trading is the first and best-looking domain.** That answers *"I don't want
it to be just a card PnL thing"* properly: the card stops being the product and becomes the
primitive.

#### One mechanic, many domains

**Screenshot the proof → get a beautiful card → your clan sees it.**

That is the whole engine, and Astra already does the hardest third of it. It generalises without a
single new integration: an MT5 PnL screenshot, a step count from the health app, a gym session, a
finished book. Same gesture the community already performs a dozen times a day, same renderer, same
share surface.

It also quietly solves the steps problem. A Telegram Mini App cannot read Apple HealthKit — that
needs a native app. But it does not have to: **a screenshot of the step count is proof**, and it is
the identical mechanic to the MT5 screenshot. No HealthKit, no App Store, no native build. If step
sync ever justifies a native app, that is a later decision made on evidence, not a blocker now.

#### "That's mostly for mobile" is not the obstacle he thinks it is

This was his one stated objection and it dissolves. The step data is on the phone, the community
lives in Telegram, Telegram is a phone app, and the screenshots come from phones — **the product is
already mobile.** What he does not need is a *native* app.

**Telegram Mini Apps** are the answer, and they are the native format of this region: a web app that
runs inside Telegram, launched from a bot, no App Store, no install, no download friction, and
shareable by link into the chat the clan is already sitting in.

The technical fit is unusually good. This repo is React 19 + Vite, which is exactly what a Mini App
is built from, and the card renderer draws to a canvas that works fine in a Telegram webview. The
existing card pipeline is reusable **as-is** — to be clear, that means reused, not modified: the
renderer, the exporter and the cards page stay untouched per the standing rule, and a Mini App shell
would sit beside them.

#### He was right to kill the feed

*"We have a Telegram chat where we talk, so no need for that probably."* Correct, and for the right
reason. Never build a social feed that competes with an incumbent habit inside your own community —
it will lose to the chat, and a feed without critical mass is a ghost town that makes the whole
product look dead. **Post into the Telegram chat; don't try to replace it.** The bot should push
cards, streaks and weekly results into the existing chat, which also means every piece of content
the product makes lands where the audience already is.

#### The strategic fork, and a recommendation

There are two businesses here and they look similar from the inside:

| | what it is | verdict |
|---|---|---|
| **individual-first** | a self-improvement tracker one person uses | **no.** Crowded, no moat, no distribution, and habit trackers are a graveyard |
| **clan-first** | the operating system for a small brotherhood — any group creates its own clan | **yes.** The unit of virality is a group, not a person, and CIS Telegram is full of exactly these groups: trading chats, prop squads, improvement communities |

Clan-first is the recommendation, and strongly. It makes the group leader the customer, the members
the content, and the group itself the thing that spreads. It also folds in the channel-template idea
from (c) — a clan has a brand, its cards carry it, and every member posting a result markets the
clan.

#### Commitment → proof → witness

The manifestation and mentality side is not something to be embarrassed about; it is a real
mechanic, and it is the one his group already runs informally in chat:

1. **you declare** what you'll do
2. **you post proof** you did it
3. **the clan sees** both

Worth noting: this is the sealed-commitment idea from (a), which was the right mechanic pointed at
the wrong target. Applied to trading judgement it was an insult to people who trade well. Applied to
discipline it is exactly right, because there the point was never analysis — it is accountability.

#### The danger has changed

For three days the worry was *not big enough*. It isn't any more. There are now four products on the
table — trading cards, visual memory, step and discipline tracking, a clan layer — and the risk is
straightforwardly **scope drift**. Picking one spine now matters more than any individual idea in
these four sections.

The test to judge every feature against, and it is unforgiving: **what does a member do on a
Tuesday?** Not after a big win — on an ordinary Tuesday. A PnL card alone has no answer; that is the
real reason cards-only feels thin. Steps, a streak and a clan leaderboard have one.

#### The spine

> **Astra is the clan's proof-of-discipline layer. One mechanic — proof becomes a beautiful card the
> clan witnesses. Trading is the hero domain; steps and habits are the daily pulse. It lives as a
> Telegram Mini App and posts into the chat that already exists. The clan, not the person, is the
> unit of growth.**

#### The smallest test, using the community he already has

Put a bot in the existing clan chat that does two things: turns an MT5 screenshot into a card, and
posts a weekly clan table combining trades logged and steps walked. Nothing else.

**If his own clan uses it daily for a month, this is real.** If they don't, no amount of further
building fixes it — and he will have learned that for the price of a bot and a leaderboard, with the
one group on earth most likely to use it. Everything in (a), (b) and (c) waits behind that result.

Unchanged and still first: `SETUP-PLANS.txt`.

---

## Start here (2026-09-20 c) — direction, corrected a second time

Short note, written before Artem's own idea landed; the fuller version follows once it has. Read it
ahead of (b) and (a), both of which are now partly wrong in the same way.

#### The correction

> *"It's like me trying to make AI do the analysis of post-trade instead of people. But trading is a
> skill that we all do by ourselves. So my product should be something that makes it more beautiful
> (as pnl cards), and only amplifies your motivation and skill to do it."*

Three rejections in three days, and they are one rejection: a vague AI coach (a), signals, and now
AI post-trade analysis (b). The through-line is **anything that moves the thinking out of the
trader's head is a worse product for people who already trade well.** His users are not looking for
a crutch. They want the doing to feel better.

So the category is not analytics. It is closer to **equipment** — the thing a craftsman buys that
makes the craft look and feel better and keeps them coming back to it.

What survives from (b) is the part that trains rather than concludes: recall ("have I seen this?")
and drill mode put the judgement back in the trader's hands. What dies is everything that hands him
a verdict. And even the survivors are now *depth*, not the centre.

#### The two things Artem said and undervalued

**1. Strava is the model, and he has already built its card.** Strava does not run for you and does
not meaningfully coach you. It makes the output of your effort beautiful, makes it witnessed, keeps
a record that accumulates into an identity, and adds light competition. It is a very large company
built on "make the thing you already do look good and be seen doing it." That is exactly the product
he is describing, and he built the card without building the rest of it.

**2. The CIS market observation is the asset, not an aside.** *"In CIS region we only have
TradingView + MetaTrader 5... All the pnls are just screenshots from MT5, which look pretty basic.
Entry - Exit, pnl. Black/white background and that's it."* He took the card idea from Axiom and
Pump.fun — US, crypto-native.

The gap that describes: those beautiful cards exist **only inside the platforms that made them.**
MT5 and TradingView have an enormous user base, a Telegram-native trading culture that posts results
constantly, and nothing but ugly grey screenshots to post. Nobody has built the beautiful-result
layer for that world. That is not "PnL cards as a feature." That is the output layer of a region's
trading culture.

#### Why cards-alone actually feels thin — and it isn't the beauty

The real defect is that **a card has nowhere to live.** You make one, you post it, you are done.
Nothing accumulates, and there is no reason to open Astra on a day you didn't have a big win. One
card is a flex; two hundred cards would be a career, except that today they are two hundred orphans.

That also settles the business argument: a tool used occasionally is hard to charge $5.99/mo for; an
identity built up over a year is easy to.

#### Ideas along his axis — beauty and motivation, no thinking outsourced

| | idea | why it fits |
|---|---|---|
| **1** | **MT5 / TradingView screenshot → card, in one step.** Forward the ugly screenshot, Astra reads symbol, volume, entry, exit and profit off it and returns the beautiful card | the bridge from what they do now to what Astra makes, and it removes the last typing in the product. MT5's layout is rigid, so this reads reliably. AI used as transcription, never as judgement — which is exactly the line he drew |
| **2** | **A profile: the body of work.** A permanent, beautiful public page of everything you've made. Not a dashboard — a portfolio | accumulation is the missing piece. Value compounds with use, and it is the thing that is hard to walk away from |
| **3** | **Streaks and consistency objects.** *14 days following your own rules. 31 trades logged. Longest green week.* | motivation, not analysis. Counts things you **did**, tells you nothing you didn't know |
| **4** | **Milestone cards.** Astra notices the moment and offers the card: first $10k month, one year trading, **back to breakeven after a drawdown** | today a card only happens after a big win. Recovery is a better story than a win and nobody celebrates it. Creates share moments instead of waiting for them |
| **5** | **Year in Review.** Wrapped, for your trading year | once-a-year organic distribution, entirely visual, in a region that lives in Telegram |
| **6** | **Channel templates.** A Telegram channel gets its own branded Astra template; every member posting a result markets the channel | B2B revenue and viral distribution in one, aimed straight at the CIS Telegram trading economy where channel owners already pay for this kind of thing |
| **7** | **Treat the aesthetic as the moat, not the decoration** | Axiom's cards spread because they look expensive. In a market of black-and-white MT5 screenshots, being the best-looking thing is defensible far longer than people expect — design is copyable in theory and rarely copied well |

#### On "it is like inventing"

He isn't starting from nothing. He has a market observation that is specific and true, a community
that already behaves the way the product needs, and the best-looking artefact in that market. The
invention required is small and it is one sentence: **give the cards somewhere to live.**

---

## Start here (2026-09-20 b)

### Visual memory, not a journal — this supersedes most of the section below it

No code in this pass either. Read this one before **Start here (2026-09-20)**: Artem described how
he and his community actually trade, and it invalidates the stat-coaching spine in that section. The
parts of it still worth keeping are named at the end here; the rest should be treated as a dead end
that was explored and closed.

#### What he said, because everything follows from it

> *"Me and my community don't trade by 'setups' like robots. There is no 'blueprint'... one of the
> most important things is 'visual'. Visual is when you see the very similar chart, as you saw a few
> months ago a few times already. You immediately know what to do... when you see a setup that you
> saw 1000 times, you are confident to put money on the line. That's why I don't like journals,
> because you have to type in every stat yourself, like risk-to-reward, risk-per-trade, long/short,
> all of this bullshit. How we do it, is we just send a screenshot of every trade to our 'Telegram
> Saved' messages and that's it. You just look at the picture of a chart, which has some drawing on
> it that you did and you just memorise it with time."*

Three things in that are worth stating outright, because they are the entire product brief:

1. **The skill being trained is recognition, not analysis.** This is chunking — the same mechanism
   that lets a chess player glance at a board and know the move. It is built by repeated exposure to
   examples, not by reading statistics about yourself. No stat journal touches it, which is exactly
   why he doesn't like them and why the previous section was wrong.
2. **The workflow already exists and works.** Screenshot → Telegram Saved Messages. It is one
   gesture, zero typing, and his community is profitable doing it. Any product that asks them to
   change this habit has already lost.
3. **The archive is write-only.** That is the bug. Everything below is a consequence of it.

#### Why the screenshot pile fails, even though the method works

The method is sound. The storage is not. A folder of images in Telegram has three specific failures,
and each one is a feature:

| failure | what it means | the feature it implies |
|---|---|---|
| **you cannot search it** | images aren't searchable, so you scroll. The memory lives in your head; the archive only holds what you already remember. It never *tells* you anything | search by shape — "have I seen this?" |
| **repetition is accidental** | you re-see whatever you happen to scroll past. Nothing makes you review the patterns you read worst | deliberate, spaced re-exposure |
| **outcomes aren't attached** | **recognition memory forms whether or not the pattern is profitable.** You can be 1000-reps confident in a shape that loses money, and there is no way to notice from inside your own head | outcome paired to the image |

The third is the dangerous one and it is the strongest single argument for the product. He is right
that his community is profitable and adaptive — but "I've seen this 1000 times" is a statement about
exposure, not about edge, and nothing in the current method can tell the two apart.

#### The thing nobody noticed: the drawings are free labels

*"a picture of a chart, which has some drawing on it that you did."*

Those drawings are the highest-signal part of every image. They are his annotation of what he saw,
made at the moment of the trade, with no extra effort — a trendline, a box, an arrow, a level. It is
supervised labelling of what mattered in the frame, already done, sitting in Telegram by the
thousand. A vision model can read them.

Two things fall out of that for free: the annotation usually marks the decision point, so the drill
mode below can crop there automatically; and two charts are "similar" in the way *he* means it when
the drawings agree, not just when the candles do.

#### The three layers

**Layer 1 — Recall. "Have I seen this before?"**

You are looking at a live chart. Screenshot it, drop it in, and Astra returns the twelve most
visually similar charts *from your own archive*, each with what happened next, plus the tally:
**you've taken this shape 23 times, 17 worked.**

This is precisely what his brain already does, with perfect recall and a real count instead of a
feeling. It doesn't replace the intuition — it confirms it when he's right and argues when his
memory is flattering him. And it is categorically not a signal: it is his own history, his own
patterns, his own hand-drawn reads. Nobody else's opinion enters.

"You've seen this 23 times" is the whole product in four words. It is probably the tagline.

**Layer 2 — Discover. Let the clusters name themselves.**

His own suggestion was folders, or an AI that files trades into them, and he's right that it's
basic — foldering only ever sorts into categories you already decided on. Invert it. Cluster the
archive by visual similarity and show him the groups that fall out:

> *Here are 34 charts that look like each other. You've never named this. It's 31% of your trades
> and your best-performing group.*

He names it whatever his community calls it. The taxonomy emerges from his own trading rather than
from a textbook — which is the only version compatible with "there is no blueprint." Imposing
Investopedia tags on these people would be the fastest way to lose them.

And then the finding that only this product can produce: **the cluster you are confident about that
loses money.** High reps, high conviction, negative expectancy. Invisible from inside your own head,
obvious from outside it, and delivered entirely in pictures — no stats typed, none read.

**Layer 3 — Train. Drill mode.** *This is the one that makes it a product rather than a tool.*

Take a chart from his own archive. Crop it at the decision point — everything to the right of the
entry hidden. Show it. He calls it: long, short, or no trade. Reveal what actually happened.

- pure visual, one tap, exactly the way he says the skill is built
- it is spaced repetition over his own archive, which fixes the accidental-exposure problem
- it makes a write-only pile readable
- it produces a real number that no journal can produce: **your recognition accuracy on your own
  patterns**, per cluster. *"You read continuations at 78% and reversals at 41%."*
- it works on the losers, which is where the learning actually is

He described the method as *"you just memorise it with time."* This is that, deliberately, at ten
times the rate. It's a gym for the one skill he says matters, and the reason nobody has built it is
that everybody went and built stat journals instead.

#### Getting the outcome in without asking him to type

Layers 2 and 3 both need to know what happened. He will not type R:R or risk-per-trade, and he
shouldn't have to. Cheapest first:

| | cost to him | notes |
|---|---|---|
| **one swipe** on the closed trade — worked / didn't | one gesture | the baseline. Enough for drills and clustering |
| **a second screenshot** at exit | one screenshot, the habit he already has | the model can see where price went. Richer, still no typing |
| **the PnL card he already makes** | none | it already carries the number. But **only winners get cards** — selection bias, so it can't be the only channel |
| read-only exchange sync | setup ceremony | exact and automatic, but it's the heaviest option and clashes with the no-ceremony spirit. Later, if ever |

Design constraint worth writing down: **do not depend on reading exact prices off a screenshot.**
Vision models describe chart structure well and read small axis numbers unreliably. Structure from
the image, outcome from the swipe.

#### Distribution: be a Telegram bot, not a website

He forwards screenshots to Saved Messages today. So the product's front door is a bot he forwards to
instead — or better, adds to the group. Zero new habit. A web app that asks for uploads is asking a
profitable trader to change a workflow that already works, which he won't do, and neither will
anyone he tells about it.

Two consequences that matter a lot:

- **The cold start is already solved.** Years of screenshots are sitting in Saved Messages right
  now. Bulk-import that and the product is useful on day one instead of in six months. Almost
  nothing launches already full; this can.
- **His community is the beachhead.** There is an existing group of profitable traders who all
  already do this. That is the hardest thing to acquire and he has it.

#### The social layer, now that it finally makes sense

He ruled out signals because copying doesn't build skill. Drills are the exact inverse:

- **Same chart, everyone calls it.** One real chart a day, cropped at the decision point, posted to
  the group. Everyone commits blind and simultaneously, then the reveal shows the distribution:
  *you said long, 71% said short, it went short.* Copying is structurally impossible — nobody can
  see anyone else's answer until all are locked — and you get a mirror for your read instead of a
  tip.
- **Pattern libraries as the shareable object.** A cluster with forty examples and their outcomes is
  genuinely valuable to a newer trader, and what it transfers is *reps*, not signals. This is the
  honest version of social trading, and it's a product a mentor would pay for.
- **The mentor view.** Hand an experienced trader a junior's clustered archive and he sees in ten
  seconds what a stat table hides for months: *you keep taking this one shape and it loses.*

#### Where the risk actually is

One technical risk dominates everything: **does visual similarity work on real chart screenshots?**
Off-the-shelf image embeddings latch onto theme, broker chrome, colour and indicator panels — not
price structure. Different timeframes, different platforms, and his own drawings all confound it.
The plan is a hybrid: embed the image *and* have Claude produce a structured description at ingest
(trend, structure, where price sits in the prior range, the approach shape, what the drawing marks),
then rank on both. The description also gives explainability — *similar because both are a third
touch after a sweep* — which matters, because a similarity result he can't see the logic of is one
he won't trust.

That question is answerable in a weekend against a few hundred of his real screenshots, and it
decides whether this product exists. Nothing else should be built first.

Smaller risks, worth tracking, not worth blocking on:

- **Selection bias.** Everything depends on losers being screenshotted too. He says *every* trade —
  confirm it, because if only wins get saved the archive is poison and the clusters lie.
- **Small n.** A personal archive is hundreds, not millions. Fine for drills (n=20 is plenty of
  reps); not fine for confident claims about expectancy. Don't let the copy oversell the statistics.
- **Privacy.** A trader's full archive is sensitive. The existing private per-user `media` bucket
  with its RLS policies is already the right shape; sharing must stay explicit and per-cluster.

#### What it costs to run

Ingest is the only model cost. A chart screenshot resizes to roughly 1568×880, which is about 1.8K
input tokens; with the description prompt and ~300 output tokens, on Claude Opus 5 at $5/$25 per
million that is **about $0.018 per chart**. So a 1000-image backfill of someone's Telegram history
is a **one-time ~$18**, and a few trades a day afterwards is pennies a month. Similarity search and
drill mode cost nothing after ingest — no model call in the loop.

That is cheap enough that the backfill can be the free hook: *forward your archive, get your patterns
back.*

#### Build order

| | | why here |
|---|---|---|
| 1 | **similarity spike on ~300 of his real screenshots** | the whole product rests on it. Nothing else until it's answered |
| 2 | Telegram bot: forward in, bulk-import Saved Messages | the front door and the cold-start fix, in one piece of work |
| 3 | Layer 1 — "have I seen this?" search + what happened next | the first thing that is useful alone |
| 4 | swipe outcome + clustering → Layer 2, clusters he names | needs a filled archive, so it comes after ingest |
| 5 | Layer 3 — drill mode, recognition accuracy | the retention engine and the real differentiator |
| 6 | group drills, shared pattern libraries, the mentor view | last, and it lands straight into his existing Telegram group |

#### What survives from the previous section

Not much, and it should be read with this one in front of it:

- **The card is still the share object and still the reason people show up.** A drill streak or a
  pattern's record is a new thing worth a card.
- **Payments still have to be finished first** (`SETUP-PLANS.txt`), unchanged.
- **The server-side architecture note still applies**, more so — ingest, embedding, the Claude call
  and the bot all need server functions and a key. This is no longer a static site with a database.
- **The "compute in code, let the model write the sentence" rule still holds** wherever a finding is
  narrated.

Dead: the typed-stat journal, the stats page as a destination, conditional splits on risk-per-trade
and R-multiple, and the coach built on them. He told us plainly that this is the part he dislikes
about every existing product, and building it would have made Astra the fourth-best version of
something his own community avoids.

---

## Start here (2026-09-20)

### Where Astra goes next — ideas, not code

Nothing was built in this pass and nothing in `src/` was touched. Artem asked a product question and
this section is the answer, written here because it is the kind of thing that has to survive the
conversation it came out of.

The question, in his words: *"Except for the payment, our project is done. However, I don't want it
to be just a card pnl thing. I want it to be something bigger."* A competitor — someone already in
the trading industry — has shipped a journal: winrate, PnL, balance, trade frequency, a friend
system, and an AI wrapper that reads the statistics back to you. Artem's read on it: *"very vague
and it really isn't that helpful for trading."* His own follow-up ruled out the obvious pivot:
*"maybe... social trading. However, that will be also not that interesting because taking signals
from someone means not improving on your own skill."*

That instinct is right, and it is the whole opening.

#### The two dead ends, and the gap between them

| | what it does | why it doesn't make you better |
|---|---|---|
| a journal | **describes** — here is your winrate, here is your equity curve | a mirror has no counterfactual. Knowing you win 43% tells you nothing you can *change* |
| signals / copy trading | **substitutes** — someone else decides, you follow | the skill stays with the person you're copying. Stop paying and you're back where you started |

Nobody sits in the gap. The gap is a product that is **prescriptive and skill-building**: it names
one thing you are doing wrong, in your own numbers, and then holds you to fixing it. Other traders
appear in it — but as a mirror, a benchmark and a source of pressure, never as a signal.

Positioning line to aim at: *the journal tells you what happened. Astra tells you what to stop
doing, and makes you prove you stopped.*

#### The asset the competitor cannot copy

It is not that Astra's cards are prettier — though Artem is right that they are, and that is the
reason there's a fight worth having at all. It is what the card *is* structurally.

A journal's hard problem is data entry. It has to nag people into logging trades, and people don't,
so most journals are half-empty and their statistics are a lie of omission. Astra has the opposite
problem already solved: **a trader opens Astra voluntarily, at the emotional peak right after a
trade, and types in the symbol, direction, leverage, entry, exit and PnL — because that is the price
of getting the card.** The card is a consent moment for trade data that nobody has to be nagged into.

That data is already being stored. `public.cards` is one row per card with the whole `CardState` as
`jsonb`, and `TradeState` in `src/types.ts` already carries symbol, direction, leverage, entry
price, exit price and PnL. What is missing is a *when* (the trade's own timestamp, not the row's),
a stop, and a table that treats these as trades rather than as drafts of a picture.

**So the card is the trojan horse.** Every card already made is a logged trade. Build the journal
underneath the card and it fills itself.

#### Seven ideas, best first

**1. Sealed plans — the one that actually builds skill.** Every journal is post-hoc, which is why
every journal is a mirror. The loop that works in every other skill domain is: commit to the plan
*before*, compare to the outcome *after*. So: before entering, the trader spends twenty seconds on a
**plan card** — symbol, direction, intended entry, stop, target, size, and one sentence of reasoning
(*"H4 supply retest, expecting rejection"*). Same visual language as the PnL card, same editor.
When the trade closes, Astra pairs the plan against what actually happened.

That pairing is the only way to compute the questions that matter, and none of them are answerable
from outcome statistics:

- Did you take your stop, or move it?
- Did you size as planned, or double down?
- Did you cut winners before target while letting losers run past the stop?
- How many trades had no plan at all? (the boredom trades — usually the expensive ones)
- **What is your win rate grouped by the reason you yourself wrote down?**

The last one is the feature. *"Your 'breakout retest' trades: 61% over 34. Your 'it's pumping'
trades: 22% over 18. You took eleven of the second kind last month."* It turns the trader's own
vocabulary into a measurable variable. No competitor has it, because it requires capturing intent
before the trade, which requires a reason to open the app before a trade — and Astra is the only one
of these products that already has a reason people open it.

**Sealed** is the important half of the word. A plan posted publicly before a trade resolves is just
a signal again, with the same problem Artem identified. So a plan is committed privately and only
unseals when the trade closes. That is a commit-reveal: it proves the plan wasn't edited in
hindsight, it cannot be followed as a tip, and it is the honest version of "social trading."

**2. Verified cards — the keystone.** Everything social in trading dies on fake numbers. Manual
entry means everyone has a 90% win rate. Connect a read-only exchange API key (Bybit, Binance, OKX)
or import an MT5 statement, and trades arrive by themselves — and a card built from an imported
trade earns a ✓ that a hand-typed card does not.

Look at what that single badge does at once:

- it solves the journal's data-entry problem completely, without ever asking anyone to "log a trade"
- it makes the ✓ the status symbol, so connecting is *aspirational* rather than a chore
- it makes the card product itself better, which protects the thing Astra is already best at
- it is unglamorous infrastructure the competitor hasn't built, so it is a real moat

**3. A coach that finds edges instead of narrating statistics.** The reason the competitor's AI is
vague is architectural, not a matter of prompt polish. It is handed a table of aggregates — winrate,
PnL, frequency — and asked for advice. Aggregates contain no counterfactual, so the model has
nothing to say and says it beautifully. That failure mode is unfixable from the prompt side.

The fix is to invert who does the analysis. **Compute the findings in code; let the model only write
the sentence.** Run conditional splits over the trader's own trades — for each candidate segment,
win rate and expectancy inside the group against outside it, gated on sample size, ranked by dollar
impact:

| segment | why it's worth splitting on |
|---|---|
| hour of day, day of week | most retail traders have one session that is quietly negative |
| hold duration bucket | separates the plan from the panic |
| leverage bucket, risk as % of balance | the blow-up variable |
| symbol / asset class | people have one coin they cannot trade and won't admit it |
| trade index within the session | the 4th trade of a day is a different animal from the 1st |
| **minutes since the last loss** | tilt. Needs ordered trades with timestamps, which is why a stats dashboard can't see it |
| plan vs no plan, stop honoured vs moved | from idea 1 — the discipline variables |

Take the top three by `|impact| × confidence`, hand Claude the raw numbers, and require every
sentence to cite one of the numbers it was given. The output is not "work on your entries." It is
*"in your last 40 trades, entering within 30 minutes of closing a loser won 28% against 61%
otherwise. That one pattern cost you $1,840 this quarter."* Deterministic, checkable, and it names
an action.

**4. Rules — the loop that keeps the subscription alive.** A finding becomes a switch: *no trades
within 30 minutes of a loss.* Once it's on, incoming trades are checked against it. *"You broke it
twice this week; those two trades lost $310."* The competitor's AI writes a paragraph you read once.
A rule generates a reason to open the app every week, forever, and it is the part that actually
changes behaviour.

**5. The hook: one number.** After connecting an account, one line: *Astra found the habit costing
you the most — $1,840 this quarter.* Computed, not claimed. That is the conversion moment, and it is
also the entire marketing campaign.

**6. Social, with no signals in it.** Three primitives, none of which is a tip:

- **Benchmarks, not a PnL leaderboard.** A leaderboard ranked by return rewards exactly the
  behaviour that empties accounts, and it makes everyone below the top ten churn. Rank on a
  *discipline* score — plan adherence, stop discipline, risk consistency, drawdown control — and show
  it as a percentile against traders with similar account size. It is more honest, it is defensible
  in marketing, and it's the one leaderboard where a losing month can still be a good month.
- **Accountability groups of three to eight.** You see each other's rule adherence and unsealed
  plans after close — never live entries. A weekly digest to the group. Pressure, not signal.
- **Structured post-mortems.** A card can be opened for critique, but the commenter answers a fixed
  prompt — *what would you have done differently at entry, at exit* — rather than a free comment box
  that fills up with rocket emojis.

**7. The card as a case study, not a brag.** Today a card is a screenshot of a number. Let a public
card open into the trade behind it: hold time, leverage, size relative to account, the unsealed
plan. The flex is the hook that makes people post; the data underneath is what makes the feed worth
reading. Again — only possible because the card came first.

#### What I would actually build, in order

The temptation is to start with the social layer because it looks like the big idea. It isn't; it's
the part that only works once there is honest data to be social about.

| | | why here |
|---|---|---|
| 0 | finish `SETUP-PLANS.txt` | there is no point pricing a coach on a checkout that isn't live |
| 1 | `trades` table + CSV/manual import + a stats page | this is the table-stakes journal. It has to exist before anything below has inputs |
| 2 | **the coach, on whatever data exists** | the cheapest possible test of the whole thesis. No exchange work needed. If the findings aren't sharply better than the competitor's horoscope, the rest isn't worth building |
| 3 | card auto-fill from a real trade | small once `trades` exists, and it makes the journal immediately pay for itself inside the product that already works |
| 4 | read-only exchange import (**one** exchange first) + the ✓ | the moat, and the end of data entry |
| 5 | sealed plans and rules | the skill-building loop, now that it has verified outcomes to pair against |
| 6 | groups, benchmarks, the feed | last, on top of verified data |

Step 2 before step 4 is the deliberate part. The coach is the only piece that decides whether this
product has a reason to exist, and it can be tested on a hundred hand-typed trades. Building the
exchange integrations first would mean spending the hardest month of work before learning anything.

#### What it costs to run

Worth settling now, because "good AI is expensive" is the wrong reason to end up shipping the vague
kind. A weekly coach report is one call: roughly 3–5K input tokens (the system prompt plus the
precomputed findings as JSON) and 600–900 output tokens. On Claude Opus 5 at $5 / $25 per million
that is about **$0.04–0.05 a report — call it $0.20 per paying user per month** at weekly cadence,
against $5.99. Caching the system prompt takes it lower.

So the competitor's vagueness was never a cost problem. It is a design problem, and design problems
are the good kind to inherit.

#### What this breaks, architecturally

Astra today is a browser app talking straight to Supabase, protected by row-level security, with
exactly two server functions (`api/checkout.ts`, `api/nowpayments-ipn.ts`). Two things in the plan
above do not fit inside that model, and both are in step 4 or later:

- **Exchange API keys can never touch the browser.** Even read-only, they need to be encrypted at
  rest and used by a scheduled server-side sync. That means a real cron function and a secret store
  — the first genuine departure from "no server."
- **The coach call needs an Anthropic key**, so it is server-side too: a function that reads the
  precomputed findings, calls the API and writes the report back to a `coach_reports` table.

Both are ordinary work. They are noted because they are the first time this project stops being a
static site with a database behind it, and that is worth deciding on purpose rather than discovering.

One more thing to keep an eye on rather than worry about: as long as Astra never publishes
actionable live positions and never touches anyone's funds, it stays an analytics tool. The
sealed-until-close rule in idea 1 is what keeps it there, which is a second reason to build plans
that way.

#### Scope, honestly

This is months of work, not a weekend, and the competitor has already shipped. The counter is that
they shipped the easy half — statistics anyone can compute and an AI wrapper over them — and the
half they skipped (verified data, captured intent, findings instead of descriptions) is both the
hard part and the part that makes the product work. Astra also starts with the one thing they can't
retrofit quickly, which is a card people actually want to post.

Step 2 is the decision point. Everything before it is cheap, and everything after it should wait on
what it shows.

---

## Start here (2026-09-19)

### A front page at `/`, the editor moved to `/cards`, and one nav in every topbar

Artem: *"Near the Astra logo on top, make a clickable header title 'Payments' or Subscriptions, or
smth else you decide. Also, create a front page, that basically explains what Astra is, and has a
full description of our Plans, what our app can do and etc. Basically the home page. That's why
there should be a header called 'Cards' that takes you to our main page currently where you
actually design the PnL card"*.

Nothing about payments changed. `SETUP-PLANS.txt` is still the thing to do, and until it is done
the live site behaves exactly as **Start here (2026-09-17)** describes.

**The nav is called Plans, not Payments or Subscriptions.** Every other string in the app already
says *plans* — *See plans*, *Plans & promo codes*, the page's own heading — and a fourth word for
the same page would have been the only one that had to be learned.

#### The paths

| | | |
|---|---|---|
| `/` | front page | public |
| `/cards` | the studio | behind the sign-in gate, as before |
| `/pricing` | plans | public, unchanged |

Anything unknown falls through to the front page, not the editor: a stranger who mistypes should
land on the page that says what this is. `pageFor` in `src/lib/route.ts` is three lines and the
paths are exported as `HOME_PATH` / `STUDIO_PATH` / `PRICING_PATH`, because the editor's path is
now the kind of thing that gets typed in several files and must not be spelled twice.

**The editor moved off `/`, so old links to it now open the front page.** That is intended — a
returning customer sees the pitch once and clicks *Cards* — but it is worth knowing if anyone
reports the app "not opening".

#### The nav

`src/components/SiteNav.tsx`: the wordmark (the way home) and **Cards** / **Plans**, with the
current one in white over a hairline. It is the left half of the topbar on all three pages, and it
replaced the subtitle that used to sit under the wordmark — the nav says which page this is, and
saying it twice made the bar noisy. Each entry is a real `<a href>` whose plain click is
intercepted, so ⌘-click, middle-click and *copy link address* still work.

Under 620px the wordmark hides and the mark alone stays: the links are the part someone actually
needs on a phone.

Two buttons went with it, both duplicates of a nav entry now: *Back to editor* on the plans page,
and the *Plans* button that was briefly on the front page's topbar.

#### The front page (`src/components/HomePage.tsx`)

Hero, *How it works* in three steps, *What Astra does* in eight, the plans in full, a closing call
to action, a footer. The plan copy — prices, the saving, the free limit, both feature lists — comes
from `src/lib/billing.ts`, so the front page and `/pricing` cannot disagree. `FREE_FEATURES` and
`PAID_FEATURES` moved there from `PricingPage.tsx` for that reason.

**The card in the hero is the real renderer**, not a screenshot: `CardPreview` painting a real
`CardState`, with the six accent swatches under it wired to the live card. It is the one claim on
the page worth demonstrating rather than asserting, and with no artwork, avatar or logo there is
nothing to decode, so it lands in the first frame or two. Its `frameId` is forced to `none` —
the default pin badge draws its empty-avatar placeholder inside a white pin, which on a front page
reads as a broken image rather than as "your face goes here".

#### The dead end that had to be fixed with it

`/cards` signed out is the full-screen `AuthScreen`, which has no topbar — so the first person to
follow *Cards* from the front page would have had no way back but the browser button. The sign-in
card's wordmark is now a link home, and there is a *What is Astra?* link under the footnote,
because a link nobody can see is not a way out.

#### Deployed

Pushed as `568f79b`; <https://nexocards.vercel.app> then served `assets/index-D2xGycJD.js`, the same
hash as the local `npm run build`. Checked on the live site (2026-09-19): `/`, `/cards` and
`/pricing` all answer 200 when loaded directly, so `vercel.json`'s rewrite covers the new path too.

#### Checked

`npm test` (264 pass — `pageFor`'s case was rewritten for the three paths), `npm run typecheck`,
`npm run build`. Screenshots at 1440px and at a 390×844 phone, taken through CDP with device
metrics overridden — a maximised window will not resize, and the extension's screenshots of it are
always desktop-width, which is worth knowing before trying to check a phone layout that way:
`Desktop\Astra-frontpage\` — `front-desktop.png`, `front-phone.png`, `plans-desktop.png`,
`plans-phone.png`, `signin-phone.png`.

---

## Start here (2026-09-17)

### Plans: Monthly $5.99, 3 months $12.99, one free card a month, promo code MM33

Artem: *"I already have some demand for my product, so please create a subscription page with 2
tiers. Monthly - 5.99$ per month, and 3 month, 12.99$ per 3 months. Make it in the same style as
our website. Also, create the limit, so that a user without a paid plan can only generate 1 card
per month. Also, there will be a promocode "MM33" that gives you a paid plan for free for 3
months."* Asked which payment provider: *"Crypto, a very popular one. Also, would be good to add
Apple Pay"*.

**Pushed at Artem's request, before setup** (*"Put the setup and tutorial in a text file, but for
now, push what there is for now"*). The step-by-step setup — plus everyday tasks: see who pays, add
or switch off a code, change prices or the free limit, give someone time by hand, and what to check
when a payment did not credit — is in **`SETUP-PLANS.txt`** at the repo root, also copied to
`Desktop\Astra-plans\`. Until its steps are done, the live site shows the plans page, Subscribe
answers "Payments are not set up yet", a promo code answers "Promo codes are not available yet"
(added just before the push, in place of the raw "could not find the function" error), and exports
are not counted — see *Deploy order* below.

#### What was built

**The payment provider is NOWPayments** — one of the largest crypto gateways (USDT, USDC, BTC, ETH,
SOL and hundreds more). It is also the answer to Apple Pay: its hosted invoice page takes cards,
Apple Pay and Google Pay through its fiat partner (Mercuryo), so a single checkout covers both.
**Apple Pay has to be switched on in the NOWPayments dashboard (fiat payments), and that requires
their business verification (KYC).** Until it is, customers see crypto only, and the plans page only
mentions cards and Apple Pay once `VITE_CARD_PAYMENTS=on` is set, so it never promises something
the checkout does not offer.

Crypto has no automatic monthly billing, so **plans are paid in advance and do not renew**: pay $5.99,
get a month; pay $12.99, get three. Paying again while a plan runs adds the time to the end of it,
and the page says so.

**The plans page, `/pricing`** (`src/components/PricingPage.tsx`). Public, so a visitor sees prices
before signing up. Same look as the editor: the topbar, near-black panels with hairline borders,
square corners, white as the only accent. Three tiers side by side (stacked on a phone): Free $0,
Monthly $5.99, 3 months $12.99 with a *Save 28%* badge and "$4.33 a month". Below: the payment
line, the promo-code box, four short questions and answers. Signed in, it shows your plan ("Free · 1
of 1 card left this month" or "Unlimited · until 17 Dec 2026"). Signed out, the buttons say *Sign
in to subscribe*, and after signing in you come back to the plans page instead of the editor. On
the way back from paying, it keeps checking and says *Waiting for your payment…* → *Payment seen —
waiting for the network to confirm it* → *Payment received — your plan is active*.

Screenshots: `Desktop\Astra-plans\` — `pricing-desktop.png`, `pricing-phone.png`, `plan-lines.png`
(the four states of the line under the export buttons), `limit-dialog.png`.

**The limit: one card a month on a free account.** What counts as "a card" had to be decided, and
the rule is **the numbers and the name on it** — the mode, the trade or period figures, the
handle/wordmark/footer. Colour, background, frame and export size are not part of it. So a free
user can export their month's card as PNG, then MP4, then copy it, and restyle it in between,
without being charged a second card; typing different numbers makes a new card. Without this, a
failed video export, or downloading and then copying the same card, would have used up the month.
The month is the calendar month in UTC; it comes back on the 1st.

In the editor:
- every export — Download PNG, Download MP4, Copy, Share, and Ctrl/⌘+S — asks the database first;
- a refused export does not render anything and opens a dialog: *"This month's free card is used"*,
  when it comes back, the price, and *See plans*;
- a line under the export buttons says where you stand ("1 free card left this month. Exporting
  uses it on this card." / "This is this month's free card — restyle and export it as often as you
  like." / "This month's free card is used; a new one comes on 1 Oct 2026." / "Unlimited — Your plan
  runs until …");
- the topbar has **Upgrade** (free) or **Plan** (paid), and the profile menu has *Plans & promo codes*.

**Where the limit is enforced: in the database, not the browser.** The app is a bundle anyone can
read and edit, so a check in JavaScript alone would be a suggestion. `claim_export` in Postgres
counts and records each export under a per-account lock (two exports at once cannot both take the
last free card). The tables are read-only to the browser, so an account cannot insert a
subscription, delete its export history to reset the counter, or list promo codes. One honest
limit: the card is *drawn* in the browser, so someone who edits the JavaScript can skip the question
entirely. Stopping that would need server-side rendering, which this app deliberately does not have.
The limit stops everyone using the site as built.

**MM33.** Stored only in the database (`promo_codes`); it is not in the JavaScript bundle (checked
by searching the build). Gives 3 months, **once per account**, any letter case, spaces ignored;
redeeming while already paid adds 3 months to the end. After 10 wrong codes in an hour an account is
told to wait, so codes cannot be guessed. To add another code later, in the Supabase SQL editor:
`insert into public.promo_codes (code, months) values ('NEWCODE', 1);` — to switch MM33 off:
`update public.promo_codes set active = false where code = 'MM33';`.

**Seeing who pays.** Supabase → Table Editor → schema `admin` → `subscribers`: email, name, paid
until, active or not, whether it came from a payment or a promo, which codes. Raw rows are in
`public.payments` (every checkout and its NOWPayments status) and `public.card_exports`.

#### Files

| | |
|---|---|
| `supabase/schema.sql` | new **billing** section at the end: 7 tables, `plan_status`, `claim_export`, `redeem_promo`, `record_payment`, `admin.subscribers`. Re-runnable like the rest. |
| `api/checkout.ts` | Vercel function. Checks the Supabase session, takes the price from `billing_plans` (never from the request), creates a `payments` row and a NOWPayments invoice, returns its URL. |
| `api/nowpayments-ipn.ts` | Vercel function NOWPayments calls on every status change. Rejects anything without a valid HMAC-SHA512 signature, then calls `record_payment`, which grants the months once on `finished` and only if the amount covers the plan. |
| `src/lib/billing.ts` | prices for display, the card key, the calls to the database and `/api/checkout`, all the wording |
| `src/components/PricingPage.tsx`, `LimitDialog.tsx`, `PlanNote.tsx` | the page, the dialog, the line under the export buttons |
| `src/lib/route.ts`, `src/main.tsx`, `vercel.json` | `/` is the studio, `/pricing` the plans; `vercel.json` makes a reload of `/pricing` work on Vercel. **Superseded 2026-09-19:** `/` is the front page and the studio is `/cards` |
| `src/App.tsx`, `src/lib/share.ts`, `ProfileMenu.tsx` | every export goes through `gateExport`; copy passes the check *into* the clipboard write, because Safari only allows the write inside the click |
| `dev/billing.html`, `dev/billing-sql.mjs` | every plan state on one page; the SQL checks below |

#### Setup — in this order

1. **Run the SQL.** Supabase → SQL Editor → New query → paste the whole of `supabase/schema.sql` →
   Run. It is safe to run again over what is already there.
2. **NOWPayments.** Make an account at nowpayments.io, add a payout wallet, then in the dashboard:
   create an **API key**, and under IPN settings generate an **IPN secret**. Optional: apply for
   **fiat payments** to get cards / Apple Pay / Google Pay. Note that each coin has a minimum
   payment; $5.99 is above the minimum for USDT (TRC-20) and most stablecoins, but some coins will
   not be offered at that amount.
3. **Vercel → Project → Settings → Environment Variables** (Production), then redeploy:
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API → *service_role*. It skips all
     row-level security: it must only ever be here, **never** in a `VITE_` variable or in `.env.local`.
   - `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`
   - `SITE_URL` = `https://nexocards.vercel.app` (or the new domain once it is added)
   - later, once Apple Pay is approved: `VITE_CARD_PAYMENTS` = `on`
4. **Push** (`git push`). Then buy the monthly plan once yourself and check `admin.subscribers`.
   To test without real money first, NOWPayments has a sandbox: a separate sandbox account's keys
   plus `NOWPAYMENTS_API_BASE` = `https://api-sandbox.nowpayments.io/v1`.

**Deploy order.** If the site is pushed before step 1, exports keep working and are simply not
counted: the database answers "function not found" (`PGRST202`) and only that answer lets an export
through, with a console warning. It cannot be produced by a user. Any other failure — network down,
session expired — blocks the export with a message, so blocking the request in the browser does not
get around the limit.

#### How it was verified

- **The SQL in real Postgres.** No database here has the service key, so `supabase/schema.sql` was
  run in PGlite (Postgres 18.3 compiled to WebAssembly; Supabase runs 15–17, and nothing used here is newer than 11) with stand-ins for Supabase's `auth` and
  `storage` schemas and its three roles, then driven as `authenticated` / `anon` / `service_role`
  (`dev/billing-sql.mjs`). **33 of 33 checks pass**, including: the schema applies twice; first card
  allowed; the same card again as MP4 allowed and still "1 used"; a different card refused and not
  recorded; last month's export does not count; direct insert/delete on `card_exports`, insert on
  `subscriptions`, reading `promo_codes`, calling `extend_subscription` / `record_payment`, and reading
  `admin.subscribers` are all *permission denied* for a signed-in user; `' mm33 '` gives exactly 3
  months, a second time says already redeemed; a paid account exports any number of cards without
  touching the free count; the 11th wrong code in an hour is throttled; one account cannot see
  another's rows; `waiting` does not credit, `finished` credits, a retried `finished` does not
  credit twice, a late `waiting` does not overwrite `finished`; the quarterly plan is 3 months; a
  finished payment below the price is refused; paying while paid extends from the end date.
- **The API functions** against a mocked Supabase and NOWPayments (`tests/api/billing-api.test.ts`,
  12 tests): the IPN signature matches NOWPayments' own documented algorithm and rejects a changed
  body, wrong secret or missing header; a forged call gets 401 and never reaches the database; a
  signed `finished` call passes every field to `record_payment`; checkout ignores a price sent by
  the browser, sends NOWPayments exactly the fields above, marks the payment failed on a refusal;
  no session / bad session / unknown plan / missing keys are refused.
- **The client logic** (`src/lib/billing.test.ts`, 15 tests): prices, $4.33 and 28%, the card key
  (restyling keeps it, different numbers or name change it), plan-state wording, payment polling,
  dates.
- `npm run typecheck` clean (now also typechecks `api/`); `npx vitest run` **264** tests pass
  (237 before); `npm run build` succeeds.
- **Screenshots** from headless Chrome against the dev server (`Desktop\Astra-plans\`). They caught
  one bug, fixed: dates were written in the browser's language inside English sentences ("1 окт.
  2026 г..", "сентябрь's"); they are now always English and UTC ("1 Oct 2026").

**Deployed.** Pushed as `da53c86` + `0ddcfcc`; <https://nexocards.vercel.app> then served
`assets/index-DrCilXEc.js`, the same hash as the local `npm run build`. Checked on the live site
(2026-09-17 04:46): `/pricing` loaded directly answers 200 with the app (so `vercel.json`'s rewrite
works); `POST /api/checkout` answers 503 *"Payments are not set up yet. Try again later."* and
`POST /api/nowpayments-ipn` answers 503 *"not configured"* — so Vercel did pick up both functions
from `api/` and they run; they are only waiting for their keys.

**Not verified:** a real payment through NOWPayments (needs your account and keys), the functions
running on Vercel with keys set, the SQL on the real Supabase project, and the signed-in editor with a real
account on the free plan. The first real checkout after setup is the test of all four — do the
monthly plan once, confirm `admin.subscribers` shows it, then try exporting a second different card
from a fresh free account.

## Start here (2026-09-16)

### Phone exports still silent: Safari's encoder hands over a magic cookie (2026-09-16, latest)

Artem, after the first pass below was deployed: *"still no sound on my phon, on PC there is sound.
The quality of the video is good in both, so keep it unchanged"*. Asked: **iPhone, Safari**; the
toast said *"60 fps, every frame, in 37.1 s"* — so it was already frame-exact, and **the first
pass's diagnosis (no audio codecs, live recorder) was wrong for this phone**; it is Safari 26, which
has `AudioEncoder`. The phone's file, sent to the PC, played silent there too, with Windows saying
*"the format mp4a is not supported"*.

**The file itself says why** (`Downloads/Telegram Desktop/september-2026-pnl 4.mp4`, dumped with
`scratchpad/dump-sound.mjs`): the video track is identical to the PC's export of the same clip
(1393 frames, same `stts`). The sound track's `esds` DecoderSpecificInfo held **39 bytes starting
`03 80 80 80 22 …`** — a whole ES descriptor with its own `04` and `05 … 12 10` inside — where the PC
file holds the bare AudioSpecificConfig `12 10`. Safari's `AudioEncoder` puts Apple's AAC *magic
cookie* in `decoderConfig.description`, not the ASC the WebCodecs registry asks for; `writeMp4`
wrapped it in a second descriptor, and no player could read the codec configuration. The same file
also shows Safari's timing differs from Chrome's: an empty edit of 22 ms and two extra 6-byte packets
at the front (1003 packets vs 1001).

**What changed** (audio only; nothing on the picture path):
- `audioSpecificConfigFrom` in `mp4read.ts` returns the ASC from either form (a description starting
  `0x03` is read through `readEsds`; no valid ASC starts with `0x03`, that is object type 0), or null.
  `transcodeAudio` uses it and fails over when it gives null.
- When the encoder answered with the cookie (`appleEncoder`), `exportOffline` uses `copyAudio` — the
  clip's own packets, exact by construction — instead of Safari's re-encode, whose timing was never
  measured and which the phone file shows starting late. The re-encode is kept only when the sound
  cannot be copied. Chrome's re-encode path is untouched.

**Verified**, isolated Chrome 152, the TikTok clip, `AudioEncoder` replaced by a subclass that hands
out the description as a cookie laid out byte for byte like the phone file's (`scratchpad/safari-cookie.js`):

| | sound in the file | `esds` ASC | off the source | corr |
|---|---|---|---|---|
| Chrome's encoder, full clip | AAC-LC re-encoded | `1210` | 0 ms | 0.996 |
| Safari-style encoder, full clip | clip's own HE-AAC v2 | `eb8a0800` (the clip's) | **0 ms** | 0.998 |
| Safari-style encoder, 5 s + 6 s | clip's own, 6.000 s | `eb8a0800` | **0 ms** | 0.9999 |

`npm run typecheck` clean; `npx vitest run` **237** (2 new: the cookie bytes from the phone file give
`12 10`; a bare ASC passes, junk is refused). **Not verified on the iPhone itself** — that needs
Artem to export once more on the phone.

**Deployed.** Pushed as `d286029`; <https://nexocards.vercel.app> then served
`assets/index-C-o7Pnsd.js`, the same hash as the local `npm run build`.

**Confirmed on the iPhone (2026-09-16 03:38).** Artem: *"Works now"*, and sent the export
(`Downloads/Telegram Desktop/september-2026-pnl latest.mp4`, the same 60 fps clip as before). In the
file: `esds` holds the bare ASC `12 10`; the sound is the clip's own AAC-LC 44.1 kHz packets (1002,
first at −24.67 ms) with one edit, `media_time` 1088 — `copyAudio`, as designed; the video track is
identical to the PC export of that clip (1393 frames, same `stts`). Its sound against the PC export
`september-2026-pnl (7).mp4` (whose sound path measured 0 ms off the source), 1 ms envelopes
(`scratchpad/phone-vs-pc.js`): **0 ms** over the whole 22.9 s (corr 0.998), and **0 ms** in the
first, middle and last 5 s each (corr 0.998) — no offset and no drift.

### Exports made on a phone came out silent (2026-09-16, first pass — diagnosis wrong for Artem's phone)

Artem: *"when I download the video from my phone and export it, it downloads without sound, while at
the PC it's all good. Fix it"*

**Why.** `frameExactAvailable()` in `video.ts` required `AudioEncoder` and `AudioDecoder`. Safari
before 26 (any iPhone not on iOS 26) has the WebCodecs *video* codecs but neither audio one, so a
phone never got the frame-exact export. It went to the live recorder, which builds its sound from an
`AudioContext` created in `attachAudio` — several awaits after the tap. iOS only lets a context start
inside the gesture, so `resume()` left it suspended, `attachAudio` returned null without a word, and
the file was recorded with no sound track. (A phone whose AAC encoder refuses every format would
land in the same place through `transcodeAudio` throwing.) Not reproduced on a real phone — there is
none here — but it is the only path on which the PC and a phone differ, and it matches the report.

**What changed.**
- **`frameExactAvailable()`** now needs only `VideoEncoder`, `VideoFrame`, `VideoDecoder`,
  `EncodedVideoChunk` and a canvas. `webCodecsAvailable()` (the live WebCodecs recorder) is unchanged.
- **`copyAudio` in `offline.ts`**: when the sound cannot be re-encoded — no audio codecs (returns
  null), or `transcodeAudio` throws — the clip's own AAC packets for the window are copied into the
  file unchanged, with the packet before the window kept for AAC's overlap. PC Chrome still takes the
  re-encode path first; nothing about it changed.
- **`writeMp4`** takes `trimStartUs` / `trimLengthUs` on the audio track and writes them as an edit
  (`media_time` = the hidden lead-in, `segment_duration` = the window), after the empty edit when the
  sound starts late. Without a trim it writes exactly what it wrote before.
- **The trap: HE-AAC's rate.** The first cut wrote the copied track at the header's rate (22 050 Hz
  for a TikTok download) and the sound came out **34 ms late** on the full clip, **26 ms** on a
  trimmed one — exactly half the lead-in the edit asked to skip. Players count edit ticks at the rate
  the sound *plays*; the TikTok file itself says 44 100 in `mdhd` and `mp4a`, with 2048-tick packets
  and `media_time` 7106. `copyAudio` now writes `mp4a.40.5`/`.29` at ≤ 24 kHz at twice the header
  rate, and `.29` (PS) as stereo.
- **Live recorder on iOS:** `renderCardVideo` now opens the `AudioContext` before its first await
  (`openAudioContext`) and hands it to `attachAudio`; it is closed if the export goes frame-exact.
  So a clip that still needs the live recorder on a phone (WebM, a codec it will not decode) should
  keep its sound too. That part is **not verified** — it only matters on a real iPhone.

**Verified**, isolated Chrome 152, local mode, `ssstik.io_@hisrevenue_1789416295020.mp4` (19.1 s,
HE-AAC v2, first audio packet at −161 ms), `AudioEncoder`/`AudioDecoder` deleted from `window` to
stand in for the phone, sound compared with the source by 1 ms envelope cross-correlation
(`scratchpad/phone-sound.js`, same method as `dev/av-sync.js`):

| | path | frames | sound in the file | off the source | corr |
|---|---|---|---|---|---|
| PC (codecs present), full clip | frame-exact | 573, 30 fps | AAC-LC 44.1 kHz, re-encoded | 0 ms | 0.996 |
| no sound codecs, full clip | frame-exact | 573, 30 fps | HE-AAC v2, copied | **0 ms** | 0.998 |
| PC, window 5 s + 6 s | frame-exact | 180 | AAC-LC, re-encoded | 0 ms | 0.986 |
| no sound codecs, window 5 s + 6 s | frame-exact | 180 | HE-AAC v2, copied, 6.000 s | **0 ms** | 0.9999 |
| `renderCardVideo` itself, no sound codecs | **frame-exact** (was live, silent on iOS) | 573 | HE-AAC v2, copied | **0 ms** | 0.998 |

`npm run typecheck` clean; `npx vitest run` **235** tests (7 new: `copyAudio` trims, late sound,
HE-AAC rate, refuses non-AAC and out-of-file packets; the writer's trim edit with and without a
delay; a trimmed track read back by `demuxMp4` on the right timeline). The first run in a cold Chrome
failed the PC full-clip export once with *"The video decoder did not finish."*; every run after it
passed, and that path was not touched.

**Not verified:** a real iPhone or Android phone. Worth doing once deployed: export a clip on the
phone and check the toast says *"every frame"* (frame-exact) and the file has sound. If it says
*"recorded live"* and is silent, the clip is one the phone's decoder refuses — the console line
*"Frame-exact export unavailable…"* says why.

**Deployed.** Pushed as `da8a03a`; within about 10 s <https://nexocards.vercel.app> served
`assets/index-DayxKi21.js`, the same hash as the local `npm run build`.

## Start here (2026-09-15)

### "JWT expired" was this PC's clock, not the app (2026-09-15)

Artem reported *"JWT expired mistake"*. Windows was set to *SE Asia Standard Time* (UTC+7), so the
machine's UTC read 15:15 while Supabase's `Date` header said 20:15. Supabase tokens live one hour on
the server's clock; the client thought each one had five more hours, never refreshed, and every
request after the first hour failed with `JWT expired`. Artem switched the time to automatic and it
cleared up; the two clocks then agreed to the second. **No code was changed for this.** If the
error comes back, check the clock first (`Invoke-WebRequest <supabase-url>/auth/v1/health -Headers
@{apikey=...}` and compare its `Date` with `(Get-Date).ToUniversalTime()`).

### Export review: two hardening fixes, nothing else touched (2026-09-15, latest)

Artem: *"let's just use our own video decoder/encoder … Optimize it to the max again, however, right
now it's very good so be careful not to break it. If you find any vulnerabilities, then do and
optimize smth. If not, then it's better to not touch it."* He also asked, before that, whether a
ready-made library would be better; the answer was to keep this pipeline (it already uses the
browser's own WebCodecs decoders and encoders — the only custom parts are reading and writing the
MP4), with **Mediabunny** as the one library worth trying later if WebM/VP9/AV1/Opus clips matter.

**Checked and left alone, because they are already right:**
- **H.264 level.** The requested codec string says level 4.0, which does not allow 60 fps at
  1680 × 1140 — but the encoder writes its own level: **4.2** in the 60 fps export, **5.0** in the
  30 fps ones (read from `avcC` and the SPS). The files are valid.
- **Background tabs.** A chain of 50 `setTimeout(0)` in a hidden tab took **43.8 s** (0.2 s in
  front), which suggested the export's progress yields would stall it. Measured on the real engine
  instead: the 19 s clip exported in **11.1 s hidden** and 12.0 s in front — the yields follow codec
  events, not each other, so they are not chained and not throttled. Not changed.
- **Memory.** `openClipBytes` loads the whole clip, but uploads are capped at 80 MB
  (`MAX_VIDEO_BYTES`), and a 30 s window is at most ~1 800 frames, far below the spread-argument
  limits in `mp4write.ts`.
- Bitrate (0.18 bit/pixel/frame, 6–24 Mbit/s) and `latencyMode: 'realtime'` (see *The lag at
  0.5 s*: `quality` hangs a hardware encoder) — not changed.

**Fixed:**
1. **A damaged file failed the export instead of falling back.** `demuxMp4` throws `RangeError`
   when a box runs past the file's end, and that is not `OfflineUnavailable`, so `renderCardVideo`
   rethrew it. And a corrupt `stsz` count (up to 4 294 967 295) went straight into `new Array(count)`.
   Now `exportOffline` turns any demuxer exception into `OfflineUnavailable` (the live recorder then
   tries the browser's own player), and `readStbl` refuses any table whose entry count does not fit
   its box — `stsz`, `stts`, `stsc`, `stco`/`co64`, and skips a `ctts`/`stss` that does not.
2. **A track that starts late came out early.** `readEdit` skipped empty edits (`media_time −1`),
   which is how a file says "this track begins N ms after the movie starts". Sound with a 200 ms
   empty edit was read as starting at 0 — 200 ms early in the export. The delay (movie timescale,
   from `mvhd`) is now converted to the track's timescale and subtracted from the edit offset.
   Our own `writeMp4` writes exactly this for a late track, so the new test round-trips it.

**Verified:** `npm run typecheck` clean, `npx vitest run` **228** tests (2 new in
`mp4read.test.ts`: the 200 ms empty edit reads back at 200 000 µs; a `stsz` count of 0x7FFFFFFF
leaves the video track out without throwing). The old and new demuxer (`git show HEAD:…` vs the
working copy) give **identical** sample counts, first timestamps and durations on **all 80** MP4/MOV
files in `Downloads` — iPhone clips, TikTok downloads, screen recordings, OBS files up to 28 min,
and every export. None of those 80 has an empty edit, so fix 2 is covered by the unit test only.
The 19 s clip through the real button with both fixes: 573 frames, 30 fps, 0 ms jitter, sound
0 ms off the source (corr 0.996), 10.0 s.

**Trap:** `Target.createTarget` with `background: true` over CDP gives a genuinely hidden tab
(`visibilityState: 'hidden'`) in a Chrome launched *without* the anti-throttling flags — the way to
test background behaviour. A hidden tab cannot load a `<video>` for an upload, so upload in a front
tab of the same origin (IndexedDB and `localStorage` are shared) and call `renderCardVideo` directly
in the hidden one.

**Deployed.** Pushed as `447852c`; <https://nexocards.vercel.app> then served
`assets/index-J2wEQSgt.js`, the same hash as the local `npm run build`.

### A 19 s clip exported laggy while a 23 s one was perfect (2026-09-15)

Artem: *"23s video is good, 19s one is laggy, please fix it. So that every video I upload, is
PERFECT in quality, smoothness, fps, audio is not delayed."*

**Measured first.** `dev/mp4-cadence.mjs` on the Downloads folder: every export over the new clip
(`september-2026-pnl (1)`–`(4)`, 19.1 s) came out at **30, 13.8, 12.5 and 26.5 fps** with up to
233 ms holes — the live recorder's signature — while the same night's exports over the 60 fps and
24 fps clips were frame-exact (59.92 and 23.98 fps, 0 jitter). So the clip, not the length, decided
it: this one was being turned away from the frame-exact path.

**Why.** The clip (`ssstik.io_@hisrevenue_1789416295020.mp4`, a TikTok download) is H.264 918 × 720
at 30 fps — fine — with **HE-AAC v2** sound (`mp4a.40.29`). Its header says 22 050 Hz mono; Chrome
decodes it to **44 100 Hz stereo** (2048 frames a packet, all 415 packets accounted for).
`transcodeAudio` asked `AudioEncoder.isConfigSupported` about the *header's* 22 050 Hz mono before
decoding anything, and Chrome 152's AAC encoder on this machine accepts **44.1 and 48 kHz only**
(checked: 8, 11.025, 16, 22.05, 24, 32, 88.2 and 96 kHz all unsupported, at 1, 2 and 6 channels).
So the check failed, `transcodeAudio` returned null, the export threw `OfflineUnavailable` and
quietly recorded live. The code already knew HE-AAC decodes at twice its header rate — it
configured the real encoder from the first decoded buffer — but the pre-check came first.

**What changed** (`src/lib/offline.ts`, new `src/lib/resample.ts`):
- The up-front check asks only the decoder. The encoder format is chosen from the first decoded
  buffer (`chooseEncoding`): the decoded rate and channel count if the encoder takes them, else
  48 kHz, else 44.1 kHz, then the same at stereo.
- When the chosen format differs from the decoded one (plain AAC at 22.05/32/96 kHz, or more
  channels than the encoder takes), the trimmed window is collected as float planes and resampled
  in one pass by `resample.ts` — a Blackman-windowed sinc, 32 zero crossings, table-driven,
  symmetric so it adds **no delay** — then encoded in 1024-frame buffers on the window's timeline.
  The common path (encoder takes the decoded format) is unchanged.

**Verified** in the isolated Chrome, local mode, the real clip through the real *Upload* and
*Download MP4* buttons:

| | before | after | after, 44.1 kHz refused (forces resampling to 48 kHz) |
|---|---|---|---|
| path | live recorder | frame-exact | frame-exact |
| frames / fps | 238–573, 12.5–30 fps | **573, 30 fps** (the source's own) | **573, 30 fps** |
| jitter / worst gap | up to 53.7 ms / 233 ms | **0 ms / 33.3 ms** | **0 ms / 33.3 ms** |
| sound | — | AAC-LC 44.1 kHz stereo, **0 ms** off the source, corr 0.996 | AAC-LC 48 kHz stereo, **0 ms**, corr 0.997 |
| wall time | ~19 s | 12.1 s | 16.2 s (3.9 s of it the resampler) |

`npm run typecheck` clean; `npx vitest run` 226 tests (7 new in `resample.test.ts`: constant level
exact at the ends, 1 kHz up from 22.05 kHz and 5 kHz down from 96 kHz within 1 % of the ideal tone,
30 kHz removed when going to 48 kHz, an impulse at 50 ms stays at 50 ms).

**Two traps from this session:**
- **PowerShell `$env:VITE_SUPABASE_URL=''` deletes the variable** rather than blanking it, so Vite
  read `.env.local` and the local-mode server came up on the sign-in screen. Start it from bash:
  `VITE_SUPABASE_URL="" VITE_SUPABASE_ANON_KEY="" npx vite --port 5174 --strictPort`.
- **A fresh Chrome profile blocks the second automatic download** of a session silently. Measure
  the export in the page instead: wrap `URL.createObjectURL` to catch the video `Blob`, then demux
  it with `/src/lib/mp4read.ts` and run the `dev/av-sync.js` correlation against it.

**Still not covered — what else sends a clip to the live recorder:** WebM or a VP9/AV1 video track
(the demuxer reads H.264 and HEVC only), sound that is not AAC (Opus or AC-3 in an MP4), and a
decoder the machine does not have. The console says which: *"Frame-exact export unavailable for
this clip; recording live instead: …"*. The resampler runs on the main thread, so a 30 s window that
needs it holds the progress bar still for ~4–6 s.

**Deployed.** Pushed as `63da15f`; about 15 s later <https://nexocards.vercel.app> served
`assets/index-1yXROTOl.js`, the same hash as the local `npm run build`, containing the new code. Not
exercised from here: an export on the live site, signed in.

## Start here (2026-09-14)

### Renamed to Astra, and the editor restyled sharp black and white (2026-09-14, latest)

Artem asked: *"I named this project "Astra" … Change the names everywhere from Nexo to Astra, and
also I dont really like the all-green UI of the website. Make it more rectangle and sharp … Make it
Sharp in some comfortable black & white colors."*

**The name.** "Nexo" appears nowhere in the code or on the page. It exists only in the Vercel
project's address, `nexocards.vercel.app`, which is set in the Vercel dashboard, not in the repo.
What the site actually showed was "PnL Card Studio", so that is what became Astra:

- the topbar and the sign-in card (`App.tsx`, `AuthScreen.tsx`), shown uppercase and tracked;
- the browser tab title (`Astra — PnL cards`) in `index.html`;
- the package name in `package.json` and `package-lock.json`, the README title, the schema header
  comment, and the title passed to the system share sheet.

**Deliberately not renamed:** the `localStorage` key `pnl-card-studio:v2` and the IndexedDB name
`pnl-card-studio`. Changing either would make every browser forget its saved card and uploaded
media. The GitHub repo name and the Vercel address are also outside the code. When the
`astracards.com` domain is bought, add it under the Vercel project's *Domains*, and add the new URL
to Supabase *Authentication → URL Configuration* (Site URL and Redirect URLs), or sign-up
confirmation links will keep pointing at the old address.

**The look.** Everything is in `src/styles/global.css`; no component markup changed.

- Tokens: near-black ground `#0a0a0a`, solid panels `#101010`, hairline borders `#242424`, white as
  the only accent with black ink on it. `--radius` and `--radius-sm` are `0`, and every hard-coded
  `999px` / `50%` / small radius in the editor is now `0` too: buttons, chips, toggles, the avatar
  button, the sync dot, toasts, badges, the spinner.
- The two background glows (green and violet radial gradients) and the green gradient on the
  primary button are gone. The primary button is solid white with black text; selected segments,
  chips and toggles invert to white. Selected tiles get a white outline. Drop shadows are replaced
  by a hairline.
- The brand mark is a white four-point star (a `clip-path` polygon) instead of the glowing green
  rounded square.
- Colour is kept only where it carries meaning: profit readouts use `--profit` (`#4ade80`), loss
  uses `--loss` (`#f87171`), and the Profit/Loss segment gets a thin outline in that colour. The
  local-mode banner went from amber to neutral grey.
- The dark fade under each colour-swatch name is the only gradient left, since it keeps the label
  legible on light swatches.

**Not changed: the card itself.** The exported card still defaults to the *Mint* colour, because
that is the product's design, not the editor's chrome. One click on *Bone* in the Colour section
gives a black-and-white card. Making Bone the default is a one-line change in `defaults.ts` if
wanted.

**Verified.** `npm run typecheck` is clean and `npx vitest run` passes all 219 tests in 18 files. Screenshots from headless Chrome against two dev servers, one in local mode and one
with `.env.local` for the sign-in screen, are in `Desktop\Astra-redesign\`:
`editor-desktop.png`, `editor-phone.png` (about 500 px wide, the narrowest headless Chrome allows)
and `signin.png`.

**Deployed.** Pushed as `e253c3f`; within about 15 s of the push <https://nexocards.vercel.app>
served the page titled `Astra — PnL cards` with the new stylesheet (white accent, zero radius).

### Video export rebuilt as frame-exact; preview pauses while it runs (2026-09-14, latest)

Artem reported, after the accounts and uploads work: *"the videos are laggy when downloading and
also in the preview they are also laggy and the sound doesn't keep up. Optimize that (videos
quality, fps, smoothness, audio, etc) to the MAX."*

**What was actually wrong, measured before anything was changed.**

- The files in `Downloads` from that night say it plainly. `dev/mp4-cadence.mjs` on the three
  `august-2026-pnl (12–14).mp4` exports of the 23 s clip: **13.1, 10.3 and 14.9 fps**, worst gaps of
  300, 233 and 133 ms. The same evening's 12 s export (`1d-realized-pnl.mp4`) was a clean 29.8 fps.
  So it was not every export, it was the long one.
- The source clips are **HEVC**, not H.264: `ssstik.io_1788973037641.mp4` is 1440 × 1080 at
  **59.9 fps** (1393 frames in 23.2 s, six key frames), `ssstik.io_1789071549332.mp4` is 1600 × 1080
  at 24 fps. Both have an audio edit list of 2112 samples, which matters below.
- Reproduced in the isolated Chrome (the recipe under **Environment notes**), local mode, the 60 fps
  clip: the preview on its own is fine — **361 frames decoded, 0 dropped**, each video draw 0.4 ms,
  no long tasks, with sound on or off. Start an export and the same preview drops **293 of 1198
  frames** over 20 s, the main thread's frame gap doubles, and the export comes out at **21.4 fps**
  with 167 ms holes (`baseline-realtime-60fps.mp4` in the scratchpad). That is the whole report:
  the live recorder plays the clip in a second `<video>` next to the preview's, so the one GPU is
  decoding a 60 fps HEVC stream twice while the canvas is painted at 60 Hz and the encoder runs, and
  whatever the `<video>` fails to show, the file fails to contain. The picture stalls while the
  sound carries on, which is "the sound doesn't keep up".
- One assumption in this file was wrong and is corrected: **there is no hardware H.264 encoder in
  Chrome on this machine.** `VideoEncoder.isConfigSupported` with `hardwareAcceleration:
  'prefer-hardware'` answers *unsupported* for High and Baseline alike; the export has always used
  the software encoder, which does **47 fps at 1680 × 1140** (High) on this Intel UHD. The section
  *The lag at 0.5 s* attributes the start-up freeze to "the hardware encoder coming up in the GPU
  process"; the measurement stood, the explanation did not. Two, three and four software encoders
  in parallel on alternate key-frame groups were tried and gained nothing (46.9 → 44.4 → 41.7 →
  40.2 fps), so there is one encoder.

**What was built.** The export no longer records anything. `src/lib/mp4read.ts` is a demuxer —
`moov`/`stbl` for a progressive file, `moof`/`trun` for a fragmented one, H.264 and HEVC sample
entries with their codec strings, AAC through `esds`, edit lists and the rotation matrix — and
`src/lib/offline.ts` drives it: every sample in the trim window goes to a `VideoDecoder`, each
decoded frame is painted once through the unchanged `renderToCanvas` and encoded by a
`VideoEncoder` at the source frame's own timestamp; the sound goes through an `AudioDecoder`, is cut
to the window to the sample, and is re-encoded at 192 kbit/s AAC on the same timeline; `writeMp4`
writes the file as before. `renderCardVideo` tries this first and falls back to the live recorder
on `OfflineUnavailable` (WebM, a codec the machine will not decode, no decoders, or a decoder that
gives up before the first frame). `App` pauses the preview for the duration of any export and puts
it back after; the toast now says which path made the file, its frame rate and how long it took.
The bitrate budget moved to `recorders.ts` and takes the frame rate: ~10.3 Mbit/s at 30 fps for the
card, 15.5 at 60 (frames past 30 are budgeted at half), still capped at 24. `BackgroundMedia.element`
may now be a `VideoFrame` or a canvas, and `isPaintable` in `draw.ts` only asks a `<video>` for its
`readyState`.

**Verified, isolated Chrome 152 on this machine, local mode, the real clips:**

| | before (live) | after (frame-exact) |
|---|---|---|
| 60 fps HEVC, 23.2 s window | 497 frames, 21.4 fps, 19.5 ms jitter, 167 ms worst gap | **1393 frames, 59.92 fps, 0.62 ms jitter, 36.4 ms worst gap — the source's own numbers exactly** |
| sound against the source (envelope cross-correlation, `dev/av-sync.js`) | −6 to −16 ms | **0 ms, correlation 0.999** |
| wall time for that window | 23.3 s | 28.6 s (encoder-bound: 25.0 of 28.6 s is waiting on the software encoder) |
| 24 fps HEVC, 12.3 s | — | 296 frames, 23.98 fps, 0 ms jitter — the source's — in 7.5 s |
| trimmed window, start 5 s, 6 s long, 60 fps | — | 360 frames, exactly 60 fps, sound 0 ms off the source's 5–11 s, first frame is the source's 5.0 s (checked visually against the source at 5.5 s) |
| WebM source (recorded in-page, VP9/Opus) | — | falls back to the live recorder with a console warning; 30.25 fps |
| preview during export | 24 % of frames dropped | paused, resumes after |
| unit tests | 199 | **219**, all passing; `mp4read.test.ts` round-trips `writeMp4`'s output and a hand-built fragmented file, `offline.test.ts` covers the window arithmetic |

A side result worth having: with the preview paused, the **live** recorder also holds 30 fps on
this machine (29.96 fps, 2.2 ms jitter on the same 60 fps clip). The pause alone would have fixed
most of the report; the frame-exact path is what makes it 60 fps and exact.

**The trap that cost the most time here: `AudioDecoder` output timestamps.** The first cut trusted
`AudioData.timestamp` and the sound came out 24–48 ms late. A phone clip's audio track carries an
edit list of 2112 samples (the AAC encoder's priming), so its first packet sits at −47.9 ms once
that is applied — and Chrome's `AudioDecoder` starts its output clock at zero regardless of a
negative input timestamp. Three impulse experiments pinned it (`scratchpad/audiolab.js` that
session; the results are the point): encoder → `writeMp4` → the browser's player is exact to the
sample; our own file back through `AudioDecoder` is exact; the source decoded with a **running
sample counter anchored on the first packet's own timestamp** matches the player with correlation
1.000. So `transcodeAudio` counts frames from the first packet's `pts` and never reads
`data.timestamp`. The encoder is also configured from the first decoded buffer's rate and channel
count rather than the header's, because HE-AAC decodes at twice its stated rate.

**Two smaller traps:**
- The demuxer test fixture holds two identity matrices (`mvhd`'s and `tkhd`'s); patching "the"
  identity matrix patched the wrong one. The test takes the last.
- `dev/start-check.html`, `cadence-check.html` and `audio-check.html` drive `renderCardVideo`, and
  their synthetic MediaRecorder sources are fragmented MP4s the demuxer reads — so they now measure
  the frame-exact path, not the live one. To measure the live recorder again, hand them a WebM.

**How to verify.** The isolated Chrome (below) on the local-mode server: `VITE_SUPABASE_URL=""
VITE_SUPABASE_ANON_KEY="" npx vite --port 5174`. `dev/probe.mjs` is `app-probe.mjs` plus
`--match`, `--file`, `--download=<dir>` and `--screenshot=<png>`; drop a clip in `dev/` as
`tmp-clip60.mp4` (the pattern is gitignored), inject it through the picker's file input with a
`DataTransfer`, press *Download MP4* with `--gesture`, and read the file with `dev/mp4-cadence.mjs`
and its sound with `dev/av-sync.js`. `window.__pnlExportStats` after an export (dev builds only)
says where the time went. Note that `Browser.setDownloadBehavior` over CDP did **not** redirect
the download in this Chrome; the files landed in `Downloads` and were moved out by hand — check
there first when a run seems to have produced nothing.

**Not verified:** Safari (the decoders exist from 16.4; HEVC decode and AAC encode there are
untested); a source with a rotation matrix in the browser (the matrix is unit-tested, the
`orient` paint is not); an HE-AAC source; an export with the window hidden (the isolated Chrome
cannot be hidden, and the everyday one cannot be driven).

**Deployed.** Pushed as `63112d9`; Vercel built it within a minute and <https://nexocards.vercel.app>
serves `assets/index-CglHwRhq.js`, the same hash as the local `npm run build`, with `frame-exact`
in it. Not exercised on the live site from here: an export there, in the signed-in app.

### Topbar avatar fixed (2026-09-14)

The round profile button looked broken until you clicked it: a small figure floating in the circle.
The cause was the browser's default `<button>` padding, 6px on each side in Chrome. It squeezed the
SVG into a 20×30 box. The avatar inside the menu is a `<span>`, which is why it always looked right.
The fix is `padding: 0` on `.profile__button` in `global.css`. Checked in Chrome, first on the live
site (still broken there) and then on a local-mode dev server with the fix: the button now fills its
circle the same way the menu avatar does.

### Emails in the profiles table (2026-09-14)

`public.profiles` has a new **`email`** column. `display_name` is now filled in from the name given
at sign-up. Both are copied from `auth.users` by the sign-up trigger. A new trigger,
`on_auth_user_updated`, keeps them in step when an email or name changes. A backfill fills them in
for accounts that already exist.
**To apply it:** run the whole of `supabase/schema.sql` again in the SQL Editor. It is safe to
re-run, and it also creates the `admin.uploads` view described below. After that, *Table Editor →
public → profiles* shows every account's email.
- RLS still limits each account to its own row, so the API never shows one user another user's
  email.
- `insert`/`update` on `profiles` are revoked from API roles except `update (display_name)`. That
  way nobody can overwrite the copied email with something false. The app doesn't write this table,
  so nothing breaks.
- **Verified 2026-09-14 after Artem ran it**, in the SQL Editor: 1 profile, and it has an email;
  1 `media` row, which `admin.uploads` also shows; the `on_auth_user_updated` trigger exists;
  2 objects in the `media` bucket.
- **Opening an upload, checked in Chrome:** *Storage* → *Files* → `media` → the folder named after
  the user id (the `user_id` column in `admin.uploads`) → click the file. A panel on the right plays
  the video (the current one is 12 s, 7.78 MB, `video/mp4`) and has *Download* and *Get URL*. Both
  current objects predate the rename, so they are still called `<media id>` and `<media id>.poster`.
  Uploads from now on will carry the original file name.

### Seeing uploads, and who uploaded them, in the dashboard (2026-09-14)

Artem asked to see the file itself in Supabase, not only its metadata, and to see which account
uploaded it. **Pushed to `main`.** The SQL has **not been run**, because nothing here can
reach the database: the anon key can't create schemas.

**What to do, in order:**
1. **Run the new SQL.** Dashboard → *SQL Editor* → paste the `admin views` block from
   `supabase/schema.sql` (from `create schema if not exists admin;` to `revoke all on admin.uploads …`)
   → *Run*. Running the whole file again is fine too.
2. ~~Push~~ — done, Vercel deploys the new file names from `main`.

**Where to look afterwards:**
- **Who uploaded what:** *Table Editor* → switch the schema dropdown from `public` to **`admin`** →
  **`uploads`**. Each row has `uploader_email`, `uploader_name`, `file_name`, kind, seconds,
  megabytes, size, the time, and `file_in_storage`, the exact path of the file.
- **The file itself:** *Storage* → `media` → the uploader's `user_id` folder (the same id is in the
  `user_id` column of `admin.uploads`). Clicking a file opens a preview panel that plays videos and
  shows images, with *Download* and *Get URL*. The Table Editor itself can't show a picture or a
  video inside a cell. That is a limit of Supabase, so Storage is the place to view files.

**What changed:**
- **Readable object names.** New uploads are stored as
  `<user_id>/<original name>--<media id>.<ext>`, e.g. `…/ssstiktok_7412--3f2a….mp4`, and their
  posters as `….poster.webp`. The name is cleaned to `[A-Za-z0-9._-]` and capped at 60 characters.
  Cyrillic names reduce to little or nothing, and then only the id is used. The first segment is
  still the user id, so the storage policies are unchanged. The logic is in `objectFileName` in
  `src/lib/remote/media.ts`, covered by `media.test.ts`.
- **Older uploads keep their names** (`<user_id>/<media id>`, no extension). They are not renamed,
  but they still appear in `admin.uploads` with their uploader.
- **Delete now uses the stored `storage_path`** instead of rebuilding it from the id. Without this,
  deleting a file with the new name would have left the file behind. `deleteMedia` no longer takes
  `userId`.
- **Why a separate `admin` schema:** a view skips row-level security and this one reads
  `auth.users`. If it were in `public`, the API would give every user's email to anyone holding the
  anon key. `admin` isn't exposed through the API, and API roles have their grants revoked as well.

**Not verified:** the SQL running without errors on the real project, and an upload and delete on
the live site with the new names.

**Sound toggle on the preview, and a new sample card — on `main` and deployed** as `99ec233`; the
live bundle `assets/index-Bg7IcgZV.js` carries "Sound on" and "Save 10% off fees".

### Accounts are live on the deployed site (2026-09-14, verified)

Artem fixed the Vercel variables (as plain config, not *secret*: Vercel does not allow `VITE_`
variables to be secret, and neither value needs to be). `db816fa` was pushed and Vercel built
`assets/index-EaLsWgjG.js`. That bundle contains `https://zwrpcaoestatmshuconp.supabase.co` and the
publishable key. Checked on <https://nexocards.vercel.app> in Chrome, which was already signed in to
Artem's account:
- no "Accounts are off" banner, the profile icon is present, and the topbar shows **Saved**;
- the card preview draws, with a 12.3 s MP4 as the background (the first screenshot, taken 2 s
  after load, was still black while the clip downloaded);
- there are 4 tiles in the background library and **none has the "Saving…" badge**, so every file
  has a `storagePath` and is in the account;
- Supabase answers requests from the live origin (`Access-Control-Allow-Origin: *`), and the console
  showed no errors.

Not checked from here: the rows themselves in the Supabase dashboard, since RLS hides them from the
anon key. Also not checked: deleting a file end to end on the live site.

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

18. **The frame-exact export is encoder-bound and single-threaded (2026-09-14).** 28.6 s for a
    23.2 s window at 60 fps here, all of it waiting on Chrome's software H.264 encoder; parallel
    encoders did not help. If it ever needs to be faster, the levers are the encoder's own
    (`latencyMode`; a lower `bitrate` does not help; `avc1.42E028` was slower than High) or a
    machine with a hardware encoder Chrome will use. Also: the live recorder is now only reached
    for WebM and undecodable sources, so item 17's note that only one recorder has been run since
    the split now applies to both live recorders.
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
19. **The fixed footer string can still be switched off (2026-09-22).** *Save 10% off fees* can no
    longer be *changed* — it is a constant and not part of card state — but `display.showFooter`
    hides the whole footer row, both halves, as it always has. If every card is meant to carry it,
    the fix is that the right half stops following `showFooter`; that narrows what the toggle means,
    so it is a decision rather than a bug. See **Start here (2026-09-22 b)**.

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
    route.ts             the three paths, pushState, and where to go after sign-in
    billing.ts           prices, plan copy, the card key, and the calls that ask
    selftest.ts          preview-vs-export pixel diff (dev only)
    canvas/
      scenes.ts          the built-in background: the Astra sky           (tested)
      spec.ts            measured geometry — change layout here, not in draw.ts
      placement.ts       cover fit, zoom, pan — shared by draw and drag  (tested)
      primitives.ts      ink-aligned text, tracking, cached metrics
      draw.ts            the card itself + foregroundKey                 (tested)
      avatarFrames.ts    the seven avatar frames, one drawAvatarFrame entry
    frames.ts            the frame list and badgePalette (one colour -> badge) (tested)
  components/
    AuthGate.tsx         session? studio : sign-in screen
    AuthScreen.tsx       registration + login form
    HomePage.tsx         the front page at `/` — pitch, features, plans in full
    PricingPage.tsx      the plans page at `/pricing` — tiers, checkout, promo box
    SiteNav.tsx          wordmark + Cards/Plans, the left half of every topbar
    FramePicker.tsx      the avatar-frame tiles, painted by drawAvatarFrame
    ...                  preview, controls, media picker, inputs
dev/
  scenes-shot.html       the built-in background as a whole card, its export
                         diffed against its preview                      (dev only)
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
