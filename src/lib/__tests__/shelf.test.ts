import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BackupValidationError,
  createBackupPayload,
  parseAndValidateBackupJson,
  reconcileBackupImport,
} from '../backup';
import { getExtensionShortcuts } from '../shortcuts';
import {
  compareSemver,
  parseSemver,
  sanitizeGitHubReleaseUrl,
  validateGitHubReleasePayload,
} from '../updater';
import {
  detectProgressFromTab,
  extractNumericProgress,
  findMatchingSavedItem,
  formatBadgeProgress,
  normalizeDomainHost,
  rewriteUrlDomain,
  sanitizeHttpUrl,
  stepProgressLabel,
  suggestCleanTitle,
} from '../progress';
import {
  getNextReadingStatus,
  getReadingStatusLabel,
} from '../../components/ShelfIcons';
import type { CollectionTab, SavedLinkItem } from '../../types/shelf';

describe('progress & URL helpers', () => {
  it('detects manga chapters, fractional chapters, episodes and pages accurately', () => {
    expect(
      detectProgressFromTab(
        'Solo Leveling - Capitulo 142 | Leitor Online',
        'https://mangadex.org/title/solo'
      )
    ).toBe('Cap. 142');

    expect(
      detectProgressFromTab(
        'Berserk',
        'https://leitor.exemplo.com/ler/berserk/chapter-375.5'
      )
    ).toBe('Cap. 375.5');

    expect(
      detectProgressFromTab('Frieren - Ep. 08', 'https://anime.exemplo.com/watch')
    ).toBe('Ep. 8');

    expect(
      detectProgressFromTab(
        'Documentacao TypeScript',
        'https://www.typescriptlang.org/docs/'
      )
    ).toBe('');
  });

  it('cleans noisy manga reader suffixes while preserving series name', () => {
    expect(
      suggestCleanTitle('Solo Leveling - Capitulo 142 | MangaOnline')
    ).toBe('Solo Leveling');
    expect(
      suggestCleanTitle('O Imperador Marcial Dragão Carmesim — Capítulo 1')
    ).toBe('O Imperador Marcial Dragão Carmesim');
    expect(
      suggestCleanTitle('O Imperador Marcial Dragão Carmesim —')
    ).toBe('O Imperador Marcial Dragão Carmesim');
    expect(
      suggestCleanTitle('O Imperador Marcial Dragão Carmesim — BlitzToons')
    ).toBe('O Imperador Marcial Dragão Carmesim');
    expect(suggestCleanTitle('Solo Leveling - MangaScan')).toBe('Solo Leveling');
    expect(suggestCleanTitle('Spider-Man: Blue')).toBe('Spider-Man: Blue');
    expect(suggestCleanTitle('Documentacao Vite')).toBe('Documentacao Vite');
  });

  it('extracts numeric progress and formats toolbar badge cleanly', () => {
    expect(extractNumericProgress('Cap. 142')).toBe(142);
    expect(extractNumericProgress('Cap. 142.5')).toBe(142.5);
    expect(extractNumericProgress('Ep. 08')).toBe(8);
    expect(extractNumericProgress('Livro')).toBeNull();

    expect(formatBadgeProgress('Cap. 142')).toBe('142');
    expect(formatBadgeProgress('Cap. 142.5')).toBe('142.5');
    expect(formatBadgeProgress('Ep. 8')).toBe('8');
    expect(formatBadgeProgress('Pag. 35')).toBe('35');
    expect(formatBadgeProgress('Vol. 2')).toBe('2');
    expect(formatBadgeProgress('')).toBe('');
    expect(formatBadgeProgress('Sem Capitulo')).toBe('OK');
  });

  it('normalizes domain hosts and rewrites URLs cleanly during bulk migration', () => {
    expect(normalizeDomainHost('https://mangadex.org/title/123')?.host).toBe('mangadex.org');
    expect(normalizeDomainHost('HTTPS://WWW.BlitzToons.com/ler')?.host).toBe('blitztoons.com');
    expect(normalizeDomainHost('blitztoons.com:8080')?.host).toBe('blitztoons.com');
    expect(normalizeDomainHost('javascript:alert(1)')).toBeNull();

    expect(
      rewriteUrlDomain(
        'https://blitztoons.com/manga/cap-10?read=1#p1',
        'blitztoons.org'
      )
    ).toBe('https://blitztoons.org/manga/cap-10?read=1#p1');

    expect(rewriteUrlDomain('https://mangadex.org/title/abc', 'mangadex.dev')).toBe(
      'https://mangadex.dev/title/abc'
    );

    expect(rewriteUrlDomain('javascript:alert(1)', 'a.com')).toBeNull();
    expect(rewriteUrlDomain('chrome://extensions', 'a.com')).toBeNull();
  });

  it('cycles reading statuses in sequence and returns clear localized labels', () => {
    expect(getNextReadingStatus('reading')).toBe('up_to_date');
    expect(getNextReadingStatus('up_to_date')).toBe('paused');
    expect(getNextReadingStatus('paused')).toBe('completed');
    expect(getNextReadingStatus('completed')).toBe('reading');

    expect(getReadingStatusLabel('reading')).toBe('Lendo');
    expect(getReadingStatusLabel('up_to_date')).toBe('Em dia');
    expect(getReadingStatusLabel('paused')).toBe('Pausado');
    expect(getReadingStatusLabel('completed')).toBe('Concluido');
  });

  it('increments and decrements chapter labels including decimals and bounds', () => {
    expect(stepProgressLabel('', 1)).toBe('Cap. 1');
    expect(stepProgressLabel('Cap. 142', 1)).toBe('Cap. 143');
    expect(stepProgressLabel('Cap. 142.5', 1)).toBe('Cap. 143');
    expect(stepProgressLabel('Cap. 0', -1)).toBe('Cap. 0');
  });

  it('blocks unsafe URL schemes and accepts http/https', () => {
    expect(sanitizeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeHttpUrl('chrome://extensions')).toBeNull();
    expect(sanitizeHttpUrl('mangadex.org/title/abc')).toBe(
      'https://mangadex.org/title/abc'
    );
  });

  it('matches an open manga tab with an existing saved card across chapters', () => {
    const saved: SavedLinkItem[] = [
      {
        id: 'link-1',
        tabId: 'tab-mangas',
        title: 'One Piece',
        url: 'https://mangaplus.shueisha.co.jp/obra/one-piece/capitulo-1110',
        domain: 'mangaplus.shueisha.co.jp',
        progressLabel: 'Cap. 1110',
        status: 'reading',
        pinned: false,
        createdAt: '2026-11-01T10:00:00.000Z',
        updatedAt: '2026-11-01T10:00:00.000Z',
      },
    ];

    const matched = findMatchingSavedItem(
      {
        title: 'One Piece - Capitulo 1115 | MangaPlus',
        url: 'https://mangaplus.shueisha.co.jp/obra/one-piece/capitulo-1115',
      },
      saved
    );
    expect(matched?.id).toBe('link-1');

    const unrelated = findMatchingSavedItem(
      {
        title: 'GitHub Docs',
        url: 'https://docs.github.com/pt',
      },
      saved
    );
    expect(unrelated).toBeNull();
  });
});

