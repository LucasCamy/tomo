export type TabIconName =
  | 'book-open'
  | 'compass'
  | 'layers'
  | 'tv'
  | 'graduation-cap'
  | 'code'
  | 'shopping-bag'
  | 'folder'
  | 'sparkles'
  | 'bookmark';

export type ReadingStatus = 'reading' | 'up_to_date' | 'paused' | 'completed';

export interface CollectionTab {
  id: string;
  name: string;
  icon: TabIconName;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface SavedLinkItem {
  id: string;
  tabId: string;
  title: string;
  url: string;
  domain: string;
  faviconUrl?: string;
  coverImage?: string;
  progressLabel?: string;
  status: ReadingStatus;
  pinned: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShelfBackupPayload {
  app: 'tomo-extension';
  schemaVersion: 1;
  exportedAt: string;
  tabs: CollectionTab[];
  items: SavedLinkItem[];
}

export type ImportMode = 'merge' | 'replace';

export interface ImportSummary {
  tabsImported: number;
  itemsImported: number;
  itemsUpdated: number;
}

export interface BrowserTabSnapshot {
  chromeTabId?: number;
  title: string;
  url: string;
  domain: string;
  faviconUrl?: string;
  ogImageUrl?: string;
  capturedDataUrl?: string;
  detectedProgress: string;
  cleanTitle: string;
}
