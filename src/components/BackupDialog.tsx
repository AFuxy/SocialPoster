import { useEffect, useState } from "react";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { Download, FileArchive, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exportProfileStorage, restoreProfileStorage } from "@/lib/storage";
import {
  exportProfileBackup,
  importProfileBackup,
  inspectProfileBackup,
  type BackupMetadata,
  type ImportedProfileResponse,
  type ProfileInfo,
} from "@/lib/tauri";

interface BackupDialogProps {
  mode: "export" | "import" | null;
  activeProfile: ProfileInfo | null;
  onClose: () => void;
  onImported: (result: ImportedProfileResponse) => Promise<void>;
}

function slugifyProfileName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "profile";
}

function formatExportDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function BackupDialog({
  mode,
  activeProfile,
  onClose,
  onImported,
}: BackupDialogProps) {
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [importFilePath, setImportFilePath] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<BackupMetadata | null>(null);
  const [customName, setCustomName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (mode !== null) {
      setPassphrase("");
      setConfirmPassphrase("");
      setImportFilePath(null);
      setMetadata(null);
      setCustomName("");
      setError(null);
      setIsBusy(false);
    }
  }, [mode]);

  const handleExportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProfile) return;

    if (passphrase.trim().length < 8) {
      setError("Passphrase must be at least 8 characters.");
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setError("Passphrases do not match.");
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      const slug = slugifyProfileName(activeProfile.name);
      const selectedPath = await saveFileDialog({
        defaultPath: `${slug}-backup.spbackup`,
        filters: [
          { name: "SocialPoster Backup", extensions: ["spbackup", "json"] },
        ],
      });
      if (!selectedPath) return;

      const frontendState = exportProfileStorage(activeProfile.id);
      await exportProfileBackup(
        activeProfile.id,
        selectedPath,
        passphrase,
        frontendState,
      );
      toast.success("Backup exported.");
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsBusy(false);
    }
  };

  const handlePickImportFile = async () => {
    setError(null);
    try {
      const selected = await openFileDialog({
        multiple: false,
        filters: [
          { name: "SocialPoster Backup", extensions: ["spbackup", "json"] },
        ],
      });
      if (!selected || Array.isArray(selected)) return;

      const meta = await inspectProfileBackup(selected);
      setImportFilePath(selected);
      setMetadata(meta);
      setCustomName(meta.profileName);
    } catch (err) {
      setImportFilePath(null);
      setMetadata(null);
      setError(String(err));
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFilePath) {
      setError("Choose a backup file.");
      return;
    }
    if (!passphrase) {
      setError("Passphrase is required.");
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      const result = await importProfileBackup(
        importFilePath,
        passphrase,
        customName.trim() || null,
      );
      restoreProfileStorage(result.profile.id, result.frontendState);
      await onImported(result);
      toast.success(
        `Restored ${result.restoredPlatformsCount} platforms and ${result.restoredHistoryCount} history entries.`,
      );
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {mode === "export" ? (
              <>
                <Download className="size-4 text-primary" />
                <span>Export Profile</span>
              </>
            ) : (
              <>
                <Upload className="size-4 text-primary" />
                <span>Import Profile</span>
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {mode === "export" ? (
          <form onSubmit={(e) => void handleExportSubmit(e)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="export-passphrase">Passphrase</Label>
              <Input
                id="export-passphrase"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Minimum 8 characters"
                disabled={isBusy}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="export-passphrase-confirm">Confirm Passphrase</Label>
              <Input
                id="export-passphrase-confirm"
                type="password"
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                placeholder="Re-enter passphrase"
                disabled={isBusy}
              />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isBusy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isBusy || !activeProfile}>
                {isBusy && <Loader2 className="mr-2 size-4 animate-spin" />}
                Choose File & Export
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={(e) => void handleImportSubmit(e)} className="space-y-4">
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => void handlePickImportFile()}
                disabled={isBusy}
              >
                <FileArchive className="size-4 text-muted-foreground" />
                <span className="truncate">
                  {metadata
                    ? `${metadata.profileName} · ${formatExportDate(metadata.exportedAt)}`
                    : "Choose Backup File..."}
                </span>
              </Button>
            </div>

            {metadata && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="import-profile-name">Profile Name</Label>
                  <Input
                    id="import-profile-name"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder={metadata.profileName}
                    disabled={isBusy}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="import-passphrase">Passphrase</Label>
                  <Input
                    id="import-passphrase"
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Enter backup passphrase"
                    disabled={isBusy}
                    autoFocus
                  />
                </div>
              </>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isBusy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isBusy || !metadata}>
                {isBusy && <Loader2 className="mr-2 size-4 animate-spin" />}
                Import
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