describe('backup export, validation, merge and replace', () => {
  const baseTabs: CollectionTab[] = [
    {
      id: 'tab-mangas',
      name: 'Mangas',
      icon: 'book-open',
      order: 0,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
  ];

  const baseItems: SavedLinkItem[] = [
    {
      id: 'item-1',
      tabId: 'tab-mangas',
      title: 'Solo Leveling',
      url: 'https://mangadex.org/title/solo/cap-100',
      domain: 'mangadex.org',
      progressLabel: 'Cap. 100',
      status: 'reading',
      pinned: true,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
  ];

  it('exports, validates and merges newer items without losing local ones', () => {
    const incomingPayload = createBackupPayload(
      [
        {
          id: 'other-tab-id-same-name',
          name: 'mangas',
          icon: 'book-open',
          order: 0,
          createdAt: '2026-11-02T00:00:00.000Z',
          updatedAt: '2026-11-02T00:00:00.000Z',
        },
        {
          id: 'tab-estudos',
          name: 'Estudos',
          icon: 'graduation-cap',
          order: 1,
          createdAt: '2026-11-02T00:00:00.000Z',
          updatedAt: '2026-11-02T00:00:00.000Z',
        },
      ],
      [
        {
          id: 'item-1',
          tabId: 'other-tab-id-same-name',
          title: 'Solo Leveling',
          url: 'https://mangadex.org/title/solo/cap-145',
          domain: 'mangadex.org',
          progressLabel: 'Cap. 145',
          status: 'reading',
          pinned: true,
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-05T00:00:00.000Z',
        },
        {
          id: 'item-2',
          tabId: 'tab-estudos',
          title: 'React Docs',
          url: 'https://react.dev/learn',
          domain: 'react.dev',
          status: 'reading',
          pinned: false,
          createdAt: '2026-11-05T00:00:00.000Z',
          updatedAt: '2026-11-05T00:00:00.000Z',
        },
      ]
    );

    const parsed = parseAndValidateBackupJson(JSON.stringify(incomingPayload));
    const merged = reconcileBackupImport(
      { tabs: baseTabs, items: baseItems },
      parsed,
      'merge'
    );

    expect(merged.tabs).toHaveLength(2);
    expect(merged.items).toHaveLength(2);
    expect(merged.summary).toEqual({
      tabsImported: 1,
      itemsImported: 1,
      itemsUpdated: 1,
    });
    expect(merged.items.find((i) => i.id === 'item-1')?.progressLabel).toBe(
      'Cap. 145'
    );
    expect(merged.items.find((i) => i.id === 'item-1')?.tabId).toBe('tab-mangas');
  });

  it('rejects malicious or malformed JSON backups', () => {
    expect(() => parseAndValidateBackupJson('{invalido')).toThrow(
      BackupValidationError
    );

    const malicious = JSON.stringify({
      app: 'tomo-extension',
      schemaVersion: 1,
      tabs: baseTabs,
      items: [
        {
          id: 'bad-1',
          tabId: 'tab-mangas',
          title: 'XSS',
          url: 'javascript:alert(document.cookie)',
        },
      ],
    });
    expect(() => parseAndValidateBackupJson(malicious)).toThrow(
      BackupValidationError
    );
  });
});

describe('keyboard shortcuts & Manifest V3 commands', () => {
  it('exposes the 4 global shortcuts within Chrome MV3 limits', async () => {
    const shortcuts = await getExtensionShortcuts();
    expect(shortcuts).toHaveLength(4);
    expect(shortcuts.map((s) => s.name)).toEqual([
      'quick-save-tab',
      'save-and-close-tab',
      '_execute_action',
      'open-dashboard',
    ]);

    const manifestRaw = readFileSync(
      resolve(process.cwd(), 'public/manifest.json'),
      'utf-8'
    );
    const manifest = JSON.parse(manifestRaw) as {
      background?: { service_worker?: string; type?: string };
      commands?: Record<string, { suggested_key?: { default?: string } }>;
    };

    expect(manifest.background?.service_worker).toBe('background.js');
    expect(manifest.background?.type).toBe('module');

    const commandEntries = Object.entries(manifest.commands ?? {});
    expect(commandEntries.length).toBeLessThanOrEqual(4);
    for (const [, cmd] of commandEntries) {
      expect(cmd.suggested_key?.default).toMatch(
        /^(Ctrl|Alt)(\+Shift)?\+[A-Z0-9]$/
      );
    }
  });
});

describe('version comparison & GitHub release payload validation', () => {
  it('parses and compares SemVer versions accurately', () => {
    expect(parseSemver('v1.2.0')).toEqual([1, 2, 0]);
    expect(parseSemver('1.10.3-beta.1')).toEqual([1, 10, 3]);
    expect(parseSemver('invalido')).toBeNull();

    expect(compareSemver('1.1.0', 'v1.2.0')).toBe(1);
    expect(compareSemver('1.2.0', 'v1.2.0')).toBe(0);
    expect(compareSemver('1.2.0', 'v1.1.9')).toBe(-1);
  });

  it('accepts only official repository HTTPS URLs and blocks external domains', () => {
    expect(
      sanitizeGitHubReleaseUrl(
        'https://github.com/LucasCamy/tomo/releases/download/v1.2.0/tomo-chrome-v1.2.0.zip'
      )
    ).toBe(
      'https://github.com/LucasCamy/tomo/releases/download/v1.2.0/tomo-chrome-v1.2.0.zip'
    );

    expect(
      sanitizeGitHubReleaseUrl('https://evil.example.com/LucasCamy/tomo/malicious.zip')
    ).toBeNull();
    expect(
      sanitizeGitHubReleaseUrl('https://github.com/outro-autor/tomo/releases/v1.2.0.zip')
    ).toBeNull();
    expect(sanitizeGitHubReleaseUrl('javascript:alert(1)')).toBeNull();
  });

  it('validates GitHub release payload for updates and ignores untrusted zip assets', () => {
    const updatePayload = validateGitHubReleasePayload(
      {
        tag_name: 'v1.3.0',
        html_url: 'https://github.com/LucasCamy/tomo/releases/tag/v1.3.0',
        published_at: '2026-11-06T22:00:00Z',
        body: 'Novidades — sincronizacao automatica',
        assets: [
          {
            name: 'malicioso.zip',
            browser_download_url: 'https://atacante.exemplo/malicioso.zip',
          },
          {
            name: 'tomo-chrome-v1.3.0.zip',
            browser_download_url:
              'https://github.com/LucasCamy/tomo/releases/download/v1.3.0/tomo-chrome-v1.3.0.zip',
          },
        ],
      },
      '1.2.0'
    );

    expect(updatePayload.hasUpdate).toBe(true);
    expect(updatePayload.latestVersion).toBe('1.3.0');
    expect(updatePayload.zipAssetName).toBe('tomo-chrome-v1.3.0.zip');
    expect(updatePayload.zipDownloadUrl).toBe(
      'https://github.com/LucasCamy/tomo/releases/download/v1.3.0/tomo-chrome-v1.3.0.zip'
    );
    expect(updatePayload.releaseNotes).not.toContain('\u2014');

    const upToDatePayload = validateGitHubReleasePayload(
      {
        tag_name: 'v1.1.0',
        html_url: 'https://github.com/LucasCamy/tomo/releases/tag/v1.1.0',
        assets: [],
      },
      '1.2.0'
    );
    expect(upToDatePayload.hasUpdate).toBe(false);
  });
});

