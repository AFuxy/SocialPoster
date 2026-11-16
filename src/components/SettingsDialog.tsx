import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
  Unlink,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  saveCredentials,
  startPlatformOauth,
  unlinkPlatform,
  verifyPlatform,
  type PlatformMetadata,
} from "@/lib/tauri";

interface SettingsDialogProps {
  profileId: string;
  platform: PlatformMetadata | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
  onUnlinked: (platformId: string) => void;
}

export function SettingsDialog({
  profileId,
  platform,
  open,
  onOpenChange,
  onSaved,
  onUnlinked,
}: SettingsDialogProps) {
  const [selectedModeId, setSelectedModeId] = useState<string>("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isAuthorising, setIsAuthorising] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!platform || !open) return;
    const defaultMode =
      platform.activeAuthMode ?? platform.authModes[0]?.id ?? "default";
    setSelectedModeId(defaultMode);
    setValues({});
    setRevealed({});
    setConfirmUnlink(false);
    setVerifyStatus(null);
  }, [platform, open]);

  const activeMode = useMemo(() => {
    if (!platform) return null;
    return (
      platform.authModes.find((m) => m.id === selectedModeId) ??
      platform.authModes[0] ??
      null
    );
  }, [platform, selectedModeId]);

  useEffect(() => {
    if (!activeMode) return;
    setValues((prev) => {
      const next: Record<string, string> = {};
      for (const field of activeMode.fields) {
        if (field.kind.type === "select") {
          next[field.key] =
            prev[field.key] ?? field.kind.options[0]?.value ?? "";
        } else {
          next[field.key] = prev[field.key] ?? "";
        }
      }
      return next;
    });
    setVerifyStatus(null);
  }, [activeMode]);

  if (!platform) return null;

  const handleExternalLink = async (href: string | undefined) => {
    if (!href) return;
    if (href.startsWith("https://") || href.startsWith("http://")) {
      try {
        await openUrl(href);
      } catch (err) {
        toast.error(`Unable to open link: ${String(err)}`);
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMode) return;
    setIsSaving(true);
    setVerifyStatus(null);
    try {
      await saveCredentials(profileId, platform.id, activeMode.id, values);
      await onSaved();
      toast.success(`Saved credentials for ${platform.name}.`);
    } catch (err) {
      toast.error(`Failed to save credentials: ${String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleVerify = async () => {
    if (!activeMode) return;
    setIsVerifying(true);
    setVerifyStatus(null);
    try {
      const hasAnyInput = Object.values(values).some((v) => v.trim().length > 0);
      if (hasAnyInput) {
        await saveCredentials(profileId, platform.id, activeMode.id, values);
        await onSaved();
      }
      await verifyPlatform(profileId, platform.id);
      setVerifyStatus({
        ok: true,
        message: "Connection verified successfully.",
      });
    } catch (err) {
      setVerifyStatus({
        ok: false,
        message: String(err),
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleStartOauth = async () => {
    if (!activeMode) return;
    setIsAuthorising(true);
    setVerifyStatus(null);
    try {
      await startPlatformOauth(profileId, platform.id, activeMode.id, values);
      await onSaved();
      setVerifyStatus({
        ok: true,
        message: "OAuth authorisation completed and tokens saved.",
      });
      toast.success(`Connected ${platform.name} via OAuth.`);
    } catch (err) {
      setVerifyStatus({
        ok: false,
        message: String(err),
      });
    } finally {
      setIsAuthorising(false);
    }
  };

  const handleUnlink = async () => {
    if (!confirmUnlink) {
      setConfirmUnlink(true);
      return;
    }
    setIsUnlinking(true);
    setVerifyStatus(null);
    try {
      await unlinkPlatform(profileId, platform.id);
      setValues({});
      setRevealed({});
      setConfirmUnlink(false);
      onUnlinked(platform.id);
      await onSaved();
      toast.success(`Unlinked ${platform.name} credentials.`);
    } catch (err) {
      toast.error(`Failed to unlink ${platform.name}: ${String(err)}`);
    } finally {
      setIsUnlinking(false);
    }
  };

  const isBusy = isSaving || isVerifying || isAuthorising || isUnlinking;
  const isIncompatible = !platform.isCompatible;
  const instructionsMarkdown =
    activeMode?.setupInstructions ?? platform.setupInstructions;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-6 py-4">
          <div className="flex flex-wrap items-center gap-2.5 pr-6">
            <span
              className="size-3 rounded-full"
              style={{ backgroundColor: platform.accentColour }}
            />
            <DialogTitle>{platform.name}</DialogTitle>
            <Badge
              variant={platform.isConfigured ? "secondary" : "outline"}
              className="text-xs"
            >
              {platform.isConfigured ? "Configured" : "Not configured"}
            </Badge>
            <Badge
              variant="outline"
              className="ml-auto text-[11px] font-normal text-muted-foreground"
            >
              v{platform.version} • Requires SocialPoster{" "}
              {platform.compatibleAppVersion}
            </Badge>
          </div>
        </DialogHeader>

        {isIncompatible && (
          <div
            role="alert"
            className="flex items-start gap-2.5 border-b border-destructive/30 bg-destructive/10 px-6 py-3 text-xs text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-0.5">
              <p className="font-semibold">Incompatible version</p>
              <p>
                {platform.compatibilityError ??
                  `Requires SocialPoster ${platform.compatibleAppVersion}.`}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
          {/* Left column: mode selector + dynamic authFields form */}
          <form onSubmit={handleSave} className="flex flex-col gap-4 p-6">
            {platform.authModes.length > 1 && (
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Authentication Mode
                </span>
                <div className="flex flex-wrap gap-1.5 rounded-lg border bg-muted/40 p-1">
                  {platform.authModes.map((mode) => {
                    const isActive = mode.id === activeMode?.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => setSelectedModeId(mode.id)}
                        disabled={isBusy}
                        className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                          isActive
                            ? "bg-background text-foreground shadow-xs"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {mode.label}
                      </button>
                    );
                  })}
                </div>
                {activeMode?.description && (
                  <p className="text-xs text-muted-foreground">
                    {activeMode.description}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-4">
              {activeMode?.fields.map((field) => {
                if (field.kind.type === "oAuthButton") {
                  return (
                    <div key={field.key} className="space-y-1.5">
                      <Label className="flex items-center gap-1.5 text-sm font-medium">
                        <span>{field.label}</span>
                        {field.required && (
                          <span className="text-destructive">*</span>
                        )}
                      </Label>
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
                        onClick={handleStartOauth}
                        disabled={isBusy || isIncompatible}
                      >
                        {isAuthorising ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                          <KeyRound className="mr-2 size-4" />
                        )}
                        {field.kind.buttonLabel}
                      </Button>
                      {field.helpText && (
                        <p className="text-xs text-muted-foreground">
                          {field.helpText}
                        </p>
                      )}
                    </div>
                  );
                }

                if (field.kind.type === "select") {
                  return (
                    <div key={field.key} className="space-y-1.5">
                      <Label
                        htmlFor={`auth-${platform.id}-${field.key}`}
                        className="flex items-center gap-1.5 text-sm font-medium"
                      >
                        <span>{field.label}</span>
                        {field.required && (
                          <span className="text-destructive">*</span>
                        )}
                      </Label>
                      <select
                        id={`auth-${platform.id}-${field.key}`}
                        value={values[field.key] ?? ""}
                        onChange={(e) =>
                          setValues((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                        disabled={isBusy}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-2xs transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {field.kind.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      {field.helpText && (
                        <p className="text-xs text-muted-foreground">
                          {field.helpText}
                        </p>
                      )}
                    </div>
                  );
                }

                const isSecret = field.kind.type === "secret";
                const isUrl = field.kind.type === "url";
                const isVisible = Boolean(revealed[field.key]);

                return (
                  <div key={field.key} className="space-y-1.5">
                    <Label
                      htmlFor={`auth-${platform.id}-${field.key}`}
                      className="flex items-center gap-1.5 text-sm font-medium"
                    >
                      <span>{field.label}</span>
                      {field.required && (
                        <span className="text-destructive">*</span>
                      )}
                    </Label>
                    <div className="relative">
                      <Input
                        id={`auth-${platform.id}-${field.key}`}
                        type={
                          isSecret
                            ? isVisible
                              ? "text"
                              : "password"
                            : isUrl
                              ? "url"
                              : "text"
                        }
                        placeholder={
                          platform.isConfigured
                            ? "•••••••• (leave blank to keep existing, or enter new)"
                            : field.placeholder
                        }
                        value={values[field.key] ?? ""}
                        onChange={(e) =>
                          setValues((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                        className={isSecret ? "pr-9" : undefined}
                        autoComplete="off"
                        disabled={isBusy}
                      />
                      {isSecret && (
                        <button
                          type="button"
                          onClick={() =>
                            setRevealed((prev) => ({
                              ...prev,
                              [field.key]: !prev[field.key],
                            }))
                          }
                          aria-label={
                            isVisible ? "Hide secret" : "Reveal secret"
                          }
                          className="absolute inset-y-0 right-2 flex cursor-pointer items-center text-muted-foreground hover:text-foreground"
                        >
                          {isVisible ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </button>
                      )}
                    </div>
                    {field.helpText && (
                      <p className="text-xs text-muted-foreground">
                        {field.helpText}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {verifyStatus && (
              <div
                className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
                  verifyStatus.ok
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-destructive/30 bg-destructive/10 text-destructive"
                }`}
              >
                {verifyStatus.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0" />
                )}
                <span className="break-words">{verifyStatus.message}</span>
              </div>
            )}

            <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
              <Button type="submit" disabled={isBusy || isIncompatible}>
                {isSaving && <Loader2 className="mr-2 size-4 animate-spin" />}
                Save
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleVerify}
                disabled={isBusy || isIncompatible}
              >
                {isVerifying ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 size-4" />
                )}
                Test Connection
              </Button>
            </div>
          </form>

          {/* Right column: Markdown setup instructions */}
          <div className="flex flex-col bg-muted/20 p-6">
            <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Setup Guide
            </h3>
            <ScrollArea className="h-[320px] pr-3">
              <div className="prose prose-sm dark:prose-invert max-w-none space-y-3 text-sm leading-relaxed [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs [&_h3]:text-base [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
                <Markdown
                  components={{
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        onClick={(e) => {
                          e.preventDefault();
                          void handleExternalLink(href);
                        }}
                        className="inline-flex cursor-pointer items-center gap-1 font-medium text-primary underline underline-offset-4 hover:opacity-80"
                      >
                        <span>{children}</span>
                        <ExternalLink className="size-3" />
                      </a>
                    ),
                  }}
                >
                  {instructionsMarkdown}
                </Markdown>
              </div>
            </ScrollArea>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/40 px-6 py-3.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {platform.authors.length > 0 ? (
              <>
                <span>Ported by</span>
                {platform.authors.map((author, idx) => (
                  <span
                    key={author.name}
                    className="inline-flex flex-wrap items-center gap-1.5"
                  >
                    {idx > 0 && <span>·</span>}
                    <span className="font-medium text-foreground">
                      {author.name}
                    </span>
                    {author.links
                      .filter((link) => link.url.startsWith("https://"))
                      .map((link) => (
                        <button
                          key={`${author.name}-${link.url}`}
                          type="button"
                          onClick={() => void handleExternalLink(link.url)}
                          className="inline-flex cursor-pointer items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <span>{link.label}</span>
                          <ExternalLink className="size-2.5" />
                        </button>
                      ))}
                  </span>
                ))}
              </>
            ) : (
              <span>Community integration</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {platform.isConfigured && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleUnlink}
                disabled={isBusy}
              >
                {isUnlinking ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Unlink className="mr-1.5 size-3.5" />
                )}
                {confirmUnlink ? "Confirm Unlink?" : "Unlink"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
