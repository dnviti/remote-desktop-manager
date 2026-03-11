import { z } from 'zod';

export const sshTerminalConfigSchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.number().int().min(10).max(24).optional(),
  lineHeight: z.number().min(1.0).max(2.0).optional(),
  letterSpacing: z.number().min(0).max(5).optional(),
  cursorStyle: z.enum(['block', 'underline', 'bar']).optional(),
  cursorBlink: z.boolean().optional(),
  theme: z.string().optional(),
  customColors: z.record(z.string(), z.string()).optional(),
  scrollback: z.number().int().min(100).max(10000).optional(),
  bellStyle: z.enum(['none', 'sound', 'visual']).optional(),
  syncThemeWithWebUI: z.boolean().optional(),
  syncLightTheme: z.string().optional(),
  syncDarkTheme: z.string().optional(),
});

export type SshTerminalConfig = z.infer<typeof sshTerminalConfigSchema>;

export const rdpSettingsSchema = z.object({
  colorDepth: z.union([z.literal(8), z.literal(16), z.literal(24)]).optional(),
  width: z.number().int().min(640).max(7680).optional(),
  height: z.number().int().min(480).max(4320).optional(),
  dpi: z.number().int().min(48).max(384).optional(),
  resizeMethod: z.enum(['display-update', 'reconnect']).optional(),
  qualityPreset: z.enum(['performance', 'balanced', 'quality', 'custom']).optional(),
  enableWallpaper: z.boolean().optional(),
  enableTheming: z.boolean().optional(),
  enableFontSmoothing: z.boolean().optional(),
  enableFullWindowDrag: z.boolean().optional(),
  enableDesktopComposition: z.boolean().optional(),
  enableMenuAnimations: z.boolean().optional(),
  forceLossless: z.boolean().optional(),
  disableAudio: z.boolean().optional(),
  enableAudioInput: z.boolean().optional(),
  security: z.enum(['any', 'nla', 'nla-ext', 'tls', 'rdp']).optional(),
  ignoreCert: z.boolean().optional(),
  serverLayout: z.string().optional(),
  console: z.boolean().optional(),
  timezone: z.string().optional(),
});

export type RdpSettings = z.infer<typeof rdpSettingsSchema>;

export const vncSettingsSchema = z.object({
  colorDepth: z.union([z.literal(8), z.literal(16), z.literal(24), z.literal(32)]).optional(),
  cursor: z.enum(['local', 'remote']).optional(),
  readOnly: z.boolean().optional(),
  clipboardEncoding: z.enum(['ISO8859-1', 'UTF-8', 'UTF-16', 'CP1252']).optional(),
  swapRedBlue: z.boolean().optional(),
  disableAudio: z.boolean().optional(),
});

export type VncSettings = z.infer<typeof vncSettingsSchema>;
