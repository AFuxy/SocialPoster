import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import type { PostOutcome } from "@/lib/tauri";

interface DispatchResultsProps {
  outcomes: PostOutcome[];
}

export function DispatchResults({ outcomes }: DispatchResultsProps) {
  if (outcomes.length === 0) return null;

  const successCount = outcomes.filter((o) => o.success).length;

  const handleOpenPost = async (url: string) => {
    if (!url.startsWith("https://") && !url.startsWith("http://")) return;
    try {
      await openUrl(url);
    } catch (err) {
      toast.error(`Unable to open post URL: ${String(err)}`);
    }
  };

  return (
    <section
      aria-label="Dispatch results"
      className="rounded-xl border bg-card p-4 shadow-xs"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">
          Dispatch Results
        </h2>
        <Badge
          variant={successCount === outcomes.length ? "secondary" : "outline"}
          className="text-xs font-normal"
        >
          {successCount} / {outcomes.length} succeeded
        </Badge>
      </div>

      <div className="space-y-2">
        {outcomes.map((outcome) => (
          <div
            key={outcome.platformId}
            className={`rounded-lg border px-3.5 py-2.5 text-sm ${
              outcome.success
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-destructive/30 bg-destructive/5"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                {outcome.success ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <XCircle className="size-4 shrink-0 text-destructive" />
                )}
                <span className="font-medium">{outcome.platformName}</span>
                {!outcome.success && outcome.error && (
                  <span className="truncate text-xs text-destructive">
                    {outcome.error}
                  </span>
                )}
              </div>

              {outcome.success && outcome.postUrl && (
                <button
                  type="button"
                  onClick={() => void handleOpenPost(outcome.postUrl!)}
                  className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primary underline underline-offset-4 hover:opacity-80"
                >
                  <span>View post</span>
                  <ExternalLink className="size-3" />
                </button>
              )}
            </div>

            {outcome.notes && outcome.notes.length > 0 && (
              <div className="mt-1.5 space-y-0.5 pl-6.5 text-xs text-muted-foreground">
                {outcome.notes.map((note, idx) => (
                  <p key={idx}>{note}</p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
