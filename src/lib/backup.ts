import type {
  CollectionTab,
  ImportMode,
  ImportSummary,
  ReadingStatus,
  SavedLinkItem,
  ShelfBackupPayload,
  TabIconName,
} from '../types/shelf';
import { extractDomain, sanitizeCoverSource, sanitizeHttpUrl } from './progress';

const VALID_ICONS = new Set<TabIconName>([
  'book-open',
  'compass',
  'layers',
  'tv',
  'graduation-cap',
  'code',
  'shopping-bag',
  'folder',
  'sparkles',
  'bookmark',
]);

const VALID_STATUSES = new Set<ReadingStatus>([
  'reading',
  'up_to_date',
  'paused',
  'completed',
]);

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

export function createBackupPayload(
  tabs: CollectionTab[],
  items: SavedLinkItem[]
): ShelfBackupPayload {
  const sortedTabs = [...tabs].sort((a, b) => a.order - b.order);
  const sortedItems = [...items].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );

  return {
    app: 'tomo-extension',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    tabs: sortedTabs,
    items: sortedItems,
  };
}

export function parseAndValidateBackupJson(rawText: string): ShelfBackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new BackupValidationError(
      'O arquivo selecionado nao e um JSON valido. Verifique se escolheu um backup exportado pelo Tomo.'
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new BackupValidationError('Formato de backup invalido: objeto raiz ausente.');
  }

  const candidate = parsed as Record<string, unknown>;
  if (candidate.app !== 'tomo-extension') {
    throw new BackupValidationError(
      'Este arquivo JSON nao pertence ao Tomo (campo "app" ausente ou incompativel).'
    );
  }

  if (!Array.isArray(candidate.tabs) || !Array.isArray(candidate.items)) {
    throw new BackupValidationError(
      'Estrutura incompleta: o backup precisa conter as listas "tabs" e "items".'
    );
  }

  const nowIso = new Date().toISOString();
  const sanitizedTabs: CollectionTab[] = [];
  const seenTabIds = new Set<string>();

  candidate.tabs.forEach((rawTab, index) => {
    if (!rawTab || typeof rawTab !== 'object') return;
    const t = rawTab as Record<string, unknown>;
    const id = typeof t.id === 'string' && t.id.trim() ? t.id.trim() : `tab-${index + 1}`;
    if (seenTabIds.has(id)) return;

    const name = typeof t.name === 'string' ? t.name.trim().slice(0, 60) : '';
    if (!name) return;

    const icon: TabIconName =
      typeof t.icon === 'string' && VALID_ICONS.has(t.icon as TabIconName)
        ? (t.icon as TabIconName)
        : 'bookmark';

    seenTabIds.add(id);
    sanitizedTabs.push({
      id,
      name,
      icon,
      order: typeof t.order === 'number' && Number.isFinite(t.order) ? t.order : index,
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : nowIso,
      updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : nowIso,
    });
  });

  if (sanitizedTabs.length === 0) {
    sanitizedTabs.push({
      id: 'tab-geral',
      name: 'Geral',
      icon: 'bookmark',
      order: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    seenTabIds.add('tab-geral');
  }

  const fallbackTabId = sanitizedTabs[0].id;
  const sanitizedItems: SavedLinkItem[] = [];
  const seenItemIds = new Set<string>();

  candidate.items.forEach((rawItem, index) => {
    if (!rawItem || typeof rawItem !== 'object') return;
    const it = rawItem as Record<string, unknown>;

    const safeUrl = typeof it.url === 'string' ? sanitizeHttpUrl(it.url) : null;
    if (!safeUrl) {
      throw new BackupValidationError(
        `Link invalido ou inseguro encontrado no item #${index + 1} do arquivo de backup.`
      );
    }

    const id =
      typeof it.id === 'string' && it.id.trim() && !seenItemIds.has(it.id.trim())
        ? it.id.trim()
        : `item-${index + 1}-${Math.random().toString(36).slice(2, 8)}`;

    seenItemIds.add(id);

    const requestedTabId = typeof it.tabId === 'string' ? it.tabId.trim() : '';
    const tabId = seenTabIds.has(requestedTabId) ? requestedTabId : fallbackTabId;
    const domain = extractDomain(safeUrl);
    const title =
      typeof it.title === 'string' && it.title.trim()
        ? it.title.trim().slice(0, 180)
        : domain;

    const status: ReadingStatus =
      typeof it.status === 'string' && VALID_STATUSES.has(it.status as ReadingStatus)
        ? (it.status as ReadingStatus)
        : 'reading';

    sanitizedItems.push({
      id,
      tabId,
      title,
      url: safeUrl,
      domain,
      faviconUrl:
        typeof it.faviconUrl === 'string' ? sanitizeCoverSource(it.faviconUrl) : undefined,
      coverImage:
        typeof it.coverImage === 'string' ? sanitizeCoverSource(it.coverImage) : undefined,
      progressLabel:
        typeof it.progressLabel === 'string'
          ? it.progressLabel.trim().slice(0, 40) || undefined
          : undefined,
      status,
      pinned: Boolean(it.pinned),
      notes:
        typeof it.notes === 'string' ? it.notes.trim().slice(0, 400) || undefined : undefined,
      createdAt: typeof it.createdAt === 'string' ? it.createdAt : nowIso,
      updatedAt: typeof it.updatedAt === 'string' ? it.updatedAt : nowIso,
    });
  });

  return {
    app: 'tomo-extension',
    schemaVersion: 1,
    exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt : nowIso,
    tabs: sanitizedTabs,
    items: sanitizedItems,
  };
}

export function reconcileBackupImport(
  current: { tabs: CollectionTab[]; items: SavedLinkItem[] },
  incoming: ShelfBackupPayload,
  mode: ImportMode
): { tabs: CollectionTab[]; items: SavedLinkItem[]; summary: ImportSummary } {
  if (mode === 'replace') {
    return {
      tabs: incoming.tabs.map((tab, idx) => ({ ...tab, order: idx })),
      items: incoming.items,
      summary: {
        tabsImported: incoming.tabs.length,
        itemsImported: incoming.items.length,
        itemsUpdated: 0,
      },
    };
  }

  // Modo merge: preserva abas existentes (casando por ID ou nome normalizado) e mescla links
  const mergedTabs = [...current.tabs].sort((a, b) => a.order - b.order);
  const incomingTabIdMap = new Map<string, string>();
  let tabsImported = 0;

  for (const incTab of incoming.tabs) {
    const byId = mergedTabs.find((t) => t.id === incTab.id);
    if (byId) {
      incomingTabIdMap.set(incTab.id, byId.id);
      continue;
    }

    const normIncName = incTab.name.trim().toLowerCase();
    const byName = mergedTabs.find((t) => t.name.trim().toLowerCase() === normIncName);
    if (byName) {
      incomingTabIdMap.set(incTab.id, byName.id);
      continue;
    }

    const createdTab: CollectionTab = {
      ...incTab,
      order: mergedTabs.length,
    };
    mergedTabs.push(createdTab);
    incomingTabIdMap.set(incTab.id, createdTab.id);
    tabsImported += 1;
  }

  const mergedItems = [...current.items];
  let itemsImported = 0;
  let itemsUpdated = 0;

  for (const incItem of incoming.items) {
    const resolvedTabId = incomingTabIdMap.get(incItem.tabId) ?? mergedTabs[0]?.id ?? incItem.tabId;
    const existingIndex = mergedItems.findIndex(
      (existing) => existing.id === incItem.id || existing.url === incItem.url
    );

    if (existingIndex >= 0) {
      const existing = mergedItems[existingIndex];
      const shouldPreferIncoming = incItem.updatedAt >= existing.updatedAt;
      if (shouldPreferIncoming) {
        mergedItems[existingIndex] = {
          ...existing,
          ...incItem,
          id: existing.id,
          tabId: resolvedTabId,
        };
      }
      itemsUpdated += 1;
    } else {
      mergedItems.push({
        ...incItem,
        tabId: resolvedTabId,
      });
      itemsImported += 1;
    }
  }

  return {
    tabs: mergedTabs,
    items: mergedItems,
    summary: {
      tabsImported,
      itemsImported,
      itemsUpdated,
    },
  };
}
