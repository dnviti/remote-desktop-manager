import type {
  ComponentProps,
  CSSProperties,
  ElementType,
  HTMLAttributes,
  ReactNode,
} from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { Button as ShadButton } from '@/components/ui/button';
import {
  Alert as ShadAlert,
  AlertDescription,
} from '@/components/ui/alert';
import {
  Avatar as ShadAvatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { resolveSx, useSxClassName, useTheme, type SxProp } from './theme';

interface CommonProps {
  [key: string]: any;
  className?: string;
  children?: ReactNode;
  sx?: SxProp;
  style?: CSSProperties;
}

function Box({
  component: Component = 'div',
  sx,
  style,
  ...props
}: CommonProps & HTMLAttributes<HTMLElement> & {
  component?: ElementType;
}) {
  const sxClassName = useSxClassName(sx);
  return <Component {...props} className={cn(sxClassName, props.className)} style={style} />;
}

function Stack({
  direction = 'column',
  spacing = 0,
  component: Component = 'div',
  alignItems,
  flexWrap,
  justifyContent,
  useFlexGap,
  sx,
  style,
  children,
  ...props
}: CommonProps & HTMLAttributes<HTMLElement> & {
  alignItems?: CSSProperties['alignItems'];
  component?: ElementType;
  direction?: 'row' | 'row-reverse' | 'column' | 'column-reverse';
  flexWrap?: CSSProperties['flexWrap'];
  justifyContent?: CSSProperties['justifyContent'];
  spacing?: number;
  useFlexGap?: boolean;
}) {
  const sxClassName = useSxClassName(sx);
  void useFlexGap;
  return (
    <Component
      {...props}
      className={cn(sxClassName, props.className)}
      style={{
        alignItems,
        display: 'flex',
        flexDirection: direction,
        flexWrap,
        gap: `${spacing * 8}px`,
        justifyContent,
        ...style,
      }}
    >
      {children}
    </Component>
  );
}

const typographyVariants: Record<string, string> = {
  body1: 'text-base leading-7',
  body2: 'text-sm leading-6',
  caption: 'text-xs text-muted-foreground',
  h1: 'font-heading text-4xl font-medium tracking-tight',
  h2: 'font-heading text-3xl font-medium tracking-tight',
  h3: 'font-heading text-2xl font-medium tracking-tight',
  h4: 'font-heading text-xl font-medium tracking-tight',
  h5: 'font-heading text-lg font-medium tracking-tight',
  h6: 'font-heading text-base font-medium tracking-tight',
  overline: 'text-xs uppercase tracking-[0.2em] text-muted-foreground',
  subtitle1: 'text-base font-medium',
  subtitle2: 'text-sm font-medium',
};

function Typography({
  component,
  variant = 'body1',
  gutterBottom,
  align,
  color,
  noWrap,
  sx,
  style,
  className,
  ...props
}: CommonProps &
  HTMLAttributes<HTMLElement> & {
    align?: 'left' | 'center' | 'right';
    color?: string;
    component?: ElementType;
    gutterBottom?: boolean;
    noWrap?: boolean;
    variant?: keyof typeof typographyVariants;
  }) {
  const sxClassName = useSxClassName(sx);
  const Component = component ?? (variant.startsWith('h') ? variant : 'p');
  const theme = useTheme();
  const resolvedColor = color ? resolveSx(theme, { color })?.color : undefined;

  return (
    <Component
      className={cn(
        typographyVariants[variant] ?? typographyVariants.body1,
        gutterBottom && 'mb-2',
        noWrap && 'truncate',
        align === 'center' && 'text-center',
        align === 'right' && 'text-right',
        sxClassName,
        className,
      )}
      style={{
        ...(resolvedColor ? { color: resolvedColor } : undefined),
        ...style,
      }}
      {...props}
    />
  );
}

function Paper({
  sx,
  style,
  className,
  ...props
}: CommonProps & HTMLAttributes<HTMLDivElement>) {
  const sxClassName = useSxClassName(sx);
  return (
    <div
      className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', sxClassName, className)}
      style={style}
      {...props}
    />
  );
}

function Divider({
  orientation = 'horizontal',
  sx,
  style,
  className,
  ...props
}: CommonProps &
  HTMLAttributes<HTMLDivElement> & {
    orientation?: 'horizontal' | 'vertical';
  }) {
  const sxClassName = useSxClassName(sx);
  return (
    <Separator
      orientation={orientation}
      className={cn(sxClassName, className)}
      style={style}
      {...props}
    />
  );
}

function Avatar({
  src,
  sx,
  style,
  className,
  children,
  ...props
}: CommonProps &
  HTMLAttributes<HTMLSpanElement> & {
    src?: string | null;
  }) {
  const sxClassName = useSxClassName(sx);
  return (
    <ShadAvatar className={cn('size-9', sxClassName, className)} style={style} {...props}>
      {src ? <AvatarImage src={src} /> : null}
      <AvatarFallback>{children}</AvatarFallback>
    </ShadAvatar>
  );
}

function Badge({
  badgeContent,
  color = 'primary',
  children,
  invisible,
  max,
}: {
  badgeContent?: ReactNode;
  children: ReactNode;
  color?: string;
  invisible?: boolean;
  max?: number;
}) {
  const resolvedContent =
    typeof badgeContent === 'number' && typeof max === 'number' && badgeContent > max
      ? `${max}+`
      : badgeContent;
  const badgeClasses = color === 'error'
    ? 'bg-destructive text-destructive-foreground'
    : color === 'secondary'
      ? 'bg-secondary text-secondary-foreground'
      : 'bg-primary text-primary-foreground';

  return (
    <span className="relative inline-flex">
      {children}
      {!invisible && resolvedContent != null ? (
        <span
          className={cn(
            'absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold shadow-sm',
            badgeClasses,
          )}
        >
          {resolvedContent}
        </span>
      ) : null}
    </span>
  );
}

function Chip({
  label,
  color = 'default',
  variant = 'filled',
  size = 'medium',
  onDelete,
  onClick,
  clickable,
  icon,
  sx,
  style,
  className,
}: {
  className?: string;
  clickable?: boolean;
  color?: string;
  icon?: ReactNode;
  label: ReactNode;
  onClick?: () => void;
  onDelete?: () => void;
  size?: 'small' | 'medium';
  sx?: CommonProps['sx'];
  style?: CSSProperties;
  variant?: 'filled' | 'outlined';
}) {
  const sxClassName = useSxClassName(sx);
  const tone = color === 'error'
    ? 'border-destructive/25 bg-destructive/10 text-destructive'
    : color === 'warning'
      ? 'border-chart-5/25 bg-chart-5/10 text-foreground'
      : color === 'success'
        ? 'border-primary/25 bg-primary/10 text-primary'
        : color === 'secondary'
          ? 'border-secondary/25 bg-secondary/15 text-secondary-foreground'
          : color === 'primary'
            ? 'border-primary/25 bg-primary/10 text-primary'
            : 'border-border bg-background text-foreground';

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
        size === 'small' && 'px-2 py-0.5',
        variant === 'outlined' ? 'bg-transparent' : tone,
        variant === 'outlined' && color === 'default' && 'border-border text-foreground',
        variant === 'outlined' && color !== 'default' && tone.replace('/10', '/0').replace('/15', '/0'),
        !clickable && !onClick && 'cursor-default',
        sxClassName,
        className,
      )}
      style={style}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      {onDelete ? (
        <button type="button" onClick={onDelete} className="rounded-full p-0.5 hover:bg-black/10">
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

function Button({
  variant = 'text',
  color = 'primary',
  size = 'medium',
  fullWidth,
  startIcon,
  endIcon,
  sx,
  style,
  className,
  children,
  ...props
}: CommonProps &
  Omit<ComponentProps<typeof ShadButton>, 'variant' | 'size'> & {
    color?: string;
    fullWidth?: boolean;
    size?: 'small' | 'medium' | 'large';
    startIcon?: ReactNode;
    endIcon?: ReactNode;
    variant?: 'contained' | 'outlined' | 'text';
  }) {
  const sxClassName = useSxClassName(sx);
  const mappedVariant = color === 'error'
    ? 'destructive'
    : variant === 'contained'
      ? 'default'
      : variant === 'outlined'
        ? 'outline'
        : 'ghost';
  const mappedSize = size === 'small' ? 'sm' : size === 'large' ? 'lg' : 'default';

  return (
    <ShadButton
      variant={mappedVariant}
      size={mappedSize}
      className={cn(fullWidth && 'w-full', sxClassName, className)}
      style={style}
      {...props}
    >
      {startIcon}
      {children}
      {endIcon}
    </ShadButton>
  );
}

function IconButton({
  color = 'default',
  edge,
  sx,
  style,
  className,
  children,
  size = 'medium',
  ...props
}: CommonProps &
  Omit<ComponentProps<typeof ShadButton>, 'variant' | 'size'> & {
    color?: string;
    edge?: 'end' | 'start' | false;
    size?: 'small' | 'medium' | 'large';
  }) {
  const sxClassName = useSxClassName(sx);
  void edge;
  return (
    <ShadButton
      variant={color === 'primary' ? 'secondary' : 'ghost'}
      size="icon"
      className={cn(size === 'small' && 'size-8', size === 'large' && 'size-11', sxClassName, className)}
      style={style}
      {...props}
    >
      {children}
    </ShadButton>
  );
}

function Alert({
  severity = 'info',
  onClose,
  children,
  sx,
  style,
  className,
}: CommonProps & {
  onClose?: () => void;
  severity?: string;
}) {
  const sxClassName = useSxClassName(sx);
  const variant = severity === 'error'
    ? 'destructive'
    : severity === 'warning'
      ? 'warning'
      : severity === 'success'
        ? 'success'
        : 'info';

  return (
    <ShadAlert className={cn('flex items-start gap-3', sxClassName, className)} variant={variant} style={style}>
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <AlertDescription className="flex-1 text-sm text-current">{children}</AlertDescription>
      {onClose ? (
        <button type="button" onClick={onClose} className="rounded-md p-1 text-current/70 hover:bg-black/5">
          <X className="size-4" />
        </button>
      ) : null}
    </ShadAlert>
  );
}

function CircularProgress({
  size = 24,
  sx,
  style,
  className,
}: CommonProps & {
  size?: number;
}) {
  const sxClassName = useSxClassName(sx);
  return <Loader2 className={cn('animate-spin text-primary', sxClassName, className)} style={{ width: size, height: size, ...style }} />;
}

function LinearProgress({
  value,
  variant = 'indeterminate',
  sx,
  style,
  className,
}: CommonProps & {
  value?: number;
  variant?: 'determinate' | 'indeterminate';
}) {
  const sxClassName = useSxClassName(sx);
  if (variant === 'determinate') {
    return <Progress className={cn(sxClassName, className)} value={value ?? 0} style={style} />;
  }

  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-muted', sxClassName, className)} style={style}>
      <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
    </div>
  );
}

function Link({
  underline = 'always',
  sx,
  style,
  className,
  ...props
}: CommonProps &
  React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    underline?: 'always' | 'hover' | 'none';
  }) {
  const sxClassName = useSxClassName(sx);
  return (
    <a
      className={cn(
        'text-primary',
        underline === 'always' && 'underline',
        underline === 'hover' && 'hover:underline',
        sxClassName,
        className,
      )}
      style={style}
      {...props}
    />
  );
}

function Breadcrumbs({
  children,
  separator = '/',
  sx,
  style,
  className,
}: CommonProps & {
  separator?: ReactNode;
}) {
  const sxClassName = useSxClassName(sx);
  const items = Array.isArray(children) ? children : [children];

  return (
    <nav className={cn('flex flex-wrap items-center gap-2 text-sm text-muted-foreground', sxClassName, className)} style={style}>
      {items.filter(Boolean).map((child, index) => (
        <span key={index} className="inline-flex items-center gap-2">
          {index > 0 ? <span>{separator}</span> : null}
          <span>{child}</span>
        </span>
      ))}
    </nav>
  );
}

export {
  Alert,
  Avatar,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  LinearProgress,
  Link,
  Paper,
  Stack,
  Typography,
};
