"use client";

import type { LucideIcon } from 'lucide-react';
import {
  BookOpenTextIcon,
  ChevronDownIcon,
  SparklesIcon,
  SproutIcon,
  TimerIcon,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ResponseStyleId } from '@/lib/rag/system-prompt';
import { RESPONSE_STYLE_IDS } from '@/lib/rag/system-prompt';
import type { UiLanguage } from '@/lib/types';

import { uiText } from './i18n';

// One glyph per style, chosen to read at a glance: sparkles = the all-round
// default, open book = in-depth study, sprout = children, timer = brief.
const STYLE_ICONS: Record<ResponseStyleId, LucideIcon> = {
  balanced: SparklesIcon,
  scholar: BookOpenTextIcon,
  simple: SproutIcon,
  concise: TimerIcon,
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
  const isDefault = value === defaultStyle;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-tour="response-style"
        disabled={disabled}
        aria-label={`${text.settings.responseStyleAria}: ${styles[value].label}`}
        className="group inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-popup-open:bg-accent data-popup-open:text-foreground"
      >
        <ActiveIcon size={14} />
        <span>{styles[value].label}</span>
        <ChevronDownIcon
          size={12}
          className="opacity-60 transition-transform group-data-popup-open:rotate-180"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-[min(21rem,calc(100vw-2rem))] rounded-2xl p-1.5"
      >
        <div className="px-2.5 pb-2 pt-1.5">
          <p className="text-sm font-semibold text-foreground">{text.settings.responseStyle}</p>
          <p className="text-xs text-muted-foreground">{text.settings.responseStyleHint}</p>
        </div>

        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as ResponseStyleId)}
        >
          {RESPONSE_STYLE_IDS.map((id) => {
            const Icon = STYLE_ICONS[id];
            return (
              <DropdownMenuRadioItem
                key={id}
                value={id}
                className="cursor-pointer gap-3 rounded-xl py-2 pl-2 pr-9 data-checked:bg-accent/60 [&_svg:not([class*='size-'])]:size-4"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground">
                  <Icon />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium leading-tight">{styles[id].label}</span>
                  <span className="text-xs leading-snug text-muted-foreground">
                    {styles[id].description}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator className="my-1.5" />

        {/* Explicit "remember this" instead of a per-row star: the current
            choice applies to this chat; ticking this makes it the default. */}
        <DropdownMenuCheckboxItem
          checked={isDefault}
          disabled={isDefault}
          closeOnClick={false}
          onCheckedChange={() => onSetDefault(value)}
          className="cursor-pointer rounded-xl px-2.5 py-2 text-xs text-muted-foreground data-disabled:opacity-100"
        >
          {text.settings.useForNewChats}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
