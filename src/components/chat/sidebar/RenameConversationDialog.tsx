"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ConversationItem } from "@/lib/chat/conversation-list";

import { uiText } from "../i18n";

type SidebarText = ReturnType<typeof uiText>["sidebar"];

/**
 * Rename dialog for one conversation. Mount it with a `key` per target so
 * each opening starts from that conversation's title.
 */
export function RenameConversationDialog({
  target,
  text,
  onClose,
  onRenamed,
}: {
  target: ConversationItem | null;
  text: SidebarText;
  onClose: () => void;
  onRenamed: (updated: ConversationItem) => void;
}) {
  const [renameDraft, setRenameDraft] = useState(target?.title ?? "");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);

  function close() {
    if (isRenaming) return;
    onClose();
  }

  async function handleRenameSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || isRenaming) return;

    const title = renameDraft.trim();
    if (!title) {
      setRenameError(text.titleRequired);
      return;
    }

    setIsRenaming(true);
    setRenameError(null);

    try {
      const response = await fetch(`/api/conversations/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });

      if (!response.ok) {
        throw new Error(`Rename failed with status ${response.status}`);
      }

      onRenamed((await response.json()) as ConversationItem);
    } catch (error) {
      console.error("Failed to rename conversation", error);
      setRenameError(text.renameError);
    } finally {
      setIsRenaming(false);
    }
  }

  return (
    <Dialog
      open={!!target}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <form className="space-y-4" onSubmit={handleRenameSubmit}>
          <DialogHeader>
            <DialogTitle className="text-sm">{text.renameTitle}</DialogTitle>
            <DialogDescription className="text-xs">
              {text.renameDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Input
              value={renameDraft}
              maxLength={200}
              placeholder={text.titlePlaceholder}
              onChange={(event) => setRenameDraft(event.target.value)}
              disabled={isRenaming}
              autoFocus
            />
            {renameError ? (
              <p className="text-xs text-destructive">{renameError}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {text.cancel}
            </Button>
            <Button type="submit" disabled={isRenaming}>
              {isRenaming ? text.saving : text.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
