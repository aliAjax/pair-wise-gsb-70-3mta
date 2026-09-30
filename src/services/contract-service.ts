import { seedContracts } from '../data/seed';
import type {
  ApiContract,
  BatchMember,
  BatchStatus,
  ContractChange,
  ContractVersion,
  ReleaseBatch,
  ReviewState,
} from '../models/contract';
import { orderMembersByDependency, validateForRelease } from '../models/contract';
import { stableChecksum, formatDateTime } from '../lib/utils';

const STORAGE_KEY = 'pair-wise-gsb-70-contracts';
const STORE_VERSION = 2;
const LATENCY = 180;

/** 乐观锁冲突：另一窗口已提交新版本 */
export class BatchConflictError extends Error {
  serverRevision: number;
  constructor(serverRevision: number) {
    super('批次版本已变化，另一窗口已经提交过修改，已为你加载最新成员和顺序。');
    this.name = 'BatchConflictError';
    this.serverRevision = serverRevision;
  }
}

interface ReleaseStore {
  version: number;
  contracts: ApiContract[];
  batches: ReleaseBatch[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function wait(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, LATENCY));
}

// ---------------------------------------------------------------------------
// 持久化与旧数据迁移
// ---------------------------------------------------------------------------

function persistStore(store: ReleaseStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function readStore(): ReleaseStore | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (Array.isArray(parsed)) {
      // v1：直接存的契约数组，且批次字段尚未建立
      return migrateLegacyStore(parsed as ApiContract[]);
    }
    const store = parsed as Partial<ReleaseStore>;
    if (Array.isArray(store.contracts)) {
      const normalized: ReleaseStore = {
        version: STORE_VERSION,
        contracts: store.contracts,
        batches: Array.isArray(store.batches) ? store.batches : [],
      };
      return migrateUnlinkedVersions(normalized);
    }
    throw new Error('invalid store');
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

/**
 * 旧数据迁移：先迁移原冻结记录。
 * - 快照完整的旧版本自动挂到迁移批次的已冻结节点。
 * - 契约或快照未补齐的节点标成待迁移，发布页可人工补齐。
 */
function migrateLegacyStore(legacyContracts: ApiContract[]): ReleaseStore {
  const contracts = legacyContracts.map((contract) => ({
    ...contract,
    dependsOn: Array.isArray(contract.dependsOn) ? contract.dependsOn : [],
  }));
  return migrateUnlinkedStore({
    version: STORE_VERSION,
    contracts,
    batches: [],
  });
}

function migrateUnlinkedVersions(store: ReleaseStore): ReleaseStore {
  const hasUnlinked = store.contracts.some((contract) =>
    contract.versions.some((version) => !version.batchId),
  );
  if (!hasUnlinked) return store;
  return migrateUnlinkedStore(store);
}

function migrateUnlinkedStore(store: ReleaseStore): ReleaseStore {
  const members: BatchMember[] = [];
  const versionPatch = new Map<string, { batchId: string; memberId: string }>();

  store.contracts.forEach((contract) => {
    contract.versions
      .filter((version) => !version.batchId)
      .forEach((version) => {
        const memberId = `mem-legacy-${version.id}`;
        const incomplete = !version.checksum.trim() || !version.openapi.trim();
        members.push({
          id: memberId,
          contractId: incomplete ? '' : contract.id,
          contractName: contract.name,
          targetVersion: version.version,
          notes: version.notes,
          dependsOnMemberIds: [],
          status: incomplete ? 'pending' : 'frozen',
          ordinal: members.length,
          blockers: incomplete
            ? [
                {
                  id: `legacy-${version.id}`,
                  severity: 'blocker',
                  title: '旧冻结记录信息不完整',
                  detail: '该记录缺少批次关联或快照数据，补齐后才能纳入批次追溯。',
                },
              ]
            : [],
          frozenVersionId: incomplete ? undefined : version.id,
          frozenAt: incomplete ? undefined : version.releasedAt,
          frozenChecksum: incomplete ? undefined : version.checksum,
          legacyContractId: incomplete ? contract.id : undefined,
          legacyVersionId: incomplete ? version.id : undefined,
        });
        versionPatch.set(version.id, { batchId: '', memberId });
      });
  });

  if (!members.length) return store;

  const timestamps = members
    .map((member) => member.frozenAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const batchId = 'batch-legacy';
  const incomplete = members.some((member) => member.status === 'pending');
  const batch: ReleaseBatch = {
    id: batchId,
    name: '历史冻结记录迁移',
    status: incomplete ? 'migrating' : 'completed',
    createdAt: timestamps[0] ?? new Date().toISOString(),
    updatedAt: timestamps[timestamps.length - 1] ?? new Date().toISOString(),
    createdBy: '系统迁移',
    notes: '旧数据缺少发布批次关联，按原冻结记录自动迁移。',
    members,
    revision: 1,
    legacy: true,
  };

  const contracts = store.contracts.map((contract) => ({
    ...contract,
    versions: contract.versions.map((version) => {
      const patch = versionPatch.get(version.id);
      if (!patch) return version;
      return { ...version, batchId, batchMemberId: patch.memberId };
    }),
  }));

  return {
    ...store,
    version: STORE_VERSION,
    contracts,
    batches: [batch, ...store.batches.filter((item) => item.id !== batchId)],
  };
}

function loadStore(): ReleaseStore {
  const existing = readStore();
  if (existing) return existing;
  const seeded = migrateLegacyStore(clone(seedContracts));
  persistStore(seeded);
  return seeded;
}

// ---------------------------------------------------------------------------
// 契约查询与维护
// ---------------------------------------------------------------------------

export async function listContracts(): Promise<ApiContract[]> {
  await wait();
  return clone(loadStore().contracts);
}

export async function listBatches(): Promise<ReleaseBatch[]> {
  await wait();
  return clone(
    loadStore().batches.sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    ),
  );
}

export async function getContract(id: string): Promise<ApiContract | undefined> {
  const contracts = loadStore().contracts;
  await wait();
  return clone(contracts.find((contract) => contract.id === id));
}

export async function saveContract(updated: ApiContract): Promise<ApiContract> {
  const store = loadStore();
  const exists = store.contracts.some((contract) => contract.id === updated.id);
  const saved = {
    ...updated,
    dependsOn: Array.isArray(updated.dependsOn) ? updated.dependsOn : [],
    updatedAt: new Date().toISOString(),
  };
  const next = exists
    ? store.contracts.map((contract) => (contract.id === updated.id ? saved : contract))
    : [saved, ...store.contracts];
  persistStore({ ...store, contracts: next });
  await wait();
  return clone(saved);
}

export async function reviewChange(
  contractId: string,
  changeId: string,
  reviewState: ReviewState,
  reviewer: string,
  comment: string,
): Promise<ApiContract> {
  const store = loadStore();
  const contract = store.contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }

  const updated: ApiContract = {
    ...contract,
    status: contract.status === 'draft' ? 'review' : contract.status,
    changes: contract.changes.map((change) =>
      change.id === changeId
        ? {
            ...change,
            reviewState,
            reviewer,
            reviewComment: comment,
            reviewedAt: new Date().toISOString(),
          }
        : change,
    ),
  };
  persistStore({
    ...store,
    contracts: store.contracts.map((item) => (item.id === contractId ? updated : item)),
  });
  await wait();
  return clone(updated);
}

