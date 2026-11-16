import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  History,
  Image as ImageIcon,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { HistoryEntry } from "@/lib/tauri";

interface HistorySheetProps {
  entries: HistoryEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoadIntoComposer: (entry: HistoryEntry, onlyFailed?: boolean) => void;
  onClearHistory: () => void;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function HistorySheet({
  entries,
  open,
  onOpenChange,
  onLoadIntoComposer,
  onClearHistory,
}: HistorySheetProps) {
  const handleOpenPost = async (url: string) => {
    if (!url.startsWith("https://") && !url.startsWith("http://")) return;
    try {
      await openUrl(url);
    } catch (err) {
      toast.error(`Unable to open post URL: ${String(err)}`);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full max-w-md flex-col gap-0 overflow-x-hidden p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-5 py-4 pr-12">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="flex items-center gap-2 text-base">
              <History className="size-4 text-primary" />
              <span>Post History</span>
              <Badge variant="secondary" className="text-xs font-normal">
                {entries.length}
              </Badge>
            </SheetTitle>

            {entries.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={onClearHistory}
              >
                <Trash2 className="mr-1 size-3.5" />
                Clear History
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto px-5 py-4">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted-foreground">
              <History className="size-8 opacity-40" />
              <p>No posts yet.</p>
            </div>
          ) : (
            <div className="min-w-0 w-full space-y-3 overflow-hidden">
              {entries.map((entry) => {
                const hasFailures = entry.outcomes.some((o) => !o.success);
                const hasSuccesses = entry.outcomes.some((o) => o.success);
                const isPartialFailure = hasFailures && hasSuccesses;
                const preview = entry.masterText.trim();

                return (
                  <article
                    key={entry.id}
                    className="w-full min-w-0 max-w-full space-y-3 overflow-hidden rounded-xl border bg-card p-3.5 shadow-2xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="size-3.5" />
                        {formatTimestamp(entry.createdAt)}
                      </span>

                      {entry.media.length > 0 && (
                        <Badge
                          variant="outline"
                          className="gap-1 text-[11px] font-normal"
                        >
                          <ImageIcon className="size-3" />
                          {entry.media.length} attachment
                          {entry.media.length === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </div>

                    <p className="line-clamp-3 w-full min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] break-all text-sm leading-relaxed text-foreground">
                      {preview.length > 0 ? (
                        preview
                      ) : (
                        <span className="italic text-muted-foreground">
                          (No master text)
                        </span>
                      )}
                    </p>

                    <div className="flex flex-wrap gap-1.5">
                      {entry.outcomes.map((outcome) =>
                        outcome.success ? (
                          outcome.postUrl ? (
                            <button
                              key={outcome.platformId}
                              type="button"
                              onClick={() =>
                                void handleOpenPost(outcome.postUrl!)
                              }
                              title={`Open ${outcome.platformName} post`}
                              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
                            >
                              <CheckCircle2 className="size-3" />
                              <span>{outcome.platformName}</span>
                              <ExternalLink className="size-2.5" />
                            </button>
                          ) : (
                            <Badge
                              key={outcome.platformId}
                              variant="outline"
                              className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                            >
                              <CheckCircle2 className="size-3" />
                              <span>{outcome.platformName}</span>
                            </Badge>
                          )
                        ) : (
                          <Badge
                            key={outcome.platformId}
                            variant="outline"
                            title={outcome.error ?? "Publish failed"}
                            className="max-w-full gap-1 border-destructive/30 bg-destructive/10 text-xs font-normal text-destructive"
                          >
                            <XCircle className="size-3 shrink-0" />
                            <span className="font-medium">
                              {outcome.platformName}
                            </span>
                            {outcome.error && (
                              <span className="truncate opacity-85">
                                · {outcome.error}
                              </span>
                            )}
                          </Badge>
                        ),
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 border-t pt-2.5">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => onLoadIntoComposer(entry, false)}
                      >
                        <RotateCcw className="mr-1.5 size-3" />
                        Load into Composer
                      </Button>

                      {isPartialFailure && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2.5 text-xs"
                          onClick={() => onLoadIntoComposer(entry, true)}
                        >
                          Retry Failed Only
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
