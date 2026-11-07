import {
  createSavedLink,
  loadShelfState,
  updateSavedLink,
} from './lib/db';
import {
  detectProgressFromTab,
  extractDomain,
  findMatchingSavedItem,
  sanitizeHttpUrl,
  suggestCleanTitle,
} from './lib/progress';

const PREFERRED_TAB_KEY = 'tomo_preferred_tab_id';

async function getWorkerPreferredTabId(fallbackId: string): Promise<string> {
  try {
    const stored = await chrome.storage.local.get(PREFERRED_TAB_KEY);
    const val = stored?.[PREFERRED_TAB_KEY];
    if (typeof val === 'string' && val.trim()) {
      return val;
    }
  } catch {
    // fallback
  }
  return fallbackId;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

async function compressScreenshotInWorker(
  rawDataUrl: string,
  maxWidth = 520,
  maxHeight = 325
): Promise<string | undefined> {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    return undefined;
  }

  try {
    const response = await fetch(rawDataUrl);
    const sourceBlob = await response.blob();
    const bitmap = await createImageBitmap(sourceBlob);

    const ratio = Math.max(maxWidth / bitmap.width, maxHeight / bitmap.height);
    const width = Math.max(1, Math.round(Math.min(maxWidth, bitmap.width * ratio)));
    const height = Math.max(1, Math.round(Math.min(maxHeight, bitmap.height * ratio)));

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return undefined;
    }

    const targetAspect = width / height;
    let sw = bitmap.width;
    let sh = Math.round(bitmap.width / targetAspect);
    if (sh > bitmap.height) {
      sh = bitmap.height;
      sw = Math.round(bitmap.height * targetAspect);
    }
    const sx = Math.max(0, Math.round((bitmap.width - sw) / 2));

    ctx.drawImage(bitmap, sx, 0, sw, sh, 0, 0, width, height);
    bitmap.close();

    const webpBlob = await canvas.convertToBlob({
      type: 'image/webp',
      quality: 0.78,
    });
    const buf = await webpBlob.arrayBuffer();
    return `data:image/webp;base64,${arrayBufferToBase64(buf)}`;
  } catch {
    return undefined;
  }
}

async function extractPageMetaInWorker(
  tabId: number
): Promise<{ ogImage?: string; pageTitle?: string }> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const readMeta = (sel: string) =>
          document.querySelector<HTMLMetaElement>(sel)?.content?.trim() || '';
        const rawImg =
          readMeta('meta[property="og:image"]') ||
          readMeta('meta[name="twitter:image"]') ||
          readMeta('meta[property="og:image:url"]');

        let resolvedImg: string | undefined;
        if (rawImg) {
          try {
            resolvedImg = new URL(rawImg, window.location.href).toString();
          } catch {
            resolvedImg = undefined;
          }
        }
        return {
          ogImage: resolvedImg,
          pageTitle: document.title?.trim() || undefined,
        };
      },
    });
    return results?.[0]?.result ?? {};
  } catch {
    return {};
  }
}

async function flashActionBadge(
  text: string,
  color: string,
  tabId?: number
): Promise<void> {
  try {
    await chrome.action.setBadgeBackgroundColor({ color, tabId });
    await chrome.action.setBadgeText({ text, tabId });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
    }, 2200);
  } catch {
    // aba pode ter sido fechada
  }
}

async function showOnPageToast(
  tabId: number,
  heading: string,
  detail: string
): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [heading, detail],
      func: (titleText: string, subtitleText: string) => {
        const hostId = 'tomo-extension-shortcut-toast';
        document.getElementById(hostId)?.remove();

        const host = document.createElement('div');
        host.id = hostId;
        const shadow = host.attachShadow({ mode: 'closed' });

        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        const style = document.createElement('style');
        style.textContent = `
          .toast {
            position: fixed;
            top: 18px;
            right: 18px;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            gap: 12px;
            max-width: 360px;
            padding: 12px 16px;
            border-radius: 10px;
            background: #13171e;
            color: #f3f0ea;
            border: 1px solid #f59b4c;
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 13px;
            line-height: 1.35;
            pointer-events: none;
            opacity: 1;
            transform: translateY(0);
            transition: ${reduced ? 'none' : 'opacity 160ms ease, transform 160ms ease'};
          }
          .badge {
            width: 28px;
            height: 28px;
            border-radius: 7px;
            background: rgba(245, 155, 76, 0.16);
            border: 1px solid #f59b4c;
            color: #f59b4c;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 800;
            font-size: 13px;
            flex-shrink: 0;
          }
          .title {
            font-weight: 700;
            color: #f3f0ea;
            margin: 0 0 2px;
          }
          .sub {
            color: #a4aebd;
            margin: 0;
            font-family: ui-monospace, monospace;
            font-size: 12px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 280px;
          }
        `;

        const wrapper = document.createElement('div');
        wrapper.className = 'toast';
        wrapper.setAttribute('role', 'status');

        const badge = document.createElement('div');
        badge.className = 'badge';
        badge.textContent = 'OK';

        const textCol = document.createElement('div');
        const titleEl = document.createElement('p');
        titleEl.className = 'title';
        titleEl.textContent = titleText;

        const subEl = document.createElement('p');
        subEl.className = 'sub';
        subEl.textContent = subtitleText;

        textCol.append(titleEl, subEl);
        wrapper.append(badge, textCol);
        shadow.append(style, wrapper);
        document.documentElement.appendChild(host);

        setTimeout(() => {
          wrapper.style.opacity = '0';
          wrapper.style.transform = 'translateY(-6px)';
          setTimeout(() => host.remove(), 180);
        }, 2500);
      },
    });
  } catch {
    // paginas restritas usam apenas o badge na barra do Chrome
  }
}

