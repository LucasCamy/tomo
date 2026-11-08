import type {
  CollectionTab,
  ImportMode,
  ImportSummary,
  ReadingStatus,
  SavedLinkItem,
  TabIconName,
} from '../types/shelf';
import {
  createBackupPayload,
  parseAndValidateBackupJson,
  reconcileBackupImport,
} from './backup';
import {
  extractDomain,
  normalizeDomainHost,
  rewriteUrlDomain,
  sanitizeCoverSource,
  sanitizeHttpUrl,
} from './progress';

const DB_NAME = 'tomo_shelf_db';
const DB_VERSION = 1;
const STORE_TABS = 'tabs';
const STORE_ITEMS = 'items';
const STORE_META = 'meta';
const SYNC_CHANNEL = 'tomo-shelf-sync';

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const STARTER_TABS: Array<{ id: string; name: string; icon: TabIconName }> = [
  { id: 'tab-mangas', name: 'Mangas', icon: 'book-open' },
  { id: 'tab-leituras', name: 'Leituras & Estudos', icon: 'graduation-cap' },
  { id: 'tab-referencias', name: 'Para ver depois', icon: 'compass' },
];

let dbPromise: Promise<IDBDatabase> | null = null;

function openShelfDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_TABS)) {
        db.createObjectStore(STORE_TABS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        const itemStore = db.createObjectStore(STORE_ITEMS, { keyPath: 'id' });
        itemStore.createIndex('by_tab', 'tabId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao abrir banco local IndexedDB.'));
  });

  return dbPromise;
}

function broadcastShelfUpdate(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(SYNC_CHANNEL);
    channel.postMessage({ type: 'SHELF_UPDATED', at: Date.now() });
    channel.close();
  } catch {
    // Ignora caso o ambiente restrinja BroadcastChannel
  }
}

export function subscribeShelfUpdates(onChange: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(SYNC_CHANNEL);
  const handler = () => onChange();
  channel.addEventListener('message', handler);
  return () => {
    channel.removeEventListener('message', handler);
    channel.close();
  };
}

function readAllFromStore<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function getMetaFlag(store: IDBObjectStore, key: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(Boolean(req.result?.value));
    req.onerror = () => reject(req.error);
  });
}

export async function getMetaValue<T>(key: string): Promise<T | undefined> {
  const db = await openShelfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const req = tx.objectStore(STORE_META).get(key);
    req.onsuccess = () => {
      const entry = req.result as { key: string; value?: T } | undefined;
      resolve(entry?.value);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function setMetaValue<T>(key: string, value: T): Promise<void> {
  const db = await openShelfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteMetaValue(key: string): Promise<void> {
  const db = await openShelfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadShelfState(): Promise<{
  tabs: CollectionTab[];
  items: SavedLinkItem[];
}> {
  const db = await openShelfDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_TABS, STORE_ITEMS, STORE_META], 'readwrite');
    const tabStore = tx.objectStore(STORE_TABS);
    const itemStore = tx.objectStore(STORE_ITEMS);
    const metaStore = tx.objectStore(STORE_META);

    Promise.all([
      readAllFromStore<CollectionTab>(tabStore),
      readAllFromStore<SavedLinkItem>(itemStore),
      getMetaFlag(metaStore, 'seeded_v1'),
    ])
      .then(([tabs, items, alreadySeeded]) => {
        if (!alreadySeeded && tabs.length === 0) {
          const now = new Date().toISOString();
          const initialTabs: CollectionTab[] = STARTER_TABS.map((starter, idx) => ({
            id: starter.id,
            name: starter.name,
            icon: starter.icon,
            order: idx,
            createdAt: now,
            updatedAt: now,
          }));

          for (const t of initialTabs) {
            tabStore.put(t);
          }
          metaStore.put({ key: 'seeded_v1', value: true });

          tx.oncomplete = () => resolve({ tabs: initialTabs, items: [] });
          tx.onerror = () => reject(tx.error);
          return;
        }

        const sortedTabs = [...tabs].sort((a, b) => a.order - b.order);
        const sortedItems = [...items].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt)
        );
        resolve({ tabs: sortedTabs, items: sortedItems });
      })
      .catch(reject);
  });
}

