import { useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronsUpDown, Edit3, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  SettingsButtonRow,
  SettingsFieldCard,
  SettingsFieldGroup,
  SettingsSectionBlock,
  SettingsStatusBadge,
} from './settings-ui';

export interface PolicyTemplateOption {
  category: string;
  name: string;
  description: string;
  summary?: string;
  badge?: string;
  badgeTone?: 'neutral' | 'success' | 'warning' | 'destructive';
}

export function PolicyTemplatePicker({
  title,
  description,
  templates,
  comboboxLabel,
  searchPlaceholder = 'Search presets...',
  emptyStateLabel = 'No presets matched your search.',
  onApply,
}: {
  title: string;
  description: string;
  templates: PolicyTemplateOption[];
  comboboxLabel?: string;
  searchPlaceholder?: string;
  emptyStateLabel?: string;
  onApply: (templateName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedTemplateName, setSelectedTemplateName] = useState<string | null>(null);

  const groupedTemplates = useMemo(
    () => templates.reduce<Record<string, PolicyTemplateOption[]>>((groups, template) => {
      if (!groups[template.category]) {
        groups[template.category] = [];
      }
      groups[template.category].push(template);
      return groups;
    }, {}),
    [templates],
  );

  const selectedTemplate = templates.find((template) => template.name === selectedTemplateName) ?? null;

  return (
    <SettingsSectionBlock title={title} description={description}>
      <div className="space-y-3">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-label={comboboxLabel ?? title}
              className="w-full justify-between rounded-xl px-4"
            >
              <span
                className={cn(
                  'truncate text-left',
                  selectedTemplate ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {selectedTemplate?.name ?? 'Choose a preset'}
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[min(32rem,calc(100vw-3rem))] p-0"
          >
            <Command>
              <CommandInput placeholder={searchPlaceholder} />
              <CommandList className="max-h-80">
                <CommandEmpty>{emptyStateLabel}</CommandEmpty>
                {Object.entries(groupedTemplates).map(([category, categoryTemplates]) => (
                  <CommandGroup key={category} heading={category}>
                    {categoryTemplates.map((template) => {
                      const isSelected = template.name === selectedTemplate?.name;
                      return (
                        <CommandItem
                          key={template.name}
                          value={[
                            template.name,
                            template.category,
                            template.description,
                            template.summary,
                            template.badge,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onSelect={() => {
                            setSelectedTemplateName(template.name);
                            onApply(template.name);
                            setOpen(false);
                          }}
                          className="items-start gap-3 rounded-md px-3 py-3"
                        >
                          <div className="flex h-5 w-5 items-center justify-center pt-0.5">
                            <Check
                              className={cn(
                                'size-4 text-primary transition-opacity',
                                isSelected ? 'opacity-100' : 'opacity-0',
                              )}
                            />
                          </div>
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-foreground">{template.name}</span>
                              <Badge variant="outline">{template.category}</Badge>
                              {template.badge ? (
                                <SettingsStatusBadge tone={template.badgeTone ?? 'neutral'}>
                                  {template.badge}
                                </SettingsStatusBadge>
                              ) : null}
                            </div>
                            <p className="text-xs leading-5 text-muted-foreground">
                              {template.description}
                            </p>
                            {template.summary ? (
                              <p className="text-xs text-muted-foreground">
                                {template.summary}
                              </p>
                            ) : null}
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {selectedTemplate ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">Preset applied</Badge>
            <Badge variant="outline">{selectedTemplate.category}</Badge>
            {selectedTemplate.badge ? (
              <SettingsStatusBadge tone={selectedTemplate.badgeTone ?? 'neutral'}>
                {selectedTemplate.badge}
              </SettingsStatusBadge>
            ) : null}
            {selectedTemplate.summary ? (
              <span className="truncate">{selectedTemplate.summary}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </SettingsSectionBlock>
  );
}

export function PolicyRecordCard({
  title,
  description,
  badges,
  metadata,
  code,
  onEdit,
  onDelete,
}: {
  title: string;
  description?: string | null;
  badges?: ReactNode;
  metadata?: ReactNode;
  code?: string | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">{title}</div>
            {description && (
              <p className="text-sm leading-6 text-muted-foreground">{description}</p>
            )}
          </div>
          {badges && (
            <div className="flex flex-wrap gap-2">
              {badges}
            </div>
          )}
        </div>

        <SettingsButtonRow className="shrink-0">
          <Button type="button" size="sm" variant="outline" onClick={onEdit}>
            <Edit3 />
            Edit
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onDelete}>
            <Trash2 />
            Delete
          </Button>
        </SettingsButtonRow>
      </div>

      {(metadata || code) && (
        <div className="mt-4 space-y-3">
          {metadata && (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {metadata}
            </div>
          )}
          {code && (
            <pre className="overflow-x-auto rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-xs text-foreground">
              <code>{code}</code>
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function PolicyEmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center">
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

export function PolicyDialogShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">{children}</div>
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PolicyRoleChecklist({
  label,
  description,
  options,
  selected,
  onChange,
}: {
  label: string;
  description: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  return (
    <SettingsFieldCard label={label} description={description}>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {options.map((role) => {
          const checked = selected.includes(role);
          const inputId = `${label}-${role}`.replace(/\s+/g, '-').toLowerCase();

          return (
            <label
              key={role}
              htmlFor={inputId}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 px-3 py-3 text-sm transition-colors',
                checked ? 'bg-accent/50' : 'bg-background/70 hover:bg-accent/30',
              )}
            >
              <Checkbox
                id={inputId}
                checked={checked}
                onCheckedChange={(nextChecked) => {
                  onChange(
                    nextChecked
                      ? [...selected, role]
                      : selected.filter((entry) => entry !== role),
                  );
                }}
              />
              <span className="font-medium text-foreground">{role}</span>
            </label>
          );
        })}
      </div>
    </SettingsFieldCard>
  );
}

export function PolicyMetadataBadge({
  children,
  variant = 'outline',
}: {
  children: ReactNode;
  variant?: 'default' | 'secondary' | 'outline' | 'destructive';
}) {
  return <Badge variant={variant}>{children}</Badge>;
}

export function PolicyFormSection({
  children,
}: {
  children: ReactNode;
}) {
  return <SettingsFieldGroup>{children}</SettingsFieldGroup>;
}
