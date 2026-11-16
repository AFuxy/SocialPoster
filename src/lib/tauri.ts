import { invoke } from "@tauri-apps/api/core";

export interface AuthorLink {
  label: string;
  url: string;
}

export interface PlatformAuthor {
  name: string;
  links: AuthorLink[];
}

export interface SelectOption {
  value: string;
  label: string;
}

export type FieldKind =
  | { type: "text" }
  | { type: "secret" }
  | { type: "url" }
  | { type: "select"; options: SelectOption[] }
  | { type: "oAuthButton"; buttonLabel: string; targetKey: string };

export interface AuthField {
  key: string;
  label: string;
  placeholder: string;
  kind: FieldKind;
  required: boolean;
  helpText: string | null;
}

export interface AuthMode {
  id: string;
  label: string;
  description: string | null;
  fields: AuthField[];
  setupInstructions: string | null;
}

export interface PlatformCapabilities {
  maxChars: number;
  maxImages: number;
  supportsVideo: boolean;
  requiresMedia: boolean;
}

export interface PlatformMetadata {
  id: string;
  name: string;
  accentColour: string;
  version: string;
  compatibleAppVersion: string;
  isCompatible: boolean;
  compatibilityError: string | null;
  authors: PlatformAuthor[];
  authModes: AuthMode[];
  activeAuthMode: string | null;
  setupInstructions: string;
  capabilities: PlatformCapabilities;
  isConfigured: boolean;
}

export interface MediaAttachment {
  path: string;
  mimeType: string;
  altText?: string | null;
}

export interface PostPayload {
  text: string;
  media: MediaAttachment[];
}

export interface PlatformDispatchRequest {
  platformId: string;
  text: string;
  media: MediaAttachment[];
}

export interface PostOutcome {
  platformId: string;
  platformName: string;
  success: boolean;
  postUrl: string | null;
  error: string | null;
}

export async function getPlatforms(): Promise<PlatformMetadata[]> {
  return invoke<PlatformMetadata[]>("get_platforms");
}

export async function saveCredentials(
  platformId: string,
  modeId: string,
  values: Record<string, string>,
): Promise<void> {
  return invoke<void>("save_credentials", { platformId, modeId, values });
}

export async function verifyPlatform(platformId: string): Promise<void> {
  return invoke<void>("verify_platform", { platformId });
}

export async function unlinkPlatform(platformId: string): Promise<void> {
  return invoke<void>("unlink_platform", { platformId });
}

export async function startPlatformOauth(
  platformId: string,
  modeId: string,
  inputs: Record<string, string>,
): Promise<void> {
  return invoke<void>("start_platform_oauth", { platformId, modeId, inputs });
}

export async function broadcastPost(
  targets: PlatformDispatchRequest[],
): Promise<PostOutcome[]> {
  return invoke<PostOutcome[]>("broadcast_post", { targets });
}
