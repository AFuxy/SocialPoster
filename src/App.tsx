import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { AddProfileDialog } from "@/components/AddProfileDialog";
import { AppLogo } from "@/components/AppLogo";
import { Composer } from "@/components/Composer";
import { CreditsDialog } from "@/components/CreditsDialog";
import { DispatchResults } from "@/components/DispatchResults";
import { HistorySheet } from "@/components/HistorySheet";
import { PlatformBar } from "@/components/PlatformBar";
import { ProfileMenu } from "@/components/ProfileMenu";
import { SettingsDialog } from "@/components/SettingsDialog";
import { UnlockProfileCard } from "@/components/UnlockProfileCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import {
  clearProfileStorage,
  clearStoredDraft,
  EMPTY_DRAFT,
  enabledPlatformsKey,
  getActiveProfileId,
  knownPlatformsKey,
  loadDraft,
  saveDraft,
  setActiveProfileId,
  type ComposerDraft,
} from "@/lib/storage";
import {
  broadcastPost,
  clearHistory,
  createProfile,
  deleteProfile,
  getHistory,
  getPlatforms,
  listProfiles,
  lockProfile,
  renameProfile,
  setProfilePassword,
  unlockProfile,
  type HistoryEntry,
  type PlatformDispatchRequest,
  type PlatformMetadata,
  type PostOutcome,
  type ProfileInfo,
} from "@/lib/tauri";
import {
  checkForUpdateSilently,
  downloadAndInstallUpdate,
  getDismissedUpdateVersion,
  relaunchApp,
  setDismissedUpdateVersion,
  type Update,
} from "@/lib/updater";
import "./App.css";

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
  profileId: string,
  enabledIds: Set<string>,
  registeredPlatforms: PlatformMetadata[],
) {
  try {
    localStorage.setItem(
      enabledPlatformsKey(profileId),
      JSON.stringify(Array.from(enabledIds)),
    );
    localStorage.setItem(
      knownPlatformsKey(profileId),
      JSON.stringify(registeredPlatforms.map((p) => p.id)),
    );
  } catch {
    // Ignore storage quota / privacy mode failures.
  }
}

