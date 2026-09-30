import type { ApiContract, ReleaseIssue } from './contract';
import { validateForRelease } from './contract';

export type ReleaseBatchStatus =
  | 'draft' // 草稿，可改成员与顺序
  | 'running' // 正在按顺序冻结
  | 'paused' // 停在评审不完整或冻结失败的节点，可恢复
  | 'completed' // 全部成员冻结成功
  | 'archived'; // 归档（例如删除草稿后的占位，不参与发布）

export type BatchMemberStatus =
  | 'pending' // 等待执行
  | 'ready' // 门禁通过，可冻结
  | 'frozen' // 已冻结成功
  | 'blocked' // 评审/迁移约束不完整，停在此处
  | 'failed' // 冻结时出错，等待重试
  | 'skipped'; // 批次外依赖等原因跳过

export type LegacyMigrationState = 'migrated' | 'pending';

export interface BatchMember {
  contractId: string;
  /** 创建批次时的名称快照，契约被删后仍可追溯 */
  contractName: string;
  /** 计划冻结的目标版本号 */
  targetVersion: string;
  status: BatchMemberStatus;
  /** 冻结成功后写入的版本记录 id */
  versionId?: string;
  /** 冻结后的校验值快照 */
  checksum?: string;
  frozenAt?: string;
  /** 最近一次门禁/冻结提示，用于发布页说明为什么停在这里 */
  reason?: string;
}

export interface ReleaseBatch {
  id: string;
  name: string;
  notes: string;
  status: ReleaseBatchStatus;
  /** 乐观锁版本号：任何更新自增，提交时携带期望值 */
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** 冻结执行到的成员下标，恢复时从该成员继续；已完成的成员不会重跑 */
  cursor: number;
  members: BatchMember[];
  /** 批次外但被成员依赖的契约 id（信息提示，不阻塞） */
  externalDependencies: string[];
  /** 依赖成环的契约 id 组（每组一个环） */
  dependencyCycles: string[][];
  /** 历史冻结记录迁移批次 */
  legacy?: {
    state: LegacyMigrationState;
    migratedAt?: string;
    /** 待迁移记录找不到归属契约等原因 */
    reason?: string;
    legacyVersionId?: string;
  };
}

export interface ReleaseMeta {
  /** 持久化结构版本号，每次需要一次性迁移时递增 */
  storageVersion: number;
  legacyMigrationAt?: string;
}

export const BATCH_STATUS_LABELS: Record<ReleaseBatchStatus, string> = {
  draft: '草稿',
  running: '发布中',
  paused: '待处理',
  completed: '已完成',
  archived: '已归档',
};

export const MEMBER_STATUS_LABELS: Record<BatchMemberStatus, string> = {
  pending: '待执行',
  ready: '可冻结',
  frozen: '已冻结',
  blocked: '评审不完整',
  failed: '冻结失败',
  skipped: '已跳过',
};

export interface MemberBlocker {
  severity: ReleaseIssue['severity'];
  title: string;
  detail: string;
}

/**
 * 批次发布门禁：评审不完整（待评审或被退回）即为阻断，
 * 并复用单契约的影响说明 / 迁移方案 / 豁免规则。
 */
export function memberBlockers(contract: ApiContract): MemberBlocker[] {
  const blockers: MemberBlocker[] = [];

  contract.changes
    .filter((change) => change.reviewState === 'pending')
    .forEach((change) => {
      blockers.push({
        severity: 'blocker',
        title: '存在未处理变更',
        detail: `${change.method} ${change.path} 仍处于待评审状态。`,
      });
    });

  contract.changes
    .filter((change) => change.reviewState === 'returned')
    .forEach((change) => {
      blockers.push({
        severity: 'blocker',
        title: '变更被退回尚未重新评审',
        detail: `${change.method} ${change.path} 的评审结论为退回，需要补充材料后重新接受。`,
      });
    });

  validateForRelease(contract)
    .filter((issue) => issue.severity === 'blocker')
    .forEach((issue) => {
      if (!blockers.some((item) => item.title === issue.title && item.detail === issue.detail)) {
        blockers.push({ severity: issue.severity, title: issue.title, detail: issue.detail });
      }
    });

  return blockers;
}

export function isMemberReady(contract: ApiContract): boolean {
  return memberBlockers(contract).length === 0;
}

