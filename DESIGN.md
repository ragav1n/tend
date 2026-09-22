# Design

The design constitution. Phase 0 of `docs/architecture.md` listed this file and nobody wrote it,
so `CLAUDE.md` absorbed the job and carried the design rules alongside everything else.

**This file holds the reasoning. `CLAUDE.md` holds the rules that break the build.** Nothing is
restated in both places, because two copies of a constitution is how one of them goes stale and
starts lying. When you want to know *why* the palette behaves the way it does, read this. When you
want to know what you are not allowed to do, read `CLAUDE.md`.

## The direction

**Tactile material.** One light source from the top, surfaces at different depths, and pressing
something moves it in Z. Not glassmorphism, not brutalism, not the flat grey rectangles every task
app converges on.

Three things were rejected on the way here and the reasons still apply:

- **Glassmorphism** puts blur behind text. It costs contrast on the one thing an app like this is
  entirely made of.
- **Brutalism** means hard borders, raw system type and deliberate friction. It contradicts the
  motion quality outright, and friction is tiring in an app you open thirty times a day.
- **Faux texture**, meaning paper or leather or wood imagery. It reads as decoration pretending to
  be material.

What replaces the last one is grain: a 3% desaturated noise overlay, fixed to the screen, generated
with `feTurbulence` rather than downloaded so it stays reproducible from the source. It sits at
`body::after` in `app/globals.css`. Grain is what makes the material direction read as material
instead of as flat fills, and 3% is the whole budget.

## Colour carries meaning, never decoration

Two accents, and each one means something:

- **Clay is interaction.** Focus rings, primary buttons, selection, the check-off. It says "you can
  act here."
- **Olive is state.** Completion, streaks, progress rings. It says "done, and good."

A third accent would mean a colour nobody can read, so there is not one. Sand exists as a hue for
non-text marks and nothing else.

The supplied terracotta measures **1.71:1 on charcoal**, which fails WCAG outright. That is the
single fact the whole colour system is built around. Rather than abandon the palette, each accent
gets a lightness ramp at fixed hue and chroma, so the source hex survives as the `600` fill step
while text and icons use lifted steps. The hue never changes, so it still reads as the palette you
chose.

**The step numbers are jobs, not a lightness ordering.** On a light page the text steps (300, 200)
sit *below* the border step (400), and `raised` is darker than `surface` rather than lighter. This
is confusing until you accept that a step number names a role.

There are two full ramps, one per theme, and `lib/color.test.ts` asserts the contrast of both. A
design rule that only lives in prose is a rule that gets broken the first busy afternoon.

## Depth is four surfaces and four shadows

`void` is the page floor, `surface` is a card, `raised` is a control on a card, `sunken` is a well
or an input. The shadows are named for what they do rather than how big they are: `flush`,
`sunken`, `raised`, `lifted`. Both themes define all four, and in the light theme the inner
highlight becomes white rather than a tinted line.

Controls sit in sunken wells rather than on raised cards. That is a contrast decision as much as a
visual one: on `raised`, every accent has to step up and body text has to go to `text-mid`, so a
panel built from raised cards ends up either lighter than it should be or quietly failing AA.

## Typography

Instrument Sans for the UI, Instrument Serif for large headings and dates, JetBrains Mono for
numbers, counts and uppercase labels. All three self-hosted, so they work offline.

The serif is load-bearing. An earthy palette with a geometric sans reads muddy, and Instrument
Serif at display size is the strongest single move against looking like a template. It appears once
per view and never inside a list.

Numbers use `tnum`. A count that shifts width as it changes draws the eye to the wrong thing.

## Motion is the depth

Only `transform` and `opacity` animate. Anything else is a layout pass on a frame somebody is
watching.

Springs have roles rather than settings, in `lib/motion.ts`: `SHEET`, `MODAL`, `ROW`, `ICON_POP`,
`LIFT`, `PRESS_DEPTH`, `CHECK_PRESS`. Reaching for a raw duration means the thing you are animating
does not have a role yet, and that is worth a minute of thought rather than a magic number.

`prefers-reduced-motion` is a real path, not durations set to zero. Springs become short opacity
fades and ambient loops stop entirely. `MotionConfig reducedMotion="user"` covers the JS and a
media query in `globals.css` covers the CSS.

## Anti-slop guardrails

The failure mode is not ugliness, it is genericness. Specifics:

- No gradient-on-purple hero anything.
- No emoji as iconography. One icon family, Phosphor, regular and bold weights only.
- No centred marketing copy inside a working screen.
- No spinner where a skeleton or an optimistic row will do. The UI never waits on the network, so a
  spinner is usually a bug in the thinking.
- No toast for something that plainly worked. Toasts carry undo, or a count, or a reason.
- No control revealed only by hover. It does not exist on a phone at all.
- Copy is plain. No em dashes, no adverbs where a verb will do, no "not X but Y". The same voice
  applies to code comments, which explain why rather than what.

## Where the rules are enforced

Prose does not hold a line. These do:

| Rule | Held by |
|---|---|
| Both colour ramps meet contrast | `lib/color.test.ts` |
| One key chord cannot answer in two live scopes | `components/shell/keymap.test.ts` |
| Writes go through one door | the Dexie rule in `eslint.config.mjs`, pinned by `lib/db/schema.test.ts` |
| A sheet does not steal focus from a field | `components/ui/Sheet.test.tsx` |
| A device-dependent date reaches the DOM | `hooks/use-hydrated.test.tsx` |

Every one of those exists because the rule was broken first.
