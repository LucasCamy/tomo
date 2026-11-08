import type { SavedLinkItem } from '../types/shelf';

/**
 * Valida e normaliza apenas URLs http/https seguras.
 * Retorna null se a URL for vazia, invalida ou de esquema bloqueado (javascript:, chrome:, etc.).
 */
export function sanitizeHttpUrl(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function sanitizeCoverSource(rawCover: string | undefined): string | undefined {
  if (!rawCover) return undefined;
  const trimmed = rawCover.trim();
  if (!trimmed) return undefined;
  if (/^data:image\/(webp|png|jpeg|jpg|avif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }
  const safeHttp = sanitizeHttpUrl(trimmed);
  return safeHttp ?? undefined;
}

export function extractDomain(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return 'site-local';
  }
}

const PROGRESS_PATTERNS: Array<{ regex: RegExp; prefix: string }> = [
  {
    regex: /(?:cap[ií]tulo|cap\.?|chapter|chap\.?|ch\.?)\s*[-#:_/\s]*0*(\d+(?:[.,]\d+)?)/i,
    prefix: 'Cap.',
  },
  {
    regex: /\/(?:cap(?:itulo)?|chapter|chap|ch|c)[-_]?0*(\d+(?:[.,]\d+)?)(?:\/|$|\?|-)/i,
    prefix: 'Cap.',
  },
  {
    regex: /(?:epis[oó]dio|ep\.?|episode)\s*[-#:_/\s]*0*(\d+(?:[.,]\d+)?)/i,
    prefix: 'Ep.',
  },
  {
    regex: /(?:volume|vol\.?|tomo)\s*[-#:_/\s]*0*(\d+(?:[.,]\d+)?)/i,
    prefix: 'Vol.',
  },
  {
    regex: /(?:p[aá]gina|pag\.?|p[aá]g\.?|page)\s*[-#:_/\s]*0*(\d+)/i,
    prefix: 'Pag.',
  },
];

export function detectProgressFromTab(title: string, url: string): string {
  const decodedUrl = safeDecode(url);
  for (const { regex, prefix } of PROGRESS_PATTERNS) {
    const fromTitle = title.match(regex);
    if (fromTitle?.[1]) {
      return `${prefix} ${fromTitle[1].replace(',', '.')}`;
    }
    const fromUrl = decodedUrl.match(regex);
    if (fromUrl?.[1]) {
      return `${prefix} ${fromUrl[1].replace(',', '.')}`;
    }
  }
  return '';
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Remove sufixos repetitivos de capitulo e nome do leitor online para deixar o card limpo,
 * preservando o titulo original caso a limpeza fique curta demais.
 */
export function suggestCleanTitle(rawTitle: string): string {
  const trimmed = rawTitle.trim();
  if (!trimmed) return '';

  let cleaned = trimmed
    .replace(/\s*[|·•]\s*[^|·•]{2,42}$/u, '')
    .replace(
      /\s*(?:[-–—:]\s*)?(?:ler\s+)?(?:cap[ií]tulo|cap\.?|chapter|ch\.?|epis[oó]dio|ep\.?|temporada|season)\s*#?\s*\d+(?:[.,]\d+)?.*$/iu,
      ''
    )
    .replace(/\s+[—–]\s+[^—–|-]{2,30}$/u, '')
    .replace(
      /\s+-\s+[^-]{0,24}(?:[a-z0-9_-]*(?:scans?|scantrad|toons?|mang[aá]s?|manhwas?|manhuas?|webtoons?|comics?|leitor|online|oficial|pt-br|reader))\b[^-]*$/iu,
      ''
    )
    .replace(/^(?:ler|assistir)\s+/iu, '')
    .replace(/\s+(?:online|pt-br|em\s+portugu[eê]s|scan|mang[aá]s?)$/iu, '')
    .replace(/^[\s\-–—:|·•]+|[\s\-–—:|·•]+$/gu, '')
    .trim();

  if (cleaned.length < 2) {
    cleaned = trimmed.replace(/^[\s\-–—:|·•]+|[\s\-–—:|·•]+$/gu, '').trim() || trimmed;
  }
  return cleaned;
}

export function extractNumericProgress(progressLabel?: string): number | null {
  if (!progressLabel) return null;
  const match = progressLabel.match(/(\d+(?:[.,]\d+)?)/);
  if (!match?.[1]) return null;
  const val = Number.parseFloat(match[1].replace(',', '.'));
  return Number.isFinite(val) ? val : null;
}

export function formatBadgeProgress(progressLabel?: string): string {
  if (!progressLabel?.trim()) return '';
  const num = extractNumericProgress(progressLabel);
  if (num === null) return 'OK';
  const compact = String(num);
  if (compact.length <= 5) return compact;
  if (Number.isInteger(num)) {
    return `${compact.slice(0, 3)}+`;
  }
  const floored = String(Math.floor(num));
  return floored.length <= 4 ? floored : `${floored.slice(0, 3)}+`;
}

export function normalizeDomainHost(
  rawInput: string
): { host: string; protocol: 'http:' | 'https:' } | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const explicitHttp = /^http:\/\//i.test(trimmed);
  const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (!host || !host.includes('.')) return null;
    return {
      host,
      protocol: explicitHttp ? 'http:' : 'https:',
    };
  } catch {
    return null;
  }
}

export function rewriteUrlDomain(
  rawUrl: string,
  targetHost: string,
  targetProtocol: 'http:' | 'https:' = 'https:'
): string | null {
  const safe = sanitizeHttpUrl(rawUrl);
  if (!safe) return null;
  try {
    const parsed = new URL(safe);
    const hadWww = /^www\./i.test(parsed.hostname);
    const cleanTarget = targetHost.replace(/^www\./i, '').toLowerCase();
    parsed.hostname = hadWww && !cleanTarget.startsWith('www.')
      ? cleanTarget
      : cleanTarget;
    parsed.protocol = targetProtocol;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function stepProgressLabel(current: string | undefined, delta: number): string {
  const trimmed = (current ?? '').trim();
  if (!trimmed) {
    return delta > 0 ? 'Cap. 1' : '';
  }

  const match = trimmed.match(/^(.*?)(\d+(?:\.\d+)?)(\D*)$/);
  if (!match) {
    return trimmed;
  }

  const [, rawPrefix, numStr, suffix] = match;
  const currentValue = Number.parseFloat(numStr);
  if (Number.isNaN(currentValue)) return trimmed;

  const hasFraction = !Number.isInteger(currentValue);
  let nextValue: number;
  if (hasFraction) {
    nextValue = delta > 0 ? Math.floor(currentValue) + delta : Math.ceil(currentValue) + delta;
  } else {
    nextValue = currentValue + delta;
  }

  nextValue = Math.max(0, nextValue);
  const prefix = rawPrefix || '';
  return `${prefix}${nextValue}${suffix}`.trim();
}

function normalizeForMatch(text: string): string {
  return suggestCleanTitle(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractSeriesBasePath(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const cleanedPath = u.pathname
      .toLowerCase()
      .replace(/\/(?:cap(?:itulo)?|chapter|chap|ch|ep(?:isodio)?|c)[-_./]?\d+(?:[.,]\d+)?.*$/i, '')
      .replace(/[-_](?:cap(?:itulo)?|chapter|chap|ch|ep)[-_]?\d+(?:[.,]\d+)?.*$/i, '')
      .replace(/\/+$/, '');

    const segments = cleanedPath.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    if (segments.length === 1 && segments[0].length < 4) return null;
    return `${u.hostname.replace(/^www\./, '')}/${segments.join('/')}`;
  } catch {
    return null;
  }
}

export function findMatchingSavedItem(
  candidate: { title: string; url: string },
  items: SavedLinkItem[]
): SavedLinkItem | null {
  const safeUrl = sanitizeHttpUrl(candidate.url);
  if (!safeUrl || items.length === 0) return null;

  // 1. Mesma URL exata
  const exact = items.find((item) => item.url === safeUrl);
  if (exact) return exact;

  // 2. Mesmo caminho base de serie no mesmo site (ex.: /obra/one-piece/cap-1110 vs /obra/one-piece/cap-1115)
  const candidateBase = extractSeriesBasePath(safeUrl);
  if (candidateBase) {
    const pathMatch = items.find((item) => extractSeriesBasePath(item.url) === candidateBase);
    if (pathMatch) return pathMatch;
  }

  // 3. Mesmo titulo de obra normalizado (>= 4 caracteres)
  const normCandidate = normalizeForMatch(candidate.title);
  if (normCandidate.length >= 4) {
    const titleMatch = items.find((item) => normalizeForMatch(item.title) === normCandidate);
    if (titleMatch) return titleMatch;
  }

  return null;
}
