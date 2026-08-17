interface SuggestionChipsProps {
  suggestions: string[];
  /**
   * `index` is the position in `suggestions`, so a caller that renders chips from
   * a key list can recover which key was picked without matching on the rendered
   * text (which is localised, and duplicated across locales). Callers that do not
   * care may ignore it.
   */
  onSelect: (text: string, index: number) => void;
  singleLineScrollable?: boolean;
}

export function SuggestionChips({ suggestions, onSelect, singleLineScrollable = false }: SuggestionChipsProps) {
  if (singleLineScrollable) {
    return (
      <div className="w-full min-w-0 overflow-x-auto overflow-y-hidden no-scrollbar">
        <div className="flex flex-nowrap gap-1.5 min-w-max">
          {suggestions.map((s, i) => (
            <button
              key={s}
              onClick={() => onSelect(s, i)}
              className="shrink-0 whitespace-nowrap rounded-pill px-3 py-1 text-caption font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors border border-accent/20"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5 w-full min-w-0">
      {suggestions.map((s, i) => (
        <button
          key={s}
          onClick={() => onSelect(s, i)}
          className="rounded-pill px-3 py-1 text-caption font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors border border-accent/20"
        >
          {s}
        </button>
      ))}
    </div>
  );
}
