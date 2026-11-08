import {
  createSavedLink,
  loadShelfState,
  subscribeShelfUpdates,
  updateSavedLink,
} from './lib/db';
import {
  detectProgressFromTab,
  extractDomain,
  extractNumericProgress,
  findMatchingSavedItem,
  formatBadgeProgress,
  sanitizeCoverSource,
  sanitizeHttpUrl,
  suggestCleanTitle,
} from './lib/progress';

const PREFERRED_TAB_KEY = 'tomo_preferred_tab_id';
const REOPEN_DASHBOARD_STORAGE_KEY = 'tomo_reopen_dashboard_ts';
const DEFAULT_ACTION_TITLE = 'Salvar ou atualizar parada no Tomo (Alt+Shift+Q)';
const BADGE_BG_SAVED = '#222936';
const BADGE_FG_SAVED = '#F3F0EA';
const BADGE_BG_AHEAD = '#F59B4C';
const BADGE_FG_DARK = '#170E06';
const BADGE_BG_SUCCESS = '#5ED396';
const BADGE_BG_ERROR = '#FA7D7D';

let reopenCheckInFlight = false;
let menuRebuildChain: Promise<void> = Promise.resolve();

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
      func: async () => {
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

        if (resolvedImg && /^https?:\/\//i.test(resolvedImg)) {
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), 1800);
          try {
            const resp = await fetch(resolvedImg, {
              credentials: 'same-origin',
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
                    resolvedImg = webp;
                  }
                }
                bitmap.close();
              }
            }
          } catch {
            // mantem URL HTTP original caso o fetch cross-origin falhe
          } finally {
            window.clearTimeout(timer);
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

async function captureImageUrlInTabAsWebp(
  tabId: number,
  imageUrl: string
): Promise<string | undefined> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [imageUrl],
      func: async (srcUrl: string) => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 2000);
        try {
          const resp = await fetch(srcUrl, {
            credentials: 'same-origin',
            signal: controller.signal,
          });
          if (!resp.ok) return undefined;
          const blob = await resp.blob();
          if (!blob.type.startsWith('image/') || blob.size < 100) return undefined;
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
          if (!ctx) {
            bitmap.close();
            return undefined;
          }
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
          bitmap.close();
          const webp = canvas.toDataURL('image/webp', 0.8);
          return webp.startsWith('data:image/webp;base64,') ? webp : undefined;
        } catch {
          return undefined;
        } finally {
          window.clearTimeout(timer);
        }
      },
    });
    return results?.[0]?.result ?? undefined;
  } catch {
    return undefined;
  }
}

async function syncTabActionBadge(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const safeUrl = tab.url ? sanitizeHttpUrl(tab.url) : null;
    if (!safeUrl) {
      await chrome.action.setBadgeText({ text: '', tabId });
      await chrome.action.setTitle({ title: DEFAULT_ACTION_TITLE, tabId });
      return;
    }

    const { items } = await loadShelfState();
    const rawTitle = tab.title?.trim() || extractDomain(safeUrl);
    const matched = findMatchingSavedItem({ title: rawTitle, url: safeUrl }, items);

    if (!matched) {
      await chrome.action.setBadgeText({ text: '', tabId });
      await chrome.action.setTitle({ title: DEFAULT_ACTION_TITLE, tabId });
      return;
    }

    const detectedProgress = detectProgressFromTab(rawTitle, safeUrl);
    const detectedNum = extractNumericProgress(detectedProgress);
    const savedNum = extractNumericProgress(matched.progressLabel);
    const isAhead =
      detectedNum !== null &&
      (savedNum === null || detectedNum > savedNum);

    const badgeText = isAhead
      ? formatBadgeProgress(detectedProgress)
      : formatBadgeProgress(matched.progressLabel);

    await chrome.action.setBadgeBackgroundColor({
      color: isAhead ? BADGE_BG_AHEAD : BADGE_BG_SAVED,
      tabId,
    });
    if (typeof chrome.action.setBadgeTextColor === 'function') {
      await chrome.action.setBadgeTextColor({
        color: isAhead ? BADGE_FG_DARK : BADGE_FG_SAVED,
        tabId,
      });
    }
    await chrome.action.setBadgeText({ text: badgeText, tabId });

    const hoverTitle = isAhead
      ? `Tomo · ${matched.title}: avancar de ${matched.progressLabel ?? 'inicio'} para ${detectedProgress} (Alt+Shift+S)`
      : `Tomo · Salvo na estante: ${matched.title}${matched.progressLabel ? ` (${matched.progressLabel})` : ''}`;
    await chrome.action.setTitle({ title: hoverTitle, tabId });
  } catch {
    // aba encerrada ou inacessivel
  }
}

