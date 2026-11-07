import { isChromeExtensionEnv } from './chromeBridge';

export interface ExtensionShortcutInfo {
  name: string;
  label: string;
  description: string;
  shortcut: string;
}

const DEFAULT_SHORTCUTS: ExtensionShortcutInfo[] = [
  {
    name: 'quick-save-tab',
    label: 'Salvar ou atualizar parada em 1 tecla',
    description:
      'Salva o site atual (ou atualiza o capitulo se a obra ja existir) sem precisar abrir o popup.',
    shortcut: 'Alt+Shift+S',
  },
  {
    name: 'save-and-close-tab',
    label: 'Salvar/atualizar e fechar aba',
    description:
      'Guarda ou atualiza o link da aba ativa na estante e fecha a aba do navegador em seguida.',
    shortcut: 'Alt+Shift+X',
  },
  {
    name: '_execute_action',
    label: 'Abrir popup rapido do Tomo',
    description:
      'Abre o popup na barra do Chrome para escolher a aba, status ou nota antes de salvar.',
    shortcut: 'Alt+Shift+Q',
  },
  {
    name: 'open-dashboard',
    label: 'Abrir Estante completa',
    description: 'Abre ou foca o painel visual em tela cheia com todas as suas abas.',
    shortcut: 'Alt+Shift+O',
  },
];

const PREFERRED_TAB_KEY = 'tomo_preferred_tab_id';

export async function getExtensionShortcuts(): Promise<ExtensionShortcutInfo[]> {
  if (!isChromeExtensionEnv() || !chrome.commands?.getAll) {
    return DEFAULT_SHORTCUTS;
  }

  try {
    const registered = await chrome.commands.getAll();
    const byName = new Map(registered.map((cmd) => [cmd.name ?? '', cmd]));

    return DEFAULT_SHORTCUTS.map((def) => {
      const live = byName.get(def.name);
      return {
        ...def,
        shortcut: live?.shortcut?.trim() || 'Nao definido',
      };
    });
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

export async function openChromeShortcutsSettings(): Promise<boolean> {
  if (!isChromeExtensionEnv()) {
    return false;
  }
  try {
    await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    return true;
  } catch {
    return false;
  }
}

export async function getPreferredTabId(fallbackTabId: string): Promise<string> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const data = await chrome.storage.local.get(PREFERRED_TAB_KEY);
      const saved = data?.[PREFERRED_TAB_KEY];
      if (typeof saved === 'string' && saved.trim()) {
        return saved;
      }
    } catch {
      // ignora erro de leitura
    }
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const local = localStorage.getItem(PREFERRED_TAB_KEY);
      if (local) return local;
    } catch {
      // ignora em Service Worker
    }
  }

  return fallbackTabId;
}

export function setPreferredTabId(tabId: string): void {
  if (!tabId) return;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(PREFERRED_TAB_KEY, tabId);
    } catch {
      // ignora
    }
  }
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.set({ [PREFERRED_TAB_KEY]: tabId }).catch(() => {});
  }
}
