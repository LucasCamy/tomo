import type { SavedLinkItem } from '../types/shelf';
import { extractOpenGraphFromTab, isChromeExtensionEnv } from './chromeBridge';
import { updateSavedLink } from './db';
import { sanitizeCoverSource, sanitizeHttpUrl } from './progress';

export interface ShelfSyncProgress {
  current: number;
  total: number;
  item: SavedLinkItem;
  status: 'online' | 'offline' | 'cover-updated' | 'unchanged';
  detail?: string;
}

export interface InactiveShelfLink {
  item: SavedLinkItem;
  reason: string;
}

export interface ShelfSyncSummary {
  total: number;
  online: number;
  offline: number;
  coversUpdated: number;
  inactiveItems: InactiveShelfLink[];
  aborted?: boolean;
}

export interface ShelfSyncOptions {
  checkHealth?: boolean;
  fillMissingCovers?: boolean;
  forceCovers?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: ShelfSyncProgress) => void;
}

/**
 * Aguarda uma aba do Chrome concluir o carregamento com tempo limite de seguranca.
 */
function waitForTabCompletion(
  tabId: number,
  timeoutMs = 4500,
  signal?: AbortSignal
): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;

    const cleanup = () => {
      resolved = true;
      chrome.tabs.onUpdated.removeListener(onUpdatedListener);
      window.clearTimeout(timer);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const onUpdatedListener = (
      updatedId: number,
      changeInfo: chrome.tabs.TabChangeInfo
    ) => {
      if (updatedId === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve(true);
      }
    };

    const timer = window.setTimeout(() => {
      if (!resolved) {
        cleanup();
        resolve(false);
      }
    }, timeoutMs);

    const onAbort = () => {
      if (!resolved) {
        cleanup();
        resolve(false);
      }
    };

    if (signal?.aborted) {
      resolve(false);
      return;
    }

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    chrome.tabs.onUpdated.addListener(onUpdatedListener);
  });
}

/**
 * Executa a auditoria de saude e sincronizacao de links salvos em fila sequencial.
 * Abre no maximo 1 aba discreta em segundo plano por vez, fechando-a imediatamente
 * para nao sobrecarregar o Chrome e preservar a memoria do computador.
 */
export async function auditAndSyncShelfLinks(
  items: SavedLinkItem[],
  options: ShelfSyncOptions = {}
): Promise<ShelfSyncSummary> {
  const {
    checkHealth = true,
    fillMissingCovers = true,
    forceCovers = false,
    signal,
    onProgress,
  } = options;

  const summary: ShelfSyncSummary = {
    total: items.length,
    online: 0,
    offline: 0,
    coversUpdated: 0,
    inactiveItems: [],
    aborted: false,
  };

  if (items.length === 0) return summary;

  // Ambiente de desenvolvimento / testes mockados (sem APIs nativas do Chrome)
  if (!isChromeExtensionEnv()) {
    for (let i = 0; i < items.length; i++) {
      if (signal?.aborted) {
        summary.aborted = true;
        break;
      }
      const item = items[i];
      const valid = Boolean(sanitizeHttpUrl(item.url));
      if (valid) {
        summary.online++;
      } else {
        summary.offline++;
        summary.inactiveItems.push({
          item,
          reason: 'Endereco URL invalido ou protocolo bloqueado',
        });
      }

      onProgress?.({
        current: i + 1,
        total: items.length,
        item,
        status: valid ? 'online' : 'offline',
        detail: valid ? 'Ativo (simulado)' : 'URL invalida',
      });
      await new Promise((r) => setTimeout(r, 60));
    }
    return summary;
  }

  // Ambiente de producao na extensao Chrome
  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) {
      summary.aborted = true;
      break;
    }

    const item = items[i];
    const safeUrl = sanitizeHttpUrl(item.url);

    if (!safeUrl) {
      summary.offline++;
      summary.inactiveItems.push({
        item,
        reason: 'URL com formato invalido',
      });
      onProgress?.({
        current: i + 1,
        total: items.length,
        item,
        status: 'offline',
        detail: 'URL invalida',
      });
      continue;
    }

    let createdTabId: number | undefined;
    try {
      // 1. Cria aba oculta em segundo plano (active: false, nao rouba foco)
      const tab = await chrome.tabs.create({
        url: safeUrl,
        active: false,
      });
      createdTabId = tab.id;

      if (createdTabId === undefined) {
        summary.offline++;
        summary.inactiveItems.push({
          item,
          reason: 'Falha ao instanciar aba no navegador',
        });
        continue;
      }

      // 2. Aguarda carregamento com timeout seguro de 4.5 segundos se checkHealth estiver ativo
      const isOnline = checkHealth
        ? await waitForTabCompletion(createdTabId, 4500, signal)
        : true;

      if (signal?.aborted) {
        summary.aborted = true;
        break;
      }

      if (!isOnline) {
        summary.offline++;
        summary.inactiveItems.push({
          item,
          reason: 'Tempo limite esgotado ou dominio inativo',
        });
        onProgress?.({
          current: i + 1,
          total: items.length,
          item,
          status: 'offline',
          detail: 'Dominio nao respondeu a tempo',
        });
      } else {
        summary.online++;
        let coverUpdated = false;

        // 3. Preenche a capa se o card estiver sem capa (ou se forca de capa estiver ativa)
        const shouldExtractCover = (!item.coverImage && fillMissingCovers) || forceCovers;
        if (shouldExtractCover) {
          try {
            const meta = await extractOpenGraphFromTab(createdTabId);
            const safeCover = sanitizeCoverSource(meta.ogImage);
            if (safeCover) {
              await updateSavedLink(item.id, { coverImage: safeCover });
              summary.coversUpdated++;
              coverUpdated = true;
            }
          } catch {
            // capa opcional, nao invalida o status de online
          }
        }

        onProgress?.({
          current: i + 1,
          total: items.length,
          item,
          status: coverUpdated ? 'cover-updated' : 'online',
          detail: coverUpdated ? 'Capa recuperada e salva' : 'Online e saudavel',
        });
      }
    } catch {
      summary.offline++;
      summary.inactiveItems.push({
        item,
        reason: 'Erro de conexao ou dominio inacessivel',
      });
      onProgress?.({
        current: i + 1,
        total: items.length,
        item,
        status: 'offline',
        detail: 'Falha de conexao',
      });
    } finally {
      // 4. Garante SEMPRE o fechamento imediato da aba temporaria
      if (createdTabId !== undefined) {
        try {
          await chrome.tabs.remove(createdTabId);
        } catch {
          // aba pode ja ter sido encerrada
        }
      }
    }

    // Pequena pausa amigavel entre abas (80ms) para nao saturar o Chrome
    if (i + 1 < items.length && !signal?.aborted) {
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  return summary;
}
