import type { BrowserTabSnapshot } from '../types/shelf';
import {
  detectProgressFromTab,
  extractDomain,
  sanitizeHttpUrl,
  suggestCleanTitle,
} from './progress';

export function isChromeExtensionEnv(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    Boolean(chrome.runtime?.id) &&
    Boolean(chrome.tabs)
  );
}

async function compressDataUrlToThumbnail(
  rawDataUrl: string,
  maxWidth = 520,
  maxHeight = 325
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ratio = Math.max(maxWidth / img.width, maxHeight / img.height);
        const w = Math.round(Math.min(maxWidth, img.width * ratio));
        const h = Math.round(Math.min(maxHeight, img.height * ratio));
        canvas.width = w || maxWidth;
        canvas.height = h || maxHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(undefined);
          return;
        }

        // Crop centralizado na proporcao 16:10 do topo visivel da pagina
        const sourceAspect = canvas.width / canvas.height;
        let sw = img.width;
        let sh = Math.round(img.width / sourceAspect);
        if (sh > img.height) {
          sh = img.height;
          sw = Math.round(img.height * sourceAspect);
        }
        const sx = Math.max(0, Math.round((img.width - sw) / 2));
        ctx.drawImage(img, sx, 0, sw, sh, 0, 0, canvas.width, canvas.height);

        const webp = canvas.toDataURL('image/webp', 0.78);
        resolve(webp.startsWith('data:image/') ? webp : undefined);
      } catch {
        resolve(undefined);
      }
    };
    img.onerror = () => resolve(undefined);
    img.src = rawDataUrl;
  });
}

async function extractOpenGraphFromTab(
  tabId: number
): Promise<{ ogImage?: string; pageTitle?: string }> {
  if (!chrome.scripting?.executeScript) return {};
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const getMeta = (selector: string) =>
          document.querySelector<HTMLMetaElement>(selector)?.content?.trim() || '';
        const rawImage =
          getMeta('meta[property="og:image"]') ||
          getMeta('meta[name="twitter:image"]') ||
          getMeta('meta[property="og:image:url"]');

        let absoluteImage: string | undefined;
        if (rawImage) {
          try {
            absoluteImage = new URL(rawImage, window.location.href).toString();
          } catch {
            absoluteImage = undefined;
          }
        }
        return {
          ogImage: absoluteImage,
          pageTitle: document.title?.trim() || undefined,
        };
      },
    });
    return results?.[0]?.result ?? {};
  } catch {
    return {};
  }
}

export async function inspectActiveBrowserTab(): Promise<BrowserTabSnapshot | null> {
  if (!isChromeExtensionEnv()) {
    // Modo navegador de desenvolvimento/teste local: le parametros opcionais de simulacao ou exibe exemplo funcional
    const params = new URLSearchParams(window.location.search);
    const mockUrl =
      sanitizeHttpUrl(params.get('mockUrl') ?? '') ??
      'https://mangadex.org/title/solo-leveling/capitulo-142';
    const mockTitle =
      params.get('mockTitle') ?? 'Solo Leveling - Capitulo 142 | Leitor Online';

    return {
      title: mockTitle,
      cleanTitle: suggestCleanTitle(mockTitle),
      url: mockUrl,
      domain: extractDomain(mockUrl),
      detectedProgress: detectProgressFromTab(mockTitle, mockUrl),
    };
  }

  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!activeTab?.url) return null;
    const safeUrl = sanitizeHttpUrl(activeTab.url);
    if (!safeUrl) return null;

    const rawTitle = activeTab.title?.trim() || extractDomain(safeUrl);
    const ogData =
      activeTab.id !== undefined ? await extractOpenGraphFromTab(activeTab.id) : {};

    let capturedDataUrl: string | undefined;
    try {
      const screenshot = await chrome.tabs.captureVisibleTab(activeTab.windowId, {
        format: 'jpeg',
        quality: 75,
      });
      if (screenshot) {
        capturedDataUrl = await compressDataUrlToThumbnail(screenshot);
      }
    } catch {
      capturedDataUrl = undefined;
    }

    const finalTitle = ogData.pageTitle || rawTitle;
    return {
      chromeTabId: activeTab.id,
      title: finalTitle,
      cleanTitle: suggestCleanTitle(finalTitle),
      url: safeUrl,
      domain: extractDomain(safeUrl),
      faviconUrl: activeTab.favIconUrl || undefined,
      ogImageUrl: ogData.ogImage ? sanitizeHttpUrl(ogData.ogImage) ?? undefined : undefined,
      capturedDataUrl,
      detectedProgress: detectProgressFromTab(finalTitle, safeUrl),
    };
  } catch {
    return null;
  }
}

