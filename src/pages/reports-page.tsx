import { Link } from '@tanstack/react-router';
import { Download, FileJson, FileText, FolderGit2, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { formatDateTime } from '../lib/utils';
import { buildChangeReport } from '../services/contract-service';
import { buildBatchReport } from '../services/release-batch-service';
import { useReleaseBatches } from '../services/batch-queries';
import { useContracts } from '../services/contract-queries';
import { useReviewStore } from '../store/review-store';
import { BATCH_STATUS_LABELS } from '../models/release-batch';

export function ReportsPage() {
  const contracts = useContracts();
  const batchesQuery = useReleaseBatches();
  const selectedContractId = useReviewStore((state) => state.selectedContractId);
  const setSelectedContract = useReviewStore((state) => state.setSelectedContract);
  const [mode, setMode] = useState<'contract' | 'batch'>('contract');
  const [selectedBatchId, setSelectedBatchId] = useState('');

  const contractList = contracts.data ?? [];
  const contract =
    contractList.find((item) => item.id === selectedContractId) ?? contractList[0];
  const batches = useMemo(
    () =>
      (batchesQuery.data ?? [])
        .filter((batch) => batch.status !== 'archived')
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
    [batchesQuery.data],
  );
  const batch = batches.find((item) => item.id === selectedBatchId) ?? batches[0];

  const report = useMemo(() => {
    if (mode === 'batch') {
      return batch ? buildBatchReport(batch, contractList) : '';
    }
    return contract ? buildChangeReport(contract) : '';
  }, [mode, batch, contract, contractList]);
  const reviewed = contract?.changes.filter((change) => change.reviewState !== 'pending') ?? [];

  return (
    <div>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Change Report</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950 sm:text-3xl">
            契约变更报告
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            汇总接口差异、兼容性结论、调用方影响、迁移方案和兼容层豁免；发布批次报告按成员冻结顺序追溯整个联合发布。
          </p>
        </div>
        {report && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                downloadText(
                  mode === 'batch' && batch
                    ? `${batch.id}.json`
                    : `${contract?.id}-${contract?.version}.json`,
                  mode === 'batch' && batch
                    ? JSON.stringify(batch, null, 2)
                    : JSON.stringify(contract, null, 2),
                  'application/json;charset=utf-8',
                )
              }
            >
              <FileJson className="h-4 w-4" />
              导出 JSON
            </Button>
            <Button
              onClick={() =>
                downloadText(
                  mode === 'batch' && batch
                    ? `${batch.id}-report.md`
                    : `${contract?.id}-${contract?.version}-change-report.md`,
                  report,
                  'text/markdown;charset=utf-8',
                )
              }
            >
              <Download className="h-4 w-4" />
              导出报告
            </Button>
          </div>
        )}
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
          <div className="flex rounded-sm border border-slate-200 p-0.5">
            <button
              type="button"
              className={
                mode === 'contract'
                  ? 'rounded-sm bg-sky-100 px-3 py-1.5 text-xs font-medium text-sky-900'
                  : 'px-3 py-1.5 text-xs text-slate-600'
              }
              onClick={() => setMode('contract')}
            >
              单契约报告
            </button>
            <button
              type="button"
              className={
                mode === 'batch'
                  ? 'rounded-sm bg-sky-100 px-3 py-1.5 text-xs font-medium text-sky-900'
                  : 'px-3 py-1.5 text-xs text-slate-600'
              }
              onClick={() => setMode('batch')}
            >
              发布批次报告
            </button>
          </div>

          {mode === 'contract' ? (
            <>
              <Select value={contract?.id ?? ''} onValueChange={setSelectedContract}>
                <SelectTrigger className="w-full sm:w-80">
                  <SelectValue placeholder="选择契约" />
                </SelectTrigger>
                <SelectContent>
                  {contractList.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} · v{item.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {contract && (
                <div className="flex flex-wrap gap-2 sm:ml-auto">
                  <Badge tone="blue">{contract.domain}</Badge>
                  <Badge tone="neutral">{contract.changes.length} 个变化</Badge>
                  <Badge tone={reviewed.length === contract.changes.length ? 'green' : 'amber'}>
                    {reviewed.length === contract.changes.length ? '评审完成' : '仍有待评审项'}
                  </Badge>
                </div>
              )}
            </>
          ) : (
            <>
              <Select value={batch?.id ?? ''} onValueChange={setSelectedBatchId}>
                <SelectTrigger className="w-full sm:w-96">
                  <SelectValue placeholder="选择发布批次" />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} · {BATCH_STATUS_LABELS[item.status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {batch && (
                <div className="flex flex-wrap gap-2 sm:ml-auto">
                  <Badge tone="neutral">{batch.members.length} 个成员</Badge>
                  <Badge
                    tone={
                      batch.status === 'completed'
                        ? 'green'
                        : batch.status === 'paused'
                          ? 'amber'
                          : 'blue'
                    }
                  >
                    {BATCH_STATUS_LABELS[batch.status]}
                  </Badge>
                  <Link to="/releases" search={{ batch: batch.id, migration: undefined }}>
                    <Badge tone="blue" className="hover:underline">
                      <FolderGit2 className="mr-1 h-3 w-3" />
                      打开发布页
                    </Badge>
                  </Link>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {mode === 'batch' ? (
        batch ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>批次报告预览</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  按调用依赖的冻结顺序、暂停节点与成功版本完整追溯
                </p>
              </div>
              <FileText className="h-5 w-5 text-slate-400" />
            </CardHeader>
            <CardContent>
              <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100">
                {report}
              </pre>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-16 text-center text-sm text-slate-500">
              暂无可生成报告的发布批次。
            </CardContent>
          </Card>
        )
      ) : contract ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>报告预览</CardTitle>
                <p className="mt-1 text-xs text-slate-500">Markdown 归档格式</p>
              </div>
              <FileText className="h-5 w-5 text-slate-400" />
            </CardHeader>
            <CardContent>
              <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100">
                {report}
              </pre>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>豁免记录</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  兼容层范围、原因和到期时间会进入正式报告
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {contract.exemptions.map((exemption) => (
                  <article
                    key={exemption.id}
                    className="rounded-md border border-blue-200 bg-blue-50 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm text-blue-950">{exemption.scope}</strong>
                      <Badge tone="blue">至 {exemption.expiresAt}</Badge>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-blue-900">{exemption.reason}</p>
                    <div className="mt-2 text-[11px] text-blue-800">
                      批准人：{exemption.approvedBy}
                    </div>
                  </article>
                ))}
                {!contract.exemptions.length && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                    当前没有兼容层豁免。
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>评审签名</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {contract.changes.map((change) => (
                  <div
                    key={change.id}
                    className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <div className="font-mono text-[11px] text-slate-600">
                        {change.method} {change.path}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {change.reviewer || '尚未评审'}
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge
                        tone={
                          change.reviewState === 'accepted'
                            ? 'green'
                            : change.reviewState === 'returned'
                              ? 'red'
                              : change.reviewState === 'exemption'
                                ? 'blue'
                                : 'amber'
                        }
                      >
                        {change.reviewState}
                      </Badge>
                      {change.reviewedAt && (
                        <div className="mt-1 text-[10px] text-slate-400">
                          {formatDateTime(change.reviewedAt)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-4 text-xs leading-5 text-slate-600">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              报告在客户端生成，不依赖后端。正式版本冻结后仍可在历史版本页比较工作副本与发布快照。
            </div>
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="py-16 text-center text-sm text-slate-500">
            暂无可生成报告的契约。
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
