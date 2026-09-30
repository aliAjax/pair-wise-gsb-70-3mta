export type ContractStatus = 'draft' | 'review' | 'ready' | 'released' | 'frozen';
export type ChangeKind =
  | 'field_added'
  | 'field_removed'
  | 'optionality_changed'
  | 'enum_expanded'
  | 'error_code_added'
  | 'error_code_removed';
export type Compatibility = 'compatible' | 'warning' | 'breaking';
export type ReviewState = 'pending' | 'accepted' | 'returned' | 'exemption';

export interface ContractChange {
  id: string;
  path: string;
  method: string;
  kind: ChangeKind;
  before: string;
  after: string;
  compatibility: Compatibility;
  rationale: string;
  impactStatement: string;
  migrationPlan: string;
  reviewState: ReviewState;
  reviewer: string;
  reviewComment: string;
  reviewedAt?: string;
}

export interface ApiConsumer {
  id: string;
  name: string;
  owner: string;
  environment: '生产' | '预发' | '灰度';
  clientVersion: string;
  requestsPerDay: number;
  contact: string;
}

export interface Exemption {
  id: string;
  changeId: string;
  scope: string;
  reason: string;
  approvedBy: string;
  expiresAt: string;
}

export interface ContractVersion {
  id: string;
  contractId: string;
  version: string;
  releasedAt: string;
  checksum: string;
  notes: string;
  changeIds: string[];
  openapi: string;
  /** 所属发布批次；旧冻结记录迁移后补齐 */
  batchId?: string;
  /** 批次内的成员节点，便于按节点追溯 */
  batchMemberId?: string;
}

export interface ApiContract {
  id: string;
  name: string;
  version: string;
  domain: string;
  owner: string;
  protocol: 'REST' | 'GraphQL' | 'gRPC-Web';
  status: ContractStatus;
  updatedAt: string;
  openapi: string;
  /** 调用依赖：本契约会调用这些契约，发布时被依赖方必须先冻结 */
  dependsOn: string[];
  changes: ContractChange[];
  consumers: ApiConsumer[];
  exemptions: Exemption[];
  versions: ContractVersion[];
}

export interface ReleaseIssue {
  id: string;
  severity: 'blocker' | 'warning';
  title: string;
  detail: string;
  changeId?: string;
}

export type BatchStatus =
  | 'pending' // 已创建，尚未开始冻结
  | 'running' // 至少一个成员已冻结，仍有未完成节点
  | 'paused' // 停在待处理：下一个成员评审不完整
  | 'failed' // 冻结失败（版本号冲突等），可从失败节点重试
  | 'completed' // 全部成员已冻结
  | 'migrating'; // 旧冻结记录迁移批次，尚有成员未补齐

export type BatchMemberStatus =
  | 'pending' // 等待按依赖顺序执行
  | 'blocked' // 评审不完整，批次停在该节点
  | 'failed' // 冻结失败，可从该节点重试
  | 'frozen'; // 已冻结，成功版本保留

export interface BatchMember {
  id: string;
  contractId: string;
  contractName: string;
  /** 目标冻结版本号 */
  targetVersion: string;
  notes: string;
  /** 解析后的调用依赖（创建批次时快照，按节点 id 引用） */
  dependsOnMemberIds: string[];
  status: BatchMemberStatus;
  /** 创建批次时的调用顺序序号，拓扑同序时保持稳定排序 */
  ordinal: number;
  blockers: ReleaseIssue[];
  frozenVersionId?: string;
  frozenAt?: string;
  frozenChecksum?: string;
  failureReason?: string;
  /** 迁移节点缺少的契约/快照关联，待人工补齐 */
  legacyContractId?: string;
  legacyVersionId?: string;
}

export interface ReleaseBatch {
  id: string;
  name: string;
  status: BatchStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  notes: string;
  members: BatchMember[];
  /** 乐观并发版本号；提交时基于该值检测另一窗口的改动 */
  revision: number;
  /** 详情页单个契约冻结产生的隐式单成员批次 */
  implicit?: boolean;
  /** 旧冻结记录自动迁移生成的批次 */
  legacy?: boolean;
}

export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  field_added: '新增字段',
  field_removed: '删除字段',
  optionality_changed: '可选性变化',
  enum_expanded: '枚举扩展',
  error_code_added: '新增错误码',
  error_code_removed: '删除错误码',
};

export const COMPATIBILITY_LABELS: Record<Compatibility, string> = {
  compatible: '兼容',
  warning: '警告',
  breaking: '不兼容',
};

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  pending: '待评审',
  accepted: '已接受',
  returned: '已退回',
  exemption: '兼容层豁免',
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: '草稿',
  review: '评审中',
  ready: '待发布',
  released: '已发布',
  frozen: '已冻结',
};

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  pending: '待发布',
  running: '发布中',
  paused: '停在待处理',
  failed: '冻结失败',
  completed: '发布完成',
  migrating: '待迁移',
};

export const BATCH_MEMBER_STATUS_LABELS: Record<BatchMemberStatus, string> = {
  pending: '待冻结',
  blocked: '评审未完成',
  failed: '冻结失败',
  frozen: '已冻结',
};

/**
 * 按调用依赖拓扑排序：被依赖的成员排在前面。
 * 同序节点保持创建顺序（ordinal），保证调用顺序稳定可预期。
 * 检测到依赖环时抛出错误，避免发布顺序不确定。
 */