async function syncActiveWindowBadges(): Promise<void> {
  try {
    const activeTabs = await chrome.tabs.query({ active: true });
    await Promise.all(
      activeTabs
        .map((t) => t.id)
        .filter((id): id is number => id !== undefined)
        .map((id) => syncTabActionBadge(id))
    );
  } catch {
    // ignora erro de query
  }
}

async function flashActionBadge(
  text: string,
  color: string,
  tabId?: number
): Promise<void> {
  try {
    await chrome.action.setBadgeBackgroundColor({ color, tabId });
    if (typeof chrome.action.setBadgeTextColor === 'function') {
      await chrome.action.setBadgeTextColor({ color: BADGE_FG_DARK, tabId });
    }
    await chrome.action.setBadgeText({ text, tabId });
    setTimeout(() => {
      if (tabId !== undefined) {
        syncTabActionBadge(tabId).catch(() => {});
      } else {
        chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
      }
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
    await flashActionBadge('!', BADGE_BG_ERROR, activeTab.id);
    return;
  }

  const meta = await extractPageMetaInWorker(activeTab.id);
  const rawTitle = meta.pageTitle || activeTab.title?.trim() || extractDomain(safeUrl);
  const cleanTitle = suggestCleanTitle(rawTitle) || rawTitle;
  const detectedProgress = detectProgressFromTab(rawTitle, safeUrl);

  let coverImage = sanitizeCoverSource(meta.ogImage);
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

    await flashActionBadge('OK', BADGE_BG_AHEAD, activeTab.id);
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

  await flashActionBadge('OK', BADGE_BG_SUCCESS, activeTab.id);
  await showOnPageToast(
    activeTab.id,
    'Salvo na estante do Tomo',
    `${created.title} · ${tabName}${created.progressLabel ? ` · ${created.progressLabel}` : ''}`
  );
}

function deriveTitleFromUrlSlug(safeUrl: string): string {
  try {
    const parsed = new URL(safeUrl);
    const segments = parsed.pathname
      .split('/')
      .map((s) => decodeURIComponent(s).trim())
      .filter((s) => s.length > 1 && !/^(?:ler|read|obra|title|manga|series|watch)$/i.test(s));
    if (segments.length === 0) return extractDomain(safeUrl);
    const rawSlug = segments[0]
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
    return suggestCleanTitle(rawSlug) || rawSlug;
  } catch {
    return extractDomain(safeUrl);
  }
}

function rebuildContextMenus(): Promise<void> {
  if (!chrome.contextMenus) return Promise.resolve();

  menuRebuildChain = menuRebuildChain
    .then(async () => {
      const { tabs } = await loadShelfState();
      await new Promise<void>((resolve) => {
        chrome.contextMenus.removeAll(() => {
          void chrome.runtime.lastError;
          resolve();
        });
      });

      chrome.contextMenus.create({
        id: 'tomo-save-page',
        title: 'Salvar ou atualizar esta pagina no Tomo',
        contexts: ['page'],
      });

      chrome.contextMenus.create({
        id: 'tomo-link-parent',
        title: 'Salvar link no Tomo em...',
        contexts: ['link'],
      });

      for (const tab of tabs) {
        chrome.contextMenus.create({
          id: `tomo-link-tab:${tab.id}`,
          parentId: 'tomo-link-parent',
          title: tab.name,
          contexts: ['link'],
        });
      }

      chrome.contextMenus.create({
        id: 'tomo-set-cover',
        title: 'Usar esta imagem como capa no Tomo',
        contexts: ['image'],
      });
    })
    .catch(() => {});

  return menuRebuildChain;
}

async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): Promise<void> {
  const menuId = String(info.menuItemId);

  if (menuId === 'tomo-save-page') {
    await handleQuickSaveShortcut(false);
    return;
  }

  if (menuId.startsWith('tomo-link-tab:')) {
    const targetTabId = menuId.slice('tomo-link-tab:'.length);
    const safeLinkUrl = info.linkUrl ? sanitizeHttpUrl(info.linkUrl) : null;
    if (!safeLinkUrl) {
      if (tab?.id !== undefined) {
        await flashActionBadge('!', BADGE_BG_ERROR, tab.id);
      }
      return;
    }

    const { tabs, items } = await loadShelfState();
    const resolvedTab = tabs.find((t) => t.id === targetTabId) ?? tabs[0];
    if (!resolvedTab) return;

    const hintTitle =
      info.selectionText?.trim() || deriveTitleFromUrlSlug(safeLinkUrl);
    const cleanTitle = suggestCleanTitle(hintTitle) || hintTitle;
    const detectedProgress = detectProgressFromTab(hintTitle, safeLinkUrl);
    const existing = findMatchingSavedItem(
      { title: hintTitle, url: safeLinkUrl },
      items
    );

    if (existing) {
      const nextProgress = detectedProgress || existing.progressLabel;
      await updateSavedLink(existing.id, {
        url: safeLinkUrl,
        tabId: resolvedTab.id,
        progressLabel: nextProgress,
      });
      if (tab?.id !== undefined) {
        await flashActionBadge('OK', BADGE_BG_AHEAD, tab.id);
        await showOnPageToast(
          tab.id,
          'Link atualizado no Tomo',
          `${existing.title} · ${resolvedTab.name}${nextProgress ? ` · ${nextProgress}` : ''}`
        );
      }
      return;
    }

    const created = await createSavedLink({
      tabId: resolvedTab.id,
      title: cleanTitle,
      url: safeLinkUrl,
      progressLabel: detectedProgress || undefined,
      status: 'reading',
    });

    if (tab?.id !== undefined) {
      await flashActionBadge('OK', BADGE_BG_SUCCESS, tab.id);
      await showOnPageToast(
        tab.id,
        'Link salvo no Tomo',
        `${created.title} · ${resolvedTab.name}${created.progressLabel ? ` · ${created.progressLabel}` : ''}`
      );
    }
    return;
  }

  if (menuId === 'tomo-set-cover' && tab?.id !== undefined && tab.url) {
    const safePageUrl = sanitizeHttpUrl(tab.url);
    if (!safePageUrl || !info.srcUrl) return;

    const webpCover = await captureImageUrlInTabAsWebp(tab.id, info.srcUrl);
    const finalCover = webpCover ?? sanitizeCoverSource(info.srcUrl);
    if (!finalCover) {
      await flashActionBadge('!', BADGE_BG_ERROR, tab.id);
      return;
    }

    const { tabs, items } = await loadShelfState();
    const rawTitle = tab.title?.trim() || extractDomain(safePageUrl);
    const matched = findMatchingSavedItem(
      { title: rawTitle, url: safePageUrl },
      items
    );

    if (matched) {
      await updateSavedLink(matched.id, { coverImage: finalCover });
      await flashActionBadge('OK', BADGE_BG_SUCCESS, tab.id);
      await showOnPageToast(
        tab.id,
        'Capa atualizada no Tomo',
        matched.title
      );
      return;
    }

    const defaultTabId = tabs[0]?.id;
    if (!defaultTabId) return;
    const preferred = await getWorkerPreferredTabId(defaultTabId);
    const resolvedTabId = tabs.some((t) => t.id === preferred)
      ? preferred
      : defaultTabId;

    const created = await createSavedLink({
      tabId: resolvedTabId,
      title: suggestCleanTitle(rawTitle) || rawTitle,
      url: safePageUrl,
      faviconUrl: tab.favIconUrl || undefined,
      coverImage: finalCover,
      progressLabel: detectProgressFromTab(rawTitle, safePageUrl) || undefined,
      status: 'reading',
    });
    await flashActionBadge('OK', BADGE_BG_SUCCESS, tab.id);
    await showOnPageToast(
      tab.id,
      'Salvo com a capa escolhida',
      created.title
    );
  }
}

async function consumePendingDashboardReopen(): Promise<void> {
  if (reopenCheckInFlight) return;
  reopenCheckInFlight = true;
  try {
    const stored = await chrome.storage.local.get(REOPEN_DASHBOARD_STORAGE_KEY);
    const ts = stored?.[REOPEN_DASHBOARD_STORAGE_KEY];
    if (typeof ts === 'number' && Date.now() - ts < 30_000) {
      await chrome.storage.local.remove(REOPEN_DASHBOARD_STORAGE_KEY);
      await openOrFocusDashboard();
    }
  } catch {
    // ignora falha de storage
  } finally {
    reopenCheckInFlight = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  rebuildContextMenus().catch(() => {});
  syncActiveWindowBadges().catch(() => {});
  consumePendingDashboardReopen().catch(() => {});
});

rebuildContextMenus().catch(() => {});
syncActiveWindowBadges().catch(() => {});
consumePendingDashboardReopen().catch(() => {});

subscribeShelfUpdates(() => {
  rebuildContextMenus().catch(() => {});
  syncActiveWindowBadges().catch(() => {});
});

if (chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    handleContextMenuClick(info, tab).catch(() => {});
  });
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  syncTabActionBadge(tabId).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (
    changeInfo.status === 'complete' ||
    changeInfo.url !== undefined ||
    changeInfo.title !== undefined
  ) {
    syncTabActionBadge(tabId).catch(() => {});
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'quick-save-tab') {
    handleQuickSaveShortcut(false).catch(() => {});
  } else if (command === 'save-and-close-tab') {
    handleQuickSaveShortcut(true).catch(() => {});
  } else if (command === 'open-dashboard') {
    openOrFocusDashboard().catch(() => {});
  }
});