function reconcileEnabledPlatforms(
  profileId: string,
  registered: PlatformMetadata[],
): Set<string> {
  const eligibleIds = new Set(
    registered
      .filter((p) => p.isCompatible && p.isConfigured)
      .map((p) => p.id),
  );
  const storedEnabled = readStringArray(enabledPlatformsKey(profileId));
  const storedKnown = readStringArray(knownPlatformsKey(profileId));

  if (storedEnabled === null) {
    const initial = new Set(eligibleIds);
    persistPlatformState(profileId, initial, registered);
    return initial;
  }

  const reconciled = new Set(
    storedEnabled.filter((id) => eligibleIds.has(id)),
  );
  const knownSet = new Set(storedKnown ?? storedEnabled);

  for (const platform of registered) {
    if (
      !knownSet.has(platform.id) &&
      platform.isCompatible &&
      platform.isConfigured
    ) {
      reconciled.add(platform.id);
    }
  }

  persistPlatformState(profileId, reconciled, registered);
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
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [activeProfileId, setActiveProfileIdState] = useState<string>(() =>
    getActiveProfileId(),
  );
  const [addProfileOpen, setAddProfileOpen] = useState(false);

  const [draft, setDraft] = useState<ComposerDraft>(EMPTY_DRAFT);
  const [draftRestored, setDraftRestored] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const [platforms, setPlatforms] = useState<PlatformMetadata[]>([]);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
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

  const hydratedProfileRef = useRef<string | null>(null);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null,
    [profiles, activeProfileId],
  );

  const clearInMemoryProfileState = useCallback(() => {
    hydratedProfileRef.current = null;
    setPlatforms([]);
    setEnabledIds(new Set());
    setDraft(EMPTY_DRAFT);
    setDraftRestored(false);
    setHistory([]);
    setOutcomes([]);
    setSettingsPlatform(null);
    setHistoryOpen(false);
  }, []);

  const loadUnlockedProfileData = useCallback(
    async (
      profileId: string,
      isInitialForProfile: boolean,
      autoEnablePlatformId?: string,
    ) => {
      try {
        const [platformList, historyList] = await Promise.all([
          getPlatforms(profileId),
          getHistory(profileId),
        ]);

        setPlatforms(platformList);
        setHistory(historyList);
        setSettingsPlatform((current) =>
          current
            ? (platformList.find((p) => p.id === current.id) ?? current)
            : null,
        );

        if (isInitialForProfile) {
          const restoredDraft = loadDraft(profileId);
          setDraft(restoredDraft ?? EMPTY_DRAFT);
          setDraftRestored(restoredDraft !== null);
          setEnabledIds(reconcileEnabledPlatforms(profileId, platformList));
          hydratedProfileRef.current = profileId;
        } else {
          setEnabledIds((prev) => {
            const eligibleIds = new Set(
              platformList
                .filter((p) => p.isCompatible && p.isConfigured)
                .map((p) => p.id),
            );
            const filtered = new Set(
              Array.from(prev).filter((id) => eligibleIds.has(id)),
            );
            if (autoEnablePlatformId && eligibleIds.has(autoEnablePlatformId)) {
              filtered.add(autoEnablePlatformId);
            }
            persistPlatformState(profileId, filtered, platformList);
            return filtered;
          });
        }
      } catch (err) {
        toast.error(`Failed to load profile data: ${String(err)}`);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const refreshProfilesAndActivate = useCallback(
    async (preferredId?: string) => {
      try {
        const list = await listProfiles();
        setProfiles(list);

        const candidateId = preferredId ?? getActiveProfileId();
        const target =
          list.find((p) => p.id === candidateId) ?? list[0] ?? null;
        if (!target) {
          clearInMemoryProfileState();
          setIsLoading(false);
          return;
        }

        setActiveProfileId(target.id);
        setActiveProfileIdState(target.id);

        if (target.isUnlocked) {
          await loadUnlockedProfileData(target.id, true);
        } else {
          clearInMemoryProfileState();
          setIsLoading(false);
        }
      } catch (err) {
        toast.error(`Failed to load profiles: ${String(err)}`);
        setIsLoading(false);
      }
    },
    [clearInMemoryProfileState, loadUnlockedProfileData],
  );

  useEffect(() => {
    void refreshProfilesAndActivate();
  }, [refreshProfilesAndActivate]);

  useEffect(() => {
    if (
      !activeProfile ||
      !activeProfile.isUnlocked ||
      hydratedProfileRef.current !== activeProfile.id
    ) {
      return;
    }
    const profileId = activeProfile.id;
    const timer = window.setTimeout(() => {
      saveDraft(profileId, draft);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draft, activeProfile]);

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

  const handleSelectProfile = async (profileId: string) => {
    if (profileId === activeProfile?.id) return;
    clearInMemoryProfileState();
    setIsLoading(true);
    await refreshProfilesAndActivate(profileId);
  };

  const handleCreateProfile = async (name: string, password: string | null) => {
    try {
      const created = await createProfile(name, password);
      clearInMemoryProfileState();
      setIsLoading(true);
      await refreshProfilesAndActivate(created.id);
      toast.success(`Created profile "${created.name}".`);
    } catch (err) {
      toast.error(`Failed to create profile: ${String(err)}`);
      throw err;
    }
  };

  const handleUnlockProfile = async (profileId: string, password: string) => {
    const ok = await unlockProfile(profileId, password);
    if (ok) {
      setIsLoading(true);
      await refreshProfilesAndActivate(profileId);
    }
    return ok;
  };

  const handleLockProfile = useCallback(
    async (profileId: string) => {
      try {
        await lockProfile(profileId);
        clearInMemoryProfileState();
        const list = await listProfiles();
        setProfiles(list);
      } catch (err) {
        toast.error(`Failed to lock profile: ${String(err)}`);
      }
    },
    [clearInMemoryProfileState],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        if (activeProfile && activeProfile.hasPassword && activeProfile.isUnlocked) {
          e.preventDefault();
          void handleLockProfile(activeProfile.id);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeProfile, handleLockProfile]);

  const handleSetProfilePassword = async (
    profileId: string,
    currentPassword: string | null,
    newPassword: string | null,
  ) => {
    const updated = await setProfilePassword(
      profileId,
      currentPassword,
      newPassword,
    );
    setProfiles((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p)),
    );
    toast.success(
      updated.hasPassword ? "Profile password saved." : "Profile password removed.",
    );
  };

  const handleRenameProfile = async (profileId: string, name: string) => {
    try {
      const updated = await renameProfile(profileId, name);
      setProfiles((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p)),
      );
      toast.success(`Renamed profile to "${updated.name}".`);
    } catch (err) {
      toast.error(`Failed to rename profile: ${String(err)}`);
      throw err;
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    try {
      await deleteProfile(profileId);
      clearProfileStorage(profileId);
      clearInMemoryProfileState();
      setIsLoading(true);
      await refreshProfilesAndActivate();
      toast.success("Profile deleted.");
    } catch (err) {
      toast.error(`Failed to delete profile: ${String(err)}`);
      throw err;
    }
  };

  const handleRefresh = async () => {
    if (!activeProfile || isLocked || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await loadUnlockedProfileData(activeProfile.id, false);
    } finally {
      setIsRefreshing(false);
    }
  };

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
      if (!activeProfile) return;
      const profileId = activeProfile.id;
      setEnabledIds((prev) => {
        const next = updater(prev);
        persistPlatformState(profileId, next, platforms);
        return next;
      });
    },
    [activeProfile, platforms],
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
    if (!activeProfile) return;
    clearStoredDraft(activeProfile.id);
    setDraft(EMPTY_DRAFT);
    setDraftRestored(false);
  };

  const handleBroadcast = async (targets: PlatformDispatchRequest[]) => {
    if (!activeProfile) return;
    const profileId = activeProfile.id;
    setIsPosting(true);
    try {
      const results = await broadcastPost(
        profileId,
        targets,
        draft.masterText,
        draft.overrides,
        draft.media,
      );
      setOutcomes(results);

      const updatedHistory = await getHistory(profileId);
      setHistory(updatedHistory);

      const okCount = results.filter((r) => r.success).length;
      if (results.length > 0 && okCount === results.length) {
        clearStoredDraft(profileId);
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
        platforms
          .filter((p) => p.isCompatible && p.isConfigured)
          .map((p) => p.id),
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

  const handleClearHistory = async () => {
    if (!activeProfile) return;
    try {
      await clearHistory(activeProfile.id);
      setHistory([]);
      toast.success("History cleared.");
    } catch (err) {
      toast.error(`Failed to clear history: ${String(err)}`);
    }
  };

  const isLocked = Boolean(activeProfile && !activeProfile.isUnlocked);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="relative z-40 border-b bg-card/60 backdrop-blur-xs">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <AppLogo className="h-8 w-8 shrink-0" />
            <h1 className="text-base font-semibold tracking-tight">
              SocialPoster
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
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

            <ProfileMenu
              profiles={profiles}
              activeProfile={activeProfile}
              onSelectProfile={(id) => void handleSelectProfile(id)}
              onOpenAddProfile={() => setAddProfileOpen(true)}
              onLockProfile={(id) => void handleLockProfile(id)}
              onRenameProfile={handleRenameProfile}
              onSetProfilePassword={handleSetProfilePassword}
              onDeleteProfile={handleDeleteProfile}
            />

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLocked || !activeProfile || isRefreshing}
              onClick={() => void handleRefresh()}
              title="Refresh platform status"
            >
              <RefreshCw
                className={`mr-1.5 size-3.5${isRefreshing ? " animate-spin" : ""}`}
              />
              Refresh
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLocked || !activeProfile}
              onClick={() => setHistoryOpen(true)}
            >
              <History className="mr-1.5 size-3.5" />
              <span>History</span>
              {!isLocked && history.length > 0 && (
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
            Loading...
          </div>
        ) : isLocked && activeProfile ? (
          <UnlockProfileCard
            profile={activeProfile}
            onUnlock={handleUnlockProfile}
          />
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

      {activeProfile && !isLocked && (
        <>
          <SettingsDialog
            profileId={activeProfile.id}
            platform={settingsPlatform}
            open={settingsPlatform !== null}
            onOpenChange={(open) => {
              if (!open) setSettingsPlatform(null);
            }}
            onSaved={() =>
              loadUnlockedProfileData(
                activeProfile.id,
                false,
                settingsPlatform?.id,
              )
            }
            onUnlinked={(platformId) =>
              updateEnabledIds((prev) => {
                const next = new Set(prev);
                next.delete(platformId);
                return next;
              })
            }
          />

          <HistorySheet
            entries={history}
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            onLoadIntoComposer={handleLoadFromHistory}
            onClearHistory={() => void handleClearHistory()}
          />
        </>
      )}

      <CreditsDialog
        platforms={platforms}
        open={creditsOpen}
        onOpenChange={setCreditsOpen}
      />

      <AddProfileDialog
        open={addProfileOpen}
        onOpenChange={setAddProfileOpen}
        onCreate={handleCreateProfile}
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
