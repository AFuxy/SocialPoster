import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import {
  Download,
  HeartHandshake,
  History,
  Loader2,
  Moon,
  RefreshCw,
  RotateCw,
  Sun,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppLogo } from "@/components/AppLogo";
import {
  checkForUpdateSilently,
  downloadAndInstallUpdate,
  getDismissedUpdateVersion,
  relaunchApp,
  setDismissedUpdateVersion,
  type Update,
} from "@/lib/updater";
import { Composer } from "@/components/Composer";
import { CreditsDialog } from "@/components/CreditsDialog";
import { DispatchResults } from "@/components/DispatchResults";
import { HistorySheet } from "@/components/HistorySheet";
import { PlatformBar } from "@/components/PlatformBar";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import {
  clearStoredDraft,
  clearStoredHistory,
  EMPTY_DRAFT,
  loadDraft,
  loadHistory,
  MAX_HISTORY_ENTRIES,
  saveDraft,
  saveHistory,
  type ComposerDraft,
  type HistoryEntry,
} from "@/lib/storage";
import {
  broadcastPost,
  getPlatforms,
  type PlatformDispatchRequest,
  type PlatformMetadata,
  type PostOutcome,
} from "@/lib/tauri";
import "./App.css";

const ENABLED_PLATFORMS_STORAGE_KEY = "universal-poster:enabled-platforms";
const KNOWN_PLATFORMS_STORAGE_KEY = "universal-poster:known-platforms";

function readStringArray(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return null;
  }
}

function persistPlatformState(
  enabledIds: Set<string>,
  registeredPlatforms: PlatformMetadata[],
) {
  try {
    localStorage.setItem(
      ENABLED_PLATFORMS_STORAGE_KEY,
      JSON.stringify(Array.from(enabledIds)),
    );
    localStorage.setItem(
      KNOWN_PLATFORMS_STORAGE_KEY,
      JSON.stringify(registeredPlatforms.map((p) => p.id)),
    );
  } catch {
    // Ignore storage quota / privacy mode failures.
  }
}