export function orderMembersByDependency<T extends {
  id: string;
  ordinal: number;
  dependsOnMemberIds: string[];
}>(members: T[]): T[] {
  const byId = new Map(members.map((member) => [member.id, member]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  members.forEach((member) => {
    indegree.set(member.id, 0);
    dependents.set(member.id, []);
  });
  members.forEach((member) => {
    member.dependsOnMemberIds.forEach((depId) => {
      if (!byId.has(depId)) return;
      indegree.set(member.id, (indegree.get(member.id) ?? 0) + 1);
      dependents.get(depId)?.push(member.id);
    });
  });

  const ready = members
    .filter((member) => (indegree.get(member.id) ?? 0) === 0)
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((member) => member.id);
  const ordered: T[] = [];

  while (ready.length) {
    const currentId = ready.shift()!;
    const current = byId.get(currentId)!;
    ordered.push(current);
    dependents.get(currentId)?.forEach((dependentId) => {
      const next = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, next);
      if (next === 0) {
        const dependent = byId.get(dependentId)!;
        const insertAt = ready.findIndex((id) => (byId.get(id)?.ordinal ?? 0) > dependent.ordinal);
        if (insertAt === -1) ready.push(dependentId);
        else ready.splice(insertAt, 0, dependentId);
      }
    });
  }

  if (ordered.length !== members.length) {
    const cyclic = members
      .filter((member) => !ordered.some((item) => item.id === member.id))
      .map((member) => member.id);
    throw new Error(`契约调用依赖存在循环引用：${cyclic.join('、')}，请先解除环依赖。`);
  }
  return ordered;
}

/** 批次当前执行/重试应从哪个成员开始（第一个未冻结节点，按依赖顺序） */
export function nextRunnableMember(batch: ReleaseBatch): BatchMember | undefined {
  return orderMembersByDependency(batch.members).find((member) => member.status !== 'frozen');
}

export function classifyChange(input: {
  kind: ChangeKind;
  before: string;
  after: string;
}): { compatibility: Compatibility; rationale: string } {
  switch (input.kind) {
    case 'field_removed':
      return {
        compatibility: 'breaking',
        rationale: '删除字段会使仍读取该字段的客户端解析失败或业务判断缺失。',
      };
    case 'error_code_removed':
      return {
        compatibility: 'breaking',
        rationale: '删除错误码会破坏调用方基于错误码建立的分支与重试策略。',
      };
    case 'field_added':
      if (/required/i.test(input.after) || /必填/.test(input.after)) {
        return {
          compatibility: 'breaking',
          rationale: '新增必填字段要求现有调用方立即修改请求。',
        };
      }
      return {
        compatibility: 'compatible',
        rationale: '新增可选字段不会改变现有请求和响应结构。',
      };
    case 'optionality_changed':
      if (/可选.*必填|optional.*required/i.test(`${input.before} ${input.after}`)) {
        return {
          compatibility: 'breaking',
          rationale: '字段从可选变为必填，现有调用方可能不再满足请求约束。',
        };
      }
      return {
        compatibility: 'warning',
        rationale: '字段从必填变为可选会改变调用方对响应完整性的假设。',
      };
    case 'enum_expanded':
      return {
        compatibility: 'warning',
        rationale: '新增枚举值可能使未实现默认分支的客户端出现解析或展示异常。',
      };
    case 'error_code_added':
      return {
        compatibility: 'warning',
        rationale: '调用方应明确新错误码的展示和重试策略。',
      };
  }
}

export function validateForRelease(contract: ApiContract): ReleaseIssue[] {
  const issues: ReleaseIssue[] = [];
  const pending = contract.changes.filter((change) => change.reviewState === 'pending');
  pending.forEach((change) => {
    issues.push({
      id: `pending-${change.id}`,
      severity: 'blocker',
      title: '存在未处理变更',
      detail: `${change.method} ${change.path} 仍处于待评审状态。`,
      changeId: change.id,
    });
  });

  contract.changes
    .filter((change) => change.reviewState !== 'exemption')
    .forEach((change) => {
      if (change.compatibility === 'compatible') {
        return;
      }
      if (!change.impactStatement.trim()) {
        issues.push({
          id: `impact-${change.id}`,
          severity: 'blocker',
          title: '缺少调用方影响说明',
          detail: `${change.path} 需要说明受影响调用方、流量和业务影响。`,
          changeId: change.id,
        });
      }
      if (!change.migrationPlan.trim()) {
        issues.push({
          id: `migration-${change.id}`,
          severity: 'blocker',
          title: '缺少迁移方案',
          detail: `${change.path} 需要给出客户端升级、兼容层或回滚路径。`,
          changeId: change.id,
        });
      }
    });

  contract.changes
    .filter(
      (change) =>
        change.compatibility === 'breaking' &&
        change.reviewState === 'accepted' &&
        !contract.exemptions.some((item) => item.changeId === change.id),
    )
    .forEach((change) => {
      issues.push({
        id: `breaking-${change.id}`,
        severity: 'warning',
        title: '不兼容变更已接受但未登记豁免',
        detail: `${change.path} 需要记录兼容层的范围、原因和到期时间。`,
        changeId: change.id,
      });
    });

  return issues;
}