async function openOrFocusDashboard(): Promise<void> {
  const dashboardUrl = chrome.runtime.getURL('dashboard.html');
  const existing = await chrome.tabs.query({ url: `${dashboardUrl}*` });
  if (existing.length > 0 && existing[0].id !== undefined) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId !== undefined) {
      await chrome.windows.update(existing[0].windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url: dashboardUrl });
}

async function handleQuickSaveShortcut(closeAfter: boolean): Promise<void> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!activeTab?.url || activeTab.id === undefined) return;

  const safeUrl = sanitizeHttpUrl(activeTab.url);
  if (!safeUrl) {
    await flashActionBadge('!', '#FA7D7D', activeTab.id);
    return;
  }

  const meta = await extractPageMetaInWorker(activeTab.id);
  const rawTitle = meta.pageTitle || activeTab.title?.trim() || extractDomain(safeUrl);
  const cleanTitle = suggestCleanTitle(rawTitle) || rawTitle;
  const detectedProgress = detectProgressFromTab(rawTitle, safeUrl);

  let coverImage = meta.ogImage ? sanitizeHttpUrl(meta.ogImage) ?? undefined : undefined;
  if (!coverImage) {
    try {
      const screenshot = await chrome.tabs.captureVisibleTab(activeTab.windowId, {
        format: 'jpeg',
        quality: 75,
      });
      if (screenshot) {
        coverImage = await compressScreenshotInWorker(screenshot);
      }
    } catch {
      coverImage = undefined;
    }
  }

  const { tabs, items } = await loadShelfState();
  const defaultTabId = tabs[0]?.id;
  if (!defaultTabId) return;

  const preferredTabId = await getWorkerPreferredTabId(defaultTabId);
  const resolvedTabId = tabs.some((t) => t.id === preferredTabId)
    ? preferredTabId
    : defaultTabId;

  const matched = findMatchingSavedItem({ title: rawTitle, url: safeUrl }, items);

  if (matched) {
    const nextProgress = detectedProgress || matched.progressLabel;
    await updateSavedLink(matched.id, {
      url: safeUrl,
      progressLabel: nextProgress,
      faviconUrl: activeTab.favIconUrl || matched.faviconUrl,
      coverImage: coverImage ?? matched.coverImage,
    });

    const tabName = tabs.find((t) => t.id === matched.tabId)?.name ?? 'Estante';
    if (closeAfter) {
      await chrome.tabs.remove(activeTab.id);
      return;
    }

    await flashActionBadge('OK', '#F59B4C', activeTab.id);
    await showOnPageToast(
      activeTab.id,
      'Parada atualizada no Tomo',
      `${matched.title} · ${tabName}${nextProgress ? ` · ${nextProgress}` : ''}`
    );
    return;
  }

  const created = await createSavedLink({
    tabId: resolvedTabId,
    title: cleanTitle,
    url: safeUrl,
    faviconUrl: activeTab.favIconUrl || undefined,
    coverImage,
    progressLabel: detectedProgress || undefined,
    status: 'reading',
  });

  const tabName = tabs.find((t) => t.id === resolvedTabId)?.name ?? 'Estante';
  if (closeAfter) {
    await chrome.tabs.remove(activeTab.id);
    return;
  }

  await flashActionBadge('OK', '#5ED396', activeTab.id);
  await showOnPageToast(
    activeTab.id,
    'Salvo na estante do Tomo',
    `${created.title} · ${tabName}${created.progressLabel ? ` · ${created.progressLabel}` : ''}`
  );
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'quick-save-tab') {
    handleQuickSaveShortcut(false).catch(() => {});
  } else if (command === 'save-and-close-tab') {
    handleQuickSaveShortcut(true).catch(() => {});
  } else if (command === 'open-dashboard') {
    openOrFocusDashboard().catch(() => {});
  }
});