export async function bulkReviewChanges(
  selections: Array<{ contractId: string; changeId: string }>,
  reviewState: ReviewState,
  reviewer: string,
  comment: string,
): Promise<ApiContract[]> {
  const store = loadStore();
  const selected = new Set(selections.map((item) => `${item.contractId}:${item.changeId}`));
  const updated = store.contracts.map((contract) => ({
    ...contract,
    status:
      selected.has(`${contract.id}:${contract.changes[0]?.id}`) && contract.status === 'draft'
        ? ('review' as const)
        : contract.status,
    changes: contract.changes.map((change) =>
      selected.has(`${contract.id}:${change.id}`)
        ? {
            ...change,
            reviewState,
            reviewer,
            reviewComment: comment,
            reviewedAt: new Date().toISOString(),
          }
        : change,
    ),
  }));
  persistStore({ ...store, contracts: updated });
  await wait();
  return clone(updated);
}

export async function updateContractOpenApi(
  contractId: string,
  openapi: string,
): Promise<ApiContract> {
  const store = loadStore();
  const contract = store.contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  const updated = { ...contract, openapi, updatedAt: new Date().toISOString() };
  persistStore({
    ...store,
    contracts: store.contracts.map((item) => (item.id === contractId ? updated : item)),
  });
  await wait();
  return clone(updated);
}

