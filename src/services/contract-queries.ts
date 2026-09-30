import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ReviewState } from '../models/contract';
import {
  addExemption,
  bulkReviewChanges,
  completeLegacyMigration,
  createReleaseBatch,
  freezeVersion,
  getContract,
  listBatches,
  listContracts,
  removeBatchMember,
  reviewChange,
  runReleaseBatch,
  saveContract,
  simulateExternalBatchCommit,
  updateBatchMember,
  updateContractOpenApi,
} from './contract-service';

export const contractKeys = {
  all: ['contracts'] as const,
  detail: (id: string) => ['contracts', id] as const,
};

export const batchKeys = {
  all: ['release-batches'] as const,
};

/**
 * 两个窗口同时操作时，后提交窗口通过 storage 事件感知另一窗口的落盘变化，
 * 主动失效缓存，避免在过期成员和顺序上继续提交。
 */
function useCrossTabInvalidation() {
  const queryClient = useQueryClient();
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === 'pair-wise-gsb-70-contracts' && event.newValue !== null) {
        void queryClient.invalidateQueries({ queryKey: contractKeys.all });
        void queryClient.invalidateQueries({ queryKey: batchKeys.all });
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [queryClient]);
}

export function useStoreSync() {
  useCrossTabInvalidation();
}

export function useContracts() {
  return useQuery({
    queryKey: contractKeys.all,
    queryFn: listContracts,
  });
}

export function useContract(id: string) {
  return useQuery({
    queryKey: contractKeys.detail(id),
    queryFn: () => getContract(id),
    enabled: Boolean(id),
  });
}

export function useBatches() {
  return useQuery({
    queryKey: batchKeys.all,
    queryFn: listBatches,
  });
}

export function useReviewChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      contractId: string;
      changeId: string;
      state: ReviewState;
      reviewer: string;
      comment: string;
    }) =>
      reviewChange(
        input.contractId,
        input.changeId,
        input.state,
        input.reviewer,
        input.comment,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contractKeys.all });
      void queryClient.invalidateQueries({ queryKey: batchKeys.all });
    },
  });
}

export function useBulkReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      selections: Array<{ contractId: string; changeId: string }>;
      state: ReviewState;
      reviewer: string;
      comment: string;
    }) =>
      bulkReviewChanges(
        input.selections,
        input.state,
        input.reviewer,
        input.comment,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contractKeys.all });
      void queryClient.invalidateQueries({ queryKey: batchKeys.all });
    },
  });
}

export function useUpdateOpenApi() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { contractId: string; openapi: string }) =>
      updateContractOpenApi(input.contractId, input.openapi),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useSaveContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveContract,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useAddExemption() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { contractId: string; changeId: string; reason: string }) =>
      addExemption(input.contractId, input.changeId, input.reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contractKeys.all });
      void queryClient.invalidateQueries({ queryKey: batchKeys.all });
    },
  });
}

export function useFreezeVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { contractId: string; version: string; notes: string }) =>
      freezeVersion(input.contractId, input.version, input.notes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contractKeys.all });
      void queryClient.invalidateQueries({ queryKey: batchKeys.all });
    },
  });
}

export function useCreateBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createReleaseBatch,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: batchKeys.all });
      void queryClient.invalidateQueries({ queryKey: contractKeys.all });
    },
  });
}

export function useRunBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { batchId: string; revision: number }) =>
      runReleaseBatch(input.batchId, input.revision),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: batchKeys.all });
      void queryClient.invalidateQueries({ queryKey: contractKeys.all });
    },
  });
}

export function useUpdateBatchMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateBatchMember,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: batchKeys.all });
      void queryClient.invalidateQueries({ queryKey: contractKeys.all });
    },
  });
}

export function useRemoveBatchMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeBatchMember,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: batchKeys.all });
      void queryClient.invalidateQueries({ queryKey: contractKeys.all });
    },
  });
}

export function useCompleteMigration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: completeLegacyMigration,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: batchKeys.all });
      void queryClient.invalidateQueries({ queryKey: contractKeys.all });
    },
  });
}

export function useSimulateExternalCommit() {
  // 刻意不立即失效缓存：模拟本窗口仍持有旧修订版本，
  // 下次提交时由服务端拒绝并提示，之后再加载另一边的最新成员和顺序。
  return useMutation({
    mutationFn: simulateExternalBatchCommit,
  });
}
