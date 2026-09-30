import { ArrowDownWideNarrow, Info, ListOrdered, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ApiContract } from '../../models/contract';
import { orderMembersByDependency } from '../../models/contract';
import { useCreateBatch } from '../../services/contract-queries';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contracts: ApiContract[];
  /** 已在未完成批次中的契约 id，不可重复选择 */
  occupiedContractIds: Set<string>;
  onCreated?: (batchId: string) => void;
}

interface Candidate {
  key: string;
  ordinal: number;
  dependsOnMemberIds: string[];
  contractId: string;
  name: string;
  version: string;
  dependsOnNames: string[];
}

export function CreateBatchDialog({
  open,
  onOpenChange,
  contracts,
  occupiedContractIds,
  onCreated,
}: Props) {
  const createBatch = useCreateBatch();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');

  function reset() {
    setName('');
    setNotes('');
    setSelected([]);
    setError('');
  }

  function close(nextOpen: boolean) {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  function toggle(contractId: string) {
    setError('');
    setSelected((current) =>
      current.includes(contractId)
        ? current.filter((id) => id !== contractId)
        : [...current, contractId],
    );
  }

  const preview = useMemo((): { ordered: Candidate[]; cycleError: string } => {
    const nameById = new Map(contracts.map((contract) => [contract.id, contract.name]));
    const candidates: Candidate[] = contracts
      .filter((contract) => selected.includes(contract.id))
      .map((contract, index) => ({
        key: contract.id,
        ordinal: index,
        dependsOnMemberIds: [],
        contractId: contract.id,
        name: contract.name,
        version: contract.version,
        dependsOnNames: contract.dependsOn
          .filter((id) => selected.includes(id))
          .map((id) => nameById.get(id) ?? id),
      }));
    // 用选择顺序作为 id，复用拓扑排序预览调用顺序
    const withEdges = candidates.map((candidate) => ({
      ...candidate,
      id: candidate.contractId,
      dependsOnMemberIds: contracts
        .find((contract) => contract.id === candidate.contractId)!
        .dependsOn.filter((id) => selected.includes(id)),
    }));
    try {
      const ordered = orderMembersByDependency(withEdges);
      return { ordered: ordered.map(({ id, ...rest }) => ({ ...rest, key: id })), cycleError: '' };
    } catch (caught) {
      return { ordered: [], cycleError: caught instanceof Error ? caught.message : '依赖存在环。' };
    }
  }, [contracts, selected]);

  async function submit() {
    setError('');
    if (!selected.length) {
      setError('至少选择一个契约成员。');
      return;
    }
    if (preview.cycleError) {
      setError(preview.cycleError);
      return;
    }
    try {
      const batch = await createBatch.mutateAsync({
        name: name.trim(),
        notes: notes.trim(),
        members: preview.ordered.map((candidate) => ({ contractId: candidate.contractId })),
      });
      reset();
      onOpenChange(false);
      onCreated?.(batch.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建批次失败。');
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>创建可恢复发布批次</DialogTitle>
          <DialogDescription>
            勾选本次一起发版的契约，成员会按调用依赖自动排序，被依赖方先冻结；评审不完整的节点会让批次停在待处理。
          </DialogDescription>
        </DialogHeader>

        <label className="text-xs font-medium text-slate-700">批次名称</label>
        <Input
          className="mt-1.5"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如 2026-09 履约链路联合发版"
        />
        <label className="mt-3 block text-xs font-medium text-slate-700">批次说明</label>
        <Textarea
          className="mt-1.5"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="发布窗口、回滚策略和值班安排"
        />

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-600">
              <ListOrdered className="h-3.5 w-3.5" />
              选择成员（{selected.length}）
            </div>
            <div className="max-h-72 space-y-2 overflow-auto rounded-md border border-slate-200 p-2">
              {contracts.map((contract) => {
                const occupied = occupiedContractIds.has(contract.id);
                const checked = selected.includes(contract.id);
                return (
                  <label
                    key={contract.id}
                    className={`flex items-start gap-2 rounded-md p-2 text-sm ${
                      occupied ? 'cursor-not-allowed opacity-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={occupied}
                      onCheckedChange={() => toggle(contract.id)}
                    />
                    <span>
                      <span className="block font-medium text-slate-800">{contract.name}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        v{contract.version}
                        {contract.dependsOn.length
                          ? ` · 依赖 ${contract.dependsOn
                              .map((id) => contracts.find((item) => item.id === id)?.name ?? id)
                              .join('、')}`
                          : ' · 无前置依赖'}
                      </span>
                      {occupied && (
                        <span className="mt-0.5 block text-[11px] text-amber-700">
                          已在未完成批次中
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-600">
              <ArrowDownWideNarrow className="h-3.5 w-3.5" />
              冻结调用顺序预览
            </div>
            <div className="max-h-72 space-y-1.5 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2">
              {preview.cycleError ? (
                <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {preview.cycleError}
                </div>
              ) : preview.ordered.length ? (
                preview.ordered.map((candidate, index) => (
                  <div
                    key={candidate.key}
                    className="rounded-md border border-slate-200 bg-white p-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="grid h-5 w-5 place-items-center rounded-sm bg-sky-100 text-[11px] font-semibold text-sky-900">
                        {index + 1}
                      </span>
                      <span className="font-medium text-slate-800">{candidate.name}</span>
                      <Badge tone="neutral">v{candidate.version}</Badge>
                    </div>
                    {candidate.dependsOnNames.length > 0 && (
                      <p className="mt-1 pl-7 text-[11px] text-slate-500">
                        等待：{candidate.dependsOnNames.join('、')} 先冻结
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <div className="flex items-start gap-2 p-2 text-xs text-slate-500">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  选择成员后这里展示按依赖排序的冻结顺序。
                </div>
              )}
            </div>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => close(false)}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={createBatch.isPending || !selected.length}>
            {createBatch.isPending ? '创建中' : '创建批次'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