export async function addExemption(
  contractId: string,
  changeId: string,
  reason: string,
): Promise<ApiContract> {
  const store = loadStore();
  const contract = store.contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  const exemption = {
    id: `ex-${Date.now()}`,
    changeId,
    scope: contract.changes.find((item) => item.id === changeId)?.path ?? '未指定',
    reason,
    approvedBy: '当前评审人',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  };
  const updated: ApiContract = {
    ...contract,
    exemptions: [...contract.exemptions, exemption],
    changes: contract.changes.map((change) =>
      change.id === changeId ? { ...change, reviewState: 'exemption' } : change,
    ),
  };
  persistStore({
    ...store,
    contracts: store.contracts.map((item) => (item.id === contractId ? updated : item)),
  });
  await wait();
  return clone(updated);
}

// ---------------------------------------------------------------------------
// 可恢复发布批次
// ---------------------------------------------------------------------------

function assertRevision(store: ReleaseStore, batchId: string, expectedRevision: number): ReleaseBatch {
  const batch = store.batches.find((item) => item.id === batchId);
  if (!batch) throw new Error('发布批次不存在，可能已被另一窗口处理。');
  if (batch.revision !== expectedRevision) {
    throw new BatchConflictError(batch.revision);
  }
  return batch;
}

function suggestNextVersion(current: string): string {
  const parts = current.split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return current;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

function findOpenBatchForContract(store: ReleaseStore, contractId: string): ReleaseBatch | undefined {
  return store.batches.find(
    (batch) =>
      batch.status !== 'completed' &&
      !batch.legacy &&
      batch.members.some(
        (member) => member.contractId === contractId && member.status !== 'frozen',
      ),
  );
}

export interface CreateBatchInput {
  name: string;
  notes?: string;
  members: Array<{ contractId: string; targetVersion?: string; notes?: string }>;
  createdBy?: string;
}

export async function createReleaseBatch(input: CreateBatchInput): Promise<ReleaseBatch> {
  const store = loadStore();
  const contractsById = new Map(store.contracts.map((contract) => [contract.id, contract]));

  if (!input.members.length) {
    throw new Error('至少选择一个契约成员。');
  }
  const seen = new Set<string>();
  input.members.forEach((item) => {
    if (seen.has(item.contractId)) throw new Error('同一批次不能重复添加契约。');
    seen.add(item.contractId);
    if (!contractsById.has(item.contractId)) throw new Error('选择的契约不存在。');
    const occupied = findOpenBatchForContract(store, item.contractId);
    if (occupied) {
      throw new Error(`契约已在未完成批次「${occupied.name}」中，请先完成或处理该批次。`);
    }
  });

  const members: BatchMember[] = input.members.map((item, index) => {
    const contract = contractsById.get(item.contractId)!;
    return {
      id: `mem-${Date.now()}-${index}`,
      contractId: contract.id,
      contractName: contract.name,
      targetVersion: item.targetVersion?.trim() || suggestNextVersion(contract.version),
      notes: item.notes?.trim() ?? '',
      dependsOnMemberIds: [],
      status: 'pending',
      ordinal: index,
      blockers: [],
    };
  });

  // 成员按调用依赖排序：仅保留批次内依赖，被依赖方必须先冻结
  const memberIdByContract = new Map(members.map((member) => [member.contractId, member.id]));
  members.forEach((member) => {
    const contract = contractsById.get(member.contractId)!;
    member.dependsOnMemberIds = contract.dependsOn
      .map((depId) => memberIdByContract.get(depId))
      .filter((id): id is string => Boolean(id));
  });
  orderMembersByDependency(members); // 检测循环依赖

  const now = new Date().toISOString();
  const batch: ReleaseBatch = {
    id: `batch-${Date.now()}`,
    name: input.name.trim() || `发布批次 ${new Date().toLocaleString('zh-CN')}`,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy?.trim() || '当前发布人',
    notes: input.notes?.trim() ?? '',
    members,
    revision: 1,
  };
  persistStore({ ...store, batches: [batch, ...store.batches] });
  await wait();
  return clone(batch);
}

function buildFrozenVersion(
  contract: ApiContract,
  version: string,
  notes: string,
  batchId: string,
  memberId: string,
): ContractVersion {
  return {
    id: `ver-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    contractId: contract.id,
    version,
    releasedAt: new Date().toISOString(),
    checksum: stableChecksum(contract.openapi),
    notes,
    changeIds: contract.changes.map((change) => change.id),
    openapi: contract.openapi,
    batchId,
    batchMemberId: memberId,
  };
}

export interface BatchRunResult {
  batch: ReleaseBatch;
  stoppedAt?: BatchMember;
  conflict?: boolean;
}

/**
 * 从第一个未完成节点开始按依赖顺序冻结。
 * - 成员评审不完整就停在待处理（paused），不继续后续节点。
 * - 目标版本已存在等冻结失败标记 failed，成功冻结的版本保留，可重试。
 * - 基于 revision 的乐观锁：另一窗口已提交时拒绝覆盖并返回其新版本。
 */
export async function runReleaseBatch(
  batchId: string,
  expectedRevision: number,
): Promise<BatchRunResult> {
  let store = loadStore();
  const batch = assertRevision(store, batchId, expectedRevision);
  if (batch.legacy || batch.status === 'completed') {
    throw new Error('当前批次状态不允许执行冻结。');
  }

  const orderedIds = orderMembersByDependency(batch.members).map((member) => member.id);
  let stoppedAt: BatchMember | undefined;
  let status: BatchStatus = 'completed';

  const updatedContracts = new Map(store.contracts.map((contract) => [contract.id, contract]));
  const updatedMembers = new Map(batch.members.map((member) => [member.id, { ...member }]));

  for (const memberId of orderedIds) {
    const member = updatedMembers.get(memberId)!;
    if (member.status === 'frozen') continue;

    const contract = updatedContracts.get(member.contractId);
    if (!contract) {
      member.status = 'failed';
      member.failureReason = '契约记录不存在。';
      status = 'failed';
      stoppedAt = member;
      break;
    }

    const blockers = validateForRelease(contract).filter((issue) => issue.severity === 'blocker');
    if (blockers.length) {
      // 成员评审不完整，停在待处理
      member.status = 'blocked';
      member.blockers = blockers;
      member.failureReason = undefined;
      status = 'paused';
      stoppedAt = member;
      break;
    }

    if (contract.versions.some((version) => version.version === member.targetVersion)) {
      member.status = 'failed';
      member.failureReason = `版本 ${member.targetVersion} 已经冻结过，请更换版本号后重试。`;
      member.blockers = [];
      status = 'failed';
      stoppedAt = member;
      break;
    }

    const release = buildFrozenVersion(
      contract,
      member.targetVersion,
      member.notes || `${contract.name} 随发布批次冻结。`,
      batchId,
      memberId,
    );
    updatedContracts.set(member.contractId, {
      ...contract,
      version: member.targetVersion,
      status: 'frozen',
      versions: [release, ...contract.versions],
    });
    member.status = 'frozen';
    member.blockers = [];
    member.failureReason = undefined;
    member.frozenVersionId = release.id;
    member.frozenAt = release.releasedAt;
    member.frozenChecksum = release.checksum;
    status = 'running';
  }

  if (status === 'running' && !stoppedAt) status = 'completed';

  const nextMembers = batch.members.map((member) => updatedMembers.get(member.id)!);
  const nextBatch: ReleaseBatch = {
    ...batch,
    status,
    members: nextMembers,
    revision: batch.revision + 1,
    updatedAt: new Date().toISOString(),
  };

  store = {
    ...store,
    contracts: store.contracts.map((contract) => updatedContracts.get(contract.id) ?? contract),
    batches: store.batches.map((item) => (item.id === batchId ? nextBatch : item)),
  };
  persistStore(store);
  await wait();
  return { batch: clone(nextBatch), stoppedAt: stoppedAt ? clone(stoppedAt) : undefined };
}

export interface UpdateBatchMemberInput {
  batchId: string;
  revision: number;
  memberId: string;
  targetVersion?: string;
  notes?: string;
}

export async function updateBatchMember(input: UpdateBatchMemberInput): Promise<ReleaseBatch> {
  const store = loadStore();
  const batch = assertRevision(store, input.batchId, input.revision);
  const member = batch.members.find((item) => item.id === input.memberId);
  if (!member) throw new Error('批次成员不存在。');
  if (member.status === 'frozen') throw new Error('已冻结成员的版本不可修改。');

  const targetVersion = input.targetVersion?.trim();
  if (targetVersion !== undefined) {
    if (!targetVersion) throw new Error('版本号不能为空。');
    const contract = store.contracts.find((item) => item.id === member.contractId);
    if (contract?.versions.some((version) => version.version === targetVersion)) {
      throw new Error(`版本 ${targetVersion} 已经冻结过。`);
    }
    member.targetVersion = targetVersion;
  }
  if (input.notes !== undefined) member.notes = input.notes;
  if (member.status === 'failed') {
    member.status = 'pending';
    member.failureReason = undefined;
  }

  const nextBatch: ReleaseBatch = {
    ...batch,
    status: batch.status === 'failed' ? 'pending' : batch.status,
    revision: batch.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  persistStore({
    ...store,
    batches: store.batches.map((item) => (item.id === input.batchId ? nextBatch : item)),
  });
  await wait();
  return clone(nextBatch);
}

export interface RemoveBatchMemberInput {
  batchId: string;
  revision: number;
  memberId: string;
}

export async function removeBatchMember(input: RemoveBatchMemberInput): Promise<ReleaseBatch> {
  const store = loadStore();
  const batch = assertRevision(store, input.batchId, input.revision);
  const member = batch.members.find((item) => item.id === input.memberId);
  if (!member) throw new Error('批次成员不存在。');
  if (member.status === 'frozen') throw new Error('已冻结成员不能移出批次。');

  const remaining = batch.members.filter((item) => item.id !== input.memberId);
  const nextBatch: ReleaseBatch = {
    ...batch,
    members: remaining.length
      ? remaining.map((item, index) => ({
          ...item,
          ordinal: index,
          dependsOnMemberIds: item.dependsOnMemberIds.filter((id) => id !== input.memberId),
        }))
      : [],
    status: remaining.length ? batch.status : 'completed',
    revision: batch.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  persistStore({
    ...store,
    batches: store.batches.map((item) => (item.id === input.batchId ? nextBatch : item)),
  });
  await wait();
  return clone(nextBatch);
}

export interface CompleteMigrationInput {
  batchId: string;
  revision: number;
  memberId: string;
  contractId: string;
}

/** 补齐旧冻结记录的契约关联与快照，未补齐节点保持待迁移 */
export async function completeLegacyMigration(input: CompleteMigrationInput): Promise<ReleaseBatch> {
  const store = loadStore();
  const batch = assertRevision(store, input.batchId, input.revision);
  if (!batch.legacy) throw new Error('仅迁移批次支持补齐操作。');
  const member = batch.members.find((item) => item.id === input.memberId);
  if (!member) throw new Error('迁移成员不存在。');
  if (!member.legacyVersionId) throw new Error('该成员没有可补齐的旧记录。');

  const contract = store.contracts.find((item) => item.id === input.contractId);
  if (!contract) throw new Error('选择的契约不存在。');
  const version = contract.versions.find((item) => item.id === member.legacyVersionId);
  // 旧记录可能挂在被删除后重建的契约上，按 contractId+version 兜底查找
  const legacyVersion =
    version ??
    store.contracts
      .flatMap((item) => item.versions)
      .find((item) => item.id === member.legacyVersionId);
  if (!legacyVersion) throw new Error('旧冻结版本记录已不存在。');

  const checksum = legacyVersion.checksum.trim() || stableChecksum(contract.openapi);
  const openapi = legacyVersion.openapi.trim() || contract.openapi;
  const restoredVersion: ContractVersion = {
    ...legacyVersion,
    contractId: contract.id,
    checksum,
    openapi,
    batchId: batch.id,
    batchMemberId: member.id,
  };

  const contracts = store.contracts.map((item) => ({
    ...item,
    versions: (() => {
      const without = item.versions.filter((v) => v.id !== restoredVersion.id);
      return item.id === contract.id ? [restoredVersion, ...without] : without;
    })(),
  }));

  member.contractId = contract.id;
  member.contractName = contract.name;
  member.status = 'frozen';
  member.blockers = [];
  member.frozenVersionId = restoredVersion.id;
  member.frozenAt = restoredVersion.releasedAt;
  member.frozenChecksum = checksum;
  member.legacyContractId = undefined;

  const stillMigrating = batch.members.some((item) => item.status !== 'frozen');
  const nextBatch: ReleaseBatch = {
    ...batch,
    status: stillMigrating ? 'migrating' : 'completed',
    revision: batch.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  persistStore({
    ...store,
    contracts,
    batches: store.batches.map((item) => (item.id === batch.id ? nextBatch : item)),
  });
  await wait();
  return clone(nextBatch);
}

/** 详情页单契约冻结：自动包装成隐式单成员批次，保证全部冻结都可按批次追溯 */
export async function freezeVersion(
  contractId: string,
  version: string,
  notes: string,
): Promise<ApiContract> {
  const store0 = loadStore();
  const contract = store0.contracts.find((item) => item.id === contractId);
  if (!contract) throw new Error('契约不存在');
  const blockers = validateForRelease(contract).filter((issue) => issue.severity === 'blocker');
  if (blockers.length) {
    throw new Error('发布门禁仍有阻断项，无法冻结正式版本。');
  }
  const occupied = findOpenBatchForContract(store0, contractId);
  if (occupied) {
    throw new Error(`该契约已在发布批次「${occupied.name}」中，请在发布页统一处理。`);
  }
  if (contract.versions.some((item) => item.version === version.trim())) {
    throw new Error(`版本 ${version.trim()} 已经冻结过。`);
  }

  const batch = await createReleaseBatch({
    name: `${contract.name} v${version.trim()} 单独发布`,
    notes: notes.trim() || '从契约详情页发起的单契约冻结。',
    members: [{ contractId, targetVersion: version.trim(), notes: notes.trim() }],
    createdBy: '当前发布人',
  });
  const implicitBatch: ReleaseBatch = { ...batch, implicit: true };
  const store1 = loadStore();
  persistStore({
    ...store1,
    batches: store1.batches.map((item) => (item.id === batch.id ? implicitBatch : item)),
  });

  const result = await runReleaseBatch(batch.id, implicitBatch.revision);
  const finalStore = loadStore();
  const updated = finalStore.contracts.find((item) => item.id === contractId)!;
  if (result.batch.status !== 'completed') {
    throw new Error('冻结未完成，请在发布页查看停在待处理的批次。');
  }
  return clone(updated);
}

/** 测试/演示：模拟另一窗口直接提交了批次修订，用于触发乐观锁提示 */
export async function simulateExternalBatchCommit(batchId: string): Promise<number> {
  const store = loadStore();
  const batch = store.batches.find((item) => item.id === batchId);
  if (!batch) throw new Error('发布批次不存在。');
  const nextBatch: ReleaseBatch = {
    ...batch,
    revision: batch.revision + 1,
    updatedAt: new Date().toISOString(),
    notes: `${batch.notes}\n[另一窗口 ${new Date().toLocaleTimeString('zh-CN')} 提交了成员顺序调整]`.trim(),
  };
  persistStore({
    ...store,
    batches: store.batches.map((item) => (item.id === batchId ? nextBatch : item)),
  });
  return nextBatch.revision;
}

// ---------------------------------------------------------------------------
// 报告与示例
// ---------------------------------------------------------------------------

export function generateExampleRequest(contract: ApiContract, change?: ContractChange): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contract.openapi);
  } catch {
    parsed = null;
  }
  const openapi = parsed as
    | {
        paths?: Record<string, Record<string, { summary?: string }>>;
      }
    | null;
  const candidates = openapi?.paths ? Object.entries(openapi.paths) : [];
  const selectedPath = change?.path ?? candidates[0]?.[0] ?? '/resource';
  const selectedMethod = (
    change?.method ??
    (candidates[0]?.[1] ? Object.keys(candidates[0][1])[0] : 'get')
  ).toUpperCase();
  const fields = change
    ? [change.after.replace(/^新增|移除|变为/g, '').trim()]
    : ['orderId: ORD-20260929-001', 'requestId: req-local-demo'];

  return JSON.stringify(
    {
      method: selectedMethod,
      url: `https://api.example.com${selectedPath.replace('{orderId}', 'ORD-20260929-001').replace('{paymentId}', 'PAY-90218').replace('{userId}', 'U-1024')}`,
      headers: {
        Authorization: 'Bearer <token>',
        'X-Client-Version': contract.version,
      },
      body:
        selectedMethod === 'GET'
          ? undefined
          : Object.fromEntries(
              fields.map((field) => {
                const [key, value] = field.split(':').map((item) => item.trim());
                return [key || 'field', value || 'value'];
              }),
            ),
    },
    null,
    2,
  );
}

