"use client";

import type { LucideIcon } from 'lucide-react';
import {
  ChevronDownIcon,
  GraduationCapIcon,
  Minimize2Icon,
  ScaleIcon,
  SproutIcon,
  StarIcon,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ResponseStyleId } from '@/lib/rag/system-prompt';
import { RESPONSE_STYLE_IDS } from '@/lib/rag/system-prompt';
import type { UiLanguage } from '@/lib/types';

import { uiText } from './i18n';

// A small, distinct glyph per style so the trigger and menu read as "designed"
// rather than a generic dropdown: scales = balanced, cap = scholar, sprout =
// the young Primary reader, minimize = concise.
const STYLE_ICONS: Record<ResponseStyleId, LucideIcon> = {
  balanced: ScaleIcon,
  scholar: GraduationCapIcon,
  simple: SproutIcon,
  concise: Minimize2Icon,
};

interface ResponseStylePickerProps {
  language: UiLanguage;
  value: ResponseStyleId;
  defaultStyle: ResponseStyleId;
  onChange: (style: ResponseStyleId) => void;
  onSetDefault: (style: ResponseStyleId) => void;
  disabled?: boolean;
}

export function ResponseStylePicker({
  language,
  value,
  defaultStyle,
  onChange,
  onSetDefault,
  disabled = false,
}: ResponseStylePickerProps) {
  const text = uiText(language);
  const styles = text.settings.styles;
  const ActiveIcon = STYLE_ICONS[value];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-tour="response-style"
        disabled={disabled}
        aria-label={text.settings.responseStyleAria}
        className="group inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/50 bg-transparent px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50 data-popup-open:border-indigo-500/30 data-popup-open:text-foreground"
      >
        <ActiveIcon size={12} className="text-indigo-300/80" />
        <span className="hidden sm:inline">{styles[value].label}</span>
        <ChevronDownIcon
          size={11}
          className="opacity-50 transition-transform group-data-popup-open:rotate-180"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" sideOffset={6} className="w-64">
        <div className="px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          {text.settings.responseStyle}
        </div>

        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as ResponseStyleId)}
        >
          {RESPONSE_STYLE_IDS.map((id) => {
            const Icon = STYLE_ICONS[id];
            const isRowDefault = id === defaultStyle;
            const isSelected = id === value;
            return (
              <DropdownMenuRadioItem
                key={id}
                value={id}
                highlightOnFocus={false}
                className={`group/row relative cursor-pointer items-start gap-2 py-1.5 pr-8 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400/60 ${
                  isSelected
                    ? "bg-indigo-500/10 text-foreground ring-1 ring-inset ring-indigo-500/30"
                    : ""
                }`}
              >
                <Icon
                  size={14}
                  className="mt-0.5 shrink-0 text-indigo-300/80 transition-colors group-hover/row:text-accent-foreground"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium leading-none">
                    {styles[id].label}
                  </span>
                  <span className="text-[11px] leading-snug text-muted-foreground transition-colors group-hover/row:text-accent-foreground">
                    {styles[id].description}
                  </span>
                </span>

                {/* Star = "default style", pinned to the row's bottom-right,
                    below the active check. Filled secondary color on the default; click
                    another row's star to make it the default. stopPropagation
                    keeps it from changing the active selection or closing the
                    menu. */}
                <button
                  type="button"
                  aria-label={isRowDefault ? text.settings.isDefault : text.settings.setAsDefault}
                  title={isRowDefault ? text.settings.isDefault : text.settings.setAsDefault}
                  aria-pressed={isRowDefault}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!isRowDefault) onSetDefault(id);
                  }}
                  className={`absolute bottom-1.5 right-2 inline-flex cursor-pointer items-center justify-center rounded p-0.5 transition-colors ${
                    isRowDefault
                      ? "text-secondary-accent"
                      : "text-muted-foreground/25 hover:text-secondary-accent group-hover/row:text-muted-foreground/50"
                  }`}
                >
                  <StarIcon
                    size={11}
                    strokeWidth={2}
                    className={isRowDefault ? "fill-secondary-accent" : ""}
                  />
                </button>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