export async function createCollectionTab(input: {
  name: string;
  icon: TabIconName;
}): Promise<CollectionTab> {
  const cleanName = input.name.trim().slice(0, 60);
  if (!cleanName) {
    throw new Error('Informe um nome para a aba.');
  }

  const db = await openShelfDb();
  const { tabs } = await loadShelfState();
  const now = new Date().toISOString();

  const newTab: CollectionTab = {
    id: createId('tab'),
    name: cleanName,
    icon: input.icon,
    order: tabs.length,
    createdAt: now,
    updatedAt: now,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_TABS, 'readwrite');
    tx.objectStore(STORE_TABS).put(newTab);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  broadcastShelfUpdate();
  return newTab;
}

export async function updateCollectionTab(
  tabId: string,
  patch: { name?: string; icon?: TabIconName }
): Promise<void> {
  const db = await openShelfDb();
  const { tabs } = await loadShelfState();
  const target = tabs.find((t) => t.id === tabId);
  if (!target) return;

  const nextName = patch.name !== undefined ? patch.name.trim().slice(0, 60) : target.name;
  if (!nextName) {
    throw new Error('O nome da aba nao pode ficar vazio.');
  }

  const updated: CollectionTab = {
    ...target,
    name: nextName,
    icon: patch.icon ?? target.icon,
    updatedAt: new Date().toISOString(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_TABS, 'readwrite');
    tx.objectStore(STORE_TABS).put(updated);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  broadcastShelfUpdate();
}

export async function reorderCollectionTab(
  tabId: string,
  direction: 'up' | 'down'
): Promise<void> {
  const db = await openShelfDb();
  const { tabs } = await loadShelfState();
  const index = tabs.findIndex((t) => t.id === tabId);
  if (index < 0) return;

  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= tabs.length) return;

  const reordered = [...tabs];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(swapIndex, 0, moved);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_TABS, 'readwrite');
    const store = tx.objectStore(STORE_TABS);
    reordered.forEach((tab, idx) => {
      store.put({ ...tab, order: idx });
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  broadcastShelfUpdate();
}

export async function deleteCollectionTab(
  tabId: string,
  moveItemsToTabId?: string
): Promise<void> {
  const db = await openShelfDb();
  const { tabs, items } = await loadShelfState();
  if (tabs.length <= 1) {
    throw new Error('Mantenha pelo menos uma aba ativa na estante.');
  }

  const remainingTabs = tabs.filter((t) => t.id !== tabId);
  const destinationTabId =
    moveItemsToTabId && remainingTabs.some((t) => t.id === moveItemsToTabId)
      ? moveItemsToTabId
      : undefined;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_TABS, STORE_ITEMS], 'readwrite');
    const tabStore = tx.objectStore(STORE_TABS);
    const itemStore = tx.objectStore(STORE_ITEMS);

    tabStore.delete(tabId);
    remainingTabs.forEach((t, idx) => {
      tabStore.put({ ...t, order: idx });
    });

    const affected = items.filter((item) => item.tabId === tabId);
    for (const item of affected) {
      if (destinationTabId) {
        itemStore.put({
          ...item,
          tabId: destinationTabId,
          updatedAt: new Date().toISOString(),
        });
      } else {
        itemStore.delete(item.id);
      }
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  broadcastShelfUpdate();
}

export interface SaveLinkInput {
  tabId: string;
  title: string;
  url: string;
  faviconUrl?: string;
  coverImage?: string;
  progressLabel?: string;
  status?: ReadingStatus;
  pinned?: boolean;
  notes?: string;
}