export function buildChangeReport(contract: ApiContract, batch?: ReleaseBatch): string {
  const member = batch?.members.find((item) => item.contractId === contract.id);
  const lines = [
    `# ${contract.name} ${contract.version} 契约变更报告`,
    '',
    `- 领域：${contract.domain}`,
    `- 负责人：${contract.owner}`,
    `- 状态：${contract.status}`,
    `- 生成时间：${new Date().toISOString()}`,
  ];
  if (batch && member) {
    lines.push(
      `- 发布批次：${batch.name}（${batch.id}）`,
      `- 调用顺序：第 ${member.ordinal + 1} 个节点`,
      `- 节点状态：${member.status}`,
      member.frozenAt ? `- 批次冻结时间：${member.frozenAt}` : '- 批次冻结时间：未冻结',
    );
  }
  lines.push(
    '',
    '## 变更明细',
    ...contract.changes.flatMap((change) => [
      `### ${change.method} ${change.path} - ${change.kind}`,
      `- 兼容性：${change.compatibility}`,
      `- 变更前：${change.before}`,
      `- 变更后：${change.after}`,
      `- 判定依据：${change.rationale}`,
      `- 调用方影响：${change.impactStatement || '未填写'}`,
      `- 迁移方案：${change.migrationPlan || '未填写'}`,
      `- 评审结论：${change.reviewState}`,
      '',
    ]),
    '## 调用方',
    ...contract.consumers.map(
      (consumer) =>
        `- ${consumer.name} / ${consumer.owner} / ${consumer.environment} / ${consumer.clientVersion}`,
    ),
    '',
    '## 豁免记录',
    ...(contract.exemptions.length
      ? contract.exemptions.map(
          (item) => `- ${item.scope}：${item.reason}（至 ${item.expiresAt}）`,
        )
      : ['- 无']),
  );
  return lines.join('\n');
}

