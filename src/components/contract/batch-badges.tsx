import type { BatchMemberStatus, BatchStatus } from '../../models/contract';
import { BATCH_MEMBER_STATUS_LABELS, BATCH_STATUS_LABELS } from '../../models/contract';
import { Badge } from '../ui/badge';

const batchTones = {
  pending: 'neutral',
  running: 'blue',
  paused: 'amber',
  failed: 'red',
  completed: 'green',
  migrating: 'amber',
} as const;

const memberTones = {
  pending: 'neutral',
  blocked: 'amber',
  failed: 'red',
  frozen: 'green',
} as const;

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return <Badge tone={batchTones[status]}>{BATCH_STATUS_LABELS[status]}</Badge>;
}

export function BatchMemberStatusBadge({ status }: { status: BatchMemberStatus }) {
  return <Badge tone={memberTones[status]}>{BATCH_MEMBER_STATUS_LABELS[status]}</Badge>;
}
