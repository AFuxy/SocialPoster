import { useEffect, useRef, useState } from "react";
import { Bookmark, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { snippetsKey } from "@/lib/storage";

export interface SnippetItem {
  id: string;
  label: string;
  content: string;
}

interface SnippetsPopoverProps {
  profileId: string;
  disabled?: boolean;
  onInsert: (content: string) => void;
}

function loadSnippets(profileId: string): SnippetItem[] {
  try {
    const raw = localStorage.getItem(snippetsKey(profileId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SnippetItem =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as SnippetItem).id === "string" &&
        typeof (item as SnippetItem).label === "string" &&
        typeof (item as SnippetItem).content === "string",
    );
  } catch {
    return [];
  }
}

function saveSnippets(profileId: string, snippets: SnippetItem[]): void {
  try {
    localStorage.setItem(snippetsKey(profileId), JSON.stringify(snippets));
  } catch {
    // Ignore storage quota / privacy mode failures.
  }
}

function createSnippetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function SnippetsPopover({
  profileId,
  disabled = false,
  onInsert,
}: SnippetsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [snippets, setSnippets] = useState<SnippetItem[]>(() =>
    loadSnippets(profileId),
  );
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [contentDraft, setContentDraft] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSnippets(loadSnippets(profileId));
    setEditingId(null);
    setOpen(false);
  }, [profileId]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setEditingId(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setEditingId(null);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const startCreate = () => {
    setEditingId("new");
    setLabelDraft("");
    setContentDraft("");
  };

  const startEdit = (snippet: SnippetItem) => {
    setEditingId(snippet.id);
    setLabelDraft(snippet.label);
    setContentDraft(snippet.content);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const label = labelDraft.trim();
    const content = contentDraft.trim();
    if (!label || !content) return;

    const next =
      editingId === "new"
        ? [...snippets, { id: createSnippetId(), label, content }]
        : snippets.map((item) =>
            item.id === editingId ? { ...item, label, content } : item,
          );

    setSnippets(next);
    saveSnippets(profileId, next);
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    const next = snippets.filter((item) => item.id !== id);
    setSnippets(next);
    saveSnippets(profileId, next);
  };

  const canSave = labelDraft.trim().length > 0 && contentDraft.trim().length > 0;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        disabled={disabled}
        onClick={() => {
          setOpen((prev) => !prev);
          setEditingId(null);
        }}
        aria-expanded={open}
        aria-label="Snippets"
        title="Snippets"
        className="h-8 w-8 shrink-0 text-xs leading-none"
      >
        <Bookmark className="size-4" />
      </Button>

      {open && (
        <div className="absolute right-0 bottom-full z-50 mb-2 w-72 rounded-xl border border-border bg-card p-3 shadow-xl">
          {editingId !== null ? (
            <form onSubmit={handleSave} className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">
                  {editingId === "new" ? "New Snippet" : "Edit Snippet"}
                </span>
              </div>

              <Input
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                placeholder="Release Tags"
                aria-label="Snippet label"
                className="h-8 text-xs"
                autoFocus
              />

              <Textarea
                value={contentDraft}
                onChange={(e) => setContentDraft(e.target.value)}
                placeholder="Snippet text..."
                aria-label="Snippet content"
                rows={3}
                className="min-h-18 resize-y text-xs leading-relaxed"
              />

              <div className="flex items-center justify-end gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setEditingId(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!canSave}
                  className="h-7 px-2.5 text-xs"
                >
                  Save
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">Snippets</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={startCreate}
                >
                  <Plus className="mr-1 size-3" />
                  New
                </Button>
              </div>

              {snippets.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No snippets saved for this profile.
                </p>
              ) : (
                <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                  {snippets.map((snippet) => (
                    <div
                      key={snippet.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        onInsert(snippet.content);
                        setOpen(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onInsert(snippet.content);
                          setOpen(false);
                        }
                      }}
                      className="group flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-foreground">
                          {snippet.label}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {snippet.content}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Edit ${snippet.label}`}
                          title="Edit"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(snippet);
                          }}
                        >
                          <Pencil className="size-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Delete ${snippet.label}`}
                          title="Delete"
                          className="hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(snippet.id);
                          }}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
