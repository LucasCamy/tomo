import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bookmark,
  CircleCheck,
  ExternalLink,
  FolderPlus,
  Keyboard,
  LayoutGrid,
  Moon,
  Plus,
  RefreshCw,
  Sparkles,
  Sun,
  XCircle,
} from 'lucide-react';
import {
  SelectDropdown,
  type DropdownOption,
} from '../components/SelectDropdown';
import {
  STATUS_OPTIONS,
  StatusIcon,
  TabCollectionIcon,
} from '../components/ShelfIcons';
import {
  closeBrowserTabs,
  inspectActiveBrowserTab,
  openExtensionDashboard,
} from '../lib/chromeBridge';
import {
  createCollectionTab,
  createSavedLink,
  loadShelfState,
  updateSavedLink,
} from '../lib/db';
import {
  detectProgressFromTab,
  findMatchingSavedItem,
  sanitizeHttpUrl,
  stepProgressLabel,
} from '../lib/progress';
import {
  getExtensionShortcuts,
  getPreferredTabId,
  openChromeShortcutsSettings,
  setPreferredTabId,
} from '../lib/shortcuts';
import { applyTheme, getInitialTheme, type ThemeMode } from '../lib/theme';
import type {
  BrowserTabSnapshot,
  CollectionTab,
  ReadingStatus,
  SavedLinkItem,
} from '../types/shelf';

