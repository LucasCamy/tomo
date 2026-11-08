export const GITHUB_RELEASES_PAGE =
  'https://github.com/LucasCamy/tomo/releases/latest';
export const GITHUB_LATEST_RELEASE_API =
  'https://api.github.com/repos/LucasCamy/tomo/releases/latest';
export const REOPEN_DASHBOARD_STORAGE_KEY = 'tomo_reopen_dashboard_ts';

const FALLBACK_EXTENSION_VERSION = '1.3.2';
const ALLOWED_REPO_PATH_PREFIX = '/LucasCamy/tomo/';

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
  zipDownloadUrl: string | null;
  zipAssetName: string | null;
  publishedAt: string | null;
  releaseNotes: string;
  checkedAt: string;
}

export function parseSemver(raw: string): [number, number, number] | null {
  const cleaned = raw.trim();
  const match = cleaned.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/i);
  if (!match) return null;

  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  if (
    !Number.isFinite(major) ||
    !Number.isFinite(minor) ||
    !Number.isFinite(patch)
  ) {
    return null;
  }
  return [major, minor, patch];
}

/**
 * Compara a versao instalada (`currentVersion`) com a versao publicada (`latestVersion`).
 * Retorna `1` quando `latestVersion > currentVersion` (ha atualizacao),
 * `0` quando sao iguais, e `-1` quando `currentVersion > latestVersion`.
 */
export function compareSemver(
  currentVersion: string,
  latestVersion: string
): number {
  const cur = parseSemver(currentVersion);
  const lat = parseSemver(latestVersion);
  if (!cur || !lat) {
    throw new Error('Formato de versao invalido para comparacao.');
  }

  for (let i = 0; i < 3; i += 1) {
    if (lat[i] > cur[i]) return 1;
    if (lat[i] < cur[i]) return -1;
  }
  return 0;
}

export function sanitizeGitHubReleaseUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:') return null;
    if (parsed.hostname !== 'github.com') return null;
    if (!parsed.pathname.startsWith(ALLOWED_REPO_PATH_PREFIX)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function validateGitHubReleasePayload(
  raw: unknown,
  currentVersion: string
): UpdateCheckResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Resposta invalida ao consultar versoes no GitHub.');
  }

  const candidate = raw as Record<string, unknown>;
  const rawTag =
    typeof candidate.tag_name === 'string' ? candidate.tag_name : '';
  const parsedLatest = parseSemver(rawTag);
  if (!parsedLatest) {
    throw new Error(
      'Nao foi possivel identificar o numero da ultima versao publicada.'
    );
  }

  const normalizedCurrent =
    parseSemver(currentVersion)?.join('.') ?? FALLBACK_EXTENSION_VERSION;
  const latestVersion = parsedLatest.join('.');
  const hasUpdate = compareSemver(normalizedCurrent, latestVersion) > 0;

  const releaseUrl =
    sanitizeGitHubReleaseUrl(candidate.html_url) ?? GITHUB_RELEASES_PAGE;

  let zipDownloadUrl: string | null = null;
  let zipAssetName: string | null = null;

  if (Array.isArray(candidate.assets)) {
    for (const rawAsset of candidate.assets) {
      if (!rawAsset || typeof rawAsset !== 'object') continue;
      const asset = rawAsset as Record<string, unknown>;
      const name = typeof asset.name === 'string' ? asset.name.trim() : '';
      if (!name.toLowerCase().endsWith('.zip')) continue;

      const safeDownload = sanitizeGitHubReleaseUrl(asset.browser_download_url);
      if (safeDownload) {
        zipDownloadUrl = safeDownload;
        zipAssetName = name.slice(0, 100);
        break;
      }
    }
  }

  const publishedAt =
    typeof candidate.published_at === 'string' &&
    !Number.isNaN(Date.parse(candidate.published_at))
      ? candidate.published_at
      : null;

  const rawBody = typeof candidate.body === 'string' ? candidate.body : '';
  const releaseNotes = rawBody
    .replace(/\u2014/g, '-')
    .trim()
    .slice(0, 600);

  return {
    currentVersion: normalizedCurrent,
    latestVersion,
    hasUpdate,
    releaseUrl,
    zipDownloadUrl,
    zipAssetName,
    publishedAt,
    releaseNotes,
    checkedAt: new Date().toISOString(),
  };
}

export function getCurrentExtensionVersion(): string {
  try {
    if (
      typeof chrome !== 'undefined' &&
      typeof chrome.runtime?.getManifest === 'function'
    ) {
      const manifestVer = chrome.runtime.getManifest()?.version;
      if (manifestVer && parseSemver(manifestVer)) {
        return manifestVer;
      }
    }
  } catch {
    // ambiente de preview web fora da extensao
  }
  return FALLBACK_EXTENSION_VERSION;
}

export async function checkGitHubReleaseUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = getCurrentExtensionVersion();

  let response: Response;
  try {
    response = await fetch(GITHUB_LATEST_RELEASE_API, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
      },
    });
  } catch {
    throw new Error(
      'Sem conexao com o GitHub no momento. Verifique sua internet e tente novamente.'
    );
  }

  if (response.status === 404) {
    throw new Error('Nenhuma versao publica encontrada em GitHub Releases.');
  }

  if (!response.ok) {
    throw new Error(
      `GitHub retornou status ${response.status}. Tente novamente em instantes.`
    );
  }

  const data: unknown = await response.json();
  return validateGitHubReleasePayload(data, currentVersion);
}

export async function triggerExtensionReload(): Promise<void> {
  const hasExtensionRuntime =
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime?.reload === 'function';

  if (hasExtensionRuntime) {
    try {
      if (chrome.storage?.local) {
        await chrome.storage.local.set({
          [REOPEN_DASHBOARD_STORAGE_KEY]: Date.now(),
        });
      }
    } catch {
      // prossegue com o reload mesmo se storage falhar
    }
    chrome.runtime.reload();
    return;
  }

  window.location.reload();
}
