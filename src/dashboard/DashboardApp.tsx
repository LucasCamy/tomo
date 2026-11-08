import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
} from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  Bookmark,
  CircleCheck,
  Clock,
  Download,
  ExternalLink,
  FolderInput,
  FolderPlus,
  Globe,
  Grid2x2,
  HardDrive,
  ImagePlus,
  Keyboard,
  Layers,
  Link2,
  List,
  Moon,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Unlink,
  Upload,
  X,
} from 'lucide-react';
import { LinkCard } from '../components/LinkCard';
import { ModalDialog } from '../components/ModalDialog';
import {
  SelectDropdown,
  type DropdownOption,
} from '../components/SelectDropdown';
import {
  STATUS_OPTIONS,
  StatusIcon,
  TAB_ICON_OPTIONS,
  TabCollectionIcon,
  getNextReadingStatus,
  getReadingStatusLabel,
} from '../components/ShelfIcons';
import { parseAndValidateBackupJson } from '../lib/backup';
import {
  auditAndSyncShelfLinks,
  type ShelfSyncProgress,
  type ShelfSyncSummary,
} from '../lib/shelfSync';
import {
  closeBrowserTabs,
  compressImageBlobToCoverDataUrl,
  enrichOpenTabsWithCovers,
  extractOpenGraphFromTab,
  listOpenBrowserTabs,
  openExternalLink,
} from '../lib/chromeBridge';
import {
  createCollectionTab,
  createManySavedLinks,
  createSavedLink,
  deleteCollectionTab,
  deleteSavedLink,
  exportShelfBackupJson,
  importShelfBackupJson,
  loadShelfState,
  migrateSavedLinksDomain,
  reorderCollectionTab,
  subscribeShelfUpdates,
  updateCollectionTab,
  updateSavedLink,
} from '../lib/db';
import {
  detectProgressFromTab,
  findMatchingSavedItem,
  normalizeDomainHost,
  rewriteUrlDomain,
  sanitizeCoverSource,
  sanitizeHttpUrl,
  stepProgressLabel,
  suggestCleanTitle,
} from '../lib/progress';
import {
  getExtensionShortcuts,
  openChromeShortcutsSettings,
  setPreferredTabId,
  type ExtensionShortcutInfo,
} from '../lib/shortcuts';
import {
  getLinkedBackupStatus,
  isFileSyncSupported,
  pickAndLinkBackupFile,
  pullFromLinkedBackupFile,
  syncToLinkedBackupFile,
  unlinkBackupFile,
  type LinkedBackupStatus,
} from '../lib/fileSync';
import { applyTheme, getInitialTheme, type ThemeMode } from '../lib/theme';
import {
  GITHUB_RELEASES_PAGE,
  checkGitHubReleaseUpdate,
  getCurrentExtensionVersion,
  triggerExtensionReload,
  type UpdateCheckResult,
} from '../lib/updater';
import type {
  BrowserTabSnapshot,
  CollectionTab,
  ImportMode,
  ReadingStatus,
  SavedLinkItem,
  ShelfBackupPayload,
  TabIconName,
} from '../types/shelf';

type SortOption = 'updated' | 'title' | 'created';
type DensityMode = 'gallery' | 'compact';
type SyncModalTab = 'audit' | 'backup' | 'domain' | 'version';

const VIEW_DENSITY_KEY = 'tomo_view_density';