function reconcileEnabledPlatforms(
  registered: PlatformMetadata[],
): Set<string> {
  const eligibleIds = new Set(
    registered
      .filter((p) => p.isCompatible && p.isConfigured)
      .map((p) => p.id),
  );
  const storedEnabled = readStringArray(ENABLED_PLATFORMS_STORAGE_KEY);
  const storedKnown = readStringArray(KNOWN_PLATFORMS_STORAGE_KEY);

  // First launch: only compatible & configured platforms can be active.
  if (storedEnabled === null) {
    const initial = new Set(eligibleIds);
    persistPlatformState(initial, registered);
    return initial;
  }

  // Keep only saved IDs that still exist, are compatible, and are configured.
  const reconciled = new Set(
    storedEnabled.filter((id) => eligibleIds.has(id)),
  );
  const knownSet = new Set(storedKnown ?? storedEnabled);

  // Newly discovered compatible & configured plugins default to enabled.
  for (const platform of registered) {
    if (
      !knownSet.has(platform.id) &&
      platform.isCompatible &&
      platform.isConfigured
    ) {
      reconciled.add(platform.id);
    }
  }

  persistPlatformState(reconciled, registered);
  return reconciled;
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label="Toggle colour theme"
      title="Toggle colour theme"
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

function SocialPosterApp() {
  const initialDraftRef = useRef<ComposerDraft | null>(loadDraft());
  const [draft, setDraft] = useState<ComposerDraft>(
    () => initialDraftRef.current ?? EMPTY_DRAFT,
  );
  const [draftRestored, setDraftRestored] = useState<boolean>(
    () => initialDraftRef.current !== null,
  );
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());

  const [platforms, setPlatforms] = useState<PlatformMetadata[]>([]);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isPosting, setIsPosting] = useState(false);
  const [outcomes, setOutcomes] = useState<PostOutcome[]>([]);
  const [settingsPlatform, setSettingsPlatform] =
    useState<PlatformMetadata | null>(null);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [updatePhase, setUpdatePhase] = useState<
    "available" | "downloading" | "ready"
  >("available");
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);

  const isFirstDraftRender = useRef(true);
  useEffect(() => {
    if (isFirstDraftRender.current) {
      isFirstDraftRender.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      saveDraft(draft);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draft]);

  const loadPlatforms = useCallback(
    async (isInitial = false, autoEnablePlatformId?: string) => {
      try {
        const list = await getPlatforms();
        setPlatforms(list);
        setSettingsPlatform((current) =>
          current ? (list.find((p) => p.id === current.id) ?? current) : null,
        );

        if (isInitial) {
          setEnabledIds(reconcileEnabledPlatforms(list));
        } else {
          setEnabledIds((prev) => {
            const eligibleIds = new Set(
              list
                .filter((p) => p.isCompatible && p.isConfigured)
                .map((p) => p.id),
            );
            const filtered = new Set(
              Array.from(prev).filter((id) => eligibleIds.has(id)),
            );
            if (autoEnablePlatformId && eligibleIds.has(autoEnablePlatformId)) {
              filtered.add(autoEnablePlatformId);
            }
            persistPlatformState(filtered, list);
            return filtered;
          });
        }
      } catch (err) {
        toast.error(`Failed to load platforms: ${String(err)}`);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadPlatforms(true);
  }, [loadPlatforms]);

  useEffect(() => {
    let active = true;
    void checkForUpdateSilently().then((update) => {
      if (!active || !update) return;
      const dismissed = getDismissedUpdateVersion();
      if (dismissed === update.version) return;
      setAvailableUpdate(update);
      setUpdatePhase("available");
    });
    return () => {
      active = false;
    };
  }, []);

  const handleInstallHeaderUpdate = async () => {
    if (!availableUpdate) return;
    if (updatePhase === "ready") {
      try {
        await relaunchApp();
      } catch (err) {
        toast.error(`Restart failed: ${String(err)}`);
      }
      return;
    }

    setUpdatePhase("downloading");
    setDownloadPercent(null);
    try {
      await downloadAndInstallUpdate(availableUpdate, (progress) => {
        setDownloadPercent(progress.percent);
      });
      setUpdatePhase("ready");
    } catch (err) {
      setUpdatePhase("available");
      toast.error(`Update failed: ${String(err)}`);
    }
  };

  const handleDismissHeaderUpdate = () => {
    if (!availableUpdate) return;
    setDismissedUpdateVersion(availableUpdate.version);
    setAvailableUpdate(null);
  };

  const updateEnabledIds = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      setEnabledIds((prev) => {
        const next = updater(prev);
        persistPlatformState(next, platforms);
        return next;
      });
    },
    [platforms],
  );

  const handleToggle = (platformId: string) => {
    const target = platforms.find((p) => p.id === platformId);
    if (!target || !target.isCompatible) return;
    if (!target.isConfigured) {
      setSettingsPlatform(target);
      return;
    }
    updateEnabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(platformId)) {
        next.delete(platformId);
      } else {
        next.add(platformId);
      }
      return next;
    });
  };

  const handleSolo = (platformId: string) => {
    const target = platforms.find((p) => p.id === platformId);
    if (!target || !target.isCompatible) return;
    if (!target.isConfigured) {
      setSettingsPlatform(target);
      return;
    }
    updateEnabledIds(() => new Set([platformId]));
  };

  const handleSelectAll = () => {
    updateEnabledIds(
      () =>
        new Set(
          platforms
            .filter((p) => p.isCompatible && p.isConfigured)
            .map((p) => p.id),
        ),
    );
  };

  const handleClearAll = () => {
    updateEnabledIds(() => new Set());
  };

  const handleClearDraft = () => {
    clearStoredDraft();
    setDraft(EMPTY_DRAFT);
    setDraftRestored(false);
  };

  const handleBroadcast = async (targets: PlatformDispatchRequest[]) => {
    setIsPosting(true);
    try {
      const results = await broadcastPost(targets);
      setOutcomes(results);

      const newEntry: HistoryEntry = {
        id:
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        masterText: draft.masterText,
        overrides: draft.overrides,
        media: draft.media,
        outcomes: results,
      };

      setHistory((prev) => {
        const next = [newEntry, ...prev].slice(0, MAX_HISTORY_ENTRIES);
        saveHistory(next);
        return next;
      });

      const okCount = results.filter((r) => r.success).length;
      if (results.length > 0 && okCount === results.length) {
        clearStoredDraft();
        setDraft(EMPTY_DRAFT);
        setDraftRestored(false);
        toast.success(`Posted to ${okCount} platforms.`);
      } else if (okCount > 0) {
        const succeededIds = new Set(
          results.filter((r) => r.success).map((r) => r.platformId),
        );
        updateEnabledIds((prev) => {
          const next = new Set(prev);
          for (const id of succeededIds) {
            next.delete(id);
          }
          return next;
        });
        toast.warning(
          `Posted to ${okCount} of ${results.length}. Failed platforms remain selected.`,
        );
      } else {
        toast.error("All posts failed.");
      }
    } catch (err) {
      toast.error(`Broadcast failed: ${String(err)}`);
    } finally {
      setIsPosting(false);
    }
  };

  const handleLoadFromHistory = (entry: HistoryEntry, onlyFailed = false) => {
    setDraft({
      masterText: entry.masterText,
      overrides: { ...entry.overrides },
      media: entry.media.map((m) => ({ ...m })),
    });
    setDraftRestored(false);

    if (onlyFailed) {
      const compatibleIds = new Set(
        platforms.filter((p) => p.isCompatible).map((p) => p.id),
      );
      const failedIds = entry.outcomes
        .filter((o) => !o.success && compatibleIds.has(o.platformId))
        .map((o) => o.platformId);
      updateEnabledIds(() => new Set(failedIds));
      toast.info("Loaded failed platforms.");
    } else {
      toast.info("Loaded into composer.");
    }
    setHistoryOpen(false);
  };

  const handleClearHistory = () => {
    clearStoredHistory();
    setHistory([]);
    toast.success("History cleared.");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card/60 backdrop-blur-xs">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <AppLogo className="h-8 w-8 shrink-0" />
            <h1 className="text-base font-semibold tracking-tight">
              SocialPoster
            </h1>
          </div>

          <div className="flex items-center gap-1.5">
            {availableUpdate && (
              <div className="inline-flex items-center rounded-full border bg-secondary/80 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => void handleInstallHeaderUpdate()}
                  disabled={updatePhase === "downloading"}
                  className="inline-flex cursor-pointer items-center gap-1.5 px-2.5 py-1 text-foreground transition-opacity hover:opacity-80 disabled:cursor-default disabled:opacity-70"
                >
                  {updatePhase === "downloading" ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>
                        {downloadPercent !== null
                          ? `Downloading ${downloadPercent}%`
                          : "Downloading..."}
                      </span>
                    </>
                  ) : updatePhase === "ready" ? (
                    <>
                      <RotateCw className="size-3.5" />
                      <span>Restart to update</span>
                    </>
                  ) : (
                    <>
                      <Download className="size-3.5" />
                      <span>Update v{availableUpdate.version}</span>
                    </>
                  )}
                </button>
                {updatePhase === "available" && (
                  <button
                    type="button"
                    onClick={handleDismissHeaderUpdate}
                    aria-label="Dismiss update"
                    className="inline-flex cursor-pointer items-center rounded-r-full py-1 pr-2 pl-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void loadPlatforms(false)}
              title="Refresh platform status"
            >
              <RefreshCw className="mr-1.5 size-3.5" />
              Refresh
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setHistoryOpen(true)}
            >
              <History className="mr-1.5 size-3.5" />
              <span>History</span>
              {history.length > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1.5 h-4 px-1.5 text-[10px] font-normal"
                >
                  {history.length}
                </Badge>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCreditsOpen(true)}
            >
              <HeartHandshake className="mr-1.5 size-3.5" />
              Credits
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
        {isLoading ? (
          <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
            Loading platforms...
          </div>
        ) : (
          <>
            <PlatformBar
              platforms={platforms}
              enabledIds={enabledIds}
              onToggle={handleToggle}
              onSolo={handleSolo}
              onSelectAll={handleSelectAll}
              onClearAll={handleClearAll}
              onOpenSettings={(platform) => setSettingsPlatform(platform)}
            />

            <Composer
              platforms={platforms}
              enabledIds={enabledIds}
              draft={draft}
              onDraftChange={setDraft}
              draftRestored={draftRestored}
              onClearDraft={handleClearDraft}
              isPosting={isPosting}
              onBroadcast={handleBroadcast}
              onOpenSettings={(platform) => setSettingsPlatform(platform)}
            />

            <DispatchResults outcomes={outcomes} />
          </>
        )}
      </main>

      <SettingsDialog
        platform={settingsPlatform}
        open={settingsPlatform !== null}
        onOpenChange={(open) => {
          if (!open) setSettingsPlatform(null);
        }}
        onSaved={() => loadPlatforms(false, settingsPlatform?.id)}
        onUnlinked={(platformId) =>
          updateEnabledIds((prev) => {
            const next = new Set(prev);
            next.delete(platformId);
            return next;
          })
        }
      />

      <CreditsDialog
        platforms={platforms}
        open={creditsOpen}
        onOpenChange={setCreditsOpen}
      />

      <HistorySheet
        entries={history}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onLoadIntoComposer={handleLoadFromHistory}
        onClearHistory={handleClearHistory}
      />

      <Toaster position="bottom-right" richColors />
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <SocialPosterApp />
    </ThemeProvider>
  );
}

export default App;
