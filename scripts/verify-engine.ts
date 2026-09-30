// 引擎逻辑验证：依赖排序 / 暂停 / 失败重试 / 乐观锁冲突 / 旧数据迁移
import { topoOrderIds, planBatchMembers } from '../src/models/release-batch';
import {
  ensureLegacyMigration,
  createBatch,
  runReleaseBatch,
  resumeReleaseBatch,
  armSimulatedFailure,
  BatchConflictError,
  resolvePendingMigration,
} from '../src/services/release-batch-service';
import { loadContracts, loadBatches, loadMeta } from '../src/services/storage';
import { CURRENT_STORAGE_VERSION } from '../src/services/storage';

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
  passed += 1;
  console.log(`  ✓ ${msg}`);
}

const store: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => {
    store[k] = v;
  },
  removeItem: (k: string) => {
    delete store[k];
  },
};
(globalThis as any).window = {
  addEventListener: () => {},
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
};

async function main() {
  // 1. 拓扑排序：order 依赖 payment，payment 依赖 user => user, payment, order
  console.log('拓扑排序');
  const topo = topoOrderIds(
    ['order', 'payment', 'user'],
    (id) =>
      ({ order: ['payment'], payment: ['user'], user: [] })[id] ?? [],
  );
  assert(JSON.stringify(topo.order) === JSON.stringify(['user', 'payment', 'order']), '被依赖者排在前面');
  assert(topo.missing.length === 0 && topo.cycles.length === 0, '无缺失/无环');

  const withMissing = topoOrderIds(['a'], () => ['x', 'y']);
  assert(JSON.stringify(withMissing.missing) === JSON.stringify(['x', 'y']), '识别批次外依赖');

  const cycle = topoOrderIds(['a', 'b'], (id) => ({ a: ['b'], b: ['a'] })[id]!);
  assert(cycle.cycles.length === 1 && cycle.cycles[0].length === 2, '识别调用依赖成环');

  // 2. 首次加载种子 + 启动迁移
  console.log('\n首次加载与旧数据迁移');
  const migrated = await ensureLegacyMigration();
  const meta = loadMeta();
  assert(meta.storageVersion === CURRENT_STORAGE_VERSION, `storage 版本升到 ${CURRENT_STORAGE_VERSION}`);
  assert(migrated.migrated === 2, `两条正常历史冻结记录迁移完成（实际 ${migrated.migrated}）`);
  assert(migrated.pending === 1, `一条缺失归属契约的记录待迁移（实际 ${migrated.pending}）`);

  const contracts0 = loadContracts();
  const order0 = contracts0.find((c) => c.id === 'contract-order')!;
  assert(
    order0.versions.every((v) => v.batchId) || order0.versions.length === 0,
    '订单契约历史版本已盖批次关联',
  );
  const batches0 = loadBatches();
  const pendingLegacy = batches0.find((b) => b.legacy?.state === 'pending')!;
  assert(!!pendingLegacy, '存在待迁移批次');
  assert(pendingLegacy.status === 'paused', '待迁移批次处于待处理');

  // 迁移幂等：再次执行不产生新批次
  const again = await ensureLegacyMigration();
  assert(again.migrated === 2 && again.pending === 1 && loadBatches().length === batches0.length, '迁移幂等');

  // 补齐待迁移记录：关联到 user 契约
  console.log('\n补齐待迁移记录');
  await resolvePendingMigration(pendingLegacy.id, pendingLegacy.revision, {
    action: 'attach',
    targetContractId: 'contract-user',
  });
  const userAfter = loadContracts().find((c) => c.id === 'contract-user')!;
  assert(
    userAfter.versions.some((v) => v.id === 'ver-loyalty-090' && v.batchId === pendingLegacy.id),
    '历史版本挂到归属契约并盖上批次 id',
  );
  const legacyBatch = loadBatches().find((b) => b.id === pendingLegacy.id)!;
  assert(legacyBatch.status === 'completed' && legacyBatch.legacy?.state === 'migrated', '迁移批次转为已完成');

  // 3. 创建批次（order+payment+user）：planBatchMembers 顺序
  console.log('\n创建批次与依赖排序');
  const contracts1 = loadContracts();
  const planned = planBatchMembers(
    [
      { contractId: 'contract-order', targetVersion: '2.9.0' },
      { contractId: 'contract-user', targetVersion: '1.15.0' },
      { contractId: 'contract-payment', targetVersion: '4.3.0' },
    ],
    contracts1,
  );
  assert(
    JSON.stringify(planned.members.map((m) => m.contractId)) ===
      JSON.stringify(['contract-user', 'contract-payment', 'contract-order']),
    '批次成员按 user -> payment -> order 排序',
  );

  // 4. 立即执行：order 有 pending 评审，payment 有 returned；user 评审完整应先冻结
  //    期望：user 冻结成功 -> payment blocked（returned）暂停，order 不执行
  console.log('\n评审不完整暂停（成功版本保留）');
  const batch = await createBatch({
    name: '9月联合发布',
    notes: '批次说明',
    selections: [
      { contractId: 'contract-order', targetVersion: '2.9.0' },
      { contractId: 'contract-user', targetVersion: '1.15.0' },
      { contractId: 'contract-payment', targetVersion: '4.3.0' },
    ],
  });
  const paused = await runReleaseBatch(batch.id, batch.revision);
  assert(paused.status === 'paused', `评审不完整后批次待处理（实际 ${paused.status}）`);
  const userFrozen = paused.members[0];
  const paymentBlocked = paused.members[1];
  const orderNotRun = paused.members[2];
  assert(userFrozen.status === 'frozen' && !!userFrozen.versionId, '第 1 个成员 user 已冻结');
  assert(paymentBlocked.status === 'blocked', '第 2 个成员 payment 因退回评审 blocked');
  assert(orderNotRun.status === 'pending', '第 3 个成员 order 未执行（保留 pending）');
  assert(paused.cursor === 1, 'cursor 停在下标 1');

  const contractsAfterPause = loadContracts();
  assert(
    contractsAfterPause.find((c) => c.id === 'contract-user')!.versions[0].version === '1.15.0',
    'user 成功版本已落盘保留',
  );
  assert(
    contractsAfterPause.find((c) => c.id === 'contract-payment')!.version === '4.2.0',
    'payment 未被抬版本',
  );
  assert(paused.revision > batch.revision, '执行过程推进了 revision');

  // 5. 乐观锁冲突：拿旧 revision 提交被拒，且不覆盖
  console.log('\nrevision 乐观锁');
  let conflicted = false;
  try {
    await resumeReleaseBatch(batch.id, batch.revision);
  } catch (e) {
    conflicted = e instanceof BatchConflictError;
  }
  assert(conflicted, '旧 revision 提交被拒绝（BatchConflictError）');

  // 6. 模拟冻结失败后重试：在 payment 节点 arm 一次失败
  console.log('\n冻结失败重试');
  const beforeResume = loadBatches().find((b) => b.id === batch.id)!;
  // 让 payment 评审通过（去掉 returned/pending，补齐约束由 seed 已给 impact/migration）
  // 直接改存储模拟另一窗口补齐评审
  const contractsForFix = loadContracts().map((c) =>
    c.id === 'contract-payment'
      ? {
          ...c,
          changes: c.changes.map((ch) =>
            ch.reviewState === 'returned'
              ? { ...ch, reviewState: 'accepted' as const, reviewer: '韩度', reviewComment: '补充后接受', reviewedAt: new Date().toISOString() }
              : ch,
          ),
        }
      : c,
  );
  // order 的 chg-order-2 仍 pending，所以 payment 通过后应停在 order
  const { persistContracts } = await import('../src/services/storage');
  persistContracts(contractsForFix);

  armSimulatedFailure(batch.id, beforeResume.cursor);
  const afterFail = await resumeReleaseBatch(batch.id, beforeResume.revision);
  assert(afterFail.status === 'paused', '模拟失败后批次仍待处理');
  assert(afterFail.members[1].status === 'failed', 'payment 节点标记 failed');
  assert(afterFail.members[0].status === 'frozen', 'user 已冻结成员未被重跑');
  const paymentContracts = loadContracts().find((c) => c.id === 'contract-payment')!;
  assert(paymentContracts.version === '4.2.0', '失败成员未写入版本');

  // 再次重试：payment 成功冻结，随后停在 order(pending)
  const revAfterFail = loadBatches().find((b) => b.id === batch.id)!.revision;
  const afterRetry = await resumeReleaseBatch(batch.id, revAfterFail);
  assert(afterRetry.status === 'paused', 'payment 成功后停在 order');
  assert(afterRetry.members[1].status === 'frozen', 'payment 重试成功冻结');
  assert(afterRetry.members[2].status === 'blocked', 'order 评审不完整 blocked');
  const payVersion = loadContracts().find((c) => c.id === 'contract-payment')!.versions[0];
  assert(payVersion.version === '4.3.0' && payVersion.batchId === batch.id, 'payment 版本带批次关联');

  // 补齐 order 评审后重试，整批完成
  const fixedAll = loadContracts().map((c) =>
    c.id === 'contract-order'
      ? {
          ...c,
          changes: c.changes.map((ch) =>
            ch.id === 'chg-order-2'
              ? { ...ch, reviewState: 'exemption' as const }
              : ch,
          ),
        }
      : c,
  );
  persistContracts(fixedAll);
  const revNow = loadBatches().find((b) => b.id === batch.id)!.revision;
  const done = await resumeReleaseBatch(batch.id, revNow);
  assert(done.status === 'completed', '全部成员冻结完成');
  assert(done.members.every((m) => m.status === 'frozen'), '所有成员均 frozen');
  assert(done.cursor === 3, 'cursor 到末尾');
  const orderVersion = loadContracts().find((c) => c.id === 'contract-order')!.versions[0];
  assert(orderVersion.version === '2.9.0' && orderVersion.batchId === batch.id, 'order 版本带批次关联');

  console.log(`\n全部通过：${passed} 条断言`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
