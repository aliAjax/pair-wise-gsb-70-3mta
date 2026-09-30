import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { router } from './router';
import { subscribeStorage } from './services/storage';
import { ensureLegacyMigration } from './services/release-batch-service';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// 启动时把批次化改造前的冻结记录迁移为发布批次（幂等）
void ensureLegacyMigration().then(() => {
  queryClient.invalidateQueries({ queryKey: ['release-batches'] });
  queryClient.invalidateQueries({ queryKey: ['contracts'] });
});

// 任意窗口（含另一个浏览器窗口）写入本地仓库后，当前窗口立即拿到最新版本
subscribeStorage((key) => {
  if (key === 'contracts') {
    queryClient.invalidateQueries({ queryKey: ['contracts'] });
  }
  if (key === 'batches') {
    queryClient.invalidateQueries({ queryKey: ['release-batches'] });
  }
  if (key === 'meta') {
    queryClient.invalidateQueries({ queryKey: ['legacy-migration'] });
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
