"use client";

import {
  EllipsisVerticalIcon,
  LoaderCircleIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ConversationItem } from "@/lib/chat/conversation-list";
import { cn } from "@/lib/utils";

import { uiText } from "../i18n";

type UiText = ReturnType<typeof uiText>;

export function ConversationRow({
  conversation,
  isActive,
  menuOpen,
  text,
  onSelect,
  onMenuOpenChange,
  onRename,
  onDelete,
}: {
  conversation: ConversationItem;
  isActive: boolean;
  menuOpen: boolean;
  text: UiText;
  onSelect: () => void;
  onMenuOpenChange: (open: boolean) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors",
        isActive
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
      )}
    >
      <span className="flex-1 truncate text-xs leading-snug">
        {conversation.title ?? (
          <span className="italic text-muted-foreground/60">{text.sidebar.untitledChat}</span>
        )}
      </span>
      {conversation.generationStatus === "streaming" && (
        <LoaderCircleIcon
          aria-label={text.chat.pendingDrafting}
          className="h-3.5 w-3.5 shrink-0 animate-spin text-primary"
        />
      )}
      <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={text.sidebar.actions}
              className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[popup-open]:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent/80 hover:text-foreground"
              onClick={(event) => event.stopPropagation()}
            />
          }
        >
          <EllipsisVerticalIcon className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            onClick={(event) => {
              event.stopPropagation();
              onRename();
            }}
          >
            <PencilIcon className="h-3.5 w-3.5" />
            {text.sidebar.rename}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <Trash2Icon className="h-3.5 w-3.5" />
            {text.sidebar.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