export async function createSavedLink(input: SaveLinkInput): Promise<SavedLinkItem> {
  const safeUrl = sanitizeHttpUrl(input.url);
  if (!safeUrl) {
    throw new Error('Informe um endereco http:// ou https:// valido.');
  }

  const domain = extractDomain(safeUrl);
  const cleanTitle = input.title.trim().slice(0, 180) || domain;
  const now = new Date().toISOString();

  const item: SavedLinkItem = {
    id: createId('link'),
    tabId: input.tabId,
    title: cleanTitle,
    url: safeUrl,
    domain,
    faviconUrl: sanitizeCoverSource(input.faviconUrl),
    coverImage: sanitizeCoverSource(input.coverImage),
    progressLabel: input.progressLabel?.trim().slice(0, 40) || undefined,
    status: input.status ?? 'reading',
    pinned: Boolean(input.pinned),
    notes: input.notes?.trim().slice(0, 400) || undefined,
    createdAt: now,
    updatedAt: now,
  };

  const db = await openShelfDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ITEMS, 'readwrite');
    tx.objectStore(STORE_ITEMS).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  broadcastShelfUpdate();
  return item;
}

export async function createManySavedLinks(inputs: SaveLinkInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  const db = await openShelfDb();
  const now = new Date().toISOString();
  const validItems: SavedLinkItem[] = [];

  inputs.forEach((input) => {
    const safeUrl = sanitizeHttpUrl(input.url);
    if (!safeUrl) return;
    const domain = extractDomain(safeUrl);
    validItems.push({
      id: createId('link'),
      tabId: input.tabId,
      title: input.title.trim().slice(0, 180) || domain,
      url: safeUrl,
      domain,
      faviconUrl: sanitizeCoverSource(input.faviconUrl),
      coverImage: sanitizeCoverSource(input.coverImage),
      progressLabel: input.progressLabel?.trim().slice(0, 40) || undefined,
      status: input.status ?? 'reading',
      pinned: Boolean(input.pinned),
      notes: input.notes?.trim().slice(0, 400) || undefined,
      createdAt: now,
      updatedAt: now,
    });
  });

  if (validItems.length === 0) return 0;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ITEMS, 'readwrite');
    const store = tx.objectStore(STORE_ITEMS);
    for (const item of validItems) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  broadcastShelfUpdate();
  return validItems.length;
}