export interface TopoResult {
  order: string[];
  /** 不在节点集合内但被节点依赖的 id（批次外契约） */
  missing: string[];
  /** 成环的节点 id（每组一个环，无法判定先后） */
  cycles: string[][];
}

/**
 * 以「被依赖者优先」做拓扑排序：若 a 依赖 b（b 在 a.dependencies 中），
 * 则 b 必须排在 a 之前，保证冻结按调用依赖顺序推进。
 * 使用 Kahn 算法并在同层按 id 排序，保证顺序确定、可复现。
 */
export function topoOrderIds(
  nodes: string[],
  dependenciesOf: (id: string) => string[],
): TopoResult {
  const nodeSet = new Set(nodes);
  const indegree = new Map<string, number>();
  // dependentsOf[b] = 依赖 b 的节点，删除 b 时减少它们的入度
  const dependentsOf = new Map<string, Set<string>>();
  const missing = new Set<string>();

  nodes.forEach((node) => {
    indegree.set(node, 0);
    dependentsOf.set(node, new Set());
  });

  nodes.forEach((node) => {
    dependenciesOf(node).forEach((dep) => {
      if (!nodeSet.has(dep)) {
        missing.add(dep);
        return;
      }
      // dep -> node
      const dependents = dependentsOf.get(dep)!;
      if (!dependents.has(node)) {
        dependents.add(node);
        indegree.set(node, (indegree.get(node) ?? 0) + 1);
      }
    });
  });

  const order: string[] = [];
  const remaining = new Set(nodes);

  while (remaining.size) {
    const ready = nodes.filter(
      (node) => remaining.has(node) && (indegree.get(node) ?? 0) === 0,
    );
    if (!ready.length) {
      // 剩余节点全部在环上（或被环阻塞）
      break;
    }
    ready.sort();
    for (const node of ready) {
      order.push(node);
      remaining.delete(node);
      dependentsOf.get(node)?.forEach((dependent) => {
        indegree.set(dependent, (indegree.get(dependent) ?? 1) - 1);
      });
    }
  }

  const cycles: string[][] = [];
  if (remaining.size) {
    // 环上节点合并为一组呈现；保持输入顺序，结果稳定
    cycles.push(nodes.filter((node) => remaining.has(node)).sort());
  }

  return { order, missing: Array.from(missing).sort(), cycles };
}

/**
 * 计算批次成员的依赖排序，并识别批次外依赖与依赖环。
 * 成员名/目标版本沿用传入快照，仅重排顺序。
 */
export function planBatchMembers(
  selections: Array<{ contractId: string; targetVersion: string }>,
  contracts: ApiContract[],
): Pick<ReleaseBatch, 'members' | 'externalDependencies' | 'dependencyCycles'> {
  const byId = new Map(contracts.map((contract) => [contract.id, contract]));
  const unique = dedupeSelections(selections);
  const ids = unique.map((item) => item.contractId);
  const topo = topoOrderIds(ids, (id) => byId.get(id)?.dependencies ?? []);

  const rank = new Map(topo.order.map((id, index) => [id, index]));
  const orderedIds = [...ids].sort((left, right) => {
    const leftRank = rank.get(left);
    const rightRank = rank.get(right);
    if (leftRank === undefined && rightRank === undefined) return left.localeCompare(right);
    if (leftRank === undefined) return 1;
    if (rightRank === undefined) return -1;
    return leftRank - rightRank;
  });

  return {
    members: orderedIds.map((contractId) => {
      const selection = unique.find((item) => item.contractId === contractId)!;
      const contract = byId.get(contractId);
      return {
        contractId,
        contractName: contract?.name ?? `已删除契约 ${contractId}`,
        targetVersion: selection.targetVersion,
        status: 'pending' as const,
      };
    }),
    externalDependencies: topo.missing,
    dependencyCycles: topo.cycles,
  };
}

function dedupeSelections(
  selections: Array<{ contractId: string; targetVersion: string }>,
): Array<{ contractId: string; targetVersion: string }> {
  const seen = new Set<string>();
  return selections.filter((item) => {
    if (seen.has(item.contractId)) return false;
    seen.add(item.contractId);
    return true;
  });
}

/** 批次整体进度文案，供发布页与报告复用 */
export function batchProgress(batch: ReleaseBatch): { frozen: number; total: number } {
  return {
    frozen: batch.members.filter((member) => member.status === 'frozen').length,
    total: batch.members.length,
  };
}
