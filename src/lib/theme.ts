export type ThemeMode = 'dark' | 'light';

const THEME_STORAGE_KEY = 'tomo_theme_mode';

export function getInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // fallback padrao escuro
  }
  return 'dark';
}

export function applyTheme(theme: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // sem escrita disponivel
  }
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme }).catch(() => {});
  }
}