export function PopupApp() {
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [loading, setLoading] = useState(true);
  const [tabs, setTabs] = useState<CollectionTab[]>([]);
  const [items, setItems] = useState<SavedLinkItem[]>([]);
  const [snapshot, setSnapshot] = useState<BrowserTabSnapshot | null>(null);
  const [quickSaveCombo, setQuickSaveCombo] = useState('Alt+Shift+S');

  // Formulario de salvamento
  const [title, setTitle] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [selectedTabId, setSelectedTabId] = useState('');
  const [progressLabel, setProgressLabel] = useState('');
  const [status, setStatus] = useState<ReadingStatus>('reading');
  const [notes, setNotes] = useState('');
  const [coverChoice, setCoverChoice] = useState<'og' | 'capture'>('og');

  // Criacao rapida de nova aba
  const [creatingTab, setCreatingTab] = useState(false);
  const [newTabName, setNewTabName] = useState('');

  // Controle de correspondencia existente e feedback
  const [ignoreMatch, setIgnoreMatch] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [savedBanner, setSavedBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    let active = true;
    Promise.all([
      loadShelfState(),
      inspectActiveBrowserTab(),
      getExtensionShortcuts(),
    ])
      .then(async ([shelf, activeSnap, shortcuts]) => {
        if (!active) return;
        setTabs(shelf.tabs);
        setItems(shelf.items);
        setSnapshot(activeSnap);

        const quickCmd = shortcuts.find((s) => s.name === 'quick-save-tab');
        if (quickCmd?.shortcut) {
          setQuickSaveCombo(quickCmd.shortcut);
        }

        const fallbackId = shelf.tabs[0]?.id ?? '';
        const preferred = await getPreferredTabId(fallbackId);
        const resolvedTabId = shelf.tabs.some((t) => t.id === preferred)
          ? preferred
          : fallbackId;
        setSelectedTabId(resolvedTabId);

        if (activeSnap) {
          setTitle(activeSnap.cleanTitle || activeSnap.title);
          setManualUrl(activeSnap.url);
          setProgressLabel(activeSnap.detectedProgress);
          setCoverChoice(activeSnap.ogImageUrl ? 'og' : 'capture');

          const existing = findMatchingSavedItem(activeSnap, shelf.items);
          if (existing) {
            setSelectedTabId(existing.tabId);
            setStatus(existing.status);
          }
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const matchedItem = useMemo(() => {
    if (!snapshot || ignoreMatch) return null;
    return findMatchingSavedItem(snapshot, items);
  }, [snapshot, items, ignoreMatch]);

  const activeCoverPreview = useMemo(() => {
    if (!snapshot) return undefined;
    if (coverChoice === 'og' && snapshot.ogImageUrl) return snapshot.ogImageUrl;
    return snapshot.capturedDataUrl || snapshot.ogImageUrl;
  }, [snapshot, coverChoice]);

  const tabOptions = useMemo<DropdownOption<string>[]>(
    () =>
      tabs.map((tab, idx) => ({
        value: tab.id,
        label: idx < 9 ? `${idx + 1}. ${tab.name}` : tab.name,
        icon: <TabCollectionIcon name={tab.icon} size={15} />,
      })),
    [tabs]
  );

  const statusOptions = useMemo<DropdownOption<ReadingStatus>[]>(
    () =>
      STATUS_OPTIONS.map((opt) => ({
        value: opt.value,
        label: opt.label,
        tone: opt.tone,
        icon: <StatusIcon status={opt.value} size={15} />,
      })),
    []
  );

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const handleCreateQuickTab = async () => {
    const trimmed = newTabName.trim();
    if (!trimmed) {
      setErrorMsg('Digite um nome para criar a nova aba.');
      return;
    }
    setErrorMsg('');
    try {
      const created = await createCollectionTab({
        name: trimmed,
        icon: 'bookmark',
      });
      setTabs((prev) => [...prev, created]);
      setSelectedTabId(created.id);
      setPreferredTabId(created.id);
      setNewTabName('');
      setCreatingTab(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao criar aba.');
    }
  };

  const handleQuickUpdateMatched = useCallback(
    async (closeTabAfter: boolean) => {
      if (!matchedItem || !snapshot || submitting) return;
      setSubmitting(true);
      setErrorMsg('');
      try {
        const nextProgress =
          progressLabel.trim() ||
          snapshot.detectedProgress ||
          matchedItem.progressLabel;

        const updated = await updateSavedLink(matchedItem.id, {
          url: snapshot.url,
          progressLabel: nextProgress,
          faviconUrl: snapshot.faviconUrl ?? matchedItem.faviconUrl,
          coverImage: activeCoverPreview ?? matchedItem.coverImage,
        });

        if (closeTabAfter && snapshot.chromeTabId !== undefined) {
          await closeBrowserTabs([snapshot.chromeTabId]);
          window.close();
          return;
        }

        if (updated) {
          setItems((prev) =>
            prev.map((it) => (it.id === updated.id ? updated : it))
          );
        }
        setSavedBanner(
          `Parada atualizada: ${matchedItem.title}${
            nextProgress ? ` (${nextProgress})` : ''
          }`
        );
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? err.message : 'Falha ao atualizar parada.'
        );
      } finally {
        setSubmitting(false);
      }
    },
    [matchedItem, snapshot, submitting, progressLabel, activeCoverPreview]
  );

  const handleSaveNewItem = useCallback(
    async (closeTabAfter: boolean) => {
      if (submitting) return;
      setErrorMsg('');
      const targetUrl = sanitizeHttpUrl(snapshot ? snapshot.url : manualUrl);
      if (!targetUrl) {
        setErrorMsg('Informe um endereco http:// ou https:// valido para salvar.');
        return;
      }
      if (!selectedTabId) {
        setErrorMsg('Selecione uma aba de destino.');
        return;
      }

      setSubmitting(true);
      try {
        setPreferredTabId(selectedTabId);
        const created = await createSavedLink({
          tabId: selectedTabId,
          title: title.trim() || snapshot?.title || targetUrl,
          url: targetUrl,
          faviconUrl: snapshot?.faviconUrl,
          coverImage: activeCoverPreview,
          progressLabel: progressLabel.trim() || undefined,
          status,
          notes: notes.trim() || undefined,
        });

        if (closeTabAfter && snapshot?.chromeTabId !== undefined) {
          await closeBrowserTabs([snapshot.chromeTabId]);
          window.close();
          return;
        }

        const tabName =
          tabs.find((t) => t.id === selectedTabId)?.name ?? 'Estante';
        setItems((prev) => [created, ...prev]);
        setSavedBanner(
          `Salvo em ${tabName}${
            created.progressLabel ? ` · ${created.progressLabel}` : ''
          }`
        );
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? err.message : 'Nao foi possivel salvar.'
        );
      } finally {
        setSubmitting(false);
      }
    },
    [
      submitting,
      snapshot,
      manualUrl,
      selectedTabId,
      title,
      activeCoverPreview,
      progressLabel,
      status,
      notes,
      tabs,
    ]
  );

  // Atalhos de teclado rapidos dentro do Popup
  useEffect(() => {
    if (loading || savedBanner) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl+Enter ou Cmd+Enter -> salvar (ou atualizar parada) de qualquer campo
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === 'Enter') {
        event.preventDefault();
        if (matchedItem && snapshot) {
          handleQuickUpdateMatched(false);
        } else {
          handleSaveNewItem(false);
        }
        return;
      }

      // Alt+Enter ou Ctrl+Shift+Enter -> salvar/atualizar e ja fechar a aba
      if (
        (event.altKey && event.key === 'Enter') ||
        ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'Enter')
      ) {
        event.preventDefault();
        if (matchedItem && snapshot) {
          handleQuickUpdateMatched(true);
        } else {
          handleSaveNewItem(true);
        }
        return;
      }

      // Alt+Seta Cima / Alt+Seta Baixo -> avanca/volta capitulo rapidamente
      if (event.altKey && event.key === 'ArrowUp') {
        event.preventDefault();
        setProgressLabel((prev) => stepProgressLabel(prev, 1));
        return;
      }
      if (event.altKey && event.key === 'ArrowDown') {
        event.preventDefault();
        setProgressLabel((prev) => stepProgressLabel(prev, -1));
        return;
      }

      // Alt+1..9 -> seleciona rapidamente a aba correspondente
      if (event.altKey && /^[1-9]$/.test(event.key) && !matchedItem) {
        const index = Number.parseInt(event.key, 10) - 1;
        const chosenTab = tabs[index];
        if (chosenTab) {
          event.preventDefault();
          setSelectedTabId(chosenTab.id);
          setPreferredTabId(chosenTab.id);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    loading,
    savedBanner,
    matchedItem,
    snapshot,
    tabs,
    handleQuickUpdateMatched,
    handleSaveNewItem,
  ]);

  return (
    <div className="popup-scroll-wrap">
      <main className="popup-shell">
      <header className="popup-header">
        <div className="brand-mark">
          <span className="brand-icon" aria-hidden="true">
            <Bookmark size={17} />
          </span>
          <div>
            <p className="brand-title">Tomo</p>
            <p className="brand-subtitle">Estante local de links</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => openExtensionDashboard()}
          >
            <LayoutGrid size={14} aria-hidden="true" />
            <span>Abrir Estante</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            onClick={handleToggleTheme}
            aria-label={
              theme === 'dark'
                ? 'Alternar para tema claro'
                : 'Alternar para tema escuro'
            }
            title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="local-status-box" role="status">
          Lendo dados da aba ativa...
        </div>
      ) : savedBanner ? (
        <section
          className="feedback-banner feedback-banner--success"
          style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}
          role="status"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
            <CircleCheck size={18} aria-hidden="true" />
            <span>{savedBanner}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={() => openExtensionDashboard()}
            >
              <ExternalLink size={15} aria-hidden="true" />
              <span>Ver na Estante</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setSavedBanner(null)}
            >
              Voltar
            </button>
          </div>
        </section>
      ) : matchedItem && snapshot ? (
        <form
          className="smart-match-card"
          aria-label="Continuando leitura salva"
          onSubmit={(e) => {
            e.preventDefault();
            handleQuickUpdateMatched(false);
          }}
        >
          <div className="smart-match-title">
            <Sparkles size={15} aria-hidden="true" />
            <span>Obra encontrada na sua estante</span>
          </div>

          <div>
            <strong style={{ display: 'block', fontSize: 15 }}>
              {matchedItem.title}
            </strong>
            <span className="field-hint font-data">
              Salvo em {tabs.find((t) => t.id === matchedItem.tabId)?.name ?? 'Estante'}
              {matchedItem.progressLabel
                ? ` · Anterior: ${matchedItem.progressLabel}`
                : ''}
            </span>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="match-progress-input">
              Novo capitulo ou parada atual
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                id="match-progress-input"
                type="text"
                className="text-input font-data"
                value={progressLabel}
                onChange={(e) => setProgressLabel(e.target.value)}
                placeholder="Ex.: Cap. 142"
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm font-data"
                onClick={() => setProgressLabel((p) => stepProgressLabel(p, 1))}
              >
                +1
              </button>
            </div>
          </div>

          {errorMsg ? (
            <p className="field-error" role="alert">
              <AlertCircle size={15} aria-hidden="true" />
              <span>{errorMsg}</span>
            </p>
          ) : null}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={submitting}
            >
              <RefreshCw size={15} aria-hidden="true" />
              <span>{submitting ? 'Atualizando...' : 'Atualizar parada'}</span>
            </button>

            {snapshot.chromeTabId !== undefined ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={submitting}
                onClick={() => handleQuickUpdateMatched(true)}
                title="Atualiza o link salvo e ja fecha esta aba do Chrome (Alt+Enter)"
              >
                <XCircle size={15} aria-hidden="true" />
                <span>Atualizar e fechar</span>
              </button>
            ) : null}
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setIgnoreMatch(true)}
          >
            Salvar como novo link separado
          </button>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSaveNewItem(false);
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          {snapshot ? (
            <div className="popup-cover-preview">
              <div className="popup-cover-thumb">
                {activeCoverPreview ? (
                  <img
                    src={activeCoverPreview}
                    alt="Miniatura capturada da pagina"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      color: 'var(--action)',
                    }}
                  >
                    {snapshot.domain.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  className="font-data"
                  style={{
                    fontSize: 12,
                    color: 'var(--muted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {snapshot.domain}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink)', marginTop: 2 }}>
                  {activeCoverPreview
                    ? 'Capa capturada automaticamente'
                    : 'Capa tipografica automatica'}
                </div>
                {snapshot.ogImageUrl && snapshot.capturedDataUrl ? (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button
                      type="button"
                      className={`filter-chip ${coverChoice === 'og' ? 'is-active' : ''}`}
                      style={{ minHeight: 26, padding: '0 8px', fontSize: 11 }}
                      onClick={() => setCoverChoice('og')}
                    >
                      Capa do site
                    </button>
                    <button
                      type="button"
                      className={`filter-chip ${
                        coverChoice === 'capture' ? 'is-active' : ''
                      }`}
                      style={{ minHeight: 26, padding: '0 8px', fontSize: 11 }}
                      onClick={() => setCoverChoice('capture')}
                    >
                      Foto da aba
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="field-group">
              <label className="field-label" htmlFor="popup-manual-url">
                Endereco do site (URL)
              </label>
              <input
                id="popup-manual-url"
                type="url"
                className="text-input"
                placeholder="https://exemplo.com/manga/capitulo-10"
                value={manualUrl}
                onChange={(e) => {
                  const next = e.target.value;
                  setManualUrl(next);
                  const autoProg = detectProgressFromTab(title, next);
                  if (autoProg && !progressLabel) {
                    setProgressLabel(autoProg);
                  }
                }}
              />
              <p className="field-hint">
                Abas internas do Chrome nao podem ser lidas automaticamente; cole um
                link ou abra a Estante.
              </p>
            </div>
          )}

          <div className="field-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <label className="field-label" htmlFor="popup-title">
                Titulo na estante
              </label>
              {snapshot && snapshot.cleanTitle !== snapshot.title ? (
                <button
                  type="button"
                  onClick={() =>
                    setTitle((curr) =>
                      curr === snapshot.title ? snapshot.cleanTitle : snapshot.title
                    )
                  }
                  style={{
                    border: 'none',
                    background: 'none',
                    color: 'var(--action)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {title === snapshot.title ? 'Limpar sufixo' : 'Usar titulo completo'}
                </button>
              ) : null}
            </div>
            <input
              id="popup-title"
              type="text"
              className="text-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nome do manga, artigo ou site"
            />
          </div>

          <div className="field-group">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <label className="field-label" htmlFor="popup-tab-select">
                Aba / Colecao
              </label>
              <button
                type="button"
                onClick={() => setCreatingTab((v) => !v)}
                style={{
                  border: 'none',
                  background: 'none',
                  color: 'var(--action)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: 0,
                }}
              >
                <FolderPlus size={13} aria-hidden="true" />
                <span>{creatingTab ? 'Cancelar' : 'Nova aba'}</span>
              </button>
            </div>

            {creatingTab ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  id="popup-new-tab-name"
                  name="newTabName"
                  aria-label="Nome da nova aba"
                  type="text"
                  className="text-input"
                  value={newTabName}
                  onChange={(e) => setNewTabName(e.target.value)}
                  placeholder="Ex.: Webtoons, Animes..."
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleCreateQuickTab}
                >
                  Criar
                </button>
              </div>
            ) : (
              <SelectDropdown
                id="popup-tab-select"
                ariaLabel="Aba ou colecao"
                size="compact"
                value={selectedTabId}
                options={tabOptions}
                onChange={(nextId) => {
                  setSelectedTabId(nextId);
                  setPreferredTabId(nextId);
                }}
              />
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field-group">
              <label className="field-label" htmlFor="popup-progress">
                Capitulo / Parada
              </label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  id="popup-progress"
                  type="text"
                  className="text-input font-data"
                  value={progressLabel}
                  onChange={(e) => setProgressLabel(e.target.value)}
                  placeholder="Ex.: Cap. 142"
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm font-data"
                  onClick={() => setProgressLabel((p) => stepProgressLabel(p, 1))}
                  aria-label="Somar 1 ao capitulo"
                  title="Alt + Seta Cima"
                >
                  +1
                </button>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="popup-status">
                Status
              </label>
              <SelectDropdown
                id="popup-status"
                ariaLabel="Status de leitura"
                size="compact"
                align="right"
                value={status}
                options={statusOptions}
                onChange={setStatus}
              />
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="popup-notes">
              Nota rapida (opcional)
            </label>
            <input
              id="popup-notes"
              type="text"
              className="text-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: Lancamento toda quarta-feira"
            />
          </div>

          {errorMsg ? (
            <p className="field-error" role="alert">
              <AlertCircle size={15} aria-hidden="true" />
              <span>{errorMsg}</span>
            </p>
          ) : null}

          <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={submitting}
              title="Enter ou Ctrl+Enter"
            >
              <Plus size={16} aria-hidden="true" />
              <span>{submitting ? 'Salvando...' : 'Salvar na estante'}</span>
            </button>

            {snapshot?.chromeTabId !== undefined ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={submitting}
                onClick={() => handleSaveNewItem(true)}
                title="Salva o site na estante e fecha esta aba (Alt+Enter)"
              >
                <XCircle size={15} aria-hidden="true" />
                <span>Salvar e fechar</span>
              </button>
            ) : null}
          </div>
        </form>
      )}

      {/* Rodape discreto com atalhos de teclado */}
      <footer className="popup-shortcut-bar" aria-label="Atalhos rapidos de teclado">
        <div className="popup-shortcut-items">
          <span className="popup-shortcut-item">
            <kbd className="kbd-badge">Enter</kbd>
            <span>salvar</span>
          </span>
          <span className="popup-shortcut-item">
            <kbd className="kbd-badge">Alt+Enter</kbd>
            <span>e fechar</span>
          </span>
          <span className="popup-shortcut-item">
            <kbd className="kbd-badge">{quickSaveCombo}</kbd>
            <span>direto no site</span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            openChromeShortcutsSettings().then((opened) => {
              if (!opened) {
                openExtensionDashboard();
              }
            });
          }}
          style={{
            border: 'none',
            background: 'none',
            color: 'var(--muted)',
            cursor: 'pointer',
            padding: 2,
            display: 'inline-flex',
            alignItems: 'center',
          }}
          aria-label="Configurar teclas de atalho no Chrome"
          title="Personalizar teclas em chrome://extensions/shortcuts"
        >
          <Keyboard size={14} aria-hidden="true" />
        </button>
      </footer>
      </main>
    </div>
  );
}
