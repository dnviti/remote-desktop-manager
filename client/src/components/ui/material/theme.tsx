import {
  createContext,
  useContext,
  useInsertionEffect,
  useMemo,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { themes, type AppTheme } from '@/theme';

const ThemeContext = createContext<AppTheme>(themes.editorial.dark);

interface ThemeProviderProps {
  children: ReactNode;
  theme: AppTheme;
}

const SPACING_KEYS = new Set([
  'gap',
  'rowGap',
  'columnGap',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'paddingInline',
  'paddingBlock',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'marginInline',
  'marginBlock',
]);

const DIMENSION_KEYS = new Set([
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'fontSize',
  'borderRadius',
]);

const UNIT_LESS_KEYS = new Set([
  'flex',
  'flexGrow',
  'flexShrink',
  'fontWeight',
  'lineHeight',
  'opacity',
  'order',
  'zIndex',
  'zoom',
]);

const SX_ALIASES: Record<string, string> = {
  alignItems: 'alignItems',
  alignSelf: 'alignSelf',
  bgcolor: 'backgroundColor',
  borderBottom: 'borderBottom',
  borderColor: 'borderColor',
  borderLeft: 'borderLeft',
  borderRadius: 'borderRadius',
  borderRight: 'borderRight',
  borderTop: 'borderTop',
  boxShadow: 'boxShadow',
  color: 'color',
  display: 'display',
  flexDirection: 'flexDirection',
  flexGrow: 'flexGrow',
  flexShrink: 'flexShrink',
  flexWrap: 'flexWrap',
  fontFamily: 'fontFamily',
  fontSize: 'fontSize',
  fontWeight: 'fontWeight',
  gap: 'gap',
  gridTemplateColumns: 'gridTemplateColumns',
  height: 'height',
  justifyContent: 'justifyContent',
  lineHeight: 'lineHeight',
  margin: 'margin',
  marginBottom: 'marginBottom',
  marginLeft: 'marginLeft',
  marginRight: 'marginRight',
  marginTop: 'marginTop',
  maxHeight: 'maxHeight',
  maxWidth: 'maxWidth',
  minHeight: 'minHeight',
  minWidth: 'minWidth',
  opacity: 'opacity',
  overflow: 'overflow',
  overflowX: 'overflowX',
  overflowY: 'overflowY',
  padding: 'padding',
  paddingBottom: 'paddingBottom',
  paddingLeft: 'paddingLeft',
  paddingRight: 'paddingRight',
  paddingTop: 'paddingTop',
  position: 'position',
  textAlign: 'textAlign',
  textTransform: 'textTransform',
  whiteSpace: 'whiteSpace',
  width: 'width',
  zIndex: 'zIndex',
  p: 'padding',
  pb: 'paddingBottom',
  pl: 'paddingLeft',
  pr: 'paddingRight',
  pt: 'paddingTop',
  px: 'paddingInline',
  py: 'paddingBlock',
  m: 'margin',
  mb: 'marginBottom',
  ml: 'marginLeft',
  mr: 'marginRight',
  mt: 'marginTop',
  mx: 'marginInline',
  my: 'marginBlock',
};

type SxPrimitive = string | number | boolean | null | undefined;
type SxCallback = (theme: AppTheme) => unknown;

export interface SxRecord {
  [key: string]: SxPrimitive | SxCallback | SxRecord;
}

export type SxProp =
  | SxRecord
  | ((theme: AppTheme) => SxRecord)
  | Array<SxProp | false | null | undefined>
  | null
  | false
  | undefined;

interface ResolvedSxRecord {
  [key: string]: CSSProperties[keyof CSSProperties] | ResolvedSxRecord | undefined;
}

const BREAKPOINT_KEYS = new Set(['xs', 'sm', 'md', 'lg', 'xl', '2xl']);
const insertedSxRules = new Set<string>();

function resolveToken(value: string, theme: AppTheme) {
  switch (value) {
    case 'divider':
      return theme.palette.divider;
    case 'text.primary':
      return theme.palette.text.primary;
    case 'text.secondary':
      return theme.palette.text.secondary;
    case 'text.disabled':
      return theme.palette.text.disabled;
    case 'background.default':
      return theme.palette.background.default;
    case 'background.paper':
      return theme.palette.background.paper;
    case 'primary.main':
      return theme.palette.primary.main;
    case 'primary.dark':
      return theme.palette.primary.dark;
    case 'primary.light':
      return theme.palette.primary.light;
    case 'secondary.main':
      return theme.palette.secondary.main;
    case 'error.main':
      return theme.palette.error.main;
    case 'error.light':
      return theme.palette.error.light;
    case 'warning.main':
      return theme.palette.warning.main;
    case 'warning.light':
      return theme.palette.warning.light;
    case 'success.main':
      return theme.palette.success.main;
    case 'info.main':
      return theme.palette.info.main;
    case 'action.hover':
      return 'var(--arsenale-primary-08)';
    default: {
      const segments = value.split('.');
      let current: unknown = theme.palette;
      for (const segment of segments) {
        if (current && typeof current === 'object' && segment in current) {
          current = (current as Record<string, unknown>)[segment];
          continue;
        }
        return value;
      }
      return typeof current === 'string' ? current : value;
    }
  }
}

function resolveScalarValue(property: string, value: unknown, theme: AppTheme): CSSProperties[keyof CSSProperties] {
  if (typeof value === 'string') {
    return resolveToken(value, theme);
  }

  if (typeof value !== 'number') {
    return value as CSSProperties[keyof CSSProperties];
  }

  if (property.startsWith('border') && !property.endsWith('Radius')) {
    return `${value}px solid ${theme.palette.divider}`;
  }

  if (SPACING_KEYS.has(property)) {
    return `${value * 8}px`;
  }

  if (DIMENSION_KEYS.has(property)) {
    return `${value}px`;
  }

  if (UNIT_LESS_KEYS.has(property)) {
    return value;
  }

  return `${value}px`;
}

function resolveResponsiveValue(value: SxRecord) {
  const order = ['2xl', 'xl', 'lg', 'md', 'sm', 'xs'];
  for (const key of order) {
    if (key in value) {
      return value[key];
    }
  }

  return Object.values(value)[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUnsafeObjectKey(key: string) {
  return key === '__proto__' || key === 'prototype' || key === 'constructor';
}

function isResponsiveRecord(value: Record<string, unknown>) {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => BREAKPOINT_KEYS.has(key));
}

function isSelectorKey(key: string) {
  return (
    key.startsWith('&')
    || key.startsWith('@')
    || key.startsWith(':')
    || key.startsWith('[')
    || key.startsWith('>')
    || key.startsWith('+')
    || key.startsWith('~')
    || key.includes(' ')
    || key.includes('.')
    || key.includes('#')
    || key.includes(',')
    || /^[0-9]/.test(key)
    || key === 'from'
    || key === 'to'
  );
}

function mergeResolvedStyles(target: ResolvedSxRecord, source: Record<string, unknown>, theme: AppTheme) {
  for (const [rawKey, rawValue] of Object.entries(source)) {
    if (isUnsafeObjectKey(rawKey)) {
      continue;
    }

    const computedValue = typeof rawValue === 'function' ? (rawValue as SxCallback)(theme) : rawValue;
    if (computedValue == null) {
      continue;
    }

    if (isRecord(computedValue)) {
      if (isResponsiveRecord(computedValue)) {
        const property = SX_ALIASES[rawKey] ?? rawKey;
        target[property] = resolveScalarValue(
          property,
          resolveResponsiveValue(computedValue as SxRecord),
          theme,
        );
        continue;
      }

      if (isSelectorKey(rawKey)) {
        const nestedTarget = isRecord(target[rawKey]) ? target[rawKey] as ResolvedSxRecord : {};
        mergeResolvedStyles(nestedTarget, computedValue, theme);
        target[rawKey] = nestedTarget;
        continue;
      }
    }

    const property = SX_ALIASES[rawKey] ?? rawKey;
    if (isUnsafeObjectKey(property)) {
      continue;
    }
    target[property] = resolveScalarValue(property, computedValue, theme);
  }

  return target;
}

function mergeSxValue(style: ResolvedSxRecord, sx: SxProp, theme: AppTheme) {
  if (!sx) {
    return style;
  }

  if (Array.isArray(sx)) {
    for (const item of sx) {
      mergeSxValue(style, item, theme);
    }
    return style;
  }

  if (typeof sx === 'function') {
    return mergeSxValue(style, sx(theme) as SxProp, theme);
  }

  return mergeResolvedStyles(style, sx as Record<string, unknown>, theme);
}

export function resolveSx(theme: AppTheme, sx?: SxProp): CSSProperties | undefined {
  if (!sx) {
    return undefined;
  }
  const resolved = mergeSxValue({}, sx, theme);
  const inlineStyles = Object.fromEntries(
    Object.entries(resolved).filter(([, value]) => !isRecord(value)),
  );
  return Object.keys(inlineStyles).length > 0 ? inlineStyles as CSSProperties : undefined;
}

function toKebabCase(property: string) {
  if (property.startsWith('--')) {
    return property;
  }

  return property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function serializeDeclarations(record: ResolvedSxRecord) {
  return Object.entries(record)
    .filter(([, value]) => value != null && !isRecord(value))
    .map(([property, value]) => `${toKebabCase(property)}:${String(value)};`)
    .join('');
}

function nestSelector(baseSelector: string, nestedSelector: string) {
  if (nestedSelector.includes('&')) {
    return nestedSelector.replaceAll('&', baseSelector);
  }

  if (
    nestedSelector.startsWith(':')
    || nestedSelector.startsWith('[')
    || nestedSelector.startsWith('>')
    || nestedSelector.startsWith('+')
    || nestedSelector.startsWith('~')
  ) {
    return `${baseSelector}${nestedSelector}`;
  }

  return `${baseSelector} ${nestedSelector}`;
}

function serializeKeyframes(record: ResolvedSxRecord) {
  return Object.entries(record)
    .filter(([, value]) => isRecord(value))
    .map(([step, value]) => `${step}{${serializeDeclarations(value as ResolvedSxRecord)}}`)
    .join('');
}

function serializeRule(selector: string, record: ResolvedSxRecord): string {
  const declarations = serializeDeclarations(record);
  const nestedRules = Object.entries(record)
    .filter(([, value]) => isRecord(value))
    .map(([nestedSelector, nestedValue]) => {
      const nestedRecord = nestedValue as ResolvedSxRecord;
      if (nestedSelector.startsWith('@keyframes')) {
        return `${nestedSelector}{${serializeKeyframes(nestedRecord)}}`;
      }

      if (nestedSelector.startsWith('@')) {
        return `${nestedSelector}{${serializeRule(selector, nestedRecord)}}`;
      }

      return serializeRule(nestSelector(selector, nestedSelector), nestedRecord);
    })
    .join('');

  return `${declarations ? `${selector}{${declarations}}` : ''}${nestedRules}`;
}

function hashString(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return Math.abs(hash).toString(36);
}

export function useSxClassName(sx?: SxProp) {
  const theme = useTheme();

  const { className, cssText } = useMemo(() => {
    if (!sx) {
      return { className: undefined, cssText: '' };
    }

    const resolved = mergeSxValue({}, sx, theme);
    if (Object.keys(resolved).length === 0) {
      return { className: undefined, cssText: '' };
    }

    const rootSelector = '.__arsenale-sx-root__';
    const cssBody = serializeRule(rootSelector, resolved);
    const hash = hashString(cssBody);
    const sxClassName = `arsenale-sx-${hash}`;
    return {
      className: sxClassName,
      cssText: cssBody.replaceAll(rootSelector, `.${sxClassName}`),
    };
  }, [sx, theme]);

  useInsertionEffect(() => {
    if (!className || !cssText || typeof document === 'undefined' || insertedSxRules.has(className)) {
      return;
    }

    const styleElement = document.createElement('style');
    styleElement.dataset.arsenaleSx = className;
    styleElement.textContent = cssText;
    document.head.appendChild(styleElement);
    insertedSxRules.add(className);
  }, [className, cssText]);

  return className;
}

export function ThemeProvider({ children, theme }: ThemeProviderProps) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function CssBaseline() {
  return null;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export type Theme = AppTheme;
export type SelectChangeEvent<T = string> = ChangeEvent<HTMLSelectElement> & {
  target: EventTarget & HTMLSelectElement & { value: T };
};
