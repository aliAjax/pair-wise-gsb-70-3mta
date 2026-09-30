import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  PauseCircle,
  Play,
  RotateCcw,
  ShieldQuestion,
  TriangleAlert,
  Users,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import type { ApiContract, BatchMember, ReleaseBatch } from '../../models/contract';
import { nextRunnableMember, orderMembersByDependency } from '../../models/contract';
import { BatchConflictError } from '../../services/contract-service';
import {
  batchKeys,
  contractKeys,
  useCompleteMigration,
  useRemoveBatchMember,
  useRunBatch,
  useSimulateExternalCommit,
  useUpdateBatchMember,
} from '../../services/contract-queries';
import { formatDateTime } from '../../lib/utils';
import { BatchMemberStatusBadge, BatchStatusBadge } from './batch-badges';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

interface Props {
  batch: ReleaseBatch;
  contracts: ApiContract[];
}

export function BatchDetailPanel({ batch, contracts }: Props) {
  const queryClient = useQueryClient();
  const runBatch = useRunBatch();
  const updateMember = useUpdateBatchMember();
  const removeMemberMutation = useRemoveBatchMember();
  const completeMigration = useCompleteMigration();
  const simulateCommit = useSimulateExternalCommit();
  const [notice, setNotice] = useState<{ kind: 'conflict' | 'error' | 'paused'; text: string } | null>(
    null,
  );
  const [editingMemberId, setEditingMemberId] = useState('');
  const [migratingMemberId, setMigratingMemberId] = useState('');
  const [attachContractId, setAttachContractId] = useState('');

  const ordered = orderMembersByDependency(batch.members);
  const frozenCount = ordered.filter((member) => member.status === 'frozen').length;
  const runnable = nextRunnableMember(batch);

  function refreshAfterConflict() {
    // 后提交者看到版本变化：丢弃本地旧修订，加载另一边提交后的成员和顺序
    void queryClient.invalidateQueries({ queryKey: batchKeys.all });
    void queryClient.invalidateQueries({ queryKey: contractKeys.all });
  }

  async function execute() {
    setNotice(null);
    try {
      const result = await runBatch.mutateAsync({ batchId: batch.id, revision: batch.revision });
      if (result.batch.status === 'paused' && result.stoppedAt) {
        setNotice({
          kind: 'paused',
          text: `批次已停在待处理：${result.stoppedAt.contractName} 还有 ${result.stoppedAt.blockers.length} 个阻断项，补齐评审后可从该节点重试，已冻结的 ${result.batch.members.filter((member) => member.status === 'frozen').length} 个版本保留。`,
        });
      } else if (result.batch.status === 'failed' && result.stoppedAt) {
        setNotice({ kind: 'error', text: result.stoppedAt.failureReason ?? '冻结失败，可从该节点重试。' });
      }
    } catch (error) {
      if (error instanceof BatchConflictError) {
        refreshAfterConflict();
        setNotice({
          kind: 'conflict',
          text: `${error.message} 当前服务端修订版本为 r${error.serverRevision}，请确认新顺序后重试，本次提交未覆盖任何成员。`,
        });
      } else {
        setNotice({ kind: 'error', text: error instanceof Error ? error.message : '执行失败。' });
      }
    }
  }

  async function saveMemberEdit(member: BatchMember, targetVersion: string, notes: string) {
    setNotice(null);
    try {
      await updateMember.mutateAsync({
        batchId: batch.id,
        revision: batch.revision,
        memberId: member.id,
        targetVersion,
        notes,
      });
      setEditingMemberId('');
    } catch (error) {
      if (error instanceof BatchConflictError) {
        refreshAfterConflict();
        setNotice({
          kind: 'conflict',
          text: `${error.message} 服务端修订版本 r${error.serverRevision}，成员修改已被拒绝。`,
        });
      } else {
        setNotice({ kind: 'error', text: error instanceof Error ? error.message : '保存失败。' });
      }
    }
  }

  async function removeMember(member: BatchMember) {
    setNotice(null);
    try {
      await removeMemberMutation.mutateAsync({
        batchId: batch.id,
        revision: batch.revision,
        memberId: member.id,
      });
    } catch (error) {
      if (error instanceof BatchConflictError) {
        refreshAfterConflict();
        setNotice({ kind: 'conflict', text: error.message });
      } else {
        setNotice({ kind: 'error', text: error instanceof Error ? error.message : '移出失败。' });
      }
    }
  }

  async function attachMigration(member: BatchMember) {
    if (!attachContractId) return;
    setNotice(null);
    try {
      await completeMigration.mutateAsync({
        batchId: batch.id,
        revision: batch.revision,
        memberId: member.id,
        contractId: attachContractId,
      });
      setMigratingMemberId('');
      setAttachContractId('');
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : '补齐迁移失败。',
      });
    }
  }

  async function simulateOtherWindow() {
    setNotice(null);
    await simulateCommit.mutateAsync(batch.id);
    setNotice({
      kind: 'conflict',
      text: '已模拟另一窗口提交（修订版本 +1）。现在点击执行/编辑会基于旧修订被拒绝，以演示后提交者看到版本变化且不会覆盖另一边的成员和顺序。',
    });
  }

  const actionLabel =
    batch.status === 'pending'
      ? '开始按顺序冻结'
      : batch.status === 'failed'
        ? '从失败节点重试'
        : batch.status === 'paused'
          ? '补齐后从待处理节点重试'
          : '继续冻结后续节点';
  const running =
    runBatch.isPending || updateMember.isPending || completeMigration.isPending;
  const canExecute =
    !batch.legacy &&
    batch.status !== 'completed' &&
    Boolean(runnable) &&
    !running;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>{batch.name}</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              {batch.createdBy} · 创建于 {formatDateTime(batch.createdAt)} · 修订版本 r
              {batch.revision}
              {batch.implicit && ' · 单契约隐式批次'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <BatchStatusBadge status={batch.status} />
            <Badge tone="neutral">
              {frozenCount}/{ordered.length} 节点
            </Badge>
          </div>
        </div>
        {batch.notes && <p className="mt-2 text-xs leading-5 text-slate-600">{batch.notes}</p>}
      </CardHeader>
      <CardContent className="space-y-3">
        {notice && (
          <div
            className={
              notice.kind === 'conflict'
                ? 'flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900'
                : notice.kind === 'paused'
                  ? 'flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-900'
                  : 'flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800'
            }
          >
            {notice.kind === 'conflict' ? (
              <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0" />
            ) : notice.kind === 'paused' ? (
              <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{notice.text}</span>
          </div>
        )}

        <ol className="space-y-2">
          {ordered.map((member, index) => {
            const isRunnable = runnable?.id === member.id && member.status !== 'frozen';
            const editing = editingMemberId === member.id;
            return (
              <li
                key={member.id}
                className={`rounded-md border p-3 ${
                  member.status === 'frozen'
                    ? 'border-emerald-200 bg-emerald-50/60'
                    : isRunnable
                      ? 'border-sky-300 bg-sky-50/60'
                      : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-sm bg-slate-100 text-xs font-semibold text-sky-900">
                    {index + 1}
                  </span>
                  <strong className="text-sm text-slate-900">{member.contractName}</strong>
                  <Badge tone="slate">v{member.targetVersion}</Badge>
                  <BatchMemberStatusBadge status={member.status} />
                  {member.frozenChecksum && (
                    <span className="font-mono text-[10px] text-slate-500">
                      {member.frozenChecksum}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    {member.frozenAt && (
                      <span className="text-[11px] text-slate-500">
                        {formatDateTime(member.frozenAt)}
                      </span>
                    )}
                    {!batch.legacy && member.status !== 'frozen' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingMemberId(editing ? '' : member.id);
                          setMigratingMemberId('');
                        }}
                      >
                        {editing ? '收起' : '改版本/说明'}
                      </Button>
                    )}
                  </span>
                </div>

                {member.dependsOnMemberIds.length > 0 && (
                  <p className="mt-1.5 pl-8 text-[11px] text-slate-500">
                    需等待：
                    {member.dependsOnMemberIds
                      .map((id) => ordered.find((item) => item.id === id)?.contractName ?? id)
                      .join('、')}
                    先冻结
                  </p>
                )}

                {member.status === 'blocked' && member.blockers.length > 0 && (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
                      <TriangleAlert className="h-3.5 w-3.5" />
                      停在待处理：{member.blockers.length} 个阻断项
                    </div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11px] leading-5 text-amber-800">
                      {member.blockers.slice(0, 4).map((issue) => (
                        <li key={issue.id}>{issue.detail}</li>
                      ))}
                    </ul>
                    <Link
                      to="/contracts/$contractId"
                      params={{ contractId: member.contractId }}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-sky-800 hover:underline"
                    >
                      去补齐评审 <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                )}

                {member.status === 'failed' && (
                  <div className="mt-2 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-[11px] leading-5 text-red-800">
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      {member.failureReason}
                      {batch.status === 'failed' && '修正后点击下方按钮可直接从该节点重试。'}
                    </span>
                  </div>
                )}

                {member.status === 'frozen' && (
                  <div className="mt-1.5 flex items-center gap-1.5 pl-8 text-[11px] text-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    正式版本已保留，重试批次时不会重复冻结该节点。
                  </div>
                )}

                {batch.legacy && member.status !== 'frozen' && (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
                      <ShieldQuestion className="h-3.5 w-3.5" />
                      待迁移：旧冻结记录缺少批次关联或快照
                    </div>
                    {member.blockers.map((issue) => (
                      <p key={issue.id} className="mt-1 text-[11px] text-amber-800">
                        {issue.detail}
                      </p>
                    ))}
                    {migratingMemberId === member.id ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Select value={attachContractId} onValueChange={setAttachContractId}>
                          <SelectTrigger className="h-8 w-56 text-xs">
                            <SelectValue placeholder="选择要补齐的契约" />
                          </SelectTrigger>
                          <SelectContent>
                            {contracts.map((contract) => (
                              <SelectItem key={contract.id} value={contract.id}>
                                {contract.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          disabled={!attachContractId || completeMigration.isPending}
                          onClick={() => void attachMigration(member)}
                        >
                          补齐关联并快照
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setMigratingMemberId('');
                            setAttachContractId('');
                          }}
                        >
                          取消
                        </Button>
                      </div>
                    ) : (
                      <Button
                        className="mt-2"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setMigratingMemberId(member.id);
                          setAttachContractId(member.legacyContractId || '');
                          setEditingMemberId('');
                        }}
                      >
                        补齐关联
                      </Button>
                    )}
                  </div>
                )}

                {editing && (
                  <MemberEditForm
                    member={member}
                    busy={updateMember.isPending}
                    onCancel={() => setEditingMemberId('')}
                    onSave={(targetVersion, notes) => void saveMemberEdit(member, targetVersion, notes)}
                    onRemove={() => void removeMember(member)}
                  />
                )}
              </li>
            );
          })}
        </ol>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {!batch.legacy && batch.status !== 'completed' && (
            <Button onClick={() => void execute()} disabled={!canExecute}>
              {batch.status === 'failed' || batch.status === 'paused' ? (
                <RotateCcw className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {runBatch.isPending ? '冻结执行中' : actionLabel}
            </Button>
          )}
          {batch.status === 'completed' && (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4" />
              批次全部成员已按调用顺序冻结完成。
            </span>
          )}
          {batch.status === 'paused' && (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <CircleDashed className="h-3.5 w-3.5" />
              批次保持待处理状态，关闭页面后仍可回来重试。
            </span>
          )}
          {!batch.legacy && batch.status !== 'completed' && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-[11px] text-slate-500"
              onClick={() => void simulateOtherWindow()}
              disabled={simulateCommit.isPending}
              title="本地演示：模拟另一个浏览器窗口已经提交了同一批次"
            >
              <Users className="h-3.5 w-3.5" />
              模拟另一窗口提交
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MemberEditForm({
  member,
  busy,
  onSave,
  onCancel,
  onRemove,
}: {
  member: BatchMember;
  busy: boolean;
  onSave: (targetVersion: string, notes: string) => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const [targetVersion, setTargetVersion] = useState(member.targetVersion);
  const [notes, setNotes] = useState(member.notes);
  return (
    <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-white p-2">
      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-2 text-[11px] text-slate-600">
          目标版本
          <input
            className="h-8 w-28 rounded-sm border border-slate-300 px-2 text-xs"
            value={targetVersion}
            onChange={(event) => setTargetVersion(event.target.value)}
          />
        </label>
        <input
          className="h-8 min-w-64 flex-1 rounded-sm border border-slate-300 px-2 text-xs"
          placeholder="节点发布说明"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onRemove}>
          移出成员
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button
          size="sm"
          disabled={busy || !targetVersion.trim()}
          onClick={() => onSave(targetVersion.trim(), notes.trim())}
        >
          保存（修订版本 +1）
        </Button>
      </div>
    </div>
  );
}
