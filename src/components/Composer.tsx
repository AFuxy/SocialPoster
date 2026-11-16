import { useCallback, useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Film,
  ImagePlus,
  Loader2,
  RotateCcw,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ComposerDraft } from "@/lib/storage";
import type {
  MediaAttachment,
  PlatformDispatchRequest,
  PlatformMetadata,
} from "@/lib/tauri";

interface ComposerProps {
  platforms: PlatformMetadata[];
  enabledIds: Set<string>;
  draft: ComposerDraft;
  onDraftChange: React.Dispatch<React.SetStateAction<ComposerDraft>>;
  draftRestored: boolean;
  onClearDraft: () => void;
  isPosting: boolean;
  onBroadcast: (targets: PlatformDispatchRequest[]) => Promise<void>;
  onOpenSettings: (platform: PlatformMetadata) => void;
}

interface PlatformValidation {
  platform: PlatformMetadata;
  resolvedText: string;
  charCount: number;
  errors: string[];
}

const VALID_DROP_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "mp4",
  "mov",
]);

function fileExtension(filePath: string): string {
  return filePath.split(".").pop()?.toLowerCase() ?? "";
}

function inferMimeType(filePath: string): string {
  switch (fileExtension(filePath)) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

function fileBasename(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

export function Composer({
  platforms,
  enabledIds,
  draft,
  onDraftChange,
  draftRestored,
  onClearDraft,
  isPosting,
  onBroadcast,
}: ComposerProps) {
  const { masterText, overrides, media } = draft;
  const [activeTab, setActiveTab] = useState("master");
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const hasDraftContent =
    masterText.trim().length > 0 ||
    Object.values(overrides).some((v) => v.trim().length > 0) ||
    media.length > 0;

  const enabledPlatforms = useMemo(
    () => platforms.filter((p) => enabledIds.has(p.id)),
    [platforms, enabledIds],
  );

  const tabPlatforms = useMemo(
    () =>
      platforms.filter(
        (p) =>
          enabledIds.has(p.id) || (overrides[p.id]?.trim().length ?? 0) > 0,
      ),
    [platforms, enabledIds, overrides],
  );

  useEffect(() => {
    if (
      activeTab !== "master" &&
      !tabPlatforms.some((p) => p.id === activeTab)
    ) {
      setActiveTab("master");
    }
  }, [activeTab, tabPlatforms]);

  const appendDroppedPaths = useCallback((paths: string[]) => {
    const validPaths = paths.filter((p) =>
      VALID_DROP_EXTENSIONS.has(fileExtension(p)),
    );
    const skippedCount = paths.length - validPaths.length;

    if (validPaths.length > 0) {
      const next: MediaAttachment[] = validPaths.map((path) => ({
        path,
        mimeType: inferMimeType(path),
        altText: "",
      }));
      onDraftChange((prev) => ({ ...prev, media: [...prev.media, ...next] }));
    }

    if (skippedCount > 0) {
      toast.warning(
        `Ignored ${skippedCount} unsupported file${skippedCount === 1 ? "" : "s"}. Supported: PNG, JPG, WEBP, GIF, MP4, MOV.`,
      );
    }
  }, [onDraftChange]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (!active) return;
        const { type } = event.payload;
        if (type === "over" || type === "enter") {
          setIsDraggingOver(true);
        } else if (type === "leave") {
          setIsDraggingOver(false);
        } else if (type === "drop") {
          setIsDraggingOver(false);
          appendDroppedPaths(event.payload.paths ?? []);
        }
      })
      .then((fn) => {
        if (active) {
          unlisten = fn;
        } else {
          fn();
        }
      })
      .catch(() => {
        // Running outside a Tauri WebView (e.g. plain Vite browser preview).
      });

    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, [appendDroppedPaths]);

  const validations = useMemo<PlatformValidation[]>(() => {
    const imageCount = media.filter((m) =>
      m.mimeType.startsWith("image/"),
    ).length;
    const hasVideo = media.some((m) => m.mimeType.startsWith("video/"));

    return enabledPlatforms.map((platform) => {
      const override = overrides[platform.id];
      const resolvedText = override !== undefined ? override : masterText;
      const charCount = resolvedText.length;
      const errors: string[] = [];

      if (!platform.isConfigured) {
        errors.push("Setup required");
      }
      if (charCount > platform.capabilities.maxChars) {
        errors.push(
          `Exceeds ${platform.capabilities.maxChars.toLocaleString()} chars`,
        );
      }
      if (imageCount > platform.capabilities.maxImages) {
        errors.push(`Max ${platform.capabilities.maxImages} images`);
      }
      if (hasVideo && !platform.capabilities.supportsVideo) {
        errors.push("Video unsupported");
      }
      if (platform.capabilities.requiresMedia && media.length === 0) {
        errors.push("Media required");
      }
      if (resolvedText.trim().length === 0 && media.length === 0) {
        errors.push("Post is empty");
      }

      return {
        platform,
        resolvedText,
        charCount,
        errors,
      };
    });
  }, [enabledPlatforms, masterText, media, overrides]);

  const hasValidationErrors = validations.some((v) => v.errors.length > 0);
  const canPost =
    enabledPlatforms.length > 0 && !hasValidationErrors && !isPosting;

  const handleAttachMedia = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "Media",
            extensions: [
              "png",
              "jpg",
              "jpeg",
              "webp",
              "gif",
              "mp4",
              "mov",
              "webm",
            ],
          },
        ],
      });

      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const next: MediaAttachment[] = paths.map((path) => ({
        path,
        mimeType: inferMimeType(path),
        altText: "",
      }));
      onDraftChange((prev) => ({ ...prev, media: [...prev.media, ...next] }));
    } catch (err) {
      toast.error(`Failed to open file picker: ${String(err)}`);
    }
  };

  const handleSubmit = async () => {
    if (!canPost) return;

    const targets: PlatformDispatchRequest[] = validations.map((v) => ({
      platformId: v.platform.id,
      text: v.resolvedText,
      media: media.map((item) => ({
        path: item.path,
        mimeType: item.mimeType,
        altText: item.altText?.trim() ? item.altText.trim() : null,
      })),
    }));

    await onBroadcast(targets);
  };

  return (
    <section
      aria-label="Post composer"
      className={cn(
        "relative rounded-xl border bg-card p-5 shadow-xs transition-colors",
        isDraggingOver &&
          "border-2 border-dashed border-primary bg-primary/5 ring-2 ring-primary/15",
      )}
    >
      {isDraggingOver && (
        <div className="pointer-events-none mb-3 flex items-center justify-center gap-2 rounded-lg border border-dashed border-primary/50 bg-primary/10 py-2 text-xs font-medium text-primary">
          <Upload className="size-4" />
          <span>Drop images or videos here to attach</span>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <TabsList className="flex h-auto flex-wrap items-center justify-start gap-1.5 bg-transparent p-0">
            <TabsTrigger
              value="master"
              className="rounded-md border bg-muted/40 px-2.5 py-1 text-xs data-[state=active]:bg-background data-[state=active]:shadow-2xs"
            >
              Master
            </TabsTrigger>
            {tabPlatforms.map((platform) => {
              const hasOverride = overrides[platform.id] !== undefined;
              return (
                <TabsTrigger
                  key={platform.id}
                  value={platform.id}
                  className="gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1 text-xs data-[state=active]:bg-background data-[state=active]:shadow-2xs"
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: platform.accentColour }}
                  />
                  <span>{platform.name}</span>
                  {hasOverride && (
                    <span
                      className="size-1.5 rounded-full bg-primary"
                      title="Custom override active"
                    />
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          <div className="flex flex-wrap items-center gap-2">
            {draftRestored && (
              <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                Draft restored
              </Badge>
            )}
            {hasDraftContent && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClearDraft}
                disabled={isPosting}
                className="h-8 px-2.5 text-xs text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="mr-1.5 size-3.5" />
                Clear Draft
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAttachMedia}
              disabled={isPosting}
            >
              <ImagePlus className="mr-1.5 size-4" />
              Attach Media
            </Button>
          </div>
        </div>

        <TabsContent value="master" className="mt-0 space-y-3">
          <Textarea
            value={masterText}
            onChange={(e) => {
              const value = e.target.value;
              onDraftChange((prev) => ({ ...prev, masterText: value }));
            }}
            placeholder="Write your post, or drop media here..."
            rows={6}
            className="min-h-[150px] resize-y text-sm leading-relaxed"
            disabled={isPosting}
          />
        </TabsContent>

        {tabPlatforms.map((platform) => {
          const isOverridden = overrides[platform.id] !== undefined;
          const value = isOverridden ? overrides[platform.id] : masterText;

          return (
            <TabsContent
              key={platform.id}
              value={platform.id}
              className="mt-0 space-y-2.5"
            >
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {isOverridden
                    ? `Custom text for ${platform.name}`
                    : "Using Master text — type to override"}
                </span>
                {isOverridden && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                      onDraftChange((prev) => {
                        const copy = { ...prev.overrides };
                        delete copy[platform.id];
                        return { ...prev, overrides: copy };
                      })
                    }
                  >
                    <RotateCcw className="mr-1 size-3" />
                    Reset to master
                  </Button>
                )}
              </div>
              <Textarea
                value={value}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  onDraftChange((prev) => ({
                    ...prev,
                    overrides: {
                      ...prev.overrides,
                      [platform.id]: nextValue,
                    },
                  }));
                }}
                placeholder={`Custom post text for ${platform.name}...`}
                rows={6}
                className="min-h-[150px] resize-y text-sm leading-relaxed"
                disabled={isPosting}
              />
            </TabsContent>
          );
        })}
      </Tabs>

      {/* Media thumbnail grid */}
      {media.length > 0 && (
        <div className="mt-4 space-y-2.5 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Attachments ({media.length})
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            {media.map((item, idx) => {
              const isVideo = item.mimeType.startsWith("video/");
              const name = fileBasename(item.path);

              return (
                <div
                  key={`${item.path}-${idx}`}
                  className="group flex flex-col gap-2 rounded-lg border bg-background p-2 shadow-2xs"
                >
                  <div className="relative overflow-hidden rounded-md bg-muted">
                    {isVideo ? (
                      <div className="flex h-28 w-full flex-col items-center justify-center gap-1.5 px-2 text-center">
                        <Film className="size-7 text-muted-foreground" />
                        <Badge variant="secondary" className="text-[10px]">
                          Video
                        </Badge>
                        <span
                          className="max-w-full truncate text-[11px] text-muted-foreground"
                          title={item.path}
                        >
                          {name}
                        </span>
                      </div>
                    ) : (
                      <img
                        src={convertFileSrc(item.path)}
                        alt={item.altText || name}
                        className="h-28 w-full object-cover"
                      />
                    )}

                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="absolute top-1.5 right-1.5 size-7 opacity-90 shadow-xs hover:bg-destructive hover:text-destructive-foreground"
                      onClick={() =>
                        onDraftChange((prev) => ({
                          ...prev,
                          media: prev.media.filter((_, i) => i !== idx),
                        }))
                      }
                      aria-label={`Remove ${name}`}
                      disabled={isPosting}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>

                  <Input
                    value={item.altText ?? ""}
                    onChange={(e) => {
                      const altText = e.target.value;
                      onDraftChange((prev) => ({
                        ...prev,
                        media: prev.media.map((m, i) =>
                          i === idx ? { ...m, altText } : m,
                        ),
                      }));
                    }}
                    placeholder="Alt text (optional)"
                    className="h-7 text-xs"
                    disabled={isPosting}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Compact character counter & Post Now footer */}
      <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {enabledPlatforms.length === 0 ? (
            <span className="text-muted-foreground">
              Click a platform above to set it up
            </span>
          ) : (() => {
            if (activeTab !== "master") {
              const activeValidation = validations.find(
                (v) => v.platform.id === activeTab,
              );
              if (activeValidation) {
                const isOver =
                  activeValidation.charCount >
                  activeValidation.platform.capabilities.maxChars;
                const mediaError = activeValidation.errors.find(
                  (e) =>
                    e === "Media required" ||
                    e === "Video unsupported" ||
                    e.startsWith("Max "),
                );
                return (
                  <span
                    className={cn(
                      "tabular-nums",
                      isOver || mediaError
                        ? "font-medium text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {activeValidation.charCount} /{" "}
                    {activeValidation.platform.capabilities.maxChars}
                    {mediaError ? ` · ${mediaError}` : ""}
                  </span>
                );
              }
            }

            const tightest = validations.reduce((min, curr) =>
              curr.platform.capabilities.maxChars <
              min.platform.capabilities.maxChars
                ? curr
                : min,
            );
            const anyCharOrMediaError = validations.some(
              (v) =>
                v.charCount > v.platform.capabilities.maxChars ||
                v.errors.some(
                  (e) =>
                    e === "Media required" ||
                    e === "Video unsupported" ||
                    e.startsWith("Max "),
                ),
            );
            const firstMediaError = validations
              .flatMap((v) => v.errors)
              .find(
                (e) =>
                  e === "Media required" ||
                  e === "Video unsupported" ||
                  e.startsWith("Max "),
              );

            return (
              <span
                className={cn(
                  "tabular-nums",
                  anyCharOrMediaError
                    ? "font-medium text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {tightest.charCount} / {tightest.platform.capabilities.maxChars}{" "}
                · {tightest.platform.name}
                {firstMediaError ? ` · ${firstMediaError}` : ""}
              </span>
            );
          })()}
        </div>

        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!canPost}
          className="shrink-0"
        >
          {isPosting ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Send className="mr-2 size-4" />
          )}
          {isPosting ? "Posting..." : "Post Now"}
        </Button>
      </div>
    </section>
  );
}
