import {
  BookOpen,
  Bookmark,
  CheckSquare,
  CircleCheck,
  CircleDashed,
  Code,
  Compass,
  Folder,
  GraduationCap,
  Layers,
  ShoppingBag,
  Sparkles,
  Tv,
} from 'lucide-react';
import type { ReadingStatus, TabIconName } from '../types/shelf';

export const TAB_ICON_OPTIONS: Array<{ value: TabIconName; label: string }> = [
  { value: 'book-open', label: 'Leitura e Mangas' },
  { value: 'graduation-cap', label: 'Estudos' },
  { value: 'compass', label: 'Explorar' },
  { value: 'tv', label: 'Videos e Series' },
  { value: 'code', label: 'Programacao' },
  { value: 'layers', label: 'Projetos' },
  { value: 'shopping-bag', label: 'Compras' },
  { value: 'sparkles', label: 'Inspiracoes' },
  { value: 'folder', label: 'Pasta' },
  { value: 'bookmark', label: 'Favoritos' },
];

export function TabCollectionIcon({
  name,
  size = 17,
  className,
}: {
  name: TabIconName;
  size?: number;
  className?: string;
}) {
  switch (name) {
    case 'book-open':
      return <BookOpen size={size} className={className} aria-hidden="true" />;
    case 'compass':
      return <Compass size={size} className={className} aria-hidden="true" />;
    case 'layers':
      return <Layers size={size} className={className} aria-hidden="true" />;
    case 'tv':
      return <Tv size={size} className={className} aria-hidden="true" />;
    case 'graduation-cap':
      return <GraduationCap size={size} className={className} aria-hidden="true" />;
    case 'code':
      return <Code size={size} className={className} aria-hidden="true" />;
    case 'shopping-bag':
      return <ShoppingBag size={size} className={className} aria-hidden="true" />;
    case 'folder':
      return <Folder size={size} className={className} aria-hidden="true" />;
    case 'sparkles':
      return <Sparkles size={size} className={className} aria-hidden="true" />;
    case 'bookmark':
    default:
      return <Bookmark size={size} className={className} aria-hidden="true" />;
  }
}

export const STATUS_OPTIONS: Array<{
  value: ReadingStatus;
  label: string;
  tone: 'action' | 'success' | 'warning' | 'default';
}> = [
  { value: 'reading', label: 'Lendo', tone: 'action' },
  { value: 'up_to_date', label: 'Em dia', tone: 'success' },
  { value: 'paused', label: 'Pausado', tone: 'warning' },
  { value: 'completed', label: 'Concluido', tone: 'default' },
];

export function getNextReadingStatus(current: ReadingStatus): ReadingStatus {
  switch (current) {
    case 'reading':
      return 'up_to_date';
    case 'up_to_date':
      return 'paused';
    case 'paused':
      return 'completed';
    case 'completed':
      return 'reading';
  }
}

export function getReadingStatusLabel(status: ReadingStatus): string {
  switch (status) {
    case 'reading':
      return 'Lendo';
    case 'up_to_date':
      return 'Em dia';
    case 'paused':
      return 'Pausado';
    case 'completed':
      return 'Concluido';
  }
}

export function StatusIcon({
  status,
  size = 15,
}: {
  status: ReadingStatus;
  size?: number;
}) {
  switch (status) {
    case 'reading':
      return <BookOpen size={size} aria-hidden="true" />;
    case 'up_to_date':
      return <CircleCheck size={size} aria-hidden="true" />;
    case 'paused':
      return <CircleDashed size={size} aria-hidden="true" />;
    case 'completed':
      return <CheckSquare size={size} aria-hidden="true" />;
  }
}

export function StatusBadge({
  status,
  itemTitle,
  onClick,
}: {
  status: ReadingStatus;
  itemTitle?: string;
  onClick?: () => void;
}) {
  const label = getReadingStatusLabel(status);
  const content = (
    <>
      <StatusIcon status={status} size={13} />
      <span>{label}</span>
    </>
  );

  if (onClick) {
    const nextLabel = getReadingStatusLabel(getNextReadingStatus(status));
    return (
      <button
        type="button"
        className={`status-badge status-badge--${status} is-interactive`}
        onClick={onClick}
        aria-label={
          itemTitle
            ? `Status de ${itemTitle}: ${label}. Clique para mudar para ${nextLabel}`
            : `Status: ${label}. Clique para mudar para ${nextLabel}`
        }
        title={`Mudar status para "${nextLabel}" (1 clique)`}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={`status-badge status-badge--${status}`}>
      {content}
    </span>
  );
}
