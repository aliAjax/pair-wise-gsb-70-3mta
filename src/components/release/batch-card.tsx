import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  FileWarning,
  History,
  LockKeyhole,
  PauseCircle,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { formatDateTime } from '../../lib/utils';
import type { ApiContract } from '../../models/contract';
import {
  BATCH_STATUS_LABELS,
  MEMBER_STATUS_LABELS,
  type BatchMember,
  type ReleaseBatch,
  batchProgress,
} from '../../models/release-batch';

const memberTone: Record<BatchMember['status'], 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'slate'> = {
  pending: 'neutral',
  ready: 'blue',
  frozen: 'green',
  blocked: 'amber',
  failed: 'red',
  skipped: 'slate',
};

const batchTone: Record<ReleaseBatch['status'], 'neutral' | 'blue' | 'amber' | 'green' | 'slate'> = {
  draft: 'neutral',
  running: 'blue',
  paused: 'amber',
  completed: 'green',
  archived: 'slate',
};

interface BatchCardProps {
  batch: ReleaseBatch;
  contracts: ApiContract[];
  highlighted: boolean;
  running: boolean;
  onRun: (batch: ReleaseBatch) => void;
  onResume: (batch: ReleaseBatch) => void;
  onDelete: (batch: ReleaseBatch) => void;
  onViewReport: (batch: ReleaseBatch) => void;
}

export function BatchCard({
  batch,
  contracts,
  highlighted,
  running,
  onRun,
  onResume,
  onDelete,
  onViewReport,
}: BatchCardProps) {
  const progress = batchProgress(batch);
  const pausedMember = batch.members.find(
    (member) => member.status === 'blocked' || member.status === 'failed',
  );

  return (
    <Card className={highlighted ? 'ring-2 ring-sky-400' : undefined}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusIcon status={batch.status} />
              <strong className="text-sm">{batch.name}</strong>
              <Badge tone={batchTone[batch.status]}>{BATCH_STATUS_LABELS[batch.status]}</Badge>
              {batch.legacy && (
                <Badge tone={batch.legacy.state === 'pending' ? 'amber' : 'slate'}>
                  {batch.legacy.state === 'pending' ? '待迁移' : '历史迁移'}
                </Badge>
              )}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              更新 {formatDateTime(batch.updatedAt)} · revision {batch.revision} ·{' '}
              {progress.frozen}/{progress.total} 已冻结
            </p>
            {batch.notes && (
              <p className="mt-1 max-w-2xl truncate text-xs text-slate-600">{batch.notes}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            {batch.status === 'draft' && (
              <Button size="sm" disabled={running} onClick={() => onRun(batch)}>
                <LockKeyhole className="h-3.5 w-3.5" />
                开始发布
              </Button>
            )}
            {batch.status === 'paused' && !batch.legacy?.state && (
              <Button size="sm" disabled={running} onClick={() => onResume(batch)}>
                <RotateCcw className="h-3.5 w-3.5" />
                从未完成节点重试
              </Button>
            )}
            {batch.status === 'paused' && batch.legacy?.state === 'pending' && (
              <Link
                to="/releases"
                search={{ batch: undefined, migration: '1' }}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
              >
                去补齐迁移
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
            <Button size="sm" variant="outline" onClick={() => onViewReport(batch)}>
              <History className="h-3.5 w-3.5" />
              批次报告
            </Button>
            {batch.status === 'draft' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={running}
                onClick={() => onDelete(batch)}
              >
                删除草稿
              </Button>
            )}
          </div>
        </div>

        {pausedMember && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {pausedMember.status === 'failed' ? (
              <FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <div>
              <strong>
                停在 {pausedMember.contractName}（{MEMBER_STATUS_LABELS[pausedMember.status]}）
              </strong>
              <p className="mt-0.5 leading-5">
                {pausedMember.reason ?? '补齐评审后可从该节点重试，之前已冻结的版本会保留。'}
              </p>
              {pausedMember.status === 'blocked' && (
                <Link
                  to="/contracts/$contractId"
                  params={{ contractId: pausedMember.contractId }}
                  className="mt-1 inline-flex items-center gap-1 font-medium text-sky-800 hover:underline"
                >
                  去补齐评审 <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          </div>
        )}

        <ol className="mt-3 grid gap-2 lg:grid-cols-2">
          {batch.members.map((member, index) => (
            <li
              key={`${member.contractId}-${index}`}
              className="flex items-center gap-2 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-2"
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-sm bg-white text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-medium">{member.contractName}</span>
                  <span className="text-[11px] text-slate-500">v{member.targetVersion}</span>
                </div>
                {member.checksum && (
                  <span className="font-mono text-[10px] text-slate-400">
                    {member.checksum}
                  </span>
                )}
              </div>
              <Badge tone={memberTone[member.status]}>{MEMBER_STATUS_LABELS[member.status]}</Badge>
            </li>
          ))}
        </ol>

        {batch.externalDependencies.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-700">
            批次外依赖：
            {batch.externalDependencies
              .map((id) => contracts.find((item) => item.id === id)?.name ?? id)
              .join('、')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StatusIcon({ status }: { status: ReleaseBatch['status'] }) {
  const className = 'h-4 w-4';
  if (status === 'completed') return <CheckCircle2 className={`${className} text-emerald-600`} />;
  if (status === 'paused') return <PauseCircle className={`${className} text-amber-600`} />;
  if (status === 'running') return <LockKeyhole className={`${className} animate-pulse text-sky-700`} />;
  return <CircleDashed className={`${className} text-slate-400`} />;
}
