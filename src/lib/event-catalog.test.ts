import i18next from "i18next";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import enLocale from "@/locales/en.json";
import ruLocale from "@/locales/ru.json";
import { EVENT_TYPES } from "@/types/entities";
import {
  EVENT_CATALOG,
  getEventCaption,
  getEventIcon,
  getEventLabelKey,
  isFallbackActor,
} from "@/lib/event-catalog";

const ru = ruLocale as Record<string, string>;
const en = enLocale as Record<string, string>;

// A standalone instance configured exactly like src/i18n.ts. The locale bundle
// is flat with dotted keys, and several event types carry dots in their own
// names, so asserting against the JSON object would prove nothing about what
// reaches the screen: the resolver is the risk.
const i18n = i18next.createInstance();

beforeAll(async () => {
  await i18n.init({
    resources: { ru: { translation: ruLocale }, en: { translation: enLocale } },
    lng: "ru",
    // The app falls back to English; this instance must not, or a missing
    // Russian caption would quietly resolve to the English one and the
    // coverage assertion below would pass while the user saw English.
    fallbackLng: false,
    interpolation: { escapeValue: false },
  });
});

const t = (key: string, params?: Record<string, string>) => i18n.t(key, params ?? {});

// The instance is shared, so a case that switches language and then fails would
// leave every later case reading the wrong bundle and reporting a failure that
// has nothing to do with it. Observed while mutation-testing the en coverage
// case: one deleted English caption reddened two unrelated assertions.
afterEach(async () => {
  await i18n.changeLanguage("ru");
});

describe("event catalog", () => {
  it("gives every event type an icon", () => {
    const iconless = EVENT_TYPES.filter((type) => !EVENT_CATALOG[type].icon);
    expect(iconless).toEqual([]);
  });

  it("falls back for a type the catalog does not know", () => {
    expect(getEventLabelKey("something.invented")).toBe("activity.event.unknown");
    expect(getEventCaption(t, "something.invented", false)).toBe(ru["activity.event.unknown"].replace("{{a}}", ""));
    expect(getEventIcon("something.invented")).toBeTruthy();
  });

  it("uses the AI icon for AI-origin rows whatever the type", () => {
    expect(getEventIcon("document.created", true)).not.toBe(getEventIcon("document.created"));
  });
});

describe("the shared gender rule", () => {
  // Both feed surfaces call this, so the rule is testable once instead of
  // needing a render test per surface to notice a regression.
  it("is feminine only for the unresolved non-AI actor", () => {
    expect(isFallbackActor(false, false)).toBe(true);
    expect(isFallbackActor(false, true)).toBe(false);
    expect(isFallbackActor(true, false)).toBe(false);
    expect(isFallbackActor(true, true)).toBe(false);
  });
});

describe("event captions as the user sees them", () => {
  it.each(["ru", "en"] as const)("renders a real caption for every event type in %s", async (lng) => {
    await i18n.changeLanguage(lng);

    const broken = EVENT_TYPES.filter((type) => {
      const caption = getEventCaption(t, type, false);
      return (
        !caption
        // the resolver failed and handed the key back
        || caption === getEventLabelKey(type)
        // an unfilled interpolation slot reaching the screen
        || caption.includes("{{")
        // the raw action_type, which is what this slice exists to remove
        || caption === type.replace(/[._]/g, " ")
      );
    });

    expect(broken).toEqual([]);
  });

  it("resolves a dotted event type through the flat bundle", () => {
    // document.created is asserted here because it collides with the existing
    // document_created spelling; estimate.status_changed covers the longer
    // dotted shape. Both would break first if key separation ever changed.
    expect(getEventCaption(t, "document.created", false)).toBe("добавил документ");
    expect(getEventCaption(t, "estimate.status_changed", false)).toBe("изменил статус сметы");
  });

  it("agrees with the actor's gender for the non-human actor", () => {
    expect(getEventCaption(t, "document.created", true)).toBe("добавила документ");
  });

  it("keeps a gender slot in every Russian template", () => {
    // Structural, not rendered: a template that lost its slot renders fine for
    // a man and silently wrong for everyone else, so the rendered assertions
    // above cannot see it.
    const slotless = EVENT_TYPES.filter((type) => !ru[getEventLabelKey(type)]?.includes("{{a}}"));
    expect(slotless).toEqual([]);
  });

  it("leaves English untouched by the gender slot", async () => {
    await i18n.changeLanguage("en");
    expect(getEventCaption(t, "document.created", true)).toBe("added a document");
    expect(getEventCaption(t, "document.created", false)).toBe("added a document");
  });

  it("keeps the fallback caption translated in both bundles", () => {
    expect(ru["activity.event.unknown"]).toBeTruthy();
    expect(en["activity.event.unknown"]).toBeTruthy();
  });
});
