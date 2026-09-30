import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import {
  Archive,
  FileWarning,
  GitCompare,
  Layers3,
  LockKeyhole,
  PackageCheck,
  RefreshCw,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { BatchBuilder } from '../components/release/batch-builder';
import { BatchCard } from '../components/release/batch-card';
import { MigrationPanel } from '../components/release/migration-panel';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { formatDateTime } from '../lib/utils';
import type { ReleaseBatch } from '../models/release-batch';
import {
  isBatchConflict,
  useCreateBatch,
  useDeleteDraftBatch,
  useLegacyMigration,
  useReleaseBatches,
  useResolveMigration,
  useResumeBatch,
  useRunBatch,
} from '../services/batch-queries';
import { useContracts } from '../services/contract-queries';
import { armSimulatedFailure } from '../services/release-batch-service';
import { buildBatchReport } from '../services/release-batch-service';

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ReleasesPage() {
  const contracts = useContracts();
  const batchesQuery = useReleaseBatches();
  const migration = useLegacyMigration();
  const createBatch = useCreateBatch();
  const runBatch = useRunBatch();
  const resumeBatch = useResumeBatch();
  const deleteBatch = useDeleteDraftBatch();
  const resolveMigration = useResolveMigration();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { batch?: string; migration?: string };

  const [notice, setNotice] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [reportBatch, setReportBatch] = useState<ReleaseBatch | null>(null);

  const contractList = contracts.data ?? [];
  const batches = useMemo(() => batchesQuery.data ?? [], [batchesQuery.data]);
  const pendingMigration = useMemo(
    () => batches.filter((batch) => batch.legacy?.state === 'pending'),
    [batches],
  );

  const versions = useMemo(
    () =>
      contractList
        .flatMap((contract) => contract.versions.map((release) => ({ contract, release })))
        .sort(
          (left, right) =>
            new Date(right.release.releasedAt).getTime() -
            new Date(left.release.releasedAt).getTime(),
        ),
    [contractList],
  );

  const batchById = useMemo(
    () => new Map(batches.map((batch) => [batch.id, batch])),
    [batches],
  );

  const mutationPending =
    createBatch.isPending ||
    runBatch.isPending ||
    resumeBatch.isPending ||
    deleteBatch.isPending ||
    resolveMigration.isPending;

  function handleConflict(error: unknown) {
    if (isBatchConflict(error)) {
      setNotice({
        tone: 'error',
        text: `${error.message}（存储中最新 revision：${error.currentRevision}）。页面已刷新对方的成员与顺序，本次提交未覆盖。`,
      });
    } else {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : '操作失败，请重试。',
      });
    }
    void batchesQuery.refetch();
  }

  async function handleCreate(input: {
    name: string;
    notes: string;
    selections: Parameters<typeof createBatch.mutateAsync>[0]['selections'];
    submit: boolean;
    simulateFailureAt: number;
  }) {
    setNotice(null);
    try {
      const batch = await createBatch.mutateAsync({
        name: input.name,
        notes: input.notes,
        selections: input.selections,
      });
      if (input.simulateFailureAt >= 0) {
        armSimulatedFailure(batch.id, input.simulateFailureAt);
      }
      if (input.submit) {
        await runBatch.mutateAsync({ batchId: batch.id, expectedRevision: batch.revision });
      }
      await navigate({
        to: '/releases',
        search: { batch: batch.id, migration: undefined },
        replace: true,
      });
    } catch (error) {
      handleConflict(error);
    }
  }

  async function handleRun(batch: ReleaseBatch) {
    setNotice(null);
    try {
      await runBatch.mutateAsync({ batchId: batch.id, expectedRevision: batch.revision });
    } catch (error) {
      handleConflict(error);
    }
  }

  async function handleResume(batch: ReleaseBatch) {
    setNotice(null);
    try {
      await resumeBatch.mutateAsync({ batchId: batch.id, expectedRevision: batch.revision });
    } catch (error) {
      handleConflict(error);
    }
  }

  async function handleDelete(batch: ReleaseBatch) {
    setNotice(null);
    try {
      await deleteBatch.mutateAsync({ batchId: batch.id, expectedRevision: batch.revision });
    } catch (error) {
      handleConflict(error);
    }
  }

  async function handleResolve(
    batch: ReleaseBatch,
    resolution: { action: 'attach'; targetContractId: string } | { action: 'ignore' },
  ) {
    setNotice(null);
    try {
      await resolveMigration.mutateAsync({
        batchId: batch.id,
        expectedRevision: batch.revision,
        resolution,
      });
    } catch (error) {
      handleConflict(error);
    }
  }

  const reportText = reportBatch
    ? buildBatchReport(reportBatch, contractList)
    : '';

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Release Center</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950 sm:text-3xl">
          可恢复发布批次
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          多个契约组成一个发布批次，成员按调用依赖排序冻结；评审不完整就停在待处理节点，
          故障或冲突后可从断点重试，成功版本始终保留。两个窗口同时提交时以 revision
          乐观锁保护，后提交者只会看到版本变化，不会覆盖对方的成员与顺序。
        </p>
      </div>

      {notice && (
        <div
          className={
            notice.tone === 'error'
              ? 'mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
              : 'mb-4 flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800'
          }
        >
          <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice.text}</span>
        </div>
      )}

      {(pendingMigration.length > 0 || search.migration) && (
        <div className="mb-4">
          <MigrationPanel
            pendingBatches={pendingMigration}
            contracts={contractList}
            resolving={resolveMigration.isPending}
            onResolve={handleResolve}
          />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>发布批次</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  {batches.length} 个批次 · 迁移：{migration.data?.migrated ?? 0} 已补齐 /{' '}
                  {migration.data?.pending ?? 0} 待迁移
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void batchesQuery.refetch()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                刷新
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {batchesQuery.isLoading ? (
                <p className="py-10 text-center text-sm text-slate-500">正在加载批次...</p>
              ) : batches.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">
                  还没有发布批次，在右侧选择成员创建第一个批次。
                </p>
              ) : (
                batches.map((batch) => (
                  <BatchCard
                    key={batch.id}
                    batch={batch}
                    contracts={contractList}
                    highlighted={search.batch === batch.id}
                    running={mutationPending}
                    onRun={handleRun}
                    onResume={handleResume}
                    onDelete={handleDelete}
                    onViewReport={setReportBatch}
                  />
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>正式版本记录（按批次追溯）</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                每条冻结版本都带有发布批次，历史记录已由迁移任务补齐
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">契约</th>
                      <th className="px-4 py-3 font-medium">版本</th>
                      <th className="px-4 py-3 font-medium">所属批次</th>
                      <th className="px-4 py-3 font-medium">发布时间</th>
                      <th className="px-4 py-3 font-medium">校验值</th>
                      <th className="px-4 py-3 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map(({ contract, release }) => {
                      const batch = release.batchId ? batchById.get(release.batchId) : undefined;
                      return (
                        <tr key={release.id} className="border-t border-slate-100">
                          <td className="px-4 py-3">
                            <div className="font-medium">{contract.name}</div>
                            <div className="mt-0.5 text-xs text-slate-500">{contract.domain}</div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone="slate">v{release.version}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            {batch ? (
                              <Link
                                to="/releases"
                                search={{ batch: batch.id, migration: undefined }}
                                className="text-xs font-medium text-sky-800 hover:underline"
                              >
                                {batch.legacy ? '历史迁移 · ' : ''}
                                {batch.name}
                              </Link>
                            ) : release.batchId ? (
                              <Badge tone="amber">批次已缺失</Badge>
                            ) : (
                              <Badge tone="amber">待迁移</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600">
                            {formatDateTime(release.releasedAt)}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-500">
                            {release.checksum}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              to="/contracts/$contractId"
                              params={{ contractId: contract.id }}
                              className="text-xs font-medium text-sky-800 hover:underline"
                            >
                              版本历史
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!versions.length && (
                  <p className="px-4 py-12 text-center text-sm text-slate-500">
                    尚无冻结的正式版本。
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <BatchBuilder contracts={contractList} submitting={mutationPending} onCreate={handleCreate} />
          <Card>
            <CardHeader>
              <CardTitle>批次发布策略</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs leading-5 text-slate-600">
              <Policy icon={Layers3} text="成员按调用依赖拓扑排序，被依赖的契约先冻结。" />
              <Policy
                icon={PackageCheck}
                text="评审不完整（待评审/被退回/缺影响说明或迁移方案）时批次停在该成员。"
              />
              <Policy
                icon={RefreshCw}
                text="失败后从未完成节点重试，已冻结成员不会重跑，成功版本保留。"
              />
              <Policy
                icon={GitCompare}
                text="revision 乐观锁：另一窗口改了批次，提交会被拒绝并展示最新成员与顺序。"
              />
              <Policy icon={Archive} text="历史冻结记录启动时自动迁移，无法补齐的标记待迁移人工处理。" />
              <Policy icon={LockKeyhole} text="每个正式版本都记录所属批次，发布页、版本历史、报告按批次追溯。" />
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={Boolean(reportBatch)} onOpenChange={(open) => !open && setReportBatch(null)}>
        <DialogContent className="w-[min(900px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>批次报告：{reportBatch?.name}</DialogTitle>
            <DialogDescription>
              按发布顺序记录每个成员的冻结状态，可直接归档
            </DialogDescription>
          </DialogHeader>
          {reportBatch && (
            <>
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100">
                {reportText}
              </pre>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setReportBatch(null)}>
                  关闭
                </Button>
                <Button
                  onClick={() =>
                    downloadText(
                      `${reportBatch.id}-report.md`,
                      reportText,
                      'text/markdown;charset=utf-8',
                    )
                  }
                >
                  导出 Markdown
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Policy({
  icon: Icon,
  text,
}: {
  icon: typeof Archive;
  text: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-sky-800" />
      <span>{text}</span>
    </div>
  );
}
