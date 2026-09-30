import { Link } from '@tanstack/react-router';
import {
  Archive,
  History,
  LockKeyhole,
  PackageCheck,
  Plus,
  ShieldQuestion,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { BatchDetailPanel } from '../components/contract/batch-detail-panel';
import { BatchStatusBadge } from '../components/contract/batch-badges';
import { CreateBatchDialog } from '../components/contract/create-batch-dialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { formatDateTime } from '../lib/utils';
import { nextRunnableMember, orderMembersByDependency } from '../models/contract';
import { useBatches, useContracts } from '../services/contract-queries';

export function ReleasesPage() {
  const contracts = useContracts();
  const batches = useBatches();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState('');

  const contractList = contracts.data ?? [];
  const batchList = batches.data ?? [];

  const occupiedContractIds = useMemo(() => {
    const ids = new Set<string>();
    batchList.forEach((batch) => {
      if (batch.status === 'completed' || batch.legacy) return;
      batch.members.forEach((member) => {
        if (member.status !== 'frozen') ids.add(member.contractId);
      });
    });
    return ids;
  }, [batchList]);

  const selectedBatch =
    batchList.find((batch) => batch.id === selectedBatchId) ?? batchList[0];
  const migratingBatch = batchList.find((batch) => batch.status === 'migrating');
  const pendingMigrationCount =
    migratingBatch?.members.filter((member) => member.status !== 'frozen').length ?? 0;

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

  const batchNameById = new Map(batchList.map((batch) => [batch.id, batch]));

  return (
    <div>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Release Center</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950 sm:text-3xl">
            可恢复发布批次
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            多个契约组成批次一起发版，成员按调用依赖排序逐个冻结；评审不完整会停在待处理，失败后可从未完成节点重试，成功版本保留。两个窗口并发提交时按修订版本检测，后提交者会看到版本变化且不能覆盖另一边的成员和顺序。
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          新建发布批次
        </Button>
      </div>

      {migratingBatch && pendingMigrationCount > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <strong>旧冻结记录迁移：</strong>
            已自动把历史冻结版本归入「{migratingBatch.name}」，其中 {pendingMigrationCount}{' '}
            条记录缺少批次关联或快照，标记为待迁移。请在下方批次中补齐关联后，发布页、版本历史和报告才能完整按批次追溯。
          </div>
        </div>
      )}

      <CreateBatchDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        contracts={contractList}
        occupiedContractIds={occupiedContractIds}
        onCreated={(id) => setSelectedBatchId(id)}
      />

      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        <Card className="h-fit xl:sticky xl:top-24">
          <CardHeader>
            <CardTitle>发布批次</CardTitle>
            <p className="mt-1 text-xs text-slate-500">{batchList.length} 个批次</p>
          </CardHeader>
          <CardContent className="space-y-2 p-2">
            {batches.isLoading ? (
              <p className="px-3 py-10 text-center text-sm text-slate-500">正在加载批次...</p>
            ) : (
              batchList.map((batch) => {
                const ordered = orderMembersByDependency(batch.members);
                const frozen = ordered.filter((member) => member.status === 'frozen').length;
                const active = selectedBatch?.id === batch.id;
                const runnable = nextRunnableMember(batch);
                return (
                  <button
                    key={batch.id}
                    type="button"
                    onClick={() => setSelectedBatchId(batch.id)}
                    className={`w-full rounded-md border p-3 text-left ${
                      active
                        ? 'border-sky-300 bg-sky-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm text-slate-900">{batch.name}</strong>
                      <BatchStatusBadge status={batch.status} />
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-500">
                      {frozen}/{ordered.length} 节点 · r{batch.revision} ·{' '}
                      {formatDateTime(batch.updatedAt)}
                    </p>
                    {runnable && batch.status !== 'completed' && (
                      <p className="mt-1 text-[11px] text-sky-800">
                        下一节点：{runnable.contractName} v{runnable.targetVersion}
                      </p>
                    )}
                  </button>
                );
              })
            )}
            {!batches.isLoading && !batchList.length && (
              <p className="px-3 py-10 text-center text-sm text-slate-500">
                还没有发布批次，点击右上角创建。
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {selectedBatch ? (
            <BatchDetailPanel batch={selectedBatch} contracts={contractList} />
          ) : (
            <Card>
              <CardContent className="py-16 text-center text-sm text-slate-500">
                选择或创建一个发布批次开始发布。
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-4 w-4" />
                冻结策略
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <Policy icon={PackageCheck} text="成员按调用依赖拓扑排序，被依赖契约先冻结，调用方随后发布。" />
              <Policy icon={Archive} text="版本快照包含完整 OpenAPI、变更清单、校验值和批次节点。" />
              <Policy icon={LockKeyhole} text="冻结失败只标记当前节点，成功版本保留，重试从未完成节点继续。" />
              <Policy
                icon={ShieldQuestion}
                text="批次带修订版本号，并发提交冲突时拒绝覆盖并提示加载最新成员顺序。"
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>正式版本记录（按批次追溯）</CardTitle>
          <p className="mt-1 text-xs text-slate-500">{versions.length} 个冻结版本</p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">契约</th>
                  <th className="px-4 py-3 font-medium">版本</th>
                  <th className="px-4 py-3 font-medium">发布批次</th>
                  <th className="px-4 py-3 font-medium">发布时间</th>
                  <th className="px-4 py-3 font-medium">校验值</th>
                  <th className="px-4 py-3 font-medium">发布说明</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {versions.map(({ contract, release }) => {
                  const batch = release.batchId ? batchNameById.get(release.batchId) : undefined;
                  const pendingMigration = Boolean(release.batchId && batch?.legacy) && !release.checksum;
                  return (
                    <tr key={release.id} className="border-t border-slate-100">
                      <td className="px-4 py-4">
                        <div className="font-medium">{contract.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{contract.domain}</div>
                      </td>
                      <td className="px-4 py-4">
                        <Badge tone="slate">v{release.version}</Badge>
                      </td>
                      <td className="px-4 py-4">
                        {batch ? (
                          <button
                            type="button"
                            className="text-left"
                            onClick={() => setSelectedBatchId(batch.id)}
                          >
                            <Badge tone={batch.legacy ? 'amber' : 'blue'}>{batch.name}</Badge>
                          </button>
                        ) : (
                          <Badge tone="amber">待迁移</Badge>
                        )}
                        {pendingMigration && (
                          <div className="mt-1 text-[11px] text-amber-700">记录不完整，待补齐</div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-slate-600">
                        {formatDateTime(release.releasedAt)}
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-slate-600">
                        {release.checksum || '—'}
                      </td>
                      <td className="max-w-md px-4 py-4 text-slate-600">{release.notes}</td>
                      <td className="px-4 py-4 text-right">
                        <Link
                          to="/contracts/$contractId"
                          params={{ contractId: contract.id }}
                          className="text-xs font-medium text-sky-800 hover:underline"
                        >
                          查看版本
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!versions.length && (
              <p className="px-4 py-16 text-center text-sm text-slate-500">
                尚无冻结的正式版本。
              </p>
            )}
          </div>
        </CardContent>
      </Card>
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
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-sky-800" />
      <span>{text}</span>
    </div>
  );
}
