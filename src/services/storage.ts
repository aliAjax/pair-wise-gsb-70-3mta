import { seedContracts } from '../data/seed';
import type { ApiContract } from '../models/contract';
import type { ReleaseBatch, ReleaseMeta } from '../models/release-batch';

const CONTRACTS_KEY = 'pair-wise-gsb-70-contracts';
const BATCHES_KEY = 'pair-wise-gsb-70-release-batches';
const META_KEY = 'pair-wise-gsb-70-release-meta';

export const CURRENT_STORAGE_VERSION = 2;

/**
 * 存储变更来源。同窗口直接监听 storage-bus 事件即可立即感知；
 * 其它浏览器窗口写入时，原生 storage 事件也会转发为同一事件，
 * 让 TanStack Query 失效缓存，实现「两个窗口看到同一版本」。
 */
export type StorageChangeSource = 'local' | 'cross-tab';
export type StorageChangeKey = 'contracts' | 'batches' | 'meta';

type StorageBusListener = (key: StorageChangeKey, source: StorageChangeSource) => void;
const listeners = new Set<StorageBusListener>();

function emit(key: StorageChangeKey, source: StorageChangeSource): void {
  listeners.forEach((listener) => listener(key, source));
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === CONTRACTS_KEY) emit('contracts', 'cross-tab');
    if (event.key === BATCHES_KEY) emit('batches', 'cross-tab');
    if (event.key === META_KEY) emit('meta', 'cross-tab');
  });
}

export function subscribeStorage(listener: StorageBusListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readJson<T>(key: string): T | undefined {
  const raw = localStorage.getItem(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    localStorage.removeItem(key);
    return undefined;
  }
}

export function loadContracts(): ApiContract[] {
  const stored = readJson<ApiContract[]>(CONTRACTS_KEY);
  if (stored) {
    return normalizeContracts(stored);
  }
  persistContracts(seedContracts);
  return structuredClone(seedContracts);
}

/** 老数据兼容：批次化改造前的契约没有 dependencies 字段 */
function normalizeContracts(contracts: ApiContract[]): ApiContract[] {
  return contracts.map((contract) =>
    Array.isArray(contract.dependencies) ? contract : { ...contract, dependencies: [] },
  );
}

export function persistContracts(contracts: ApiContract[]): void {
  localStorage.setItem(CONTRACTS_KEY, JSON.stringify(contracts));
  emit('contracts', 'local');
}

export function loadBatches(): ReleaseBatch[] {
  return readJson<ReleaseBatch[]>(BATCHES_KEY) ?? [];
}

export function persistBatches(batches: ReleaseBatch[]): void {
  localStorage.setItem(BATCHES_KEY, JSON.stringify(batches));
  emit('batches', 'local');
}

export function loadMeta(): ReleaseMeta {
  return (
    readJson<ReleaseMeta>(META_KEY) ?? {
      storageVersion: 1,
    }
  );
}

export function persistMeta(meta: ReleaseMeta): void {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
  emit('meta', 'local');
}
