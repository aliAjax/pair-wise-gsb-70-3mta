import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BatchConflictError,
  createBatch,
  deleteDraftBatch,
  ensureLegacyMigration,
  listReleaseBatches,
  resolvePendingMigration,
  resumeReleaseBatch,
  runReleaseBatch,
  updateDraftBatch,
} from './release-batch-service';

export const batchKeys = {
  all: ['release-batches'] as const,
};

export function useReleaseBatches() {
  return useQuery({
    queryKey: batchKeys.all,
    queryFn: listReleaseBatches,
  });
}

export function useLegacyMigration() {
  return useQuery({
    queryKey: ['legacy-migration'],
    queryFn: ensureLegacyMigration,
    staleTime: Infinity,
  });
}

export function useCreateBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBatch,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: batchKeys.all }),
  });
}

export function useUpdateDraftBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      batchId: string;
      expectedRevision: number;
      patch: Parameters<typeof updateDraftBatch>[2];
    }) => updateDraftBatch(input.batchId, input.expectedRevision, input.patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: batchKeys.all }),
  });
}

export function useDeleteDraftBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { batchId: string; expectedRevision: number }) =>
      deleteDraftBatch(input.batchId, input.expectedRevision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: batchKeys.all }),
  });
}

export function useRunBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { batchId: string; expectedRevision: number }) =>
      runReleaseBatch(input.batchId, input.expectedRevision),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: batchKeys.all });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}

export function useResumeBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { batchId: string; expectedRevision: number }) =>
      resumeReleaseBatch(input.batchId, input.expectedRevision),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: batchKeys.all });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}

export function useResolveMigration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      batchId: string;
      expectedRevision: number;
      resolution: Parameters<typeof resolvePendingMigration>[2];
    }) => resolvePendingMigration(input.batchId, input.expectedRevision, input.resolution),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: batchKeys.all });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['legacy-migration'] });
    },
  });
}

export function isBatchConflict(error: unknown): error is BatchConflictError {
  return error instanceof BatchConflictError;
}