export function buildBatchReport(batch: ReleaseBatch): string {
  const ordered = orderMembersByDependency(batch.members);
  const frozen = ordered.filter((member) => member.status === 'frozen').length;
  const lines = [
    `# 发布批次报告：${batch.name}`,
    '',
    `- 批次编号：${batch.id}`,
    `- 状态：${batch.status}`,
    `- 创建人：${batch.createdBy}`,
    `- 创建时间：${batch.createdAt}`,
    `- 最近更新：${batch.updatedAt}`,
    `- 修订版本：${batch.revision}`,
    `- 冻结进度：${frozen} / ${ordered.length}`,
    `- 发布说明：${batch.notes || '无'}`,
    '',
    '## 调用顺序与节点状态',
    ...ordered.flatMap((member, index) => [
      `### ${index + 1}. ${member.contractName} → v${member.targetVersion}`,
      `- 节点：${member.id}`,
      `- 状态：${member.status}`,
      member.frozenChecksum ? `- 校验值：${member.frozenChecksum}` : '- 校验值：未冻结',
      member.frozenAt ? `- 冻结时间：${formatDateTime(member.frozenAt)}` : '- 冻结时间：未冻结',
      member.dependsOnMemberIds.length
        ? `- 依赖先发布：${member.dependsOnMemberIds
            .map((id) => ordered.find((item) => item.id === id)?.contractName ?? id)
            .join('、')}`
        : '- 依赖先发布：无',
      member.failureReason ? `- 失败原因：${member.failureReason}` : '',
      ...(member.blockers.length
        ? [
            '- 待处理阻断：',
            ...member.blockers.map((issue) => `  - ${issue.title}：${issue.detail}`),
          ]
        : []),
      '',
    ]),
  ];
  return lines.filter((line) => line !== '').join('\n');
}

export function diffVersionSummary(contract: ApiContract): string {
  const previous = contract.versions[0];
  if (!previous) {
    return '无可比较的历史正式版本。';
  }
  return [
    `上一版 ${previous.version}`,
    `发布于 ${formatDateTime(previous.releasedAt)}`,
    `校验值 ${previous.checksum}`,
    previous.batchId ? `发布批次 ${previous.batchId}` : '发布批次 待迁移',
    `本版变更 ${contract.changes.length} 项`,
  ].join('\n');
}
