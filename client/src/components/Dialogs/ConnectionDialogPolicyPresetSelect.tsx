import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { PolicyTemplateOption } from "../Settings/databasePolicyUi";

const badgeToneClasses = {
  neutral: "border-border bg-background text-foreground",
  success: "border-primary/25 bg-primary/10 text-primary",
  warning: "border-chart-5/25 bg-chart-5/10 text-foreground",
  destructive: "border-destructive/25 bg-destructive/10 text-destructive",
};

interface ConnectionDialogPolicyPresetSelectProps {
  title: string;
  description: string;
  templates: PolicyTemplateOption[];
  comboboxLabel: string;
  searchPlaceholder?: string;
  emptyStateLabel?: string;
  onApply: (templateName: string) => void;
}

export default function ConnectionDialogPolicyPresetSelect({
  title,
  description,
  templates,
  comboboxLabel,
  searchPlaceholder = "Search presets...",
  emptyStateLabel = "No presets matched your search.",
  onApply,
}: ConnectionDialogPolicyPresetSelectProps) {
  const [open, setOpen] = useState(false);
  const [selectedTemplateName, setSelectedTemplateName] = useState<string | null>(null);

  const groupedTemplates = useMemo(() => {
    return templates.reduce<Record<string, PolicyTemplateOption[]>>((groups, template) => {
      if (!groups[template.category]) {
        groups[template.category] = [];
      }
      groups[template.category].push(template);
      return groups;
    }, {});
  }, [templates]);

  const selectedTemplate =
    templates.find((template) => template.name === selectedTemplateName) ?? null;

  return (
    <div className="space-y-3 border-t border-border/60 pt-5 first:border-t-0 first:pt-0">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={comboboxLabel}
            className="w-full justify-between rounded-xl px-4"
          >
            <span
              className={cn(
                "truncate text-left",
                selectedTemplate ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {selectedTemplate?.name ?? "Choose a preset"}
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
                          .join(" ")}
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
                              "size-4 text-primary transition-opacity",
                              isSelected ? "opacity-100" : "opacity-0",
                            )}
                          />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-foreground">
                              {template.name}
                            </span>
                            <Badge variant="outline">{template.category}</Badge>
                            {template.badge ? (
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                  badgeToneClasses[template.badgeTone ?? "neutral"],
                                )}
                              >
                                {template.badge}
                              </span>
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
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 font-medium",
                badgeToneClasses[selectedTemplate.badgeTone ?? "neutral"],
              )}
            >
              {selectedTemplate.badge}
            </span>
          ) : null}
          {selectedTemplate.summary ? (
            <span className="truncate">{selectedTemplate.summary}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
