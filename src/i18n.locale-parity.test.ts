import { describe, expect, it } from "vitest";
import enLocale from "@/locales/en.json";
import ruLocale from "@/locales/ru.json";

/**
 * PRD requirement 6.8 promised this check in CI and it was never written.
 *
 * A key missing from en.json renders as the raw identifier, because en is both
 * the requested language and the fallback (`fallbackLng: "en"`, src/i18n.ts). A
 * key missing from ru.json renders in English inside the Russian interface.
 * Both measured against the installed i18next; see the commit message.
 */

type LocaleTree = { [key: string]: string | LocaleTree };

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** i18next honours this as an explicit `count === 0` override in every language. */
const EXPLICIT_ZERO = "zero";

/**
 * A key whose name ends in a plural category IS a plural form, and the only way out is
 * to say so here. The rule is deliberately strict rather than inferred from the value,
 * because the two cases are byte-identical in shape and interpolate a count either way:
 *
 *   notifications.unread_other = "{{count}} непрочитанных"   lazy plural, must be caught
 *   filters.status_other       = "Другое ({{count}})"        ordinary label, must not be
 *
 * Guessing from the text gets one of them wrong whichever way it guesses: a value-based
 * rule turns CI red on the correct label, and a two-or-more-forms rule stops guarding the
 * lazy plural entirely, in both locales at once, where nothing else would see it.
 *
 * So the price is paid here, once per label, instead of on every future key: add the BASE
 * (the key without its category suffix) to this list, with a line saying what it is. The
 * excluded key is not left unguarded, it simply moves into the ordinary-key parity check
 * below, which still requires it in both locales.
 *
 * The list is empty because the project has no such key today.
 */
const NOT_PLURAL: string[] = [
  // "filters.status", // не плюрал: подпись со счётчиком
];

function flatten(tree: LocaleTree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]): [string, string][] => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [[path, value]] : flatten(value, path);
  });
}

const LOCALES = {
  ru: flatten(ruLocale as LocaleTree),
  en: flatten(enLocale as LocaleTree),
};

type Language = keyof typeof LOCALES;

const LANGUAGES = Object.keys(LOCALES) as Language[];

function keysOf(language: Language): string[] {
  return LOCALES[language].map(([key]) => key);
}

function baseOf(key: string): string | null {
  const match = PLURAL_SUFFIX.exec(key);
  return match === null ? null : key.slice(0, -match[0].length);
}

function categoriesByBase(language: Language): Map<string, Set<string>> {
  const byBase = new Map<string, Set<string>>();
  for (const key of keysOf(language)) {
    const match = PLURAL_SUFFIX.exec(key);
    if (!match) continue;
    const base = key.slice(0, -match[0].length);
    const categories = byBase.get(base) ?? new Set<string>();
    categories.add(match[1]);
    byBase.set(base, categories);
  }
  return byBase;
}

const CATEGORIES: Record<Language, Map<string, Set<string>>> = {
  ru: categoriesByBase("ru"),
  en: categoriesByBase("en"),
};

const SUFFIXED_BASES = new Set([...CATEGORIES.ru.keys(), ...CATEGORIES.en.keys()]);

const EXCLUDED_BASES = new Set(NOT_PLURAL);

const PLURAL_BASES = new Set([...SUFFIXED_BASES].filter((base) => !EXCLUDED_BASES.has(base)));

function isPluralMember(key: string): boolean {
  const base = baseOf(key);
  return base !== null && PLURAL_BASES.has(base);
}

function plainKeys(language: Language): Set<string> {
  return new Set(keysOf(language).filter((key) => !isPluralMember(key)));
}

function pluralBases(language: Language): Set<string> {
  return new Set([...PLURAL_BASES].filter((base) => CATEGORIES[language].has(base)));
}

function requiredCategories(language: Language): string[] {
  return new Intl.PluralRules(language).resolvedOptions().pluralCategories;
}

function missingFrom(expected: Set<string>, present: Set<string>): string[] {
  return [...expected].filter((key) => !present.has(key)).sort();
}

describe("ru/en locale parity", () => {
  // Without its own ICU data a runtime silently answers with the root locale, and the
  // ru half of the category check below would then demand only one/other and stop
  // guarding the 60 _few/_many keys this file exists for, while still reporting green.
  it.each(LANGUAGES)("resolves plural rules from %s's own ICU data", (language) => {
    expect(new Intl.PluralRules(language).resolvedOptions().locale).toBe(language);
  });

  // An exclusion whose key is gone is dead weight, and worse, it silently keeps a base
  // out of the plural check should the name ever come back as a real plural.
  it("keeps no exclusion that no longer matches a key", () => {
    expect(NOT_PLURAL.filter((base) => !SUFFIXED_BASES.has(base))).toEqual([]);
  });

  // An exclusion says "this base is one label that happens to end in a category name".
  // The moment it carries a second form it is a plural after all, and leaving it excluded
  // would silently drop it out of the completeness check above: `filters.status_one` plus
  // `filters.status_other` in both locales is symmetric, so nothing else would object,
  // while ru still renders the raw key at count === 2 for want of `_few`.
  it.each(LANGUAGES)("keeps every %s exclusion down to the single form it claims to be", (language) => {
    const overgrown = NOT_PLURAL.filter((base) => (CATEGORIES[language].get(base)?.size ?? 0) > 1).sort();
    expect(overgrown).toEqual([]);
  });

  it("has no ordinary key present in only one locale", () => {
    expect({
      missingInEn: missingFrom(plainKeys("ru"), plainKeys("en")),
      missingInRu: missingFrom(plainKeys("en"), plainKeys("ru")),
    }).toEqual({ missingInEn: [], missingInRu: [] });
  });

  it("has no pluralised key whose base is present in only one locale", () => {
    expect({
      missingInEn: missingFrom(pluralBases("ru"), pluralBases("en")),
      missingInRu: missingFrom(pluralBases("en"), pluralBases("ru")),
    }).toEqual({ missingInEn: [], missingInRu: [] });
  });

  // Russian needs one/few/many/other where English needs only one/other, so the
  // two key sets are legitimately different sizes and cannot be compared directly.
  it.each(LANGUAGES)("gives every %s plural base the categories the language requires", (language) => {
    const keys = new Set(keysOf(language));
    const incomplete = [...PLURAL_BASES]
      .flatMap((base) => requiredCategories(language).map((category) => `${base}_${category}`))
      .filter((key) => !keys.has(key))
      .sort();
    expect(incomplete).toEqual([]);
  });

  // Categories a language never resolves to are dead and tolerated: two en bases already
  // carry _few and _many, which English never selects. `_zero` is the exception, because
  // i18next applies it at count === 0 in both languages, so a one-sided one is real drift.
  it("keeps an explicit _zero override symmetric across locales", () => {
    const withZero = (language: Language) =>
      new Set([...PLURAL_BASES].filter((base) => CATEGORIES[language].get(base)?.has(EXPLICIT_ZERO)));
    expect({
      missingInEn: missingFrom(withZero("ru"), withZero("en")),
      missingInRu: missingFrom(withZero("en"), withZero("ru")),
    }).toEqual({ missingInEn: [], missingInRu: [] });
  });
});
