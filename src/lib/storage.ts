import type { MediaAttachment, PostOutcome } from "@/lib/tauri";

export const DRAFT_STORAGE_KEY = "universal-poster:draft-v1";
export const HISTORY_STORAGE_KEY = "universal-poster:history-v1";
export const MAX_HISTORY_ENTRIES = 50;

export interface ComposerDraft {
  masterText: string;
  overrides: Record<string, string>;
  media: MediaAttachment[];
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  masterText: string;
  overrides: Record<string, string>;
  media: MediaAttachment[];
  outcomes: PostOutcome[];
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

export function loadDraft(): ComposerDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ComposerDraft>;
    const draft: ComposerDraft = {
      masterText:
        typeof parsed.masterText === "string" ? parsed.masterText : "",
      overrides:
        parsed.overrides && typeof parsed.overrides === "object"
          ? parsed.overrides
          : {},
      media: Array.isArray(parsed.media) ? parsed.media : [],
    };
    return isDraftEmpty(draft) ? null : draft;
  } catch {
    return null;
  }
}

export function saveDraft(draft: ComposerDraft): void {
  try {
    if (isDraftEmpty(draft)) {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } else {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    }
  } catch {
    // Ignore storage quota / privacy mode errors.
  }
}

export function clearStoredDraft(): void {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_HISTORY_ENTRIES) as HistoryEntry[];
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_HISTORY_ENTRIES)),
    );
  } catch {
    // Ignore storage quota / privacy mode errors.
  }
}

export function clearStoredHistory(): void {
  try {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}
