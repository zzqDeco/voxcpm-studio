# `apps/demo-web/src/App.tsx` 技术说明

## 1. 文件定位

- 项目：`voxcpm-studio`
- 源文件：`apps/demo-web/src/App.tsx`
- 文档文件：`doc/src/apps/demo-web/src/App.tsx.plan.md`
- 文件类型：React + TypeScript 源码

## 2. 核心职责

- 实现 studio 的主界面与工作区切换
- 管理运行时、模型、训练、Bench、History 等前端状态
- 通过 HTTP / WebSocket 与后端通信

## 3. 输入与输出

- 输入来源：
  - 用户表单输入
  - 后端 `/api/*` 响应
  - 推理 WebSocket 事件
- 输出结果：
  - 可交互的工作台 UI
  - 运行状态、音频、Mel、日志、比较视图

## 4. 关键实现细节

- 当前为单文件主壳组件，负责五个 tab：
  - Playground
  - Compare
  - Bench
  - Training
  - History
- `fetchJson()` 统一封装后端请求
- `openStreamingSession()` 封装流式推理通道
- 运行时能力由 `/api/runtime` 驱动，前端按能力启停选项

## 5. 依赖关系

- 内部依赖：
  - `src/types.ts`
  - `src/styles.css`
- 外部依赖：
  - React
  - 浏览器 Fetch / WebSocket API

## 6. 变更影响面

- 修改该文件会直接改变工作台交互、布局和后端契约使用方式
- Training / Bench / History 的状态联动都集中在这里

## 7. 维护建议

- 优先保持 API 字段消费的一致性
- 如继续扩展页面，建议先按工作区拆分组件，再同步更新此文档
- 所有用户可见流程变化都要同步更新 `README.md` 与 `README_CN.md`
