# API 契约兼容性审查与版本发布平台

用于后端维护者、接口评审人和调用方负责人协作处理 API 契约变化的独立前端工程。工程没有真实后端，首次运行加载本地模拟契约，后续状态写入浏览器 `localStorage`。

## 技术栈

- React 19 + TypeScript + Vite 8
- shadcn/ui 风格本地组件 + Radix UI primitives
- Zustand + persist
- TanStack Router
- TanStack Query
- Monaco Editor / Diff Editor
- Tailwind CSS 4

## 功能

- OpenAPI JSON 导入、契约列表搜索和领域/状态筛选
- 字段新增、删除、可选性、枚举与错误码变化展示
- 自动判定兼容、警告或不兼容，并要求调用方影响说明与迁移方案
- Monaco Editor 编辑契约定义，Monaco Diff Editor 比较正式版本快照
- 调用方列表、示例请求生成、逐条接受、退回和兼容层豁免
- 跨契约批量评审、发布门禁、正式版本冻结与版本历史
- 可恢复发布批次：成员按调用依赖拓扑排序冻结，评审不完整停在待处理节点，失败后可从断点重试，成功版本保留
- 批次 revision 乐观锁：两个窗口同时提交时，后提交者会看到版本变化并被拒绝，不会覆盖对方的成员与顺序
- 旧冻结记录启动时自动迁移为发布批次，无法补齐归属的标记为待迁移
- Markdown 变更报告与 JSON 导出（支持单契约报告与发布批次报告）

## 运行

```bash
npm install
npm run dev
```

默认开发地址为 `http://localhost:18470`。

生产构建：

```bash
npm run build
```

构建输出位于 `dist`。

## 目录

```text
src/
  components/             shadcn/Radix 基础组件、业务组件、应用外壳
  data/                   本地模拟契约
  lib/                    通用工具
  models/                 契约模型、兼容性与发布门禁规则
  pages/                  工作台、详情、批量评审、发布、报告
  services/               本地持久化服务和 TanStack Query hooks
  store/                  Zustand 评审工作区状态
```
