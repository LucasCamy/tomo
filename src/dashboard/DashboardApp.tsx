import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Bookmark,
  CircleCheck,
  Download,
  FolderInput,
  FolderPlus,
  Grid2x2,
  Keyboard,
  Layers,
  List,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { LinkCard } from '../components/LinkCard';
import { ModalDialog } from '../components/ModalDialog';
import {
  STATUS_OPTIONS,
  TAB_ICON_OPTIONS,
  TabCollectionIcon,
} from '../components/ShelfIcons';
import { parseAndValidateBackupJson } from '../lib/backup';
import {
  closeBrowserTabs,
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
  reorderCollectionTab,
  subscribeShelfUpdates,
  updateCollectionTab,
  updateSavedLink,
} from '../lib/db';
import {
  detectProgressFromTab,
  findMatchingSavedItem,
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
import { applyTheme, getInitialTheme, type ThemeMode } from '../lib/theme';
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

  const refreshShelf = useCallback(async () => {
    const state = await loadShelfState();
    setTabs(state.tabs);
    setItems(state.items);
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshShelf();
    return subscribeShelfUpdates(() => {
      refreshShelf();
    });
  }, [refreshShelf]);

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

  const anyModalOpen =
    itemModalOpen ||
    Boolean(quickStopItem) ||
    tabModalOpen ||
    batchModalOpen ||
    importModalOpen ||
    Boolean(itemPendingDelete) ||
    shortcutsModalOpen;

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
      await updateSavedLink(quickStopItem.id, {
        url: safeUrl,
        progressLabel: quickStopProgress,
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

  // Passo rapido +1 direto no card
  const handleStepCardProgress = async (item: SavedLinkItem, delta: number) => {
    const nextProgress = stepProgressLabel(item.progressLabel, delta);
    await updateSavedLink(item.id, { progressLabel: nextProgress });
    await refreshShelf();
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
  };

  const handleSaveSelectedBrowserTabs = async (closeAfter: boolean) => {
    if (!batchTargetTabId || selectedBrowserUrls.size === 0) return;

    const chosen = openBrowserTabs.filter((bt) => selectedBrowserUrls.has(bt.url));
    const count = await createManySavedLinks(
      chosen.map((bt) => ({
        tabId: batchTargetTabId,
        title: bt.cleanTitle || bt.title,
        url: bt.url,
        faviconUrl: bt.faviconUrl,
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
    showBanner(`${count} ${count === 1 ? 'aba guardada' : 'abas guardadas'} na estante.`);
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
            className="btn btn-ghost btn-icon"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label={
              theme === 'dark' ? 'Alternar para tema claro' : 'Alternar para tema escuro'
            }
            title={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        <div>
          <div className="sidebar-section-label">
            <span>Visao geral</span>
          </div>
          <div className="sidebar-tabs-list">
            <div className="sidebar-tab-row">
              <button
                type="button"
                className={`nav-tab ${activeTabId === 'ALL' ? 'is-active' : ''}`}
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

        <div>
          <div className="sidebar-section-label">
            <span>Suas abas</span>
            <button
              type="button"
              onClick={openCreateTabModal}
              style={{
                border: 'none',
                background: 'none',
                color: 'var(--action)',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 4px',
              }}
            >
              <Plus size={14} aria-hidden="true" />
              <span>Nova aba</span>
            </button>
          </div>

          <div className="sidebar-tabs-list">
            {tabs.map((tab) => {
              const isActive = activeTabId === tab.id;
              return (
                <div key={tab.id} className="sidebar-tab-row">
                  <button
                    type="button"
                    className={`nav-tab ${isActive ? 'is-active' : ''}`}
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
                    className="btn btn-ghost btn-icon"
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
            <strong>Salvo nesta maquina</strong>
            <span className="font-data">
              {items.length} {items.length === 1 ? 'link salvo' : 'links salvos'} em{' '}
              {tabs.length} {tabs.length === 1 ? 'aba' : 'abas'}
            </span>
          </div>

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
                  className="btn btn-ghost btn-icon"
                  onClick={() => openManageTabModal(activeTabObj)}
                  aria-label={`Editar aba ${activeTabObj.name}`}
                  title="Renomear ou organizar esta aba"
                >
                  <Settings2 size={17} aria-hidden="true" />
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
              className="btn btn-ghost"
              onClick={openShortcutsModal}
              title="Abrir guia de atalhos (tecla ?)"
            >
              <Keyboard size={16} aria-hidden="true" />
              <span>Atalhos</span>
              <kbd className="kbd-badge">?</kbd>
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
              placeholder="Buscar por obra, site, capitulo ou nota... (atalho /)"
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
            <div className="filter-rail no-scrollbar" role="group" aria-label="Filtrar por status">
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

            <select
              id="shelf-sort-select"
              name="shelfSort"
              className="select-input"
              style={{ width: 'auto', minHeight: 40, padding: '0 12px' }}
              aria-label="Ordenar links"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
            >
              <option value="updated">Atualizados por ultimo</option>
              <option value="title">Ordem alfabetica (A-Z)</option>
              <option value="created">Adicionados recentemente</option>
            </select>

            <div style={{ display: 'inline-flex', gap: 4 }} role="group" aria-label="Modo de exibicao">
              <button
                type="button"
                className={`filter-chip ${density === 'gallery' ? 'is-active' : ''}`}
                style={{ minWidth: 40, justifyContent: 'center', padding: 0 }}
                aria-pressed={density === 'gallery'}
                aria-label="Visualizacao em galeria de capas"
                title="Galeria de capas"
                onClick={() => setDensity('gallery')}
              >
                <Grid2x2 size={16} />
              </button>
              <button
                type="button"
                className={`filter-chip ${density === 'compact' ? 'is-active' : ''}`}
                style={{ minWidth: 40, justifyContent: 'center', padding: 0 }}
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

        {/* Conteudo / Estados */}
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
                onTogglePin={handleTogglePin}
                onQuickUpdateStop={openQuickStopModal}
                onEdit={openEditItemModal}
                onDelete={(it) => setItemPendingDelete(it)}
              />
            ))}
          </section>
        )}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
              <select
                id="item-tab"
                className="select-input"
                value={formTabId}
                onChange={(e) => setFormTabId(e.target.value)}
              >
                {tabs.map((tab) => (
                  <option key={tab.id} value={tab.id}>
                    {tab.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="item-status">
                Status
              </label>
              <select
                id="item-status"
                className="select-input"
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value as ReadingStatus)}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
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
              Imagem de capa (opcional · URL https ou miniatura automatica)
            </label>
            <input
              id="item-cover"
              type="text"
              className="text-input"
              placeholder="https://site.com/capa.jpg"
              value={formCover.startsWith('data:image/') ? '' : formCover}
              onChange={(e) => setFormCover(e.target.value)}
            />
            {formCover.startsWith('data:image/') ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="field-hint">Miniatura local capturada da pagina ativa.</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFormCover('')}
                >
                  Remover miniatura
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
                      <select
                        id="delete-tab-move-select"
                        className="select-input"
                        value={deleteTabMoveTo}
                        onChange={(e) => setDeleteTabMoveTo(e.target.value)}
                      >
                        {tabs
                          .filter((t) => t.id !== editingTab.id)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              Mover links para "{t.name}"
                            </option>
                          ))}
                        <option value="__DELETE__">
                          Apagar tambem todos os links desta aba
                        </option>
                      </select>
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
        onClose={() => setBatchModalOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setBatchModalOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={selectedBrowserUrls.size === 0}
              onClick={() => handleSaveSelectedBrowserTabs(false)}
            >
              Salvar ({selectedBrowserUrls.size})
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={selectedBrowserUrls.size === 0}
              onClick={() => handleSaveSelectedBrowserTabs(true)}
            >
              Salvar e fechar abas ({selectedBrowserUrls.size})
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p className="field-hint">
            Selecione as abas abertas que deseja guardar na estante para liberar memoria no
            Chrome sem perder onde parou.
          </p>

          <div className="field-group">
            <label className="field-label" htmlFor="batch-target-tab">
              Guardar na aba da estante
            </label>
            <select
              id="batch-target-tab"
              className="select-input"
              value={batchTargetTabId}
              onChange={(e) => setBatchTargetTabId(e.target.value)}
            >
              {tabs.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.name}
                </option>
              ))}
            </select>
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
    </div>
  );
}
