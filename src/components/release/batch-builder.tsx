import { ArrowDownWideNarrow, CircleAlert, GitBranch, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import type { ApiContract } from '../../models/contract';
import {
  planBatchMembers,
} from '../../models/release-batch';

export interface BatchSelection {
  contractId: string;
  targetVersion: string;
}

interface BatchBuilderProps {
  contracts: ApiContract[];
  submitting: boolean;
  onCreate: (input: {
    name: string;
    notes: string;
    selections: BatchSelection[];
    submit: boolean;
    simulateFailureAt: number;
  }) => Promise<void>;
}

function suggestVersion(current: string): string {
  const parts = current.split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return current;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

export function BatchBuilder({ contracts, submitting, onCreate }: BatchBuilderProps) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [simulateFailure, setSimulateFailure] = useState(false);

  const selections = useMemo<BatchSelection[]>(
    () =>
      selectedIds
        .map((contractId) => ({
          contractId,
          targetVersion: versions[contractId]?.trim() ?? '',
        }))
        .filter((item) => item.targetVersion),
    [selectedIds, versions],
  );

  const planned = useMemo(
    () =>
      selectedIds.length
        ? planBatchMembers(
            selectedIds.map((contractId) => ({
              contractId,
              targetVersion: versions[contractId]?.trim() ?? '',
            })),
            contracts,
          )
        : { members: [], externalDependencies: [], dependencyCycles: [] },
    [selectedIds, versions, contracts],
  );

  function toggle(contractId: string) {
    setSelectedIds((current) => {
      if (current.includes(contractId)) {
        return current.filter((id) => id !== contractId);
      }
      const contract = contracts.find((item) => item.id === contractId);
      setVersions((versionsNow) => ({
        ...versionsNow,
        [contractId]: versionsNow[contractId] ?? suggestVersion(contract?.version ?? '1.0.0'),
      }));
      return [...current, contractId];
    });
  }

  const readyToCreate = selections.length > 0 && selections.length === selectedIds.length;
  const failureIndex = simulateFailure && planned.members.length ? 0 : -1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-sky-800" />
          组织可恢复发布批次
        </CardTitle>
        <p className="mt-1 text-xs text-slate-500">
          勾选多个契约后，成员会按调用依赖自动排序，评审不完整的成员会让批次停在待处理。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-xs font-medium text-slate-700">批次名称</label>
          <Input
            className="mt-1.5"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如 交易履约 9 月联合发布"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700">批次发布说明</label>
          <Textarea
            className="mt-1.5"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="联合发布的范围、兼容层窗口与调用方升级安排"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-700">选择批次成员</span>
            <span className="text-[11px] text-slate-500">
              {selectedIds.length} 个成员
            </span>
          </div>
          <div className="space-y-2">
            {contracts.map((contract) => {
              const checked = selectedIds.includes(contract.id);
              return (
                <label
                  key={contract.id}
                  className={
                    checked
                      ? 'flex cursor-pointer items-center gap-3 rounded-md border border-sky-300 bg-sky-50 px-3 py-2'
                      : 'flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50'
                  }
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-sky-700"
                    checked={checked}
                    onChange={() => toggle(contract.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{contract.name}</span>
                      <Badge tone="neutral">v{contract.version}</Badge>
                      <span className="truncate text-[11px] text-slate-500">
                        {contract.domain}
                      </span>
                    </div>
                    {contract.dependencies.length > 0 && (
                      <div className="mt-0.5 truncate text-[11px] text-slate-500">
                        依赖：
                        {contract.dependencies
                          .map(
                            (id) =>
                              contracts.find((item) => item.id === id)?.name ??
                              `${id}（批次外/缺失）`,
                          )
                          .join('、')}
                      </div>
                    )}
                  </div>
                  {checked && (
                    <Input
                      className="h-8 w-28 text-xs"
                      value={versions[contract.id] ?? ''}
                      onChange={(event) =>
                        setVersions((current) => ({
                          ...current,
                          [contract.id]: event.target.value,
                        }))
                      }
                      placeholder="目标版本"
                      onClick={(event) => event.stopPropagation()}
                    />
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {planned.members.length > 0 && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <ArrowDownWideNarrow className="h-3.5 w-3.5 text-sky-800" />
              依赖排序后的冻结顺序
            </div>
            <ol className="mt-2 space-y-1.5">
              {planned.members.map((member, index) => (
                <li key={member.contractId} className="flex items-center gap-2 text-xs">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-sm bg-sky-100 text-[10px] font-semibold text-sky-900">
                    {index + 1}
                  </span>
                  <span className="font-medium">{member.contractName}</span>
                  <span className="text-slate-500">v{member.targetVersion}</span>
                  {index === failureIndex && <Badge tone="red">模拟失败</Badge>}
                </li>
              ))}
            </ol>
            {planned.externalDependencies.length > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-amber-700">
                <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                存在批次外依赖：
                {planned.externalDependencies
                  .map(
                    (id) =>
                      contracts.find((item) => item.id === id)?.name ?? `${id}（缺失）`,
                  )
                  .join('、')}
                ，这些契约不会随批次冻结，仅提示发布窗口协调。
              </p>
            )}
            {planned.dependencyCycles.length > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-red-700">
                <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                检测到调用依赖成环，环内成员无法判定先后，已并列排在最后，请人工确认。
              </p>
            )}
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-sky-700"
            checked={simulateFailure}
            onChange={(event) => setSimulateFailure(event.target.checked)}
          />
          在首个成员模拟一次冻结失败（用于演示断点重试，成功版本会保留）
        </label>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            disabled={!readyToCreate || submitting}
            onClick={() =>
              void onCreate({
                name,
                notes,
                selections,
                submit: false,
                simulateFailureAt: failureIndex,
              })
            }
          >
            存为草稿
          </Button>
          <Button
            disabled={!readyToCreate || submitting}
            onClick={() =>
              void onCreate({
                name,
                notes,
                selections,
                submit: true,
                simulateFailureAt: failureIndex,
              })
            }
          >
            <Play className="h-4 w-4" />
            创建并按顺序发布
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
