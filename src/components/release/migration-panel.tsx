import { ArchiveRestore, CircleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
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
import { formatDateTime } from '../../lib/utils';
import type { ApiContract } from '../../models/contract';
import type { ReleaseBatch } from '../../models/release-batch';

interface MigrationPanelProps {
  pendingBatches: ReleaseBatch[];
  contracts: ApiContract[];
  resolving: boolean;
  onResolve: (
    batch: ReleaseBatch,
    resolution: { action: 'attach'; targetContractId: string } | { action: 'ignore' },
  ) => Promise<void>;
}

export function MigrationPanel({
  pendingBatches,
  contracts,
  resolving,
  onResolve,
}: MigrationPanelProps) {
  const [targets, setTargets] = useState<Record<string, string>>({});

  const summary = useMemo(() => {
    const versions = contracts.flatMap((contract) =>
      contract.versions.map((version) => ({ contract, version })),
    );
    const linked = versions.filter((item) => item.version.batchId).length;
    return { total: versions.length, linked };
  }, [contracts]);

  return (
    <Card className="border-amber-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArchiveRestore className="h-4 w-4 text-amber-700" />
          历史冻结记录迁移
          {pendingBatches.length > 0 && <Badge tone="amber">{pendingBatches.length} 待迁移</Badge>}
        </CardTitle>
        <p className="mt-1 text-xs text-slate-500">
          批次化改造前的冻结记录已自动补建发布批次并关联到版本历史（{summary.linked}/{summary.total}{' '}
          条已关联）。找不到归属契约的记录需要在这里补齐，否则无法按批次追溯。
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {pendingBatches.length === 0 ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            所有历史冻结记录均已补齐批次关联。
          </div>
        ) : (
          pendingBatches.map((batch) => {
            const member = batch.members[0];
            return (
              <div
                key={batch.id}
                className="rounded-md border border-amber-200 bg-amber-50 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <CircleAlert className="h-4 w-4 shrink-0 text-amber-700" />
                  <strong className="text-sm">{batch.name}</strong>
                  <Badge tone="slate">v{member?.targetVersion}</Badge>
                  <span className="text-[11px] text-amber-800">
                    冻结于 {member?.frozenAt ? formatDateTime(member.frozenAt) : '未知时间'}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-amber-900">
                  {batch.legacy?.reason ?? member?.reason}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Select
                    value={targets[batch.id] ?? ''}
                    onValueChange={(value) =>
                      setTargets((current) => ({ ...current, [batch.id]: value }))
                    }
                  >
                    <SelectTrigger className="h-8 w-72 text-xs">
                      <SelectValue placeholder="选择归属契约以补齐关联" />
                    </SelectTrigger>
                    <SelectContent>
                      {contracts.map((contract) => (
                        <SelectItem key={contract.id} value={contract.id}>
                          {contract.name} · v{contract.version}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    disabled={resolving || !targets[batch.id]}
                    onClick={() =>
                      void onResolve(batch, {
                        action: 'attach',
                        targetContractId: targets[batch.id],
                      })
                    }
                  >
                    关联到该契约
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={resolving}
                    onClick={() => void onResolve(batch, { action: 'ignore' })}
                  >
                    无法补齐，归档保留
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
