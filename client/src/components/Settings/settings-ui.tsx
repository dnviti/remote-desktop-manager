import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface SettingsPanelProps {
  title: string;
  description?: string;
  heading?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

const statusToneClasses = {
  neutral: 'border-border bg-background text-foreground',
  success: 'border-primary/25 bg-primary/10 text-primary',
  warning: 'border-chart-5/25 bg-chart-5/10 text-foreground',
  destructive: 'border-destructive/25 bg-destructive/10 text-destructive',
};

export function SettingsPanel({
  title,
  description,
  heading,
  children,
  className,
  contentClassName,
}: SettingsPanelProps) {
  return (
    <section className={cn('min-w-0 w-full max-w-full space-y-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="font-heading text-lg font-medium tracking-tight text-foreground">{title}</h3>
          {description ? <p className="text-sm leading-6 text-muted-foreground">{description}</p> : null}
        </div>
        {heading}
      </div>
      <Separator className="bg-border/70" />
      <div className={cn('min-w-0 w-full max-w-full space-y-5', contentClassName)}>{children}</div>
    </section>
  );
}

export function SettingsStatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: keyof typeof statusToneClasses;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium',
        statusToneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}

export function SettingsButtonRow({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {children}
    </div>
  );
}

export function SettingsFieldGroup({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('space-y-4', className)}>{children}</div>;
}

export function SettingsSectionBlock({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('space-y-4 border-t border-border/60 pt-5 first:border-t-0 first:pt-0', className)}>
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        {description && <p className="text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function SettingsFieldCard({
  label,
  description,
  aside,
  className,
  contentClassName,
  children,
}: {
  label: string;
  description?: string;
  aside?: ReactNode;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('space-y-4 rounded-lg bg-muted/10 p-4', className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">{label}</div>
          {description && <p className="text-sm leading-6 text-muted-foreground">{description}</p>}
        </div>
        {aside}
      </div>
      <div className={cn('space-y-3', contentClassName)}>{children}</div>
    </div>
  );
}

export function SettingsLoadingState({
  message,
}: {
  message: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {message}
    </div>
  );
}

export function SettingsSummaryGrid({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('grid gap-3 md:grid-cols-2 xl:grid-cols-4', className)}>{children}</div>;
}

export function SettingsSummaryItem({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg bg-muted/20 px-3 py-3', className)}>
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

export function SettingsSwitchRow({
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'flex items-start justify-between gap-4 rounded-lg bg-muted/10 px-3 py-3 transition-colors',
        disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-muted/20',
      )}
    >
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {description && (
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        )}
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={title}
      />
    </label>
  );
}
