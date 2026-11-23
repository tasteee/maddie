export type ThemePreferenceT = 'system' | 'light' | 'dark';

export type AppSettingsT = {
  theme: ThemePreferenceT;
  ghostNotes: boolean;
};

const SETTINGS_KEY = 'maddie.settings.v1';
// Zest's own key. index.html reads it before first paint.
const THEME_KEY = 'zest-theme-preference';

const DEFAULT_SETTINGS: AppSettingsT = { theme: 'light', ghostNotes: true };

const isTheme = (value: unknown): value is ThemePreferenceT => value === 'system' || value === 'light' || value === 'dark';

export const readAppSettings = (): AppSettingsT => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    const theme = isTheme(saved.theme) ? saved.theme : readZestTheme();
    const ghostNotes = typeof saved.ghostNotes === 'boolean' ? saved.ghostNotes : DEFAULT_SETTINGS.ghostNotes;
    return { theme, ghostNotes };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

// Before settings existed, the theme was saved under Zest's key alone.
const readZestTheme = (): ThemePreferenceT => {
  const stored = localStorage.getItem(THEME_KEY);
  return isTheme(stored) ? stored : DEFAULT_SETTINGS.theme;
};

export const writeAppSettings = (changes: Partial<AppSettingsT>) => {
  const next = { ...readAppSettings(), ...changes };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    localStorage.setItem(THEME_KEY, next.theme);
  } catch {
    // Storage is unavailable. The setting still applies until the page closes.
  }
};

/** Put a theme preference on the page. `system` follows the operating system. */
export const applyTheme = (preference: ThemePreferenceT) => {
  const isSystemDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = preference === 'system' ? (isSystemDark ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
};
