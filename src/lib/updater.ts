import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export const DISMISSED_UPDATE_KEY = "universal-poster:dismissed-update";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "up-to-date";

export interface DownloadProgress {
  downloaded: number;
  total: number | null;
  percent: number | null;
}

export function getDismissedUpdateVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_UPDATE_KEY);
  } catch {
    return null;
  }
}

export function setDismissedUpdateVersion(version: string): void {
  try {
    localStorage.setItem(DISMISSED_UPDATE_KEY, version);
  } catch {
    // Ignore storage errors.
  }
}

export async function checkForUpdateSilently(): Promise<Update | null> {
  try {
    return await check();
  } catch {
    // Ignore offline, 404, or pre-release manifest errors during background checks.
    return null;
  }
}

export async function checkForUpdateManual(): Promise<Update | null> {
  return check();
}

export async function downloadAndInstallUpdate(
  update: Update,
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;

  await update.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
      downloaded = 0;
      onProgress({ downloaded, total, percent: total ? 0 : null });
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      const percent =
        total && total > 0
          ? Math.min(100, Math.round((downloaded / total) * 100))
          : null;
      onProgress({ downloaded, total, percent });
    } else if (event.event === "Finished") {
      onProgress({
        downloaded,
        total,
        percent: total ? 100 : null,
      });
    }
  });
}

export async function relaunchApp(): Promise<void> {
  await relaunch();
}

export type { Update };
