import type { ImportMode, ImportSummary } from '../types/shelf';
import {
  deleteMetaValue,
  exportShelfBackupJson,
  getMetaValue,
  importShelfBackupJson,
  setMetaValue,
} from './db';

const BACKUP_SYNC_META_KEY = 'backup_file_sync';

export type FileSyncPermission = 'granted' | 'prompt' | 'denied' | 'unsupported';

interface FileSystemPermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface ExtendedFileHandle extends FileSystemFileHandle {
  queryPermission?: (
    descriptor?: FileSystemPermissionDescriptor
  ) => Promise<PermissionState>;
  requestPermission?: (
    descriptor?: FileSystemPermissionDescriptor
  ) => Promise<PermissionState>;
}

interface SaveFilePickerType {
  description?: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  id?: string;
  suggestedName?: string;
  types?: SaveFilePickerType[];
}

type WindowWithPicker = Window & {
  showSaveFilePicker?: (
    options?: SaveFilePickerOptions
  ) => Promise<ExtendedFileHandle>;
};

interface StoredBackupSyncRecord {
  handle: ExtendedFileHandle;
  fileName: string;
  lastSyncedAt?: string;
}

export interface LinkedBackupStatus {
  supported: boolean;
  linked: boolean;
  fileName?: string;
  lastSyncedAt?: string;
  permission: FileSyncPermission;
}

// Fila em memoria para serializar gravacoes concorrentes no mesmo arquivo local
let writeChain: Promise<void> = Promise.resolve();

function enqueueSerializedWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function isFileSyncSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as WindowWithPicker).showSaveFilePicker === 'function';
}

async function resolveHandlePermission(
  handle: ExtendedFileHandle,
  mode: 'read' | 'readwrite',
  requestIfNeeded: boolean
): Promise<FileSyncPermission> {
  try {
    let state: PermissionState = 'granted';
    if (typeof handle.queryPermission === 'function') {
      state = await handle.queryPermission({ mode });
    }
    if (
      state !== 'granted' &&
      requestIfNeeded &&
      typeof handle.requestPermission === 'function'
    ) {
      state = await handle.requestPermission({ mode });
    }
    if (state === 'granted' || state === 'prompt' || state === 'denied') {
      return state;
    }
    return 'prompt';
  } catch {
    return 'prompt';
  }
}

async function writeCurrentShelfToHandle(
  handle: ExtendedFileHandle
): Promise<string> {
  const { jsonString } = await exportShelfBackupJson();
  const writable = await handle.createWritable();
  try {
    await writable.write(jsonString);
    await writable.close();
  } catch (err) {
    try {
      await writable.abort();
    } catch {
      // ignora erro secundario de abort
    }
    throw err;
  }
  return new Date().toISOString();
}

export async function getLinkedBackupStatus(): Promise<LinkedBackupStatus> {
  if (!isFileSyncSupported()) {
    return {
      supported: false,
      linked: false,
      permission: 'unsupported',
    };
  }

  try {
    const record = await getMetaValue<StoredBackupSyncRecord>(
      BACKUP_SYNC_META_KEY
    );
    if (!record?.handle) {
      return {
        supported: true,
        linked: false,
        permission: 'prompt',
      };
    }

    const permission = await resolveHandlePermission(
      record.handle,
      'readwrite',
      false
    );

    return {
      supported: true,
      linked: true,
      fileName: record.fileName || record.handle.name,
      lastSyncedAt: record.lastSyncedAt,
      permission,
    };
  } catch {
    return {
      supported: true,
      linked: false,
      permission: 'prompt',
    };
  }
}

export async function pickAndLinkBackupFile(): Promise<LinkedBackupStatus | null> {
  if (!isFileSyncSupported()) {
    throw new Error(
      'Este navegador nao suporta vinculo direto de arquivo local. Use o botao Exportar.'
    );
  }

  const picker = (window as WindowWithPicker).showSaveFilePicker;
  if (!picker) return null;

  let handle: ExtendedFileHandle;
  try {
    handle = await picker({
      id: 'tomo-auto-backup',
      suggestedName: 'tomo-backup.json',
      types: [
        {
          description: 'Backup JSON do Tomo',
          accept: { 'application/json': ['.json'] },
        },
      ],
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return null;
    }
    throw err;
  }

  const lastSyncedAt = await enqueueSerializedWrite(() =>
    writeCurrentShelfToHandle(handle)
  );

  const fileName = handle.name || 'tomo-backup.json';
  await setMetaValue<StoredBackupSyncRecord>(BACKUP_SYNC_META_KEY, {
    handle,
    fileName,
    lastSyncedAt,
  });

  return {
    supported: true,
    linked: true,
    fileName,
    lastSyncedAt,
    permission: 'granted',
  };
}

export async function syncToLinkedBackupFile(options?: {
  requestPermission?: boolean;
}): Promise<{
  synced: boolean;
  needsPermission?: boolean;
  status: LinkedBackupStatus;
}> {
  if (!isFileSyncSupported()) {
    return {
      synced: false,
      status: {
        supported: false,
        linked: false,
        permission: 'unsupported',
      },
    };
  }

  const record = await getMetaValue<StoredBackupSyncRecord>(
    BACKUP_SYNC_META_KEY
  );
  if (!record?.handle) {
    return {
      synced: false,
      status: {
        supported: true,
        linked: false,
        permission: 'prompt',
      },
    };
  }

  const permission = await resolveHandlePermission(
    record.handle,
    'readwrite',
    Boolean(options?.requestPermission)
  );

  if (permission !== 'granted') {
    return {
      synced: false,
      needsPermission: true,
      status: {
        supported: true,
        linked: true,
        fileName: record.fileName || record.handle.name,
        lastSyncedAt: record.lastSyncedAt,
        permission,
      },
    };
  }

  const lastSyncedAt = await enqueueSerializedWrite(() =>
    writeCurrentShelfToHandle(record.handle)
  );

  const latestRecord = await getMetaValue<StoredBackupSyncRecord>(
    BACKUP_SYNC_META_KEY
  );
  if (latestRecord?.handle) {
    await setMetaValue<StoredBackupSyncRecord>(BACKUP_SYNC_META_KEY, {
      ...latestRecord,
      lastSyncedAt,
    });
  }

  return {
    synced: true,
    status: {
      supported: true,
      linked: true,
      fileName: record.fileName || record.handle.name,
      lastSyncedAt,
      permission: 'granted',
    },
  };
}

export async function pullFromLinkedBackupFile(
  mode: ImportMode = 'merge'
): Promise<ImportSummary> {
  const record = await getMetaValue<StoredBackupSyncRecord>(
    BACKUP_SYNC_META_KEY
  );
  if (!record?.handle) {
    throw new Error('Nenhum arquivo de backup fixo esta vinculado.');
  }

  const permission = await resolveHandlePermission(record.handle, 'read', true);
  if (permission !== 'granted') {
    throw new Error(
      'Permissao de leitura negada para o arquivo de backup vinculado.'
    );
  }

  const file = await record.handle.getFile();
  const rawJson = await file.text();
  return importShelfBackupJson(rawJson, mode);
}

export async function unlinkBackupFile(): Promise<void> {
  await deleteMetaValue(BACKUP_SYNC_META_KEY);
}
