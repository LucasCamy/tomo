import type { BrowserTabSnapshot } from '../types/shelf';
import {
  detectProgressFromTab,
  extractDomain,
  sanitizeCoverSource,
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

export async function compressImageBlobToCoverDataUrl(
  blob: Blob,
  maxWidth = 520,
  maxHeight = 325
): Promise<string | undefined> {
  if (!blob.type.startsWith('image/') && blob.size === 0) return undefined;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        resolve(undefined);
        return;
      }
      compressDataUrlToThumbnail(reader.result, maxWidth, maxHeight).then(resolve);
    };
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(blob);
  });
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

export async function extractOpenGraphFromTab(
  tabId: number
): Promise<{ ogImage?: string; pageTitle?: string }> {
  if (!chrome.scripting?.executeScript) return {};
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const getMeta = (selector: string) =>
          document.querySelector<HTMLMetaElement>(selector)?.content?.trim() || '';
        const getLink = (selector: string) =>
          document.querySelector<HTMLLinkElement>(selector)?.href?.trim() || '';

        const candidateUrl =
          getMeta('meta[property="og:image"]') ||
          getMeta('meta[property="og:image:secure_url"]') ||
          getMeta('meta[property="og:image:url"]') ||
          getMeta('meta[name="twitter:image"]') ||
          getMeta('meta[name="twitter:image:src"]') ||
          getMeta('meta[name="thumbnail"]') ||
          getLink('link[rel="image_src"]') ||
          document.querySelector<HTMLImageElement>('[itemprop="image"]')?.src?.trim() ||
          document.querySelector<HTMLImageElement>(
            'img[class*="cover" i], img[class*="poster" i], img[id*="cover" i], img[alt*="capa" i], img[alt*="cover" i]'
          )?.src?.trim();

        let absoluteImage: string | undefined;
        if (candidateUrl) {
          try {
            absoluteImage = new URL(candidateUrl, window.location.href).toString();
          } catch {
            absoluteImage = undefined;
          }
        }

        let resolvedCover = absoluteImage;
        if (absoluteImage && /^https?:\/\//i.test(absoluteImage)) {
          // 1. Tenta desenhar direto da imagem existente no DOM no canvas (super rapido, sem refetch)
          try {
            const domImg = Array.from(document.images).find(
              (im) => im.src === absoluteImage && im.naturalWidth >= 60 && im.naturalHeight >= 60
            );
            if (domImg) {
              const canvas = document.createElement('canvas');
              const maxW = 520;
              const maxH = 325;
              const ratio = Math.max(maxW / domImg.naturalWidth, maxH / domImg.naturalHeight);
              const w = Math.max(1, Math.round(Math.min(maxW, domImg.naturalWidth * ratio)));
              const h = Math.max(1, Math.round(Math.min(maxH, domImg.naturalHeight * ratio)));
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                const targetAspect = w / h;
                let sw = domImg.naturalWidth;
                let sh = Math.round(domImg.naturalWidth / targetAspect);
                if (sh > domImg.naturalHeight) {
                  sh = domImg.naturalHeight;
                  sw = Math.round(domImg.naturalHeight * targetAspect);
                }
                const sx = Math.max(0, Math.round((domImg.naturalWidth - sw) / 2));
                const sy = Math.max(0, Math.round((domImg.naturalHeight - sh) / 3));
                ctx.drawImage(domImg, sx, sy, sw, sh, 0, 0, w, h);
                const webp = canvas.toDataURL('image/webp', 0.8);
                if (webp.startsWith('data:image/webp;base64,')) {
                  resolvedCover = webp;
                }
              }
            }
          } catch {
            // Tainted canvas se a imagem nao permitiu crossOrigin direto
          }

          // 2. Se ainda nao e base64, tenta fetch com timeout omitindo credenciais
          if (!resolvedCover?.startsWith('data:image/webp;base64,')) {
            const controller = new AbortController();
            const timer = window.setTimeout(() => controller.abort(), 1800);
            try {
              const resp = await fetch(absoluteImage, {
                credentials: 'omit',
                signal: controller.signal,
              });
              if (resp.ok) {
                const blob = await resp.blob();
                if (blob.type.startsWith('image/') && blob.size > 200) {
                  const bitmap = await createImageBitmap(blob);
                  const maxW = 520;
                  const maxH = 325;
                  const ratio = Math.max(maxW / bitmap.width, maxH / bitmap.height);
                  const w = Math.max(1, Math.round(Math.min(maxW, bitmap.width * ratio)));
                  const h = Math.max(1, Math.round(Math.min(maxH, bitmap.height * ratio)));

                  const canvas = document.createElement('canvas');
                  canvas.width = w;
                  canvas.height = h;
                  const ctx = canvas.getContext('2d');
                  if (ctx) {
                    const targetAspect = w / h;
                    let sw = bitmap.width;
                    let sh = Math.round(bitmap.width / targetAspect);
                    if (sh > bitmap.height) {
                      sh = bitmap.height;
                      sw = Math.round(bitmap.height * targetAspect);
                    }
                    const sx = Math.max(0, Math.round((bitmap.width - sw) / 2));
                    const sy = Math.max(0, Math.round((bitmap.height - sh) / 3));
                    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
                    const webp = canvas.toDataURL('image/webp', 0.8);
                    if (webp.startsWith('data:image/webp;base64,')) {
                      resolvedCover = webp;
                    }
                  }
                  bitmap.close();
                }
              }
            } catch {
              // Mantem absoluteImage como fallback
            } finally {
              window.clearTimeout(timer);
            }
          }
        }

        return {
          ogImage: resolvedCover,
          pageTitle: document.title?.trim() || undefined,
        };
      },
    });
    return results?.[0]?.result ?? {};
  } catch {
    return {};
  }
}

export async function enrichOpenTabsWithCovers(
  tabs: BrowserTabSnapshot[]
): Promise<BrowserTabSnapshot[]> {
  if (!isChromeExtensionEnv() || tabs.length === 0) return tabs;

  const tasks = tabs.map(async (tabSnap) => {
    if (tabSnap.ogImageUrl || tabSnap.capturedDataUrl || tabSnap.chromeTabId === undefined) {
      return tabSnap;
    }
    try {
      const meta = await extractOpenGraphFromTab(tabSnap.chromeTabId);
      const safeCover = sanitizeCoverSource(meta.ogImage);
      return {
        ...tabSnap,
        ogImageUrl: safeCover,
        cleanTitle: meta.pageTitle ? suggestCleanTitle(meta.pageTitle) : tabSnap.cleanTitle,
      };
    } catch {
      return tabSnap;
    }
  });

  const settled = await Promise.allSettled(tasks);
  return settled.map((res, i) => (res.status === 'fulfilled' ? res.value : tabs[i]));
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
      ogImageUrl: sanitizeCoverSource(ogData.ogImage),
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
