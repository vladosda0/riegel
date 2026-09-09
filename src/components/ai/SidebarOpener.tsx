import { cn } from "@/lib/utils";
import type { SidebarOpenerResult } from "@/lib/ai-sidebar-opener";

interface SidebarOpenerProps {
  opener: SidebarOpenerResult;
  /** Same contract as `SuggestionChips.onSelect`: fills the composer, never sends. */
  onSelect: (text: string, chipKey: string) => void;
  /** Quota exhausted: the text stays, the chips stop being offers. */
  chipsDisabled?: boolean;
}

/**
 * Holds the block's place while the project data is still arriving, so the composer
 * does not jump when the text appears and nothing is asserted before it is known.
 * Heights match one signal line plus a chip row.
 */
export function SidebarOpenerSkeleton() {
  return (
    <div className="w-full min-w-0 space-y-2 px-1 pb-1" aria-hidden="true">
      <div className="h-3 w-3/4 rounded bg-muted/50 animate-pulse" />
      <div className="flex gap-1.5">
        <div className="h-6 w-24 rounded-pill bg-muted/40 animate-pulse" />
        <div className="h-6 w-28 rounded-pill bg-muted/40 animate-pulse" />
      </div>
    </div>
  );
}

/**
 * Presentational only. What to say is decided by `buildSidebarOpener`; this renders it.
 *
 * Deliberately borderless (PRD section 8): a card would give visual weight to a block
 * whose whole design is to fade and get out of the way.
 */
export function SidebarOpener({ opener, onSelect, chipsDisabled = false }: SidebarOpenerProps) {
  return (
    <div className="w-full min-w-0 space-y-2 px-1 pb-1">
      {opener.headline && (
        <p className="text-caption font-medium text-foreground">{opener.headline}</p>
      )}
      {opener.intro && <p className="text-caption text-muted-foreground">{opener.intro}</p>}

      {opener.lines.map((line) => (
        <p key={line} className="text-caption text-muted-foreground">
          {line}
        </p>
      ))}

      {opener.quotaNote && (
        <p className="text-caption text-muted-foreground/80">{opener.quotaNote}</p>
      )}

      <div className="flex flex-wrap gap-1.5 w-full min-w-0">
        {opener.chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            disabled={chipsDisabled}
            onClick={() => onSelect(chip.text, chip.key)}
            className={cn(
              "rounded-pill px-3 py-1 text-caption font-medium border transition-colors",
              chipsDisabled
                ? "bg-muted/40 text-muted-foreground border-border cursor-not-allowed"
                : "bg-accent/10 text-accent hover:bg-accent/20 border-accent/20",
            )}
          >
            {chip.text}
          </button>
        ))}
      </div>
    </div>
  );
}
