import { Download, FileJson, FileText, Layers, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BatchStatusBadge } from '../components/contract/batch-badges';
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
import { orderMembersByDependency } from '../models/contract';
import { buildBatchReport, buildChangeReport } from '../services/contract-service';
import { useBatches, useContracts } from '../services/contract-queries';
import { useReviewStore } from '../store/review-store';

type Scope = 'contract' | 'batch';

export function ReportsPage() {
  const contracts = useContracts();
  const batches = useBatches();
  const selectedContractId = useReviewStore((state) => state.selectedContractId);
  const setSelectedContract = useReviewStore((state) => state.setSelectedContract);
  const [scope, setScope] = useState<Scope>('contract');
  const [selectedBatchId, setSelectedBatchId] = useState('');

  const contractList = contracts.data ?? [];
  const batchList = batches.data ?? [];

  const contract =
    contractList.find((item) => item.id === selectedContractId) ?? contractList[0];
  const batch =
    batchList.find((item) => item.id === selectedBatchId) ?? batchList[0];

  const contractReport = useMemo(
    () => (contract ? buildChangeReport(contract) : ''),
    [contract],
  );
  const batchReport = useMemo(() => (batch ? buildBatchReport(batch) : ''), [batch]);
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
            汇总接口差异、兼容性结论、调用方影响、迁移方案和兼容层豁免；支持按发布批次追溯调用顺序、节点状态与冻结结果，供发布评审归档。
          </p>
        </div>
        <div className="flex gap-2">
          {scope === 'contract' && contract && (
            <>
              <Button
                variant="secondary"
                onClick={() =>
                  downloadText(
                    `${contract.id}-${contract.version}.json`,
                    JSON.stringify(contract, null, 2),
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
                    `${contract.id}-${contract.version}-change-report.md`,
                    contractReport,
                    'text/markdown;charset=utf-8',
                  )
                }
              >
                <Download className="h-4 w-4" />
                导出契约报告
              </Button>
            </>
          )}
          {scope === 'batch' && batch && (
            <Button
              onClick={() =>
                downloadText(
                  `${batch.id}-release-report.md`,
                  batchReport,
                  'text/markdown;charset=utf-8',
                )
              }
            >
              <Download className="h-4 w-4" />
              导出批次报告
            </Button>
          )}
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
          <div className="flex rounded-sm border border-slate-300 p-0.5">
            <button
              type="button"
              className={`rounded-sm px-3 py-1.5 text-xs font-medium ${
                scope === 'contract' ? 'bg-sky-100 text-sky-900' : 'text-slate-600'
              }`}
              onClick={() => setScope('contract')}
            >
              按契约
            </button>
            <button
              type="button"
              className={`rounded-sm px-3 py-1.5 text-xs font-medium ${
                scope === 'batch' ? 'bg-sky-100 text-sky-900' : 'text-slate-600'
              }`}
              onClick={() => setScope('batch')}
            >
              按发布批次
            </button>
          </div>

          {scope === 'contract' ? (
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
            batch && (
              <>
                <Select value={batch.id} onValueChange={setSelectedBatchId}>
                  <SelectTrigger className="w-full sm:w-80">
                    <SelectValue placeholder="选择发布批次" />
                  </SelectTrigger>
                  <SelectContent>
                    {batchList.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                  <BatchStatusBadge status={batch.status} />
                  <Badge tone="neutral">
                    {batch.members.filter((member) => member.status === 'frozen').length}/
                    {batch.members.length} 节点
                  </Badge>
                  <Badge tone="slate">r{batch.revision}</Badge>
                </div>
              </>
            )
          )}
        </CardContent>
      </Card>

      {scope === 'contract' ? (
        contract ? (
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
                  {contractReport}
                </pre>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>版本批次追溯</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">每个正式版本都可回溯到发布批次节点</p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {contract.versions.map((version) => {
                    const versionBatch = version.batchId
                      ? batchList.find((item) => item.id === version.batchId)
                      : undefined;
                    return (
                      <div
                        key={version.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-slate-200 p-2 text-xs"
                      >
                        <div>
                          <strong>v{version.version}</strong>
                          <div className="mt-0.5 text-slate-500">
                            {formatDateTime(version.releasedAt)}
                          </div>
                        </div>
                        {versionBatch ? (
                          <Badge tone={versionBatch.legacy ? 'amber' : 'blue'}>
                            {versionBatch.name}
                          </Badge>
                        ) : (
                          <Badge tone="amber">待迁移</Badge>
                        )}
                      </div>
                    );
                  })}
                  {!contract.versions.length && (
                    <p className="py-6 text-center text-xs text-slate-500">尚无正式版本。</p>
                  )}
                </CardContent>
              </Card>

              <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-4 text-xs leading-5 text-slate-600">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                报告在客户端生成，不依赖后端。批次报告包含调用顺序、各节点阻断与冻结校验值，可直接用于联合发版归档。
              </div>
            </div>
          </div>
        ) : (
          <Card>
            <CardContent className="py-16 text-center text-sm text-slate-500">
              暂无可生成报告的契约。
            </CardContent>
          </Card>
        )
      ) : batch ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>批次报告预览</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  按调用依赖顺序列出节点、阻断与冻结结果
                </p>
              </div>
              <Layers className="h-5 w-5 text-slate-400" />
            </CardHeader>
            <CardContent>
              <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100">
                {batchReport}
              </pre>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>调用顺序节点</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {orderMembersByDependency(batch.members).map((member, index) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-slate-200 p-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="grid h-5 w-5 place-items-center rounded-sm bg-slate-100 text-[10px] font-semibold text-sky-900">
                        {index + 1}
                      </span>
                      <div>
                        <strong>{member.contractName}</strong>
                        <div className="mt-0.5 text-slate-500">v{member.targetVersion}</div>
                      </div>
                    </div>
                    <Badge
                      tone={
                        member.status === 'frozen'
                          ? 'green'
                          : member.status === 'failed'
                            ? 'red'
                            : 'amber'
                      }
                    >
                      {member.status}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
            <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-4 text-xs leading-5 text-slate-600">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              修订版本 r{batch.revision}。两个窗口并发提交时，后提交方会被要求基于最新版本重试，报告中的顺序与成员始终与已提交版本一致。
            </div>
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="py-16 text-center text-sm text-slate-500">
            暂无可生成报告的发布批次。
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
