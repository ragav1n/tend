/**
 * Shared motion tokens so the whole app speaks one animation language.
 *
 * Ported from the same file in novira, which already encodes the house style:
 * fast start, soft landing, no rubber-band bounce unless asked for. Ease curves
 * use cubic-bezier(0.22, 1, 0.36, 1), which decelerates quickly and lands
 * gently. The check-off and depth tokens at the bottom are new here.
 *
 * SOFT is installed as the default transition on the app-shell MotionConfig
 * (components/motion/MotionProvider.tsx), so a motion element with no
 * `transition` prop inherits the house spring. Only override it when the element
 * needs a different character, and reach for a token below before writing
 * numbers inline.
 *
 * Presets are intentionally untyped (no `Transition` annotation) so they pass
 * cleanly into both motion.div's `transition` prop AND useAnimate's options
 * parameter, which expect slightly different shapes.
 */

// ─── Character ────────────────────────────────────────────────────────────────

/** Most things: entrances, position changes, soft transitions. The app default. */
export const SOFT = {
  type: 'spring' as const,
  damping: 26,
  stiffness: 200,
  mass: 0.85,
};

/** Snappier: chip pops, badges, reveals with a hint of life. */
export const SNAPPY = {
  type: 'spring' as const,
  damping: 22,
  stiffness: 320,
  mass: 0.6,
};

/** A subtle bounce. Celebrations and milestone pops only. */
export const BOUNCE = {
  type: 'spring' as const,
  damping: 16,
  stiffness: 240,
  mass: 0.9,
};

// ─── Curves ───────────────────────────────────────────────────────────────────

export const EASE_OUT_SOFT: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const EASE_IN_OUT_SOFT: [number, number, number, number] = [0.4, 0, 0.2, 1];

/**
 * iOS-style emphasized decelerate. Stretches the final third of the curve so
 * motion melts into rest instead of clicking into place. Use for translation and
 * anything that visibly locks with a spring.
 */
export const EASE_GLIDE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Pure fade, for when spring overshoot would look wrong. */
export const FADE = { duration: 0.42, ease: EASE_OUT_SOFT };
export const QUICK_FADE = { duration: 0.26, ease: EASE_OUT_SOFT };

/** Slide and translation tween that does not lock at its endpoints. */
export const GLIDE = { duration: 0.85, ease: EASE_GLIDE };

/** Smooth chip or badge entrance, for elements that fade in and stay. */
export const POP = { duration: 0.55, ease: EASE_GLIDE };

/** Linear, only for repeating spins. */
export const LINEAR_SPIN = { duration: 1.2, ease: 'linear' as const, repeat: Infinity };

export const STAGGER_FAST = 0.05;
export const STAGGER_NORMAL = 0.08;

// ─── UI roles ─────────────────────────────────────────────────────────────────
// The presets above describe motion character; these name the app's recurring
// roles so sibling surfaces cannot drift apart.

/** Bottom sheets, action bars, anything rising from the bottom edge. */
export const SHEET = {
  type: 'spring' as const,
  stiffness: 320,
  damping: 30,
  mass: 0.8,
};

/** Centered modal or dialog entrance. */
export const MODAL = { type: 'spring' as const, duration: 0.6, bounce: 0.3 };

/**
 * List row enter and exit. A tween, not a spring: rows must not overshoot into
 * each other, which is what a spring on a dense list looks like.
 */
export const ROW = { duration: 0.32, ease: EASE_OUT_SOFT };

/** Icon appearing inside a field or status chip. */
export const ICON_POP = { type: 'spring' as const, stiffness: 400, damping: 25 };

// ─── Tactile material ─────────────────────────────────────────────────────────
// The design direction is physical depth, so a press moves an element in Z
// rather than only scaling it. These carry that.

/** Pointer down on any control: 1px down, shadow tightens. */
export const PRESS_DEPTH = { duration: 0.1, ease: EASE_OUT_SOFT };

/** Drag pickup: the element lifts off the surface. */
export const LIFT = { type: 'spring' as const, stiffness: 260, damping: 24 };

// ─── The check-off ────────────────────────────────────────────────────────────
// The most-touched control in a todo app, so it gets its own tokens rather than
// borrowing generic ones. Sequence: press (90ms) -> release spring -> the mark
// draws (500ms) -> strikethrough sweeps (260ms, 60ms behind), overlapping the
// draw rather than queuing after it, so the row answers immediately.

export const CHECK_PRESS = { duration: 0.09, ease: EASE_OUT_SOFT };
export const CHECK_RELEASE = {
  type: 'spring' as const,
  stiffness: 320,
  damping: 22,
  mass: 0.6,
};
/**
 * The check mark drawing itself on.
 *
 * 500ms rather than the 220ms a plain tick wanted: the scribble is roughly four
 * times the arc length, and at 220ms it reads as a flicker instead of a stroke.
 * EASE_IN_OUT_SOFT rather than EASE_GLIDE for the same reason. GLIDE dumps most
 * of its distance up front and crawls to a stop, which looks like a pen running
 * out of ink; a real stroke starts easy, moves, then lands.
 */
export const CHECK_DRAW = { duration: 0.5, ease: EASE_IN_OUT_SOFT };
export const STRIKE = { duration: 0.26, ease: EASE_GLIDE, delay: 0.06 };

/** How long a completed row stays visible before it leaves a filtered list.
 *  Long enough to see the animation finish, short enough not to feel stuck. */
export const COMPLETED_ROW_LINGER_MS = 400;

// ─── Shared variants ──────────────────────────────────────────────────────────
// Module scope, never inline in JSX, so the library's variant identity check
// short-circuits instead of re-diffing a freshly allocated object each render.

/** Rises from the bottom edge. Pair with SHEET. */
export const sheetVariants = {
  hidden: { y: 24, opacity: 0 },
  visible: { y: 0, opacity: 1 },
};

/** Centered dialog. Pair with MODAL. */
export const modalVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 20 },
  visible: { opacity: 1, scale: 1, y: 0 },
};

/**
 * List row. Pair with ROW. Exit scales rather than collapsing height, because
 * animating height inside AnimatePresence forces a layout pass per frame per
 * row and is the fastest way to drop below 60fps on a long list.
 */
export const rowVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97 },
};

/** Parent of a staggered list. Pair with rowVariants on the children. */
export const listVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: STAGGER_FAST } },
};
