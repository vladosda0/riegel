/**
 * Attribution of a sidebar thread's first message to a suggestion chip.
 *
 * Baseline measurement for the grounded opener (PRD `rovno-ai-sidebar-opener-prd.md`,
 * requirement 6.10): before the opener ships we need to know how often the CURRENT
 * static chip row actually starts a conversation, otherwise the opener's own
 * click-through has nothing to be compared against.
 *
 * The chips do not send. `SuggestionChips.onSelect` writes the chip text into the
 * composer and the user still presses send, possibly after editing it. So "came
 * from a chip" cannot be observed at click time; it is decided at send time by
 * comparing what was sent against what the chip seeded.
 *
 * Exact match (whitespace-normalised) is the deliberate rule: a user who reworded
 * the chip wrote their own prompt, and counting that as a chip click would inflate
 * exactly the number this baseline exists to measure. Erring toward `manual` keeps
 * the baseline a floor rather than a guess.
 */

export interface ChipSeed {
  /** Locale key of the chip, e.g. `ai.sidebar.suggestion.addTasks`. */
  chipKey: string;
  /** Rendered text the chip put into the composer. */
  text: string;
}

export type FirstMoveEntry = "chip" | "manual";

export interface FirstMoveAttribution {
  entry: FirstMoveEntry;
  /** Present only when `entry === "chip"`. */
  chipKey?: string;
}

function normalise(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Decide whether `sentContent` is the seeded chip verbatim.
 *
 * `seed` is whatever chip last wrote into the composer, or `null` when the user
 * typed from scratch, cleared the box, or already sent the seeded text once.
 */
export function resolveFirstMoveEntry(
  sentContent: string,
  seed: ChipSeed | null | undefined,
): FirstMoveAttribution {
  if (!seed) return { entry: "manual" };
  if (normalise(seed.text) === "") return { entry: "manual" };
  if (normalise(seed.text) !== normalise(sentContent)) return { entry: "manual" };
  return { entry: "chip", chipKey: seed.chipKey };
}
