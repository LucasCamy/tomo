import { useState } from 'react';
import {
  ExternalLink,
  Globe,
  Pencil,
  Pin,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { SavedLinkItem } from '../types/shelf';
import { extractNumericProgress } from '../lib/progress';
import { StatusBadge } from './ShelfIcons';

interface LinkCardProps {
  item: SavedLinkItem;
  tabName?: string;
  showTabBadge: boolean;
  onOpenLink: (item: SavedLinkItem) => void;
  onStepProgress: (item: SavedLinkItem, delta: number) => void;
  onCycleStatus: (item: SavedLinkItem) => void;
  onTogglePin: (item: SavedLinkItem) => void;
  onQuickUpdateStop: (item: SavedLinkItem) => void;
  onEdit: (item: SavedLinkItem) => void;
  onDelete: (item: SavedLinkItem) => void;
}

function formatUpdatedRelative(isoDate: string): string {
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) return 'Recente';

  const diffMs = Date.now() - timestamp;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 2) return 'Agora';
  if (diffMin < 60) return `ha ${diffMin} min`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `ha ${diffHours} h`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'ha 1 dia';
  if (diffDays < 30) return `ha ${diffDays} dias`;

  return new Date(timestamp).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
}

function buildMonogram(title: string): string {
  const words = title
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return 'TM';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export function LinkCard({
  item,
  tabName,
  showTabBadge,
  onOpenLink,
  onStepProgress,
  onCycleStatus,
  onTogglePin,
  onQuickUpdateStop,
  onEdit,
  onDelete,
}: LinkCardProps) {
  const [coverBroken, setCoverBroken] = useState(false);
  const [faviconBroken, setFaviconBroken] = useState(false);

  const hasValidCover = Boolean(item.coverImage) && !coverBroken;
  const numericProgress = extractNumericProgress(item.progressLabel);
  const canDecrement = numericProgress === null || numericProgress > 0;

  return (
    <article className={`link-card ${item.pinned ? 'is-pinned' : ''}`}>
      <div className="card-cover-wrap">
        {hasValidCover ? (
          <img
            src={item.coverImage}
            alt={`Capa de ${item.title}`}
            className="card-cover-img"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setCoverBroken(true)}
          />
        ) : (
          <div className="card-cover-fallback" aria-hidden="true">
            <span className="fallback-monogram">{buildMonogram(item.title)}</span>
            <span className="fallback-domain">{item.domain}</span>
          </div>
        )}

        <div className="card-top-badges">
          <StatusBadge
            status={item.status}
            itemTitle={item.title}
            onClick={() => onCycleStatus(item)}
          />
          <button
            type="button"
            className={`pin-btn ${item.pinned ? 'is-pinned' : ''}`}
            onClick={() => onTogglePin(item)}
            aria-label={item.pinned ? `Desafixar ${item.title}` : `Fixar ${item.title} no topo`}
            aria-pressed={item.pinned}
            title={item.pinned ? 'Fixado no topo' : 'Fixar no topo'}
          >
            <Pin size={15} aria-hidden="true" />
          </button>
        </div>

        {item.progressLabel ? (
          <div className="card-progress-bar">
            <div className="progress-pill-group">
              {numericProgress !== null ? (
                <button
                  type="button"
                  className="progress-step-btn progress-step-btn--prev"
                  disabled={!canDecrement}
                  onClick={() => onStepProgress(item, -1)}
                  aria-label={`Voltar progresso de ${item.title} em 1`}
                  title="Voltar -1 capitulo"
                >
                  -1
                </button>
              ) : null}
              <span className="progress-pill-label">{item.progressLabel}</span>
              <button
                type="button"
                className="progress-step-btn"
                onClick={() => onStepProgress(item, 1)}
                aria-label={`Avancar progresso de ${item.title} em 1`}
                title="Avancar +1 capitulo"
              >
                +1
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="card-content-col">
        <div className="card-body">
          <div className="card-domain-row">
            <span className="domain-chip">
              {item.faviconUrl && !faviconBroken ? (
                <img
                  src={item.faviconUrl}
                  alt=""
                  aria-hidden="true"
                  referrerPolicy="no-referrer"
                  onError={() => setFaviconBroken(true)}
                />
              ) : (
                <Globe size={13} aria-hidden="true" />
              )}
              <span>{item.domain}</span>
            </span>
            <span className="font-data">{formatUpdatedRelative(item.updatedAt)}</span>
          </div>

          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="card-title-link"
            onClick={(event) => {
              event.preventDefault();
              onOpenLink(item);
            }}
          >
            {item.title}
          </a>

          {item.notes ? <p className="card-notes">{item.notes}</p> : null}

          {showTabBadge && tabName ? (
            <span className="card-tab-pill">{tabName}</span>
          ) : null}
        </div>

        <div className="card-footer">
          <button
            type="button"
            className="btn btn-primary btn-open"
            onClick={() => onOpenLink(item)}
          >
            <ExternalLink size={15} aria-hidden="true" />
            <span>{item.progressLabel ? 'Continuar' : 'Abrir site'}</span>
          </button>

          <button
            type="button"
            className="btn btn-card-tool"
            onClick={() => onQuickUpdateStop(item)}
            aria-label={`Atualizar capitulo ou link de ${item.title}`}
            title="Atualizar parada (capitulo e link)"
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="btn btn-card-tool"
            onClick={() => onEdit(item)}
            aria-label={`Editar ${item.title}`}
            title="Editar detalhes"
          >
            <Pencil size={16} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="btn btn-card-tool btn-card-tool--danger"
            onClick={() => onDelete(item)}
            aria-label={`Remover ${item.title}`}
            title="Remover da estante"
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}