export async function updateSavedLink(
  itemId: string,
  patch: Partial<Omit<SavedLinkItem, 'id' | 'createdAt' | 'domain'>>
): Promise<SavedLinkItem | null> {
  const db = await openShelfDb();
  const { items } = await loadShelfState();
  const existing = items.find((i) => i.id === itemId);
  if (!existing) return null;

  const nextUrl = patch.url !== undefined ? sanitizeHttpUrl(patch.url) : existing.url;
  if (!nextUrl) {
    throw new Error('Endereco http:// ou https:// invalido.');
  }

  const nextTitle =
    patch.title !== undefined
      ? patch.title.trim().slice(0, 180) || extractDomain(nextUrl)
      : existing.title;

  const updated: SavedLinkItem = {
    ...existing,
    ...patch,
    title: nextTitle,
    url: nextUrl,
    domain: extractDomain(nextUrl),
    faviconUrl:
      patch.faviconUrl !== undefined
        ? sanitizeCoverSource(patch.faviconUrl)
        : existing.faviconUrl,
    coverImage:
      patch.coverImage !== undefined
        ? sanitizeCoverSource(patch.coverImage)
        : existing.coverImage,
    progressLabel:
      patch.progressLabel !== undefined
        ? patch.progressLabel.trim().slice(0, 40) || undefined
        : existing.progressLabel,
    notes:
      patch.notes !== undefined
        ? patch.notes.trim().slice(0, 400) || undefined
        : existing.notes,
    updatedAt: new Date().toISOString(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ITEMS, 'readwrite');
    tx.objectStore(STORE_ITEMS).put(updated);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  broadcastShelfUpdate();
  return updated;
}

export async function deleteSavedLink(itemId: string): Promise<void> {
  const db = await openShelfDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ITEMS, 'readwrite');
    tx.objectStore(STORE_ITEMS).delete(itemId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  broadcastShelfUpdate();
}

export async function migrateSavedLinksDomain(
  oldDomainInput: string,
  newDomainInput: string
): Promise<{
  updatedCount: number;
  oldDomain: string;
  newDomain: string;
}> {
  const parsedOld = normalizeDomainHost(oldDomainInput);
  const parsedNew = normalizeDomainHost(newDomainInput);

  if (!parsedOld) {
    throw new Error('Selecione ou informe um dominio antigo valido (ex.: siteantigo.com).');
  }
  if (!parsedNew) {
    throw new Error('Informe o novo dominio valido (ex.: sitenovo.org).');
  }
  if (parsedOld.host === parsedNew.host) {
    throw new Error('O novo dominio precisa ser diferente do dominio atual.');
  }

  const db = await openShelfDb();
  const { items } = await loadShelfState();
  const now = new Date().toISOString();

  const updatedItems: SavedLinkItem[] = [];
  for (const item of items) {
    if (extractDomain(item.url).toLowerCase() !== parsedOld.host) continue;

    const rewrittenUrl = rewriteUrlDomain(
      item.url,
      parsedNew.host,
      parsedNew.protocol
    );
    if (!rewrittenUrl) continue;

    let nextCover = item.coverImage;
    if (
      nextCover &&
      !nextCover.startsWith('data:image/') &&
      extractDomain(nextCover).toLowerCase() === parsedOld.host
    ) {
      nextCover =
        rewriteUrlDomain(nextCover, parsedNew.host, parsedNew.protocol) ??
        nextCover;
    }

    let nextFavicon = item.faviconUrl;
    if (
      nextFavicon &&
      !nextFavicon.startsWith('data:image/') &&
      extractDomain(nextFavicon).toLowerCase() === parsedOld.host
    ) {
      nextFavicon =
        rewriteUrlDomain(nextFavicon, parsedNew.host, parsedNew.protocol) ??
        nextFavicon;
    }

    updatedItems.push({
      ...item,
      url: rewrittenUrl,
      domain: extractDomain(rewrittenUrl),
      coverImage: nextCover,
      faviconUrl: nextFavicon,
      updatedAt: now,
    });
  }

  if (updatedItems.length === 0) {
    return {
      updatedCount: 0,
      oldDomain: parsedOld.host,
      newDomain: parsedNew.host,
    };
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ITEMS, 'readwrite');
    const store = tx.objectStore(STORE_ITEMS);
    for (const updated of updatedItems) {
      store.put(updated);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  broadcastShelfUpdate();
  return {
    updatedCount: updatedItems.length,
    oldDomain: parsedOld.host,
    newDomain: parsedNew.host,
  };
}

export async function exportShelfBackupJson(): Promise<{
  filename: string;
  jsonString: string;
}> {
  const { tabs, items } = await loadShelfState();
  const payload = createBackupPayload(tabs, items);
  const datePart = payload.exportedAt.slice(0, 10);
  return {
    filename: `tomo-backup-${datePart}.json`,
    jsonString: JSON.stringify(payload, null, 2),
  };
}

export async function importShelfBackupJson(
  rawJson: string,
  mode: ImportMode
): Promise<ImportSummary> {
  const validated = parseAndValidateBackupJson(rawJson);
  const current = await loadShelfState();
  const reconciled = reconcileBackupImport(current, validated, mode);

  const db = await openShelfDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_TABS, STORE_ITEMS, STORE_META], 'readwrite');
    const tabStore = tx.objectStore(STORE_TABS);
    const itemStore = tx.objectStore(STORE_ITEMS);
    const metaStore = tx.objectStore(STORE_META);

    tabStore.clear();
    itemStore.clear();

    for (const tab of reconciled.tabs) {
      tabStore.put(tab);
    }
    for (const item of reconciled.items) {
      itemStore.put(item);
    }
    metaStore.put({ key: 'seeded_v1', value: true });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  broadcastShelfUpdate();
  return reconciled.summary;
}
