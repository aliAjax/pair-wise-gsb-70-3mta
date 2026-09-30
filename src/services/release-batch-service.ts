import type { ApiContract, ContractVersion } from '../models/contract';
import {
  BATCH_STATUS_LABELS,
  MEMBER_STATUS_LABELS,
  type BatchMember,
  type ReleaseBatch,
  batchProgress,
  isMemberReady,
  memberBlockers,
  planBatchMembers,
} from '../models/release-batch';
import {
  CURRENT_STORAGE_VERSION,
  loadBatches,
  loadContracts,
  loadMeta,
  persistBatches,
  persistContracts,
  persistMeta,
} from './storage';
import { applyFrozenVersion, buildFrozenVersion } from './contract-service';

const LATENCY = 160;
/** 演示用：在该批次上对指定下标成员模拟一次冻结失败，失败后清除，重试可成功 */
export const SIMULATED_FAILURE_KEY = 'pair-wise-gsb-70-simulated-failures';

function wait(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, LATENCY));
}

function nowIso(): string {
  return new Date().toISOString();
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 提交时的批次 revision 与存储中不一致时抛出，调用方应提示版本已变化 */
export class BatchConflictError extends Error {
  currentRevision: number;
  constructor(currentRevision: number) {
    super('发布批次已在其它窗口更新，请刷新查看最新成员与顺序后再提交。');
    this.name = 'BatchConflictError';
    this.currentRevision = currentRevision;
  }
}

export class BatchValidationError extends Error {}

export interface CreateBatchInput {
  name: string;
  notes: string;
  selections: Array<{ contractId: string; targetVersion: string }>;
  /** 直接创建为待处理/已完成批次（迁移用） */
  initialMembers?: BatchMember[];
  legacy?: ReleaseBatch['legacy'];
  createdAt?: string;
}

export async function listReleaseBatches(): Promise<ReleaseBatch[]> {
  await wait();
  return loadBatches();
}

function saveBatches(batches: ReleaseBatch[]): void {
  persistBatches(batches);
}

function assertRevision(expected: number | undefined, batch: ReleaseBatch): void {
  if (expected !== undefined && expected !== batch.revision) {
    throw new BatchConflictError(batch.revision);
  }
}

function bump(batch: ReleaseBatch, patch: Partial<ReleaseBatch>): ReleaseBatch {
  return { ...batch, ...patch, revision: batch.revision + 1, updatedAt: nowIso() };
}

/**
 * 创建批次：成员按调用依赖排序。重复契约去重，空成员拒绝。
 */
export async function createBatch(input: CreateBatchInput): Promise<ReleaseBatch> {
  const contracts = loadContracts();
  const validSelections = input.selections.filter(
    (item) => item.contractId && item.targetVersion.trim(),
  );
  if (!validSelections.length && !input.initialMembers) {
    throw new BatchValidationError('请至少选择一个契约并填写目标版本号。');
  }

  const planned = planBatchMembers(validSelections, contracts);
  const members = input.initialMembers ?? planned.members;
  const timestamp = nowIso();
  const batch: ReleaseBatch = {
    id: nextId('batch'),
    name: input.name.trim() || `发布批次 ${new Date().toLocaleString('zh-CN')}`,
    notes: input.notes.trim(),
    status: input.legacy ? 'paused' : 'draft',
    revision: 1,
    createdAt: input.createdAt ?? timestamp,
    updatedAt: timestamp,
    cursor: 0,
    members,
    externalDependencies: planned.externalDependencies,
    dependencyCycles: planned.dependencyCycles,
    legacy: input.legacy,
  };

  const batches = loadBatches();
  saveBatches([batch, ...batches]);
  await wait();
  return batch;
}

export interface UpdateDraftInput {
  name?: string;
  notes?: string;
  selections?: Array<{ contractId: string; targetVersion: string }>;
}

/** 更新草稿：改成员后重新按依赖排序，已冻结的历史批次不允许修改 */
export async function updateDraftBatch(
  batchId: string,
  expectedRevision: number,
  patch: UpdateDraftInput,
): Promise<ReleaseBatch> {
  const batches = loadBatches();
  const index = batches.findIndex((item) => item.id === batchId);
  if (index < 0) throw new BatchValidationError('发布批次不存在。');
  const batch = batches[index];
  assertRevision(expectedRevision, batch);
  if (batch.status !== 'draft') {
    throw new BatchValidationError('批次已开始发布，成员与顺序已锁定，不能修改。');
  }

  const contracts = loadContracts();
  const planned = patch.selections
    ? planBatchMembers(
        patch.selections.filter((item) => item.contractId && item.targetVersion.trim()),
        contracts,
      )
    : undefined;
  if (planned && !planned.members.length) {
    throw new BatchValidationError('批次至少保留一个成员。');
  }

  const updated = bump(batch, {
    name: patch.name !== undefined ? patch.name : batch.name,
    notes: patch.notes !== undefined ? patch.notes : batch.notes,
    members: planned?.members ?? batch.members,
    externalDependencies: planned?.externalDependencies ?? batch.externalDependencies,
    dependencyCycles: planned?.dependencyCycles ?? batch.dependencyCycles,
    cursor: 0,
  });
  const next = [...batches];
  next[index] = updated;
  saveBatches(next);
  await wait();
  return updated;
}

export async function deleteDraftBatch(
  batchId: string,
  expectedRevision: number,
): Promise<void> {
  const batches = loadBatches();
  const batch = batches.find((item) => item.id === batchId);
  if (!batch) return;
  assertRevision(expectedRevision, batch);
  if (batch.status !== 'draft') {
    throw new BatchValidationError('只有草稿批次可以删除。');
  }
  saveBatches(batches.filter((item) => item.id !== batchId));
  await wait();
}

function consumeSimulatedFailure(batchId: string, index: number): boolean {
  try {
    const raw = localStorage.getItem(SIMULATED_FAILURE_KEY);
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, number[]>;
    const indices = map[batchId] ?? [];
    if (!indices.includes(index)) return false;
    map[batchId] = indices.filter((value) => value !== index);
    localStorage.setItem(SIMULATED_FAILURE_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

export function armSimulatedFailure(batchId: string, index: number): void {
  let map: Record<string, number[]> = {};
  try {
    map = JSON.parse(localStorage.getItem(SIMULATED_FAILURE_KEY) ?? '{}') as Record<
      string,
      number[]
    >;
  } catch {
    map = {};
  }
  const set = new Set([...(map[batchId] ?? []), index]);
  map[batchId] = Array.from(set);
  localStorage.setItem(SIMULATED_FAILURE_KEY, JSON.stringify(map));
}

/**
 * 可恢复的批次执行器：
 * - 从 cursor 开始，按依赖顺序逐个冻结，已经 frozen 的成员绝不重跑；
 * - 评审不完整 -> 成员 blocked、批次停在待处理；
 * - 冻结抛错 -> 成员 failed、批次停在待处理，成功版本保留；
 * - 每次成员状态变化立即落盘并推进 revision，页面刷新或换窗口后可从断点恢复；
 * - 传入 expectedRevision，提交时若批次已在另一窗口变化则拒绝，避免覆盖对方成员和顺序。
 */
export async function runReleaseBatch(
  batchId: string,
  expectedRevision: number,
): Promise<ReleaseBatch> {
  let working = loadBatches().find((item) => item.id === batchId);
  if (!working) throw new BatchValidationError('发布批次不存在。');
  assertRevision(expectedRevision, working);
  if (working.status === 'completed') return working;
  if (working.legacy?.state === 'pending') {
    throw new BatchValidationError('该批次含待迁移的历史冻结记录，补齐归属后才能发布。');
  }

  let contracts = loadContracts();
  let cursor = Math.min(working.cursor, working.members.length);

  // 标记发布中并落盘
  working = bump(working, { status: 'running' });
  persistState(working, contracts);

  for (let index = cursor; index < working.members.length; index += 1) {
    const member = working.members[index];
    cursor = index;

    // 恢复执行时跳过已完成成员
    if (member.status === 'frozen') continue;

    const contract = contracts.find((item) => item.id === member.contractId);

    // 契约缺失：挂起，等待数据补齐后重试
    if (!contract) {
      working = persistMember(working, contracts, index, {
        status: 'failed',
        reason: '归属契约不存在，恢复契约后可重试。',
      });
      contracts = loadContracts();
      working = bump(working, { status: 'paused', cursor: index });
      persistState(working, contracts);
      return working;
    }

    // 目标版本已存在（可能是另一窗口刚冻结）：视为冲突，保留对方结果
    if (contract.versions.some((version) => version.version === member.targetVersion)) {
      working = bump(working, { status: 'paused', cursor: index });
      persistState(working, contracts);
      throw new BatchConflictError(working.revision);
    }

    // 评审不完整就停在待处理：已冻结成员保留
    const blockers = memberBlockers(contract);
    if (!isMemberReady(contract)) {
      working = persistMember(working, contracts, index, {
        status: 'blocked',
        reason: blockers[0]?.detail ?? '成员评审不完整。',
      });
      contracts = loadContracts();
      working = bump(working, { status: 'paused', cursor: index });
      persistState(working, contracts);
      return working;
    }

    // 演示冻结失败：成员 failed、批次待处理，从未完成节点重试
    if (consumeSimulatedFailure(working.id, index)) {
      working = persistMember(working, contracts, index, {
        status: 'failed',
        reason: '冻结服务返回 503（模拟故障），版本未写入，可重试。',
      });
      contracts = loadContracts();
      working = bump(working, { status: 'paused', cursor: index });
      persistState(working, contracts);
      return working;
    }

    // 执行冻结并立即提交，保证中途失败时成功版本已保留
    let release: ContractVersion;
    try {
      release = buildFrozenVersion(contract, member.targetVersion, working.notes, {
        batchId: working.id,
        batchTitle: working.name,
      });
      contracts = contracts.map((item) =>
        item.id === contract.id ? applyFrozenVersion(item, release) : item,
      );
    } catch (error) {
      working = persistMember(working, contracts, index, {
        status: 'failed',
        reason: error instanceof Error ? error.message : '冻结失败。',
      });
      contracts = loadContracts();
      working = bump(working, { status: 'paused', cursor: index });
      persistState(working, contracts);
      return working;
    }

    working = persistMember(working, contracts, index, {
      status: 'frozen',
      versionId: release.id,
      checksum: release.checksum,
      frozenAt: release.releasedAt,
      reason: undefined,
    });
    contracts = loadContracts();
    cursor = index + 1;
  }

  working = bump(working, {
    status: 'completed',
    cursor: working.members.length,
  });
  persistState(working, contracts);
  return working;
}

/** 从批次的未完成节点重试：校验当前 revision 后重新驱动执行器 */
export async function resumeReleaseBatch(
  batchId: string,
  expectedRevision: number,
): Promise<ReleaseBatch> {
  const batch = loadBatches().find((item) => item.id === batchId);
  if (!batch) throw new BatchValidationError('发布批次不存在。');
  assertRevision(expectedRevision, batch);
  if (batch.status !== 'paused') {
    throw new BatchValidationError('只有待处理批次可以重试。');
  }
  return runReleaseBatch(batchId, batch.revision);
}

/**
 * 单契约快捷冻结：内部仍走「创建单成员批次 -> 按门禁执行」的同一套链路，
 * 保证历史版本一定带有批次关联，发布页/版本历史/报告口径统一。
 */
export async function freezeSingleContract(
  contractId: string,
  version: string,
  notes: string,
): Promise<ReleaseBatch> {
  const contract = loadContracts().find((item) => item.id === contractId);
  if (!contract) throw new Error('契约不存在');
  const batch = await createBatch({
    name: `${contract.name} v${version} 单契约发布`,
    notes,
    selections: [{ contractId, targetVersion: version }],
  });
  return runReleaseBatch(batch.id, batch.revision);
}

/** 替换某个成员的可变字段并落盘（不推进 cursor） */
function persistMember(
  batch: ReleaseBatch,
  contracts: ApiContract[],
  index: number,
  patch: Partial<BatchMember>,
): ReleaseBatch {
  const members = batch.members.map((member, current) =>
    current === index ? { ...member, ...patch } : member,
  );
  const updated = bump(batch, { members });
  persistState(updated, contracts);
  return updated;
}

/** 原子提交批次与契约（localStorage 单次事件循环内连续写入，读取侧总是成对看到） */
function persistState(batch: ReleaseBatch, contracts: ApiContract[]): void {
  const batches = loadBatches();
  const exists = batches.some((item) => item.id === batch.id);
  const nextBatches = exists
    ? batches.map((item) => (item.id === batch.id ? batch : item))
    : [batch, ...batches];
  persistContracts(contracts);
  persistBatches(nextBatches);
}

/**
 * 旧数据迁移：批次化改造前的冻结记录（ContractVersion 没有 batchId）
 * 逐条补建批次。归属契约仍存在的，成员标记已冻结、批次标记已完成；
 * 归属契约缺失、无法补齐追溯链的，标记为待迁移，发布页提示人工处理。
 * 幂等：通过 meta.legacyMigrationAt 与 version.batchId 双重保证只迁移一次。
 */
export async function ensureLegacyMigration(): Promise<{ migrated: number; pending: number }> {
  const meta = loadMeta();
  if (meta.storageVersion >= CURRENT_STORAGE_VERSION && meta.legacyMigrationAt) {
    return countLegacyState(loadBatches());
  }

  const contracts = loadContracts();
  const batches = loadBatches();
  const stampTargets: Array<{
    contractId: string;
    versionId: string;
    batchId: string;
    batchName: string;
  }> = [];

  const legacyVersions = contracts.flatMap((contract) =>
    contract.versions
      .filter((version) => !version.batchId)
      .map((version) => ({ contract, version })),
  );

  let migrated = 0;
  let pending = 0;
  const newBatches: ReleaseBatch[] = [];

  for (const { version } of legacyVersions) {
    const ownerExists = contracts.some((contract) => contract.id === version.contractId);
    const timestamp = version.releasedAt;
    const batchId = nextId('legacy-batch');
    const batchName = `历史冻结迁移 · v${version.version}`;

    const member: BatchMember = ownerExists
      ? {
          contractId: version.contractId,
          contractName:
            contracts.find((contract) => contract.id === version.contractId)?.name ??
            version.contractId,
          targetVersion: version.version,
          status: 'frozen',
          versionId: version.id,
          checksum: version.checksum,
          frozenAt: version.releasedAt,
        }
      : {
          contractId: version.contractId,
          contractName: `缺失契约 ${version.contractId}`,
          targetVersion: version.version,
          status: 'failed',
          reason: `归属契约 ${version.contractId} 已不存在，无法补齐批次追溯链。`,
        };

    const created: ReleaseBatch = {
      id: batchId,
      name: batchName,
      notes: version.notes,
      status: ownerExists ? 'completed' : 'paused',
      revision: 1,
      createdAt: timestamp,
      updatedAt: nowIso(),
      cursor: ownerExists ? 1 : 0,
      members: [member],
      externalDependencies: [],
      dependencyCycles: [],
      legacy: ownerExists
        ? { state: 'migrated', migratedAt: nowIso(), legacyVersionId: version.id }
        : {
            state: 'pending',
            reason: `归属契约 ${version.contractId} 已删除，历史冻结记录无法关联。`,
            legacyVersionId: version.id,
          },
    };

    newBatches.push(created);
    if (ownerExists) {
      migrated += 1;
      stampTargets.push({
        contractId: version.contractId,
        versionId: version.id,
        batchId,
        batchName,
      });
    } else {
      pending += 1;
    }
  }

  if (newBatches.length) {
    const nextContracts = contracts.map((contract) => ({
      ...contract,
      versions: contract.versions.map((version) => {
        const stamp = stampTargets.find(
          (item) => item.contractId === contract.id && item.versionId === version.id,
        );
        return stamp
          ? { ...version, batchId: stamp.batchId, batchTitle: stamp.batchName }
          : version;
      }),
    }));
    persistContracts(nextContracts);
    persistBatches([...newBatches, ...batches]);
  }

  persistMeta({
    storageVersion: CURRENT_STORAGE_VERSION,
    legacyMigrationAt: nowIso(),
  });
  await wait();
  return { migrated, pending };
}

function countLegacyState(batches: ReleaseBatch[]): { migrated: number; pending: number } {
  let migrated = 0;
  let pending = 0;
  batches
    .filter((batch) => batch.legacy)
    .forEach((batch) => {
      if (batch.legacy?.state === 'migrated') migrated += 1;
      else pending += 1;
    });
  return { migrated, pending };
}

/**
 * 处理待迁移记录：
 * - 指定新的归属契约：把历史版本挂到该契约的版本历史、批次转为已完成（版本保留）；
 * - 标记忽略：仍保留批次但注明无法追溯（不再阻塞发布页统计）。
 */
export async function resolvePendingMigration(
  batchId: string,
  expectedRevision: number,
  resolution: { action: 'attach'; targetContractId: string } | { action: 'ignore' },
): Promise<ReleaseBatch> {
  const batches = loadBatches();
  const index = batches.findIndex((item) => item.id === batchId);
  if (index < 0) throw new BatchValidationError('迁移批次不存在。');
  const batch = batches[index];
  assertRevision(expectedRevision, batch);
  if (!batch.legacy || batch.legacy.state !== 'pending') {
    throw new BatchValidationError('该批次没有待处理的迁移记录。');
  }

  let contracts = loadContracts();
  const member = batch.members[0];
  const legacyVersionId = batch.legacy.legacyVersionId;

  if (resolution.action === 'attach') {
    const target = contracts.find((item) => item.id === resolution.targetContractId);
    if (!target) throw new BatchValidationError('目标契约不存在。');

    // 历史版本可能挂在别的契约 versions 下（原归属契约缺失时记录被种子挂在幸存契约上）
    const sourceContract = contracts.find((contract) =>
      contract.versions.some((version) => version.id === legacyVersionId),
    );
    const legacyVersion = sourceContract?.versions.find(
      (version) => version.id === legacyVersionId,
    );
    if (!legacyVersion) throw new BatchValidationError('历史冻结记录不存在。');

    const stamped: ContractVersion = {
      ...legacyVersion,
      contractId: target.id,
      batchId: batch.id,
      batchTitle: batch.name,
    };
    contracts = contracts.map((contract) => {
      if (contract.id === sourceContract?.id) {
        return {
          ...contract,
          versions: contract.versions.filter((version) => version.id !== legacyVersionId),
        };
      }
      return contract;
    });
    contracts = contracts.map((contract) =>
      contract.id === target.id
        ? { ...contract, versions: [stamped, ...contract.versions] }
        : contract,
    );

    const updatedMember: BatchMember = {
      ...member,
      contractId: target.id,
      contractName: target.name,
      status: 'frozen',
      versionId: stamped.id,
      checksum: stamped.checksum,
      frozenAt: stamped.releasedAt,
      reason: undefined,
    };
    const updated = bump(batch, {
      status: 'completed',
      cursor: 1,
      members: [updatedMember],
      legacy: { ...batch.legacy, state: 'migrated', migratedAt: nowIso() },
    });
    const nextBatches = [...batches];
    nextBatches[index] = updated;
    persistContracts(contracts);
    persistBatches(nextBatches);
    await wait();
    return updated;
  }

  const updated = bump(batch, {
    status: 'archived',
    legacy: { ...batch.legacy, reason: '人工确认无法补齐归属，保留记录但不参与追溯。' },
  });
  const nextBatches = [...batches];
  nextBatches[index] = updated;
  persistContracts(contracts);
  persistBatches(nextBatches);
  await wait();
  return updated;
}

/** 批次报告（Markdown），发布页与报告页共用，保证按批次追溯口径一致 */
export function buildBatchReport(batch: ReleaseBatch, contracts: ApiContract[]): string {
  const progress = batchProgress(batch);
  const lines = [
    `# 发布批次报告：${batch.name}`,
    '',
    `- 批次编号：${batch.id}`,
    `- 批次状态：${BATCH_STATUS_LABELS[batch.status]}`,
    `- 冻结进度：${progress.frozen} / ${progress.total}`,
    `- 创建时间：${batch.createdAt}`,
    `- 最近更新：${batch.updatedAt}`,
    `- 乐观锁版本：revision ${batch.revision}`,
    batch.notes ? `- 批次说明：${batch.notes}` : '',
    batch.legacy ? `- 数据来源：批次化改造前的历史冻结迁移（${batch.legacy.state === 'migrated' ? '已补齐关联' : '待迁移'}）` : '',
    '',
    '## 发布顺序（按调用依赖排序）',
    ...batch.members.flatMap((member, index) => {
      const contract = contracts.find((item) => item.id === member.contractId);
      return [
        `${index + 1}. ${member.contractName} · 目标 v${member.targetVersion} · ${MEMBER_STATUS_LABELS[member.status]}${member.checksum ? ` · ${member.checksum}` : ''}`,
        member.reason ? `   - 暂停原因：${member.reason}` : '',
        contract ? `   - 领域：${contract.domain} · 负责人：${contract.owner}` : '   - 归属契约缺失',
      ].filter(Boolean);
    }),
    '',
    '## 已冻结正式版本',
    ...(batch.members
      .filter((member) => member.status === 'frozen')
      .map(
        (member) =>
          `- ${member.contractName} v${member.targetVersion}${member.checksum ? `（${member.checksum}）` : ''}${member.frozenAt ? ` · ${member.frozenAt}` : ''}`,
      )
      .concat(
        batch.members.some((member) => member.status !== 'frozen')
          ? []
          : [],
      )),
    ...(batch.members.every((member) => member.status === 'frozen')
      ? []
      : ['- 批次尚未全部完成，未冻结成员见上方顺序清单。']),
    '',
    '## 评审完整性',
    ...batch.members.map((member) => {
      const contract = contracts.find((item) => item.id === member.contractId);
      if (!contract) return `- ${member.contractName}：归属契约缺失。`;
      const pending = contract.changes.filter(
        (change) => change.reviewState === 'pending' || change.reviewState === 'returned',
      ).length;
      return `- ${member.contractName}：${pending ? `${pending} 项评审未完成（${MEMBER_STATUS_LABELS[member.status]}）` : '评审完整'}`;
    }),
  ];
  return lines.filter((line) => line !== undefined).join('\n');
}