export function DashboardApp() {
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [density, setDensity] = useState<DensityMode>(() => {
    try {
      return localStorage.getItem(VIEW_DENSITY_KEY) === 'compact'
        ? 'compact'
        : 'gallery';
    } catch {
      return 'gallery';
    }
  });

  const [loading, setLoading] = useState(true);
  const [tabs, setTabs] = useState<CollectionTab[]>([]);
  const [items, setItems] = useState<SavedLinkItem[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('ALL');

  // Busca, filtros e ordenacao
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ReadingStatus>('ALL');
  const [sortBy, setSortBy] = useState<SortOption>('updated');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Feedback global discreto
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  // Modal Criar / Editar Link
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SavedLinkItem | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formTabId, setFormTabId] = useState('');
  const [formProgress, setFormProgress] = useState('');
  const [formStatus, setFormStatus] = useState<ReadingStatus>('reading');
  const [formCover, setFormCover] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formPinned, setFormPinned] = useState(false);
  const [formError, setFormError] = useState('');
  const [coverUploading, setCoverUploading] = useState(false);
  const coverFileInputRef = useRef<HTMLInputElement>(null);

  // Modal Atualizar Parada Rapida
  const [quickStopItem, setQuickStopItem] = useState<SavedLinkItem | null>(null);
  const [quickStopUrl, setQuickStopUrl] = useState('');
  const [quickStopProgress, setQuickStopProgress] = useState('');
  const [quickStopOpenTabs, setQuickStopOpenTabs] = useState<BrowserTabSnapshot[]>([]);
  const [quickStopTabToClose, setQuickStopTabToClose] = useState<number | undefined>(
    undefined
  );
  const [quickStopCloseAfter, setQuickStopCloseAfter] = useState(true);
  const [quickStopError, setQuickStopError] = useState('');

  // Modal Criar / Gerenciar Aba
  const [tabModalOpen, setTabModalOpen] = useState(false);
  const [editingTab, setEditingTab] = useState<CollectionTab | null>(null);
  const [tabNameInput, setTabNameInput] = useState('');
  const [tabIconInput, setTabIconInput] = useState<TabIconName>('book-open');
  const [deleteTabMoveTo, setDeleteTabMoveTo] = useState<string>('');
  const [tabFormError, setTabFormError] = useState('');

  // Modal Guardar Abas Abertas em Lote
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [openBrowserTabs, setOpenBrowserTabs] = useState<BrowserTabSnapshot[]>([]);
  const [selectedBrowserUrls, setSelectedBrowserUrls] = useState<Set<string>>(
    new Set()
  );
  const [batchTargetTabId, setBatchTargetTabId] = useState('');
  const [batchSaving, setBatchSaving] = useState(false);

  // Modal Importar Backup JSON
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRawJson, setImportRawJson] = useState('');
  const [importPreview, setImportPreview] = useState<ShelfBackupPayload | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [importError, setImportError] = useState('');

  // Modal Confirmacao de Exclusao de Item
  const [itemPendingDelete, setItemPendingDelete] = useState<SavedLinkItem | null>(
    null
  );

  // Modal Atalhos de Teclado
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [globalShortcuts, setGlobalShortcuts] = useState<ExtensionShortcutInfo[]>(
    []
  );

  // Modal Sincronizacao Local (.json), Migracao de Dominio e Atualizacao (GitHub)
  const extVersion = useMemo(() => getCurrentExtensionVersion(), []);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncModalTab, setSyncModalTab] = useState<SyncModalTab>('backup');
  const [linkedBackup, setLinkedBackup] = useState<LinkedBackupStatus>(() => ({
    supported: isFileSyncSupported(),
    linked: false,
    permission: isFileSyncSupported() ? 'prompt' : 'unsupported',
  }));
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{
    tone: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const [domainOld, setDomainOld] = useState('');
  const [domainNew, setDomainNew] = useState('');
  const [domainBusy, setDomainBusy] = useState(false);
  const [domainFeedback, setDomainFeedback] = useState<{
    tone: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(
    null
  );
  const [updateError, setUpdateError] = useState('');
  // Auditoria e Sincronizacao de Links da Estante
  const [auditScope, setAuditScope] = useState<'current' | 'all'>('current');
  const [auditCheckHealth, setAuditCheckHealth] = useState(true);
  const [auditFillCovers, setAuditFillCovers] = useState(true);
  const [auditForceCovers, setAuditForceCovers] = useState(false);
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditProgress, setAuditProgress] = useState<ShelfSyncProgress | null>(null);
  const [auditSummary, setAuditSummary] = useState<ShelfSyncSummary | null>(null);
  const auditAbortControllerRef = useRef<AbortController | null>(null);
  const prevShelfFingerprintRef = useRef<string | null>(null);

  const refreshShelf = useCallback(async () => {
    const state = await loadShelfState();
    setTabs(state.tabs);
    setItems(state.items);
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshShelf();
    getLinkedBackupStatus().then(setLinkedBackup);
    return subscribeShelfUpdates(() => {
      refreshShelf();
    });
  }, [refreshShelf]);

  const shelfFingerprint = useMemo(() => {
    if (loading) return '';
    const tabSig = tabs
      .map((t) => `${t.id}:${t.order}:${t.updatedAt}`)
      .join('|');
    const itemSig = items
      .map((i) => `${i.id}:${i.tabId}:${i.updatedAt}`)
      .join('|');
    return `${tabSig}##${itemSig}`;
  }, [loading, tabs, items]);

  // Gravacao automatica no arquivo .json vinculado sempre que a estante mudar
  useEffect(() => {
    if (loading || !shelfFingerprint) return;

    if (prevShelfFingerprintRef.current === null) {
      prevShelfFingerprintRef.current = shelfFingerprint;
      return;
    }

    if (prevShelfFingerprintRef.current === shelfFingerprint) {
      return;
    }

    prevShelfFingerprintRef.current = shelfFingerprint;

    if (!linkedBackup.linked || linkedBackup.permission !== 'granted') {
      return;
    }

    const timer = window.setTimeout(() => {
      syncToLinkedBackupFile({ requestPermission: false })
        .then((res) => {
          setLinkedBackup(res.status);
        })
        .catch(() => {
          // mantem estado atual sem interromper uso caso o arquivo esteja bloqueado
        });
    }, 450);

    return () => window.clearTimeout(timer);
  }, [loading, shelfFingerprint, linkedBackup.linked, linkedBackup.permission]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_DENSITY_KEY, density);
    } catch {
      // ignora falha de escrita
    }
  }, [density]);

  // Se a aba selecionada deixar de existir, volta para Todos
  useEffect(() => {
    if (
      activeTabId !== 'ALL' &&
      tabs.length > 0 &&
      !tabs.some((t) => t.id === activeTabId)
    ) {
      setActiveTabId('ALL');
    }
  }, [activeTabId, tabs]);

  const openShortcutsModal = useCallback(async () => {
    const list = await getExtensionShortcuts();
    setGlobalShortcuts(list);
    setShortcutsModalOpen(true);
  }, []);

  const openSyncModal = useCallback(
    async (initialTab?: SyncModalTab) => {
      setSyncFeedback(null);
      setDomainFeedback(null);
      if (initialTab) {
        setSyncModalTab(initialTab);
      } else if (updateResult?.hasUpdate) {
        setSyncModalTab('version');
      }
      const status = await getLinkedBackupStatus();
      setLinkedBackup(status);
      setSyncModalOpen(true);
    },
    [updateResult?.hasUpdate]
  );

  const anyModalOpen =
    itemModalOpen ||
    Boolean(quickStopItem) ||
    tabModalOpen ||
    batchModalOpen ||
    importModalOpen ||
    Boolean(itemPendingDelete) ||
    shortcutsModalOpen ||
    syncModalOpen;

  // Atalhos rapidos de teclado na Estante ('/', 'n', 'g', '0..9', '?')
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (anyModalOpen) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const el = document.activeElement;
      const isTyping =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement;
      if (isTyping) return;

      if (event.key === '/') {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (event.key === '?') {
        event.preventDefault();
        openShortcutsModal();
        return;
      }

      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        const defaultTabId =
          activeTabId !== 'ALL' ? activeTabId : (tabs[0]?.id ?? '');
        setEditingItem(null);
        setFormTitle('');
        setFormUrl('');
        setFormTabId(defaultTabId);
        setFormProgress('');
        setFormStatus('reading');
        setFormCover('');
        setFormNotes('');
        setFormPinned(false);
        setFormError('');
        setItemModalOpen(true);
        return;
      }

      if (event.key === 'g' || event.key === 'G') {
        event.preventDefault();
        const defaultTarget =
          activeTabId !== 'ALL' ? activeTabId : (tabs[0]?.id ?? '');
        setBatchTargetTabId(defaultTarget);
        listOpenBrowserTabs().then((list) => {
          setOpenBrowserTabs(list);
          const unsaved = new Set<string>();
          for (const bt of list) {
            if (!items.some((it) => it.url === bt.url)) {
              unsaved.add(bt.url);
            }
          }
          setSelectedBrowserUrls(unsaved);
          setBatchModalOpen(true);
        });
        return;
      }

      if (event.key === '0') {
        event.preventDefault();
        setActiveTabId('ALL');
        return;
      }

      if (/^[1-9]$/.test(event.key)) {
        const idx = Number.parseInt(event.key, 10) - 1;
        const targetTab = tabs[idx];
        if (targetTab) {
          event.preventDefault();
          setActiveTabId(targetTab.id);
          setPreferredTabId(targetTab.id);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [anyModalOpen, activeTabId, tabs, items, openShortcutsModal]);

  const showBanner = (msg: string) => {
    setBannerMsg(msg);
  };

  const tabNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const tab of tabs) {
      map.set(tab.id, tab.name);
    }
    return map;
  }, [tabs]);

  const countByTabId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.tabId, (counts.get(item.tabId) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const filteredItems = useMemo(() => {
    const normSearch = searchQuery.trim().toLowerCase();

    return items
      .filter((item) => {
        if (activeTabId !== 'ALL' && item.tabId !== activeTabId) return false;
        if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;

        if (normSearch) {
          const tabTitle = tabNameById.get(item.tabId)?.toLowerCase() ?? '';
          const matches =
            item.title.toLowerCase().includes(normSearch) ||
            item.domain.toLowerCase().includes(normSearch) ||
            (item.progressLabel?.toLowerCase().includes(normSearch) ?? false) ||
            (item.notes?.toLowerCase().includes(normSearch) ?? false) ||
            tabTitle.includes(normSearch);
          if (!matches) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (sortBy === 'title') {
          return a.title.localeCompare(b.title, 'pt-BR');
        }
        if (sortBy === 'created') {
          return b.createdAt.localeCompare(a.createdAt);
        }
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [items, activeTabId, statusFilter, searchQuery, sortBy, tabNameById]);

  const activeTabObj = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId]
  );

  const readingCountInView = useMemo(() => {
    const base =
      activeTabId === 'ALL'
        ? items
        : items.filter((item) => item.tabId === activeTabId);
    return base.filter((i) => i.status === 'reading').length;
  }, [items, activeTabId]);

  const sortOptions = useMemo<DropdownOption<SortOption>[]>(
    () => [
      {
        value: 'updated',
        label: 'Atualizados por ultimo',
        icon: <Clock size={15} />,
      },
      {
        value: 'title',
        label: 'Ordem alfabetica (A-Z)',
        icon: <ArrowDownAZ size={15} />,
      },
      {
        value: 'created',
        label: 'Adicionados recentemente',
        icon: <Sparkles size={15} />,
      },
    ],
    []
  );

  const tabDropdownOptions = useMemo<DropdownOption<string>[]>(
    () =>
      tabs.map((tab) => ({
        value: tab.id,
        label: tab.name,
        icon: <TabCollectionIcon name={tab.icon} size={15} />,
      })),
    [tabs]
  );

  const statusDropdownOptions = useMemo<DropdownOption<ReadingStatus>[]>(
    () =>
      STATUS_OPTIONS.map((opt) => ({
        value: opt.value,
        label: opt.label,
        tone: opt.tone,
        icon: <StatusIcon status={opt.value} size={15} />,
      })),
    []
  );

  const deleteTabMoveOptions = useMemo<DropdownOption<string>[]>(() => {
    if (!editingTab) return [];
    const moveTargets = tabs
      .filter((t) => t.id !== editingTab.id)
      .map((t) => ({
        value: t.id,
        label: `Mover links para "${t.name}"`,
        icon: <TabCollectionIcon name={t.icon} size={15} />,
      }));
    return [
      ...moveTargets,
      {
        value: '__DELETE__',
        label: 'Apagar tambem todos os links desta aba',
        tone: 'destructive',
        icon: <Trash2 size={15} />,
      },
    ];
  }, [tabs, editingTab]);

  const savedDomainStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const parsed = normalizeDomainHost(item.domain);
      const host = parsed ? parsed.host : item.domain.toLowerCase();
      if (!host) continue;
      counts.set(host, (counts.get(host) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
  }, [items]);

  const savedDomainOptions = useMemo<DropdownOption<string>[]>(
    () =>
      savedDomainStats.map((entry) => ({
        value: entry.domain,
        label: `${entry.domain} (${entry.count} ${
          entry.count === 1 ? 'link' : 'links'
        })`,
        icon: <Globe size={15} />,
      })),
    [savedDomainStats]
  );

  useEffect(() => {
    if (savedDomainStats.length === 0) {
      if (domainOld) setDomainOld('');
      return;
    }
    if (!domainOld || !savedDomainStats.some((s) => s.domain === domainOld)) {
      setDomainOld(savedDomainStats[0].domain);
    }
  }, [savedDomainStats, domainOld]);

  const domainMigrationPreview = useMemo(() => {
    if (!domainOld) return null;
    const matching = items.filter((it) => {
      const parsed = normalizeDomainHost(it.domain);
      const host = parsed ? parsed.host : it.domain.toLowerCase();
      return host === domainOld;
    });
    if (matching.length === 0) return null;
    const parsedNew = normalizeDomainHost(domainNew);
    const sample = matching[0];
    const sampleAfter =
      parsedNew && parsedNew.host !== domainOld
        ? rewriteUrlDomain(sample.url, parsedNew.host, parsedNew.protocol)
        : null;
    return {
      count: matching.length,
      sampleBefore: sample.url,
      sampleAfter,
      parsedNew,
    };
  }, [items, domainOld, domainNew]);

  const handleCoverBlobSelected = async (blob: Blob | undefined | null) => {
    if (!blob || !blob.type.startsWith('image/')) return;
    setCoverUploading(true);
    setFormError('');
    try {
      const webpDataUrl = await compressImageBlobToCoverDataUrl(blob);
      if (!webpDataUrl) {
        setFormError('Nao foi possivel processar a imagem selecionada.');
        return;
      }
      setFormCover(webpDataUrl);
    } catch {
      setFormError('Falha ao comprimir a imagem de capa.');
    } finally {
      setCoverUploading(false);
    }
  };

  const handleModalImagePaste = (event: ClipboardEvent<HTMLElement>) => {
    const clipboardItems = event.clipboardData?.items;
    if (!clipboardItems) return;
    for (const clipItem of clipboardItems) {
      if (clipItem.kind === 'file' && clipItem.type.startsWith('image/')) {
        const file = clipItem.getAsFile();
        if (file) {
          event.preventDefault();
          void handleCoverBlobSelected(file);
          return;
        }
      }
    }
  };

  // Abertura de modais
  const openCreateItemModal = () => {
    const defaultTabId =
      activeTabId !== 'ALL' ? activeTabId : (tabs[0]?.id ?? '');
    setEditingItem(null);
    setFormTitle('');
    setFormUrl('');
    setFormTabId(defaultTabId);
    setFormProgress('');
    setFormStatus('reading');
    setFormCover('');
    setFormNotes('');
    setFormPinned(false);
    setFormError('');
    setItemModalOpen(true);
  };

  const openEditItemModal = (item: SavedLinkItem) => {
    setEditingItem(item);
    setFormTitle(item.title);
    setFormUrl(item.url);
    setFormTabId(item.tabId);
    setFormProgress(item.progressLabel ?? '');
    setFormStatus(item.status);
    setFormCover(item.coverImage ?? '');
    setFormNotes(item.notes ?? '');
    setFormPinned(item.pinned);
    setFormError('');
    setItemModalOpen(true);
  };

  const handleSaveItemForm = async () => {
    setFormError('');
    const safeUrl = sanitizeHttpUrl(formUrl);
    if (!safeUrl) {
      setFormError('Informe um endereco http:// ou https:// valido.');
      return;
    }
    if (!formTabId) {
      setFormError('Selecione uma aba para guardar este link.');
      return;
    }

    try {
      if (editingItem) {
        await updateSavedLink(editingItem.id, {
          title: formTitle.trim() || safeUrl,
          url: safeUrl,
          tabId: formTabId,
          progressLabel: formProgress,
          status: formStatus,
          coverImage: formCover,
          notes: formNotes,
          pinned: formPinned,
        });
        showBanner(`Alteracoes salvas em "${formTitle.trim() || editingItem.title}".`);
      } else {
        const created = await createSavedLink({
          title: formTitle.trim() || suggestCleanTitle(safeUrl),
          url: safeUrl,
          tabId: formTabId,
          progressLabel: formProgress,
          status: formStatus,
          coverImage: formCover || undefined,
          notes: formNotes,
          pinned: formPinned,
        });
        showBanner(`"${created.title}" adicionado a estante.`);
      }
      setItemModalOpen(false);
      await refreshShelf();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Falha ao salvar link.');
    }
  };

  // Atualizar parada rapida
  const openQuickStopModal = async (item: SavedLinkItem) => {
    setQuickStopItem(item);
    setQuickStopUrl(item.url);
    setQuickStopProgress(item.progressLabel ?? '');
    setQuickStopTabToClose(undefined);
    setQuickStopCloseAfter(true);
    setQuickStopError('');

    const browserTabs = await listOpenBrowserTabs();
    setQuickStopOpenTabs(browserTabs);

    // Se houver uma aba aberta da mesma serie/obra, ja pre-seleciona para facilitar!
    const matchingOpen = browserTabs.find(
      (bt) => findMatchingSavedItem(bt, [item])?.id === item.id && bt.url !== item.url
    );
    if (matchingOpen) {
      setQuickStopUrl(matchingOpen.url);
      if (matchingOpen.detectedProgress) {
        setQuickStopProgress(matchingOpen.detectedProgress);
      }
      setQuickStopTabToClose(matchingOpen.chromeTabId);
    }
  };

  const handleConfirmQuickStop = async () => {
    if (!quickStopItem) return;
    setQuickStopError('');
    const safeUrl = sanitizeHttpUrl(quickStopUrl);
    if (!safeUrl) {
      setQuickStopError('Informe um endereco http:// ou https:// valido.');
      return;
    }

    try {
      let recoveredCover: string | undefined;
      const matchedTab = quickStopOpenTabs.find((bt) => bt.url === safeUrl);
      if (!quickStopItem.coverImage && matchedTab?.chromeTabId !== undefined) {
        try {
          const meta = await extractOpenGraphFromTab(matchedTab.chromeTabId);
          recoveredCover = sanitizeCoverSource(meta.ogImage);
        } catch {
          // fallback sem interrupcao
        }
      }

      await updateSavedLink(quickStopItem.id, {
        url: safeUrl,
        progressLabel: quickStopProgress,
        coverImage: recoveredCover ?? quickStopItem.coverImage,
      });

      if (quickStopCloseAfter && quickStopTabToClose !== undefined) {
        await closeBrowserTabs([quickStopTabToClose]);
      }

      setQuickStopItem(null);
      await refreshShelf();
      showBanner(
        `Parada de "${quickStopItem.title}" atualizada${
          quickStopProgress.trim() ? ` para ${quickStopProgress.trim()}` : ''
        }.`
      );
    } catch (err) {
      setQuickStopError(
        err instanceof Error ? err.message : 'Nao foi possivel atualizar.'
      );
    }
  };

  // Passo rapido -1 / +1 direto no card
  const handleStepCardProgress = async (item: SavedLinkItem, delta: number) => {
    const nextProgress = stepProgressLabel(item.progressLabel, delta);
    await updateSavedLink(item.id, { progressLabel: nextProgress });
    await refreshShelf();
  };

  // Alternar status em 1 clique direto no card
  const handleCycleCardStatus = async (item: SavedLinkItem) => {
    const nextStatus = getNextReadingStatus(item.status);
    await updateSavedLink(item.id, { status: nextStatus });
    await refreshShelf();
    showBanner(
      `Status de "${item.title}" alterado para ${getReadingStatusLabel(nextStatus)}.`
    );
  };

  const handleTogglePin = async (item: SavedLinkItem) => {
    await updateSavedLink(item.id, { pinned: !item.pinned });
    await refreshShelf();
  };

  const handleConfirmDeleteItem = async () => {
    if (!itemPendingDelete) return;
    const removedTitle = itemPendingDelete.title;
    await deleteSavedLink(itemPendingDelete.id);
    setItemPendingDelete(null);
    await refreshShelf();
    showBanner(`"${removedTitle}" removido da estante.`);
  };

  // Gestao de Abas
  const openCreateTabModal = () => {
    setEditingTab(null);
    setTabNameInput('');
    setTabIconInput('book-open');
    setTabFormError('');
    setTabModalOpen(true);
  };

  const openManageTabModal = (tab: CollectionTab) => {
    setEditingTab(tab);
    setTabNameInput(tab.name);
    setTabIconInput(tab.icon);
    const fallbackTarget = tabs.find((t) => t.id !== tab.id)?.id ?? '';
    setDeleteTabMoveTo(fallbackTarget);
    setTabFormError('');
    setTabModalOpen(true);
  };

  const handleSaveTabModal = async () => {
    setTabFormError('');
    const trimmed = tabNameInput.trim();
    if (!trimmed) {
      setTabFormError('Informe um nome para a aba.');
      return;
    }

    try {
      if (editingTab) {
        await updateCollectionTab(editingTab.id, {
          name: trimmed,
          icon: tabIconInput,
        });
        showBanner(`Aba "${trimmed}" atualizada.`);
      } else {
        const created = await createCollectionTab({
          name: trimmed,
          icon: tabIconInput,
        });
        setActiveTabId(created.id);
        showBanner(`Aba "${created.name}" criada.`);
      }
      setTabModalOpen(false);
      await refreshShelf();
    } catch (err) {
      setTabFormError(err instanceof Error ? err.message : 'Erro ao salvar aba.');
    }
  };

  const handleMoveTabOrder = async (direction: 'up' | 'down') => {
    if (!editingTab) return;
    await reorderCollectionTab(editingTab.id, direction);
    await refreshShelf();
  };

  const handleDeleteTab = async () => {
    if (!editingTab) return;
    setTabFormError('');
    try {
      const targetTabId = deleteTabMoveTo === '__DELETE__' ? undefined : deleteTabMoveTo;
      await deleteCollectionTab(editingTab.id, targetTabId);
      setTabModalOpen(false);
      await refreshShelf();
      showBanner(`Aba "${editingTab.name}" removida.`);
    } catch (err) {
      setTabFormError(err instanceof Error ? err.message : 'Erro ao remover aba.');
    }
  };

  // Guardar abas abertas em lote
  const openBatchTabsModal = async () => {
    const defaultTarget =
      activeTabId !== 'ALL' ? activeTabId : (tabs[0]?.id ?? '');
    setBatchTargetTabId(defaultTarget);
    const list = await listOpenBrowserTabs();
    setOpenBrowserTabs(list);

    const unsavedUrls = new Set<string>();
    for (const bt of list) {
      const alreadySaved = items.some((it) => it.url === bt.url);
      if (!alreadySaved) {
        unsavedUrls.add(bt.url);
      }
    }
    setSelectedBrowserUrls(unsavedUrls);
    setBatchModalOpen(true);

    // Enriquece em segundo plano com capas detectadas enquanto o usuario revisa
    enrichOpenTabsWithCovers(list).then((enriched) => {
      setOpenBrowserTabs((current) =>
        current.map((curr) => {
          const match = enriched.find((e) => e.url === curr.url);
          return match?.ogImageUrl ? { ...curr, ogImageUrl: match.ogImageUrl } : curr;
        })
      );
    });
  };

  const handleSaveSelectedBrowserTabs = async (closeAfter: boolean) => {
    if (!batchTargetTabId || selectedBrowserUrls.size === 0 || batchSaving) return;

    setBatchSaving(true);
    try {
      const chosen = openBrowserTabs.filter((bt) => selectedBrowserUrls.has(bt.url));
      // Garante deteccao e compressao completa de capa para todas as abas selecionadas
      const enrichedChosen = await enrichOpenTabsWithCovers(chosen);

      const count = await createManySavedLinks(
        enrichedChosen.map((bt) => ({
          tabId: batchTargetTabId,
          title: bt.cleanTitle || bt.title,
          url: bt.url,
          faviconUrl: bt.faviconUrl,
          coverImage: bt.ogImageUrl || bt.capturedDataUrl || undefined,
          progressLabel: bt.detectedProgress || undefined,
          status: 'reading',
        }))
      );

      if (closeAfter) {
        const ids = chosen
          .map((bt) => bt.chromeTabId)
          .filter((id): id is number => id !== undefined);
        await closeBrowserTabs(ids);
      }

      setBatchModalOpen(false);
      await refreshShelf();
      showBanner(
        `${count} ${count === 1 ? 'aba guardada' : 'abas guardadas'} na estante com capa.`
      );
    } catch {
      showBanner('Nao foi possivel guardar as abas selecionadas.');
    } finally {
      setBatchSaving(false);
    }
  };

  // Exportar e Importar Backup JSON
  const handleExportBackup = async () => {
    const { filename, jsonString } = await exportShelfBackupJson();
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);

    showBanner(`Backup "${filename}" exportado para o seu computador.`);
  };

  const openImportBackupModal = () => {
    setImportRawJson('');
    setImportPreview(null);
    setImportMode('merge');
    setImportError('');
    setImportModalOpen(true);
  };

  const handleImportFileChosen = async (file: File | undefined) => {
    setImportError('');
    setImportPreview(null);
    setImportRawJson('');
    if (!file) return;

    try {
      const text = await file.text();
      const validated = parseAndValidateBackupJson(text);
      setImportRawJson(text);
      setImportPreview(validated);
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Arquivo de backup invalido.'
      );
    }
  };

  const handleConfirmImport = async () => {
    if (!importRawJson) {
      setImportError('Selecione um arquivo .json de backup antes de importar.');
      return;
    }

    try {
      const summary = await importShelfBackupJson(importRawJson, importMode);
      setImportModalOpen(false);
      await refreshShelf();
      showBanner(
        importMode === 'replace'
          ? `Estante restaurada com ${summary.tabsImported} abas e ${summary.itemsImported} links.`
          : `Importacao concluida: ${summary.itemsImported} novos links, ${summary.itemsUpdated} atualizados.`
      );
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Erro ao importar backup.');
    }
  };

  // Sincronizacao local automatica (.json fixo) e verificacao de versao (GitHub)
  const formatSyncTimestamp = (iso?: string): string => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handlePickBackupFile = async () => {
    setSyncBusy(true);
    setSyncFeedback(null);
    try {
      const status = await pickAndLinkBackupFile();
      if (!status) return;
      setLinkedBackup(status);
      setSyncFeedback({
        tone: 'success',
        message: `Arquivo "${status.fileName}" vinculado e atualizado automaticamente.`,
      });
      showBanner(
        `Backup automatico ativado em "${status.fileName}".`
      );
    } catch (err) {
      setSyncFeedback({
        tone: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Nao foi possivel vincular o arquivo local.',
      });
    } finally {
      setSyncBusy(false);
    }
  };

  const handleManualSyncToLinkedFile = async (fromSidebar = false) => {
    setSyncBusy(true);
    setSyncFeedback(null);
    try {
      const result = await syncToLinkedBackupFile({ requestPermission: true });
      setLinkedBackup(result.status);
      if (result.synced) {
        const msg = `Backup atualizado em "${result.status.fileName ?? 'arquivo local'}".`;
        if (fromSidebar) {
          showBanner(msg);
        } else {
          setSyncFeedback({ tone: 'success', message: msg });
        }
      } else if (result.needsPermission) {
        const warnMsg =
          'Permissao de gravacao nao concedida. Autorize o acesso ao arquivo para ativar.';
        if (fromSidebar) {
          setSyncModalOpen(true);
        }
        setSyncFeedback({ tone: 'warning', message: warnMsg });
      }
    } catch (err) {
      const errMsg =
        err instanceof Error
          ? err.message
          : 'Falha ao gravar no arquivo vinculado.';
      if (fromSidebar) {
        setSyncModalOpen(true);
      }
      setSyncFeedback({ tone: 'error', message: errMsg });
    } finally {
      setSyncBusy(false);
    }
  };

  const handlePullFromLinkedFile = async () => {
    setSyncBusy(true);
    setSyncFeedback(null);
    try {
      const summary = await pullFromLinkedBackupFile('merge');
      await refreshShelf();
      const msg = `Leitura concluida: ${summary.itemsImported} novos links, ${summary.itemsUpdated} verificados/atualizados.`;
      setSyncFeedback({ tone: 'success', message: msg });
      showBanner(msg);
    } catch (err) {
      setSyncFeedback({
        tone: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Nao foi possivel ler o arquivo vinculado.',
      });
    } finally {
      setSyncBusy(false);
    }
  };

  const handleUnlinkBackupFile = async () => {
    setSyncBusy(true);
    setSyncFeedback(null);
    try {
      await unlinkBackupFile();
      const fresh = await getLinkedBackupStatus();
      setLinkedBackup(fresh);
      setSyncFeedback({
        tone: 'warning',
        message: 'Vinculo automatico removido. Seus links continuam salvos nesta maquina.',
      });
    } finally {
      setSyncBusy(false);
    }
  };

  const handleMigrateDomain = async () => {
    setDomainBusy(true);
    setDomainFeedback(null);
    try {
      const result = await migrateSavedLinksDomain(domainOld, domainNew);
      await refreshShelf();
      setDomainOld(result.newDomain);
      setDomainNew('');
      if (result.updatedCount === 0) {
        setDomainFeedback({
          tone: 'warning',
          message: `Nenhum link do dominio "${result.oldDomain}" precisou ser alterado.`,
        });
      } else {
        const msg = `${result.updatedCount} ${
          result.updatedCount === 1 ? 'link migrado' : 'links migrados'
        } de ${result.oldDomain} para ${result.newDomain}.`;
        setDomainFeedback({ tone: 'success', message: msg });
        showBanner(msg);
      }
    } catch (err) {
      setDomainFeedback({
        tone: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Nao foi possivel migrar o dominio.',
      });
    } finally {
      setDomainBusy(false);
    }
  };

  const handleCheckUpdate = async () => {
    setUpdateChecking(true);
    setUpdateError('');
    try {
      const result = await checkGitHubReleaseUpdate();
      setUpdateResult(result);
    } catch (err) {
      setUpdateError(
        err instanceof Error
          ? err.message
          : 'Falha ao consultar versoes no GitHub.'
      );
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleReloadExtension = async () => {
    await triggerExtensionReload();
  };

  const handleStartShelfSync = async () => {
    if (auditRunning) return;

    const targetItems =
      auditScope === 'current' && activeTabId !== 'ALL'
        ? items.filter((it) => it.tabId === activeTabId)
        : items;

    if (targetItems.length === 0) {
      showBanner('Nenhum link encontrado para sincronizar.');
      return;
    }

    const controller = new AbortController();
    auditAbortControllerRef.current = controller;
    setAuditRunning(true);
    setAuditProgress(null);
    setAuditSummary(null);

    try {
      const summary = await auditAndSyncShelfLinks(targetItems, {
        checkHealth: auditCheckHealth,
        fillMissingCovers: auditFillCovers,
        forceCovers: auditForceCovers,
        signal: controller.signal,
        onProgress: (prog) => {
          setAuditProgress(prog);
        },
      });

      setAuditSummary(summary);
      await refreshShelf();
      if (!summary.aborted) {
        showBanner(
          `Sincronizacao concluida: ${summary.online} ativos${
            summary.coversUpdated > 0 ? `, ${summary.coversUpdated} capas salvas` : ''
          }${summary.offline > 0 ? `, ${summary.offline} inativos` : ''}.`
        );
      } else {
        showBanner('Sincronizacao interrompida.');
      }
    } catch {
      showBanner('Nao foi possivel concluir a sincronizacao dos links.');
    } finally {
      setAuditRunning(false);
      auditAbortControllerRef.current = null;
    }
  };

  const handleCancelShelfSync = () => {
    if (auditAbortControllerRef.current) {
      auditAbortControllerRef.current.abort();
    }
  };

  const syncAttentionDot =
    updateResult?.hasUpdate
      ? 'action'
      : linkedBackup.linked && linkedBackup.permission !== 'granted'
        ? 'warning'
        : linkedBackup.linked && linkedBackup.permission === 'granted'
          ? 'success'
          : null;

  return (
    <div className="shelf-shell">
      {/* Barra superior e trilho de abas para telas estreitas (< 1024px) */}
      <header className="mobile-top-bar">
        <div className="brand-mark">
          <span className="brand-icon" aria-hidden="true">
            <Bookmark size={18} />
          </span>
          <div>
            <p className="brand-title">Tomo</p>
            <p className="brand-subtitle font-data">
              {items.length} links · {tabs.length} abas
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={() => openSyncModal()}
            aria-label="Sincronizar backup, migrar dominio e verificar atualizacao"
            title="Sincronizar backup, dominio e versao"
          >
            <RefreshCw size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={openShortcutsModal}
            aria-label="Ver atalhos de teclado"
            title="Atalhos de teclado (?)"
          >
            <Keyboard size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label={
              theme === 'dark' ? 'Alternar para tema claro' : 'Alternar para tema escuro'
            }
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <nav className="mobile-tabs-rail no-scrollbar" aria-label="Abas da estante">
        <button
          type="button"
          className={`nav-tab ${activeTabId === 'ALL' ? 'is-active' : ''}`}
          aria-current={activeTabId === 'ALL' ? 'page' : undefined}
          onClick={() => setActiveTabId('ALL')}
        >
          <Layers size={16} className="nav-tab-icon" aria-hidden="true" />
          <span>Todos</span>
          <span className="tab-count">{items.length}</span>
        </button>

        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`nav-tab ${activeTabId === tab.id ? 'is-active' : ''}`}
            aria-current={activeTabId === tab.id ? 'page' : undefined}
            onClick={() => setActiveTabId(tab.id)}
          >
            <TabCollectionIcon name={tab.icon} size={16} className="nav-tab-icon" />
            <span>{tab.name}</span>
            <span className="tab-count">{countByTabId.get(tab.id) ?? 0}</span>
          </button>
        ))}
      </nav>

      {/* Sidebar Desktop (>= 1024px) */}
      <aside className="shelf-sidebar" aria-label="Navegacao e backup local">
        <div className="sidebar-top-fixed">
          <div className="brand-row">
            <div className="brand-mark">
              <span className="brand-icon" aria-hidden="true">
                <Bookmark size={18} />
              </span>
              <div>
                <p className="brand-title">Tomo</p>
                <p className="brand-subtitle">Estante visual de links</p>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-secondary btn-icon btn-sm"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              aria-label={
                theme === 'dark' ? 'Alternar para tema claro' : 'Alternar para tema escuro'
              }
              title={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>

          <div>
            <div className="sidebar-section-label">
              <span>Visao geral</span>
            </div>
            <div className="sidebar-tabs-list">
              <div
                className={`sidebar-tab-capsule ${
                  activeTabId === 'ALL' ? 'is-active' : ''
                }`}
              >
                <button
                  type="button"
                  className="sidebar-tab-trigger"
                  aria-current={activeTabId === 'ALL' ? 'page' : undefined}
                  onClick={() => setActiveTabId('ALL')}
                >
                  <span className="nav-tab-main">
                    <Layers size={17} className="nav-tab-icon" aria-hidden="true" />
                    <span>Todos os links</span>
                  </span>
                  <span className="tab-count">{items.length}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="sidebar-tabs-section">
          <div className="sidebar-section-label">
            <span>Suas abas</span>
            <button
              type="button"
              className="btn-sidebar-add"
              onClick={openCreateTabModal}
            >
              <Plus size={13} aria-hidden="true" />
              <span>Nova aba</span>
            </button>
          </div>

          <div className="sidebar-tabs-scroll">
            {tabs.map((tab) => {
              const isActive = activeTabId === tab.id;
              return (
                <div
                  key={tab.id}
                  className={`sidebar-tab-capsule ${isActive ? 'is-active' : ''}`}
                >
                  <button
                    type="button"
                    className="sidebar-tab-trigger"
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => setActiveTabId(tab.id)}
                  >
                    <span className="nav-tab-main">
                      <TabCollectionIcon
                        name={tab.icon}
                        size={17}
                        className="nav-tab-icon"
                      />
                      <span>{tab.name}</span>
                    </span>
                    <span className="tab-count">{countByTabId.get(tab.id) ?? 0}</span>
                  </button>

                  <button
                    type="button"
                    className="sidebar-tab-config-btn"
                    onClick={() => openManageTabModal(tab)}
                    aria-label={`Configurar aba ${tab.name}`}
                    title={`Editar aba ${tab.name}`}
                  >
                    <Settings2 size={15} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="local-status-box">
            <div className="local-status-header">
              <strong>Salvo nesta maquina</strong>
              <span className="version-pill font-data">v{extVersion}</span>
            </div>
            <span className="font-data">
              {items.length} {items.length === 1 ? 'link salvo' : 'links salvos'} em{' '}
              {tabs.length} {tabs.length === 1 ? 'aba' : 'abas'}
            </span>
            {linkedBackup.linked ? (
              <div
                className={`local-sync-indicator ${
                  linkedBackup.permission === 'granted'
                    ? 'local-sync-indicator--active'
                    : 'local-sync-indicator--pending'
                }`}
              >
                {linkedBackup.permission === 'granted' ? (
                  <CircleCheck size={13} aria-hidden="true" />
                ) : (
                  <AlertCircle size={13} aria-hidden="true" />
                )}
                <span className="font-data">
                  {linkedBackup.permission === 'granted'
                    ? `Auto: ${linkedBackup.fileName}`
                    : `Reativar: ${linkedBackup.fileName}`}
                </span>
              </div>
            ) : null}
          </div>

          {linkedBackup.linked ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={syncBusy}
              onClick={() => handleManualSyncToLinkedFile(true)}
              title="Gravar estante agora no arquivo .json vinculado"
            >
              <RefreshCw
                size={15}
                className={syncBusy ? 'is-spinning' : undefined}
                aria-hidden="true"
              />
              <span>
                {linkedBackup.permission === 'granted'
                  ? 'Gravar no backup agora'
                  : 'Reativar backup automatico'}
              </span>
            </button>
          ) : null}

          <button
            type="button"
            className="btn btn-surface"
            onClick={() => openSyncModal()}
          >
            <RefreshCw size={15} aria-hidden="true" />
            <span>Sincronizar e Atualizar</span>
            {syncAttentionDot ? (
              <span
                className={`btn-status-dot btn-status-dot--${syncAttentionDot}`}
                aria-hidden="true"
              />
            ) : null}
          </button>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExportBackup}
            >
              <Download size={15} aria-hidden="true" />
              <span>Exportar</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={openImportBackupModal}
            >
              <Upload size={15} aria-hidden="true" />
              <span>Importar</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Area Principal da Estante */}
      <main className="shelf-main">
        <div className="shelf-top-sticky">
          {bannerMsg ? (
            <div className="feedback-banner feedback-banner--success" role="status">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <CircleCheck size={17} aria-hidden="true" />
                <span>{bannerMsg}</span>
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setBannerMsg(null)}
                aria-label="Fechar aviso"
              >
                <X size={15} />
              </button>
            </div>
          ) : null}

          <div className="shelf-header">
            <div className="shelf-heading">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1>{activeTabObj ? activeTabObj.name : 'Todos os links'}</h1>
                {activeTabObj ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-icon btn-sm"
                    onClick={() => openManageTabModal(activeTabObj)}
                    aria-label={`Editar aba ${activeTabObj.name}`}
                    title="Renomear ou organizar esta aba"
                  >
                    <Settings2 size={16} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <p className="shelf-meta-summary font-data">
                {filteredItems.length}{' '}
                {filteredItems.length === 1 ? 'item exibido' : 'itens exibidos'} ·{' '}
                {readingCountInView} em leitura ativa
              </p>
            </div>

            <div className="shelf-header-actions">
              <button
                type="button"
                className="btn btn-surface"
                onClick={() => openSyncModal()}
                title="Sincronizar arquivo local .json, trocar dominio em massa e verificar versao"
              >
                <RefreshCw size={16} aria-hidden="true" />
                <span>Atualizar</span>
                {syncAttentionDot ? (
                  <span
                    className={`btn-status-dot btn-status-dot--${syncAttentionDot}`}
                    aria-hidden="true"
                  />
                ) : null}
              </button>

              <button
                type="button"
                className="btn btn-surface"
                onClick={openShortcutsModal}
                title="Abrir guia de atalhos (tecla ?)"
              >
                <Keyboard size={16} aria-hidden="true" />
                <span>Atalhos</span>
                <kbd className="kbd-badge">?</kbd>
              </button>

              <button
                type="button"
                className="btn btn-surface"
                onClick={() => openSyncModal('audit')}
                title="Auditar se os dominios estao ativos e recuperar capas faltantes"
              >
                <ShieldCheck size={16} aria-hidden="true" />
                <span>Sincronizar</span>
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={openBatchTabsModal}
                title="Tecla G"
              >
                <FolderInput size={16} aria-hidden="true" />
                <span>Guardar abas abertas</span>
              </button>

              <button
                type="button"
                className="btn btn-primary"
                onClick={openCreateItemModal}
                title="Tecla N"
              >
                <Plus size={17} aria-hidden="true" />
                <span>Novo link</span>
              </button>
            </div>
          </div>

          {/* Barra de busca, filtros de status, ordenacao e densidade */}
          <section className="shelf-toolbar" aria-label="Busca e filtros">
            <div className="search-field-wrap">
              <Search size={16} className="search-field-icon" aria-hidden="true" />
              <input
                id="shelf-search-input"
                name="shelfSearch"
                ref={searchInputRef}
                type="search"
                className="search-input"
                placeholder="Buscar obra, site, capitulo ou nota... (/)"
                aria-label="Buscar links na estante"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchQuery('')}
                  aria-label="Limpar busca"
                >
                  <X size={15} />
                </button>
              ) : null}
            </div>

            <div className="toolbar-filters">
              <div
                className="segmented-group is-scrollable no-scrollbar"
                role="group"
                aria-label="Filtrar por status"
              >
                <div className="filter-rail">
                  <button
                    type="button"
                    className={`filter-chip ${statusFilter === 'ALL' ? 'is-active' : ''}`}
                    aria-pressed={statusFilter === 'ALL'}
                    onClick={() => setStatusFilter('ALL')}
                  >
                    Todos
                  </button>
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`filter-chip ${
                        statusFilter === opt.value ? 'is-active' : ''
                      }`}
                      aria-pressed={statusFilter === opt.value}
                      onClick={() => setStatusFilter(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <SelectDropdown
                id="shelf-sort-select"
                ariaLabel="Ordenar links"
                size="compact"
                align="right"
                fullWidth={false}
                value={sortBy}
                options={sortOptions}
                onChange={setSortBy}
              />

              <div
                className="segmented-group"
                role="group"
                aria-label="Modo de exibicao"
              >
                <button
                  type="button"
                  className={`filter-chip filter-chip--icon ${
                    density === 'gallery' ? 'is-active' : ''
                  }`}
                  aria-pressed={density === 'gallery'}
                  aria-label="Visualizacao em galeria de capas"
                  title="Galeria de capas"
                  onClick={() => setDensity('gallery')}
                >
                  <Grid2x2 size={16} />
                </button>
                <button
                  type="button"
                  className={`filter-chip filter-chip--icon ${
                    density === 'compact' ? 'is-active' : ''
                  }`}
                  aria-pressed={density === 'compact'}
                  aria-label="Visualizacao compacta"
                  title="Modo compacto"
                  onClick={() => setDensity('compact')}
                >
                  <List size={16} />
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Conteudo / Estados */}
        <div className="shelf-content">
          {loading ? (
            <div className="empty-state" role="status">
              <p>Carregando sua estante local...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <section className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">
                <Bookmark size={24} />
              </div>
              {items.length === 0 ? (
                <>
                  <h2>Sua estante esta pronta para receber seus links</h2>
                  <p>
                    Salve seus mangas, leituras ou referencias pelo icone do Tomo na barra
                    do Chrome, guarde todas as abas abertas de uma vez ou importe um
                    backup JSON.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 6 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={openCreateItemModal}
                    >
                      <Plus size={16} aria-hidden="true" />
                      <span>Adicionar primeiro link</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={openBatchTabsModal}
                    >
                      <FolderInput size={16} aria-hidden="true" />
                      <span>Guardar abas abertas</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={openImportBackupModal}
                    >
                      <Upload size={16} aria-hidden="true" />
                      <span>Importar JSON</span>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2>Nenhum link encontrado para este filtro</h2>
                  <p>
                    Tente limpar o termo de busca, alternar o filtro de status ou escolher
                    outra aba da estante.
                  </p>
                  <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                    {(searchQuery || statusFilter !== 'ALL') ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          setSearchQuery('');
                          setStatusFilter('ALL');
                        }}
                      >
                        Limpar filtros
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={openCreateItemModal}
                    >
                      <Plus size={16} aria-hidden="true" />
                      <span>Novo link nesta aba</span>
                    </button>
                  </div>
                </>
              )}
            </section>
          ) : (
            <section
              className={`cards-grid ${density === 'compact' ? 'is-compact' : ''}`}
              aria-label="Links salvos"
            >
              {filteredItems.map((item) => (
                <LinkCard
                  key={item.id}
                  item={item}
                  tabName={tabNameById.get(item.tabId)}
                  showTabBadge={activeTabId === 'ALL'}
                  onOpenLink={(it) => openExternalLink(it.url)}
                  onStepProgress={handleStepCardProgress}
                  onCycleStatus={handleCycleCardStatus}
                  onTogglePin={handleTogglePin}
                  onQuickUpdateStop={openQuickStopModal}
                  onEdit={openEditItemModal}
                  onDelete={(it) => setItemPendingDelete(it)}
                />
              ))}
            </section>
          )}
        </div>
      </main>

      {/* Barra Inferior Mobile (< 1024px) */}
      <nav className="mobile-bottom-nav" aria-label="Acoes rapidas">
        <button
          type="button"
          className="mobile-bottom-btn is-primary"
          onClick={openCreateItemModal}
        >
          <Plus size={18} aria-hidden="true" />
          <span>Novo link</span>
        </button>
        <button
          type="button"
          className="mobile-bottom-btn"
          onClick={openCreateTabModal}
        >
          <FolderPlus size={18} aria-hidden="true" />
          <span>Nova aba</span>
        </button>
        <button
          type="button"
          className="mobile-bottom-btn"
          onClick={handleExportBackup}
        >
          <Download size={18} aria-hidden="true" />
          <span>Exportar</span>
        </button>
        <button
          type="button"
          className="mobile-bottom-btn"
          onClick={openImportBackupModal}
        >
          <Upload size={18} aria-hidden="true" />
          <span>Importar</span>
        </button>
      </nav>

      {/* MODAL 1: Criar / Editar Link */}
      <ModalDialog
        open={itemModalOpen}
        title={editingItem ? 'Editar link salvo' : 'Novo link na estante'}
        onClose={() => setItemModalOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setItemModalOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSaveItemForm}
            >
              {editingItem ? 'Salvar alteracoes' : 'Adicionar a estante'}
            </button>
          </>
        }
      >
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          onPaste={handleModalImagePaste}
        >
          <div className="field-group">
            <label className="field-label" htmlFor="item-url">
              Endereco da pagina (URL)
            </label>
            <input
              id="item-url"
              type="url"
              className="text-input"
              aria-invalid={Boolean(formError && !sanitizeHttpUrl(formUrl))}
              placeholder="https://mangadex.org/title/obra/capitulo-142"
              value={formUrl}
              onChange={(e) => {
                const val = e.target.value;
                setFormUrl(val);
                if (!editingItem && !formProgress) {
                  const detected = detectProgressFromTab(formTitle, val);
                  if (detected) setFormProgress(detected);
                }
              }}
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="item-title">
              Titulo de exibicao
            </label>
            <input
              id="item-title"
              type="text"
              className="text-input"
              placeholder="Ex.: Solo Leveling, Documentacao React..."
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field-group">
              <label className="field-label" htmlFor="item-tab">
                Aba da estante
              </label>
              <SelectDropdown
                id="item-tab"
                ariaLabel="Aba da estante"
                value={formTabId}
                options={tabDropdownOptions}
                onChange={setFormTabId}
              />
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="item-status">
                Status
              </label>
              <SelectDropdown
                id="item-status"
                ariaLabel="Status de leitura"
                align="right"
                value={formStatus}
                options={statusDropdownOptions}
                onChange={setFormStatus}
              />
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="item-progress">
              Capitulo ou ponto de parada (opcional)
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id="item-progress"
                type="text"
                className="text-input font-data"
                placeholder="Ex.: Cap. 142, Ep. 08, Pag. 30"
                value={formProgress}
                onChange={(e) => setFormProgress(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary font-data"
                onClick={() => setFormProgress((p) => stepProgressLabel(p, -1))}
                aria-label="Diminuir 1 capitulo"
              >
                -1
              </button>
              <button
                type="button"
                className="btn btn-secondary font-data"
                onClick={() => setFormProgress((p) => stepProgressLabel(p, 1))}
                aria-label="Somar 1 capitulo"
              >
                +1
              </button>
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="item-cover">
              Imagem de capa (URL https, arquivo do PC ou colar com Ctrl+V)
            </label>
            <div className="cover-input-row">
              <input
                id="item-cover"
                type="text"
                className="text-input"
                placeholder="https://site.com/capa.jpg ou cole uma imagem (Ctrl+V)"
                value={formCover.startsWith('data:image/') ? '' : formCover}
                onChange={(e) => setFormCover(e.target.value)}
              />
              <input
                ref={coverFileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  void handleCoverBlobSelected(file);
                }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={coverUploading}
                onClick={() => coverFileInputRef.current?.click()}
                title="Escolher imagem do computador (convertida localmente para WebP)"
              >
                <ImagePlus size={15} aria-hidden="true" />
                <span>{coverUploading ? 'Convertendo...' : 'Do PC'}</span>
              </button>
            </div>
            {formCover ? (
              <div className="cover-mini-preview-bar">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div className="cover-mini-thumb">
                    <img
                      src={formCover}
                      alt="Previa da capa"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <span className="field-hint">
                    {formCover.startsWith('data:image/')
                      ? 'Capa salva offline nesta maquina (WebP).'
                      : 'Capa externa via link HTTPS.'}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFormCover('')}
                >
                  Remover
                </button>
              </div>
            ) : null}
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="item-notes">
              Notas rapidas (opcional)
            </label>
            <textarea
              id="item-notes"
              className="textarea-input"
              placeholder="Ex.: Capitulos novos saem aos domingos"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
            />
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              id="item-pinned-checkbox"
              name="pinned"
              type="checkbox"
              checked={formPinned}
              onChange={(e) => setFormPinned(e.target.checked)}
            />
            <span style={{ fontSize: 14, fontWeight: 500 }}>
              Fixar este card no topo da aba
            </span>
          </label>

          {formError ? (
            <p className="field-error" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{formError}</span>
            </p>
          ) : null}
        </div>
      </ModalDialog>

      {/* MODAL 2: Atualizar Parada Rapida */}
      <ModalDialog
        open={Boolean(quickStopItem)}
        title={`Atualizar parada: ${quickStopItem?.title ?? ''}`}
        onClose={() => setQuickStopItem(null)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setQuickStopItem(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirmQuickStop}
            >
              <RefreshCw size={15} aria-hidden="true" />
              <span>Salvar nova parada</span>
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {quickStopOpenTabs.length > 0 ? (
            <div className="field-group">
              <span className="field-label">
                Puxar de uma aba aberta agora no navegador (1 clique)
              </span>
              <div className="open-tabs-list" style={{ maxHeight: 170 }}>
                {quickStopOpenTabs.map((bt) => {
                  const isCurrentSelected = quickStopUrl === bt.url;
                  return (
                    <button
                      key={`${bt.chromeTabId ?? bt.url}`}
                      type="button"
                      className={`open-tab-item ${isCurrentSelected ? 'is-selected' : ''}`}
                      style={{ textAlign: 'left', width: '100%' }}
                      onClick={() => {
                        setQuickStopUrl(bt.url);
                        if (bt.detectedProgress) {
                          setQuickStopProgress(bt.detectedProgress);
                        }
                        setQuickStopTabToClose(bt.chromeTabId);
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 13,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {bt.title}
                        </div>
                        <div className="font-data" style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {bt.domain}
                          {bt.detectedProgress ? ` · Detectado: ${bt.detectedProgress}` : ''}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="field-group">
            <label className="field-label" htmlFor="quick-stop-progress">
              Capitulo ou ponto atual
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id="quick-stop-progress"
                type="text"
                className="text-input font-data"
                value={quickStopProgress}
                onChange={(e) => setQuickStopProgress(e.target.value)}
                placeholder="Ex.: Cap. 148"
              />
              <button
                type="button"
                className="btn btn-secondary font-data"
                onClick={() => setQuickStopProgress((p) => stepProgressLabel(p, 1))}
              >
                +1
              </button>
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="quick-stop-url">
              Novo link da parada
            </label>
            <input
              id="quick-stop-url"
              type="url"
              className="text-input"
              value={quickStopUrl}
              onChange={(e) => {
                const next = e.target.value;
                setQuickStopUrl(next);
                const auto = detectProgressFromTab('', next);
                if (auto) setQuickStopProgress(auto);
              }}
            />
          </div>

          {quickStopTabToClose !== undefined ? (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                id="quick-stop-close-checkbox"
                name="closeAfter"
                type="checkbox"
                checked={quickStopCloseAfter}
                onChange={(e) => setQuickStopCloseAfter(e.target.checked)}
              />
              <span style={{ fontSize: 13 }}>
                Fechar a aba aberta correspondente apos atualizar
              </span>
            </label>
          ) : null}

          {quickStopError ? (
            <p className="field-error" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{quickStopError}</span>
            </p>
          ) : null}
        </div>
      </ModalDialog>

      {/* MODAL 3: Criar / Gerenciar Aba da Estante */}
      <ModalDialog
        open={tabModalOpen}
        title={editingTab ? `Configurar aba: ${editingTab.name}` : 'Criar nova aba'}
        onClose={() => setTabModalOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setTabModalOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSaveTabModal}
            >
              {editingTab ? 'Salvar aba' : 'Criar aba'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="field-group">
            <label className="field-label" htmlFor="tab-name-input">
              Nome da aba
            </label>
            <input
              id="tab-name-input"
              type="text"
              className="text-input"
              placeholder="Ex.: Mangas, Webtoons, Faculdade, Receitas..."
              value={tabNameInput}
              onChange={(e) => setTabNameInput(e.target.value)}
            />
          </div>

          <div className="field-group">
            <span className="field-label">Icone da aba</span>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))',
                gap: 8,
              }}
              role="radiogroup"
              aria-label="Escolher icone da aba"
            >
              {TAB_ICON_OPTIONS.map((opt) => {
                const selected = tabIconInput === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`status-option ${selected ? 'is-active' : ''}`}
                    style={{ minHeight: 42, padding: '0 10px' }}
                    onClick={() => setTabIconInput(opt.value)}
                  >
                    <TabCollectionIcon name={opt.value} size={16} />
                    <span style={{ fontSize: 13 }}>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {editingTab ? (
            <>
              <div className="field-group">
                <span className="field-label">Ordem na barra lateral</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleMoveTabOrder('up')}
                  >
                    <ArrowUp size={15} aria-hidden="true" />
                    <span>Subir posicao</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleMoveTabOrder('down')}
                  >
                    <ArrowDown size={15} aria-hidden="true" />
                    <span>Descer posicao</span>
                  </button>
                </div>
              </div>

              {tabs.length > 1 ? (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--line)',
                    backgroundColor: 'var(--subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <strong style={{ fontSize: 13 }}>Remover esta aba</strong>
                  {(countByTabId.get(editingTab.id) ?? 0) > 0 ? (
                    <div className="field-group">
                      <label className="field-hint" htmlFor="delete-tab-move-select">
                        O que fazer com os {countByTabId.get(editingTab.id)} links salvos
                        nesta aba?
                      </label>
                      <SelectDropdown
                        id="delete-tab-move-select"
                        ariaLabel="Destino dos links ao remover aba"
                        value={deleteTabMoveTo}
                        options={deleteTabMoveOptions}
                        onChange={setDeleteTabMoveTo}
                      />
                    </div>
                  ) : (
                    <p className="field-hint">Esta aba esta vazia no momento.</p>
                  )}

                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={handleDeleteTab}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    <span>Excluir aba "{editingTab.name}"</span>
                  </button>
                </div>
              ) : null}
            </>
          ) : null}

          {tabFormError ? (
            <p className="field-error" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{tabFormError}</span>
            </p>
          ) : null}
        </div>
      </ModalDialog>

      {/* MODAL 4: Guardar Abas Abertas em Lote */}
      <ModalDialog
        open={batchModalOpen}
        title="Guardar abas abertas do navegador"
        onClose={() => {
          if (!batchSaving) setBatchModalOpen(false);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={batchSaving}
              onClick={() => setBatchModalOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={selectedBrowserUrls.size === 0 || batchSaving}
              onClick={() => handleSaveSelectedBrowserTabs(false)}
            >
              {batchSaving ? 'Guardando...' : `Salvar (${selectedBrowserUrls.size})`}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={selectedBrowserUrls.size === 0 || batchSaving}
              onClick={() => handleSaveSelectedBrowserTabs(true)}
            >
              {batchSaving ? 'Guardando...' : `Salvar e fechar abas (${selectedBrowserUrls.size})`}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p className="field-hint">
            Selecione as abas abertas que deseja guardar na estante para liberar memoria no
            Chrome sem perder onde parou. O Tomo extrai capas e capitulos automaticamente.
          </p>

          <div className="field-group">
            <label className="field-label" htmlFor="batch-target-tab">
              Guardar na aba da estante
            </label>
            <SelectDropdown
              id="batch-target-tab"
              ariaLabel="Guardar na aba da estante"
              value={batchTargetTabId}
              options={tabDropdownOptions}
              onChange={setBatchTargetTabId}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="field-label font-data">
              {openBrowserTabs.length} abas detectadas na janela
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                if (selectedBrowserUrls.size === openBrowserTabs.length) {
                  setSelectedBrowserUrls(new Set());
                } else {
                  setSelectedBrowserUrls(new Set(openBrowserTabs.map((t) => t.url)));
                }
              }}
            >
              {selectedBrowserUrls.size === openBrowserTabs.length
                ? 'Desmarcar todas'
                : 'Marcar todas'}
            </button>
          </div>

          {openBrowserTabs.length === 0 ? (
            <div className="local-status-box">
              Nenhuma aba http/https aberta encontrada nesta janela.
            </div>
          ) : (
            <div className="open-tabs-list">
              {openBrowserTabs.map((bt) => {
                const checked = selectedBrowserUrls.has(bt.url);
                const alreadySaved = items.some((it) => it.url === bt.url);
                return (
                  <label
                    key={`${bt.chromeTabId ?? bt.url}`}
                    className={`open-tab-item ${checked ? 'is-selected' : ''}`}
                  >
                    <input
                      name="batchTabSelect"
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSelectedBrowserUrls((prev) => {
                          const next = new Set(prev);
                          if (next.has(bt.url)) next.delete(bt.url);
                          else next.add(bt.url);
                          return next;
                        });
                      }}
                    />
                    {bt.faviconUrl ? (
                      <img
                        src={bt.faviconUrl}
                        alt=""
                        aria-hidden="true"
                        style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0 }}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : null}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 13,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {bt.cleanTitle || bt.title}
                      </div>
                      <div className="font-data" style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {bt.domain}
                        {bt.detectedProgress ? ` · ${bt.detectedProgress}` : ''}
                        {bt.ogImageUrl ? ' · Capa detectada' : ''}
                        {alreadySaved ? ' · Ja salvo' : ''}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </ModalDialog>

      {/* MODAL 5: Importar Backup JSON */}
      <ModalDialog
        open={importModalOpen}
        title="Importar backup (.json)"
        onClose={() => setImportModalOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setImportModalOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!importPreview}
              onClick={handleConfirmImport}
            >
              <Upload size={15} aria-hidden="true" />
              <span>Confirmar importacao</span>
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="field-group">
            <label className="field-label" htmlFor="backup-file-input">
              Arquivo JSON exportado pelo Tomo
            </label>
            <input
              id="backup-file-input"
              type="file"
              accept=".json,application/json"
              className="text-input"
              onChange={(e) => handleImportFileChosen(e.target.files?.[0])}
            />
            <p className="field-hint">
              Tudo roda localmente no seu computador; nenhum arquivo e enviado para a internet.
            </p>
          </div>

          {importPreview ? (
            <div className="local-status-box">
              <strong>Arquivo validado com sucesso</strong>
              <span className="font-data">
                {importPreview.tabs.length} abas · {importPreview.items.length} links
                encontrados
              </span>
            </div>
          ) : null}

          <fieldset
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: 12,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <legend className="field-label" style={{ padding: '0 6px' }}>
              Como aplicar o backup?
            </legend>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
              <input
                type="radio"
                name="import-mode"
                checked={importMode === 'merge'}
                onChange={() => setImportMode('merge')}
                style={{ marginTop: 4 }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  Mesclar com minha estante atual (Recomendado)
                </div>
                <div className="field-hint">
                  Mantem seus links atuais, adiciona abas/itens novos e atualiza os mais
                  recentes sem apagar nada.
                </div>
              </div>
            </label>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
              <input
                type="radio"
                name="import-mode"
                checked={importMode === 'replace'}
                onChange={() => setImportMode('replace')}
                style={{ marginTop: 4 }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  Substituir toda a estante atual
                </div>
                <div className="field-hint">
                  Remove os {items.length} links atuais desta maquina e deixa identico ao
                  arquivo importado.
                </div>
              </div>
            </label>
          </fieldset>

          {importError ? (
            <p className="field-error" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{importError}</span>
            </p>
          ) : null}
        </div>
      </ModalDialog>

      {/* MODAL 6: Confirmacao de exclusao de card */}
      <ModalDialog
        open={Boolean(itemPendingDelete)}
        title="Remover link da estante?"
        onClose={() => setItemPendingDelete(null)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setItemPendingDelete(null)}
            >
              Manter link
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleConfirmDeleteItem}
            >
              <Trash2 size={15} aria-hidden="true" />
              <span>Sim, remover</span>
            </button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
          Tem certeza de que deseja remover{' '}
          <strong style={{ color: 'var(--ink)' }}>{itemPendingDelete?.title}</strong> da sua
          estante local?
        </p>
      </ModalDialog>

      {/* MODAL 7: Guia e configuracao de Atalhos de Teclado */}
      <ModalDialog
        open={shortcutsModalOpen}
        title="Atalhos rapidos de teclado"
        onClose={() => setShortcutsModalOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={async () => {
                const opened = await openChromeShortcutsSettings();
                if (!opened) {
                  setShortcutsModalOpen(false);
                  showBanner(
                    'No Chrome instalado, acesse chrome://extensions/shortcuts para personalizar.'
                  );
                }
              }}
            >
              <Keyboard size={15} aria-hidden="true" />
              <span>Personalizar teclas no Chrome</span>
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShortcutsModalOpen(false)}
            >
              Entendi
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="shortcuts-section">
            <h3 className="shortcuts-section-title">
              Em qualquer site no Chrome (Globais)
            </h3>
            {globalShortcuts.map((item) => (
              <div key={item.name} className="shortcut-row">
                <div className="shortcut-row-text">
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </div>
                <kbd className="kbd-badge">{item.shortcut}</kbd>
              </div>
            ))}
          </div>

          <div className="shortcuts-section">
            <h3 className="shortcuts-section-title">Dentro do Popup rapido</h3>
            <div className="shortcut-row">
              <div className="shortcut-row-text">
                <strong>Salvar ou atualizar parada</strong>
                <span>Confirma o salvamento a partir de qualquer campo</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <kbd className="kbd-badge">Enter</kbd>
                <kbd className="kbd-badge">Ctrl+Enter</kbd>
              </div>
            </div>
            <div className="shortcut-row">
              <div className="shortcut-row-text">
                <strong>Salvar e fechar aba atual</strong>
                <span>Guarda na estante e ja fecha a aba no Chrome</span>
              </div>
              <kbd className="kbd-badge">Alt+Enter</kbd>
            </div>
            <div className="shortcut-row">
              <div className="shortcut-row-text">
                <strong>Somar ou diminuir capitulo e trocar de aba</strong>
                <span>Ajusta o numero da parada ou escolhe a aba 1 a 9</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <kbd className="kbd-badge">Alt+↑/↓</kbd>
                <kbd className="kbd-badge">Alt+1..9</kbd>
              </div>
            </div>
          </div>

          <div className="shortcuts-section">
            <h3 className="shortcuts-section-title">Dentro da Estante</h3>
            <div className="shortcut-row">
              <div className="shortcut-row-text">
                <strong>Buscar, Novo link e Guardar abas abertas</strong>
                <span>Acoes imediatas quando nenhum campo de texto esta focado</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <kbd className="kbd-badge">/</kbd>
                <kbd className="kbd-badge">N</kbd>
                <kbd className="kbd-badge">G</kbd>
              </div>
            </div>
            <div className="shortcut-row">
              <div className="shortcut-row-text">
                <strong>Alternar entre suas abas</strong>
                <span>0 mostra Todos os links; 1 a 9 abre cada aba na ordem</span>
              </div>
              <kbd className="kbd-badge">0..9</kbd>
            </div>
          </div>
        </div>
      </ModalDialog>

      {/* MODAL 8: Sincronizacao Automatica Local (.json), Troca de Dominio e Atualizacao via GitHub */}
      <ModalDialog
        open={syncModalOpen}
        title="Sincronizacao, Dominio e Atualizacao"
        onClose={() => setSyncModalOpen(false)}
        footer={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setSyncModalOpen(false)}
          >
            Fechar
          </button>
        }
      >
        <div className="sync-modal-stack">
          <div
            className="sync-tabs-bar"
            role="tablist"
            aria-label="Opcoes de sincronizacao, dominio e atualizacao"
          >
            <button
              type="button"
              role="tab"
              aria-selected={syncModalTab === 'audit'}
              className={`sync-tab-btn ${syncModalTab === 'audit' ? 'is-active' : ''}`}
              onClick={() => setSyncModalTab('audit')}
            >
              <ShieldCheck size={15} aria-hidden="true" />
              <span>Auditoria e Saude</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={syncModalTab === 'backup'}
              className={`sync-tab-btn ${syncModalTab === 'backup' ? 'is-active' : ''}`}
              onClick={() => setSyncModalTab('backup')}
            >
              <HardDrive size={15} aria-hidden="true" />
              <span>Backup Auto</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={syncModalTab === 'domain'}
              className={`sync-tab-btn ${syncModalTab === 'domain' ? 'is-active' : ''}`}
              onClick={() => setSyncModalTab('domain')}
            >
              <Globe size={15} aria-hidden="true" />
              <span>Trocar Dominio</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={syncModalTab === 'version'}
              className={`sync-tab-btn ${syncModalTab === 'version' ? 'is-active' : ''}`}
              onClick={() => setSyncModalTab('version')}
            >
              <Sparkles size={15} aria-hidden="true" />
              <span>Versao</span>
              {updateResult?.hasUpdate ? (
                <span
                  className="btn-status-dot btn-status-dot--action"
                  aria-hidden="true"
                />
              ) : null}
            </button>
          </div>

          {/* Secao 0: Sincronizar e Auditar Links da Estante */}
          {syncModalTab === 'audit' ? (
            <section className="sync-section" aria-label="Sincronizacao e auditoria de links">
              <h3 className="shortcuts-section-title">
                Auditoria de Saude e Recuperacao de Capas
              </h3>
              <p className="field-hint" style={{ margin: 0 }}>
                Verifica se os sites e dominios ainda estao online e ativos, e preenche capas
                em WebP offline para links que ficaram sem imagem, preservando suas capas de sinopse.
              </p>

              {/* Seletor de Escopo */}
              <div className="field-group" style={{ marginTop: 12 }}>
                <label className="field-label">Escopo da verificacao</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    disabled={auditRunning}
                    className={`filter-chip ${auditScope === 'current' ? 'is-active' : ''}`}
                    onClick={() => setAuditScope('current')}
                  >
                    {activeTabObj ? `Aba "${activeTabObj.name}"` : 'Aba atual'}{' '}
                    ({activeTabId !== 'ALL' ? items.filter((it) => it.tabId === activeTabId).length : items.length} links)
                  </button>
                  <button
                    type="button"
                    disabled={auditRunning}
                    className={`filter-chip ${auditScope === 'all' ? 'is-active' : ''}`}
                    onClick={() => setAuditScope('all')}
                  >
                    Toda a estante ({items.length} links)
                  </button>
                </div>
              </div>

              {/* Opcoes de auditoria */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  padding: '10px 12px',
                  background: 'var(--subtle)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: 'var(--ink)',
                    cursor: auditRunning ? 'not-allowed' : 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    disabled={auditRunning}
                    checked={auditCheckHealth}
                    onChange={(e) => setAuditCheckHealth(e.target.checked)}
                  />
                  <span>Verificar se os dominios estao ativos e respondendo</span>
                </label>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: 'var(--ink)',
                    cursor: auditRunning ? 'not-allowed' : 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    disabled={auditRunning}
                    checked={auditFillCovers}
                    onChange={(e) => setAuditFillCovers(e.target.checked)}
                  />
                  <span>Preencher capas apenas dos links sem imagem (preserva capas de sinopse)</span>
                </label>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: 'var(--muted)',
                    cursor: auditRunning ? 'not-allowed' : 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    disabled={auditRunning}
                    checked={auditForceCovers}
                    onChange={(e) => setAuditForceCovers(e.target.checked)}
                  />
                  <span>Forcar nova captura para todos os links (sobrescreve capas existentes)</span>
                </label>
              </div>

              {/* Barra de Progresso Durante Execucao */}
              {auditRunning && auditProgress ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    padding: '12px',
                    border: '1px solid var(--line-strong)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600 }}>
                    <span>Verificando links ({auditProgress.current}/{auditProgress.total})...</span>
                    <span className="font-data">
                      {Math.round((auditProgress.current / auditProgress.total) * 100)}%
                    </span>
                  </div>

                  <div
                    style={{
                      height: 6,
                      background: 'var(--subtle)',
                      borderRadius: 'var(--radius-pill)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.round((auditProgress.current / auditProgress.total) * 100)}%`,
                        background: 'var(--action)',
                        transition: 'width 180ms ease',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>
                      {auditProgress.item.title} ({auditProgress.item.domain})
                    </span>
                    <span className="font-data" style={{ color: auditProgress.status === 'offline' ? 'var(--destructive)' : 'var(--success)' }}>
                      {auditProgress.detail ?? auditProgress.status}
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Resumo da Ultima Auditoria */}
              {auditSummary ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        padding: '10px 12px',
                        background: 'var(--subtle)',
                        borderRadius: 'var(--radius-sm)',
                        textAlign: 'center',
                      }}
                    >
                      <div className="font-data" style={{ fontSize: 20, fontWeight: 700, color: 'var(--success)' }}>
                        {auditSummary.online}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Ativos / Online</div>
                    </div>

                    <div
                      style={{
                        padding: '10px 12px',
                        background: 'var(--subtle)',
                        borderRadius: 'var(--radius-sm)',
                        textAlign: 'center',
                      }}
                    >
                      <div className="font-data" style={{ fontSize: 20, fontWeight: 700, color: 'var(--action)' }}>
                        {auditSummary.coversUpdated}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Capas Salvas</div>
                    </div>

                    <div
                      style={{
                        padding: '10px 12px',
                        background: 'var(--subtle)',
                        borderRadius: 'var(--radius-sm)',
                        textAlign: 'center',
                      }}
                    >
                      <div className="font-data" style={{ fontSize: 20, fontWeight: 700, color: auditSummary.offline > 0 ? 'var(--destructive)' : 'var(--muted)' }}>
                        {auditSummary.offline}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Inativos</div>
                    </div>
                  </div>

                  {auditSummary.inactiveItems.length > 0 ? (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        padding: '10px 12px',
                        background: 'var(--destructive-soft)',
                        border: '1px solid var(--destructive)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13, color: 'var(--destructive)' }}>
                        <AlertTriangle size={15} aria-hidden="true" />
                        <span>{auditSummary.inactiveItems.length} {auditSummary.inactiveItems.length === 1 ? 'link nao respondeu' : 'links nao responderam'}:</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
                        {auditSummary.inactiveItems.map(({ item, reason }) => (
                          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 10 }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <strong>{item.title}</strong> ({item.domain})
                            </span>
                            <span style={{ color: 'var(--muted)', flexShrink: 0 }}>{reason}</span>
                          </div>
                        ))}
                      </div>
                      {auditSummary.inactiveItems[0]?.item.domain ? (
                        <div style={{ paddingTop: 4 }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setDomainOld(auditSummary.inactiveItems[0].item.domain);
                              setSyncModalTab('domain');
                            }}
                          >
                            <Globe size={14} aria-hidden="true" />
                            <span>Trocar dominio de {auditSummary.inactiveItems[0].item.domain}</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Botoes de Acao */}
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                {auditRunning ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ flex: 1 }}
                    onClick={handleCancelShelfSync}
                  >
                    <X size={15} aria-hidden="true" />
                    <span>Cancelar / Parar</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    onClick={handleStartShelfSync}
                  >
                    <ShieldCheck size={16} aria-hidden="true" />
                    <span>Iniciar Auditoria e Sincronizacao</span>
                  </button>
                )}
              </div>
            </section>
          ) : null}

          {/* Secao 1: Backup Automatico em Arquivo Fixo no PC */}
          {syncModalTab === 'backup' ? (
            <section className="sync-section" aria-label="Backup automatico no computador">
              <h3 className="shortcuts-section-title">
                Backup automatico no computador (.json fixo)
              </h3>
            <p className="field-hint">
              Vincule um arquivo <code>.json</code> em uma pasta fixa (como{' '}
              <code>Documentos</code>, OneDrive ou Google Drive). Enquanto ativo, toda
              alteracao na estante grava nesse mesmo arquivo sem gerar copias repetidas.
            </p>

            <div className="sync-status-card">
              {!linkedBackup.supported ? (
                <div className="sync-alert sync-alert--warning" role="status">
                  <div className="sync-alert-head">
                    <AlertCircle size={16} aria-hidden="true" />
                    <span>Gravacao direta indisponivel neste navegador</span>
                  </div>
                  <p className="field-hint">
                    Use os botoes Exportar e Importar na barra lateral para salvar ou
                    restaurar seu arquivo .json.
                  </p>
                </div>
              ) : !linkedBackup.linked ? (
                <>
                  <div className="sync-status-row">
                    <div className="sync-badge-line sync-badge-line--muted">
                      <HardDrive size={16} aria-hidden="true" />
                      <span>Nenhum arquivo fixo vinculado</span>
                    </div>
                  </div>
                  <p className="field-hint">
                    Escolha uma unica vez onde criar ou apontar seu arquivo{' '}
                    <code>tomo-backup.json</code>.
                  </p>
                  <div className="sync-actions-wrap">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={syncBusy}
                      onClick={handlePickBackupFile}
                    >
                      <Link2 size={15} aria-hidden="true" />
                      <span>Escolher arquivo .json fixo</span>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="sync-status-row">
                    {linkedBackup.permission === 'granted' ? (
                      <div className="sync-badge-line sync-badge-line--success">
                        <CircleCheck size={16} aria-hidden="true" />
                        <span>Sincronizacao automatica ativa</span>
                      </div>
                    ) : linkedBackup.permission === 'denied' ? (
                      <div className="sync-badge-line sync-badge-line--danger">
                        <AlertCircle size={16} aria-hidden="true" />
                        <span>Permissao negada pelo navegador</span>
                      </div>
                    ) : (
                      <div className="sync-badge-line sync-badge-line--warning">
                        <AlertCircle size={16} aria-hidden="true" />
                        <span>Reativacao pendente nesta sessao</span>
                      </div>
                    )}

                    <span className="version-pill font-data">
                      {linkedBackup.fileName}
                    </span>
                  </div>

                  {linkedBackup.lastSyncedAt ? (
                    <p className="field-hint font-data">
                      Ultima gravacao: {formatSyncTimestamp(linkedBackup.lastSyncedAt)}
                    </p>
                  ) : null}

                  {linkedBackup.permission !== 'granted' ? (
                    <p className="field-hint">
                      Apos reiniciar o navegador, clique em{' '}
                      <strong>Gravar agora</strong> para confirmar a permissao e retomar o
                      salvamento automatico.
                    </p>
                  ) : null}

                  <div className="sync-actions-wrap">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={syncBusy}
                      onClick={() => handleManualSyncToLinkedFile(false)}
                    >
                      <RefreshCw
                        size={14}
                        className={syncBusy ? 'is-spinning' : undefined}
                        aria-hidden="true"
                      />
                      <span>Gravar agora</span>
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={syncBusy}
                      onClick={handlePullFromLinkedFile}
                      title="Mesclar links mais recentes vindos deste arquivo"
                    >
                      <Upload size={14} aria-hidden="true" />
                      <span>Ler do arquivo (Mesclar)</span>
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={syncBusy}
                      onClick={handlePickBackupFile}
                    >
                      <Link2 size={14} aria-hidden="true" />
                      <span>Trocar arquivo</span>
                    </button>

                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={syncBusy}
                      onClick={handleUnlinkBackupFile}
                    >
                      <Unlink size={14} aria-hidden="true" />
                      <span>Desvincular</span>
                    </button>
                  </div>
                </>
              )}

              {syncFeedback ? (
                <div
                  className={
                    syncFeedback.tone === 'error'
                      ? 'field-error'
                      : `sync-alert sync-alert--${syncFeedback.tone}`
                  }
                  role={syncFeedback.tone === 'error' ? 'alert' : 'status'}
                >
                  <div className="sync-alert-head">
                    {syncFeedback.tone === 'success' ? (
                      <CircleCheck size={16} aria-hidden="true" />
                    ) : (
                      <AlertCircle size={16} aria-hidden="true" />
                    )}
                    <span>{syncFeedback.message}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Secao 2: Trocar Dominio em Massa */}
        {syncModalTab === 'domain' ? (
          <section
            className="sync-section"
            aria-label="Migracao em lote de dominio"
          >
            <h3 className="shortcuts-section-title">
              Trocar dominio de sites em massa
            </h3>
            <p className="field-hint">
              Quando um site ou scan mudar de dominio (ex.: de{' '}
              <code>mangadex.org</code> para <code>mangadex.dev</code>),
              atualize todos os seus links salvos de uma so vez, mantendo
              capitulos, notas, capas e abas intactos.
            </p>

            <div className="sync-status-card">
              {savedDomainStats.length === 0 ? (
                <p className="field-hint">
                  Voce ainda nao possui links salvos na estante.
                </p>
              ) : (
                <>
                  <div className="field-group">
                    <label className="field-label" htmlFor="domain-old-select">
                      Dominio atual dos links salvos
                    </label>
                    <SelectDropdown
                      id="domain-old-select"
                      ariaLabel="Dominio atual dos links salvos"
                      value={domainOld}
                      options={savedDomainOptions}
                      onChange={setDomainOld}
                    />
                  </div>

                  <div className="field-group">
                    <label className="field-label" htmlFor="domain-new-input">
                      Novo dominio ou endereco
                    </label>
                    <input
                      id="domain-new-input"
                      type="text"
                      className="text-input font-data"
                      placeholder="Ex.: novo-site.org"
                      value={domainNew}
                      onChange={(e) => setDomainNew(e.target.value)}
                    />
                  </div>

                  {domainMigrationPreview ? (
                    <div className="domain-preview-box">
                      <strong style={{ fontSize: 13 }}>
                        {domainMigrationPreview.count}{' '}
                        {domainMigrationPreview.count === 1
                          ? 'link sera atualizado'
                          : 'links serao atualizados'}
                      </strong>
                      <div className="domain-preview-url">
                        Antes: {domainMigrationPreview.sampleBefore}
                      </div>
                      {domainMigrationPreview.sampleAfter ? (
                        <div className="domain-preview-url domain-preview-url--after">
                          Depois: {domainMigrationPreview.sampleAfter}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="sync-actions-wrap">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={
                        domainBusy ||
                        !domainOld ||
                        !domainNew.trim() ||
                        normalizeDomainHost(domainOld)?.host ===
                          normalizeDomainHost(domainNew)?.host
                      }
                      onClick={handleMigrateDomain}
                    >
                      <RefreshCw
                        size={14}
                        className={domainBusy ? 'is-spinning' : undefined}
                        aria-hidden="true"
                      />
                      <span>Atualizar links deste dominio</span>
                    </button>
                  </div>

                  {domainFeedback ? (
                    <div
                      className={
                        domainFeedback.tone === 'error'
                          ? 'field-error'
                          : `sync-alert sync-alert--${domainFeedback.tone}`
                      }
                      role={
                        domainFeedback.tone === 'error' ? 'alert' : 'status'
                      }
                    >
                      <div className="sync-alert-head">
                        {domainFeedback.tone === 'success' ? (
                          <CircleCheck size={16} aria-hidden="true" />
                        ) : (
                          <AlertCircle size={16} aria-hidden="true" />
                        )}
                        <span>{domainFeedback.message}</span>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </section>
        ) : null}

        {/* Secao 3: Verificacao de Nova Versao no GitHub + Recarregar Extensao */}
        {syncModalTab === 'version' ? (
          <section className="sync-section" aria-label="Atualizacao da extensao">
            <h3 className="shortcuts-section-title">
              Versao da extensao (GitHub Releases)
            </h3>
            <p className="field-hint">
              Consulta publica sob demanda ao repositorio oficial para conferir se saiu
              uma versao nova. Nenhum link salvo ou dado pessoal e enviado.
            </p>

            <div className="sync-status-card">
              <div className="sync-status-row">
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    Versao instalada nesta maquina
                  </div>
                  <div className="field-hint font-data">v{extVersion}</div>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={updateChecking}
                  onClick={handleCheckUpdate}
                >
                  <RefreshCw
                    size={14}
                    className={updateChecking ? 'is-spinning' : undefined}
                    aria-hidden="true"
                  />
                  <span>
                    {updateChecking ? 'Verificando...' : 'Verificar nova versao'}
                  </span>
                </button>
              </div>

              {updateError ? (
                <div className="field-error" role="alert">
                  <AlertCircle size={16} aria-hidden="true" />
                  <div style={{ flex: 1 }}>
                    <div>{updateError}</div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ marginTop: 6 }}
                      onClick={() => openExternalLink(GITHUB_RELEASES_PAGE)}
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                      <span>Abrir GitHub Releases manualmente</span>
                    </button>
                  </div>
                </div>
              ) : null}

              {updateResult && !updateResult.hasUpdate ? (
                <div className="sync-alert sync-alert--success" role="status">
                  <div className="sync-alert-head">
                    <CircleCheck size={16} aria-hidden="true" />
                    <span>
                      Extensao em dia (v{updateResult.currentVersion})
                    </span>
                  </div>
                  <p className="field-hint font-data">
                    Ultima versao publicada no GitHub: v{updateResult.latestVersion}
                  </p>
                </div>
              ) : null}

              {updateResult && updateResult.hasUpdate ? (
                <div className="sync-alert sync-alert--action" role="status">
                  <div className="sync-alert-head">
                    <Sparkles size={16} aria-hidden="true" />
                    <span>
                      Nova versao v{updateResult.latestVersion} disponivel!
                    </span>
                  </div>

                  <ol className="sync-steps-list">
                    <li>
                      Clique em <strong>Baixar pacote .zip</strong> abaixo;
                    </li>
                    <li>
                      Extraia os arquivos dentro da <strong>mesma pasta</strong> onde voce
                      instalou o Tomo (substituindo os antigos);
                    </li>
                    <li>
                      Clique em <strong>Aplicar e recarregar extensao</strong> para ativar
                      sem perder seus links.
                    </li>
                  </ol>

                  <div className="sync-actions-wrap">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() =>
                        openExternalLink(
                          updateResult.zipDownloadUrl ?? updateResult.releaseUrl
                        )
                      }
                    >
                      <Download size={14} aria-hidden="true" />
                      <span>
                        Baixar{' '}
                        {updateResult.zipAssetName ??
                          `tomo-chrome-v${updateResult.latestVersion}.zip`}
                      </span>
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => openExternalLink(updateResult.releaseUrl)}
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                      <span>Ver notas da versao</span>
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="sync-reload-bar">
                <span className="field-hint">
                  Ja extraiu os arquivos novos na pasta da extensao?
                </span>
                <button
                  type="button"
                  className="btn btn-surface btn-sm"
                  onClick={handleReloadExtension}
                >
                  <RotateCw size={14} aria-hidden="true" />
                  <span>Aplicar e recarregar extensao</span>
                </button>
              </div>
            </div>
          </section>
        ) : null}
        </div>
      </ModalDialog>
    </div>
  );
}
