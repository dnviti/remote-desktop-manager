import type { Theme } from '@mui/material';
import * as editorial from './editorial';
import * as primer from './primer';
import * as tanuki from './tanuki';
import * as monokai from './monokai';
import * as solarized from './solarized';
import * as onedark from './onedark';

export type ThemeMode = 'light' | 'dark';
export type ThemeName = 'editorial' | 'primer' | 'tanuki' | 'monokai' | 'solarized' | 'onedark';

export interface ThemeInfo {
  name: ThemeName;
  label: string;
  description: string;
  accent: string; // dark-mode accent color for preview swatch
  accentLight: string; // light-mode accent color for preview swatch
}

export const themeRegistry: ThemeInfo[] = [
  { name: 'editorial', label: 'Dark Editorial Precision', description: 'Emerald accent, serif headings', accent: '#00e5a0', accentLight: '#059669' },
  { name: 'primer', label: 'Primer Clarity', description: 'GitHub-inspired, trusted blue', accent: '#58a6ff', accentLight: '#0969da' },
  { name: 'tanuki', label: 'Tanuki Bold', description: 'GitLab-inspired, purple + orange', accent: '#7c3aed', accentLight: '#6e49cb' },
  { name: 'monokai', label: 'Neon Syntax', description: 'Monokai-inspired, multi-color', accent: '#a6e22e', accentLight: '#6d8c14' },
  { name: 'solarized', label: 'Precision Spectrum', description: 'Solarized-inspired, cyan accent', accent: '#2aa198', accentLight: '#2aa198' },
  { name: 'onedark', label: 'Atom Equilibrium', description: 'OneDark-inspired, balanced blue', accent: '#61afef', accentLight: '#4078f2' },
];

export const THEME_NAMES: ThemeName[] = themeRegistry.map((t) => t.name);

/**
 * Full theme map: themes[themeName][mode] => MUI Theme
 */
export const themes: Record<ThemeName, Record<ThemeMode, Theme>> = {
  editorial: { dark: editorial.dark, light: editorial.light },
  primer: { dark: primer.dark, light: primer.light },
  tanuki: { dark: tanuki.dark, light: tanuki.light },
  monokai: { dark: monokai.dark, light: monokai.light },
  solarized: { dark: solarized.dark, light: solarized.light },
  onedark: { dark: onedark.dark, light: onedark.light },
};