export async function listOpenBrowserTabs(): Promise<BrowserTabSnapshot[]> {
  if (!isChromeExtensionEnv()) {
    return [
      {
        chromeTabId: 101,
        title: 'One Piece - Capitulo 1115 | Leitor Manga',
        cleanTitle: 'One Piece',
        url: 'https://mangaplus.shueisha.co.jp/titles/100020/capitulo-1115',
        domain: 'mangaplus.shueisha.co.jp',
        detectedProgress: 'Cap. 1115',
      },
      {
        chromeTabId: 102,
        title: 'Frieren e a Jornada para o Alem - Cap. 130',
        cleanTitle: 'Frieren e a Jornada para o Alem',
        url: 'https://mangadex.org/title/frieren/cap-130',
        domain: 'mangadex.org',
        detectedProgress: 'Cap. 130',
      },
      {
        chromeTabId: 103,
        title: 'Documentacao TypeScript Handbook',
        cleanTitle: 'Documentacao TypeScript Handbook',
        url: 'https://www.typescriptlang.org/docs/handbook/intro.html',
        domain: 'typescriptlang.org',
        detectedProgress: '',
      },
    ];
  }

  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const snapshots: BrowserTabSnapshot[] = [];

    for (const tab of tabs) {
      if (!tab.url) continue;
      const safeUrl = sanitizeHttpUrl(tab.url);
      if (!safeUrl) continue;

      const rawTitle = tab.title?.trim() || extractDomain(safeUrl);
      snapshots.push({
        chromeTabId: tab.id,
        title: rawTitle,
        cleanTitle: suggestCleanTitle(rawTitle),
        url: safeUrl,
        domain: extractDomain(safeUrl),
        faviconUrl: tab.favIconUrl || undefined,
        detectedProgress: detectProgressFromTab(rawTitle, safeUrl),
      });
    }

    return snapshots;
  } catch {
    return [];
  }
}

export async function closeBrowserTabs(tabIds: number[]): Promise<void> {
  const validIds = tabIds.filter((id) => Number.isInteger(id) && id > 0);
  if (validIds.length === 0 || !isChromeExtensionEnv()) return;
  try {
    await chrome.tabs.remove(validIds);
  } catch {
    // Aba pode ja ter sido fechada pelo usuario
  }
}

export async function openExtensionDashboard(): Promise<void> {
  if (!isChromeExtensionEnv()) {
    window.open('./dashboard.html', '_blank', 'noopener,noreferrer');
    return;
  }

  const dashboardUrl = chrome.runtime.getURL('dashboard.html');
  try {
    const existingTabs = await chrome.tabs.query({ url: `${dashboardUrl}*` });
    if (existingTabs.length > 0 && existingTabs[0].id !== undefined) {
      await chrome.tabs.update(existingTabs[0].id, { active: true });
      if (existingTabs[0].windowId !== undefined) {
        await chrome.windows.update(existingTabs[0].windowId, { focused: true });
      }
      return;
    }
    await chrome.tabs.create({ url: dashboardUrl });
  } catch {
    window.open(dashboardUrl, '_blank', 'noopener,noreferrer');
  }
}

export async function openExternalLink(url: string): Promise<void> {
  const safeUrl = sanitizeHttpUrl(url);
  if (!safeUrl) return;

  if (isChromeExtensionEnv()) {
    try {
      await chrome.tabs.create({ url: safeUrl });
      return;
    } catch {
      // fallback abaixo
    }
  }
  window.open(safeUrl, '_blank', 'noopener,noreferrer');
}
