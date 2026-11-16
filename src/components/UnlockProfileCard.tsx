import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProfileInfo } from "@/lib/tauri";

interface UnlockProfileCardProps {
  profile: ProfileInfo;
  onUnlock: (profileId: string, password: string) => Promise<boolean>;
}

export function UnlockProfileCard({
  profile,
  onUnlock,
}: UnlockProfileCardProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setIsUnlocking(true);
    setError(null);
    try {
      const ok = await onUnlock(profile.id, password);
      if (!ok) {
        setError("Incorrect password.");
      } else {
        setPassword("");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsUnlocking(false);
    }
  };

  return (
    <section
      aria-label="Unlock profile"
      className="mx-auto mt-10 max-w-sm rounded-xl border bg-card p-6 shadow-xs"
    >
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex size-9 items-center justify-center rounded-lg border bg-muted/50">
          <Lock className="size-4 text-muted-foreground" />
        </div>
        <h2 className="text-base font-semibold tracking-tight">
          {profile.name}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          disabled={isUnlocking}
        />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button
          type="submit"
          className="w-full"
          disabled={isUnlocking || !password}
        >
          {isUnlocking && <Loader2 className="mr-2 size-4 animate-spin" />}
          Unlock
        </Button>
      </form>
    </section>
  );
}
