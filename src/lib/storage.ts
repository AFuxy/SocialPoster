import type { MediaAttachment } from "@/lib/tauri";

export const ACTIVE_PROFILE_STORAGE_KEY = "universal-poster:active-profile";

const LEGACY_ENABLED_KEY = "universal-poster:enabled-platforms";
const LEGACY_KNOWN_KEY = "universal-poster:known-platforms";
const LEGACY_DRAFT_KEY = "universal-poster:draft-v1";

export function enabledPlatformsKey(profileId: string): string {
  return `universal-poster:${profileId}:enabled-platforms`;
}

export function knownPlatformsKey(profileId: string): string {
  return `universal-poster:${profileId}:known-platforms`;
}

export function draftKey(profileId: string): string {
  return `universal-poster:${profileId}:draft`;
}

export function overridesKey(profileId: string): string {
  return `universal-poster:${profileId}:overrides`;
}

export function autoThreadKey(profileId: string): string {
  return `universal-poster:${profileId}:auto-thread`;
}

export function loadAutoThread(profileId: string): boolean {
  try {
    return localStorage.getItem(autoThreadKey(profileId)) === "true";
  } catch {
    return false;
  }
}

export function saveAutoThread(profileId: string, enabled: boolean): void {
  try {
    localStorage.setItem(autoThreadKey(profileId), enabled ? "true" : "false");
  } catch {
    // Ignore storage errors.
  }
}

export interface ComposerDraft {
  masterText: string;
  overrides: Record<string, string>;
  media: MediaAttachment[];
}

export const EMPTY_DRAFT: ComposerDraft = {
  masterText: "",
  overrides: {},
  media: [],
};

export function isDraftEmpty(draft: ComposerDraft): boolean {
  const hasMaster = draft.masterText.trim().length > 0;
  const hasOverrides = Object.values(draft.overrides).some(
    (v) => v.trim().length > 0,
  );
  return !hasMaster && !hasOverrides && draft.media.length === 0;
}

export function getActiveProfileId(): string {
  try {
    return localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY) || "default";
  } catch {
    return "default";
  }
}

export function setActiveProfileId(profileId: string): void {
  try {
    localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, profileId);
  } catch {
    // Ignore storage errors.
  }
}

export function migrateLegacyStorageForDefault(): void {
  try {
    const enabledTarget = enabledPlatformsKey("default");
    if (localStorage.getItem(enabledTarget) === null) {
      const legacyEnabled = localStorage.getItem(LEGACY_ENABLED_KEY);
      if (legacyEnabled !== null) {
        localStorage.setItem(enabledTarget, legacyEnabled);
      }
    }
    localStorage.removeItem(LEGACY_ENABLED_KEY);

    const knownTarget = knownPlatformsKey("default");
    if (localStorage.getItem(knownTarget) === null) {
      const legacyKnown = localStorage.getItem(LEGACY_KNOWN_KEY);
      if (legacyKnown !== null) {
        localStorage.setItem(knownTarget, legacyKnown);
      }
    }
    localStorage.removeItem(LEGACY_KNOWN_KEY);

    const draftTarget = draftKey("default");
    const overridesTarget = overridesKey("default");
    if (localStorage.getItem(draftTarget) === null) {
      const legacyDraftRaw = localStorage.getItem(LEGACY_DRAFT_KEY);
      if (legacyDraftRaw) {
        const parsed = JSON.parse(legacyDraftRaw) as Partial<ComposerDraft>;
        localStorage.setItem(
          draftTarget,
          JSON.stringify({
            masterText:
              typeof parsed.masterText === "string" ? parsed.masterText : "",
            media: Array.isArray(parsed.media) ? parsed.media : [],
          }),
        );
        if (parsed.overrides && typeof parsed.overrides === "object") {
          localStorage.setItem(overridesTarget, JSON.stringify(parsed.overrides));
        }
      }
    }
    localStorage.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    // Ignore storage migration errors.
  }
}

export function loadDraft(profileId: string): ComposerDraft | null {
  try {
    if (profileId === "default") {
      migrateLegacyStorageForDefault();
    }

    const rawDraft = localStorage.getItem(draftKey(profileId));
    const rawOverrides = localStorage.getItem(overridesKey(profileId));

    const parsedDraft = rawDraft
      ? (JSON.parse(rawDraft) as Partial<ComposerDraft>)
      : {};
    const parsedOverrides = rawOverrides
      ? (JSON.parse(rawOverrides) as Record<string, string>)
      : {};

    const draft: ComposerDraft = {
      masterText:
        typeof parsedDraft.masterText === "string"
          ? parsedDraft.masterText
          : "",
      overrides:
        parsedOverrides && typeof parsedOverrides === "object"
          ? parsedOverrides
          : {},
      media: Array.isArray(parsedDraft.media) ? parsedDraft.media : [],
    };
    return isDraftEmpty(draft) ? null : draft;
  } catch {
    return null;
  }
}

export function saveDraft(profileId: string, draft: ComposerDraft): void {
  try {
    if (isDraftEmpty(draft)) {
      localStorage.removeItem(draftKey(profileId));
      localStorage.removeItem(overridesKey(profileId));
    } else {
      localStorage.setItem(
        draftKey(profileId),
        JSON.stringify({
          masterText: draft.masterText,
          media: draft.media,
        }),
      );
      localStorage.setItem(
        overridesKey(profileId),
        JSON.stringify(draft.overrides),
      );
    }
  } catch {
    // Ignore storage quota / privacy mode errors.
  }
}

export function clearStoredDraft(profileId: string): void {
  try {
    localStorage.removeItem(draftKey(profileId));
    localStorage.removeItem(overridesKey(profileId));
  } catch {
    // Ignore storage errors.
  }
}

export function clearProfileStorage(profileId: string): void {
  try {
    localStorage.removeItem(enabledPlatformsKey(profileId));
    localStorage.removeItem(knownPlatformsKey(profileId));
    localStorage.removeItem(draftKey(profileId));
    localStorage.removeItem(overridesKey(profileId));
    localStorage.removeItem(autoThreadKey(profileId));
  } catch {
    // Ignore storage errors.
  }
}
