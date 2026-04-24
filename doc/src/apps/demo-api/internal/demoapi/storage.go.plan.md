# `apps/demo-api/internal/demoapi/storage.go` 技术说明

## 1. 文件定位

- 项目：`voxcpm-studio`
- 源文件：`apps/demo-api/internal/demoapi/storage.go`
- 文档文件：`doc/src/apps/demo-api/internal/demoapi/storage.go.plan.md`
- 文件类型：Go 源码

## 2. 核心职责

- 管理本地 SQLite schema
- 持久化 run、training job 和 bench job
- 提供 History、Training 和 Bench 查询能力
- 在 API 启动时恢复重启前未收敛的作业状态

## 3. 输入与输出

- 输入来源：
  - Go API 产生的 run record
  - Go Training / Bench 编排状态
- 输出结果：
  - `demo-data/demo.sqlite3`
  - 前端可直接消费的 JSON payload

## 4. 关键实现细节

- `payload_json` 保存完整前端合同，结构变化优先通过 payload 兼容
- `runs` 表额外保存常用指标列，方便后续排序和过滤扩展
- `RecoverInterruptedJobs()` 会把 `starting`、`running`、`stopping` 的 training / bench job 标记为 `failed`
- storage 使用进程内 mutex 串行化 SQLite 访问，避免后台 Bench 写入和前端轮询并发触发 `SQLITE_BUSY`

## 5. 依赖关系

- 外部依赖：
  - `modernc.org/sqlite`
  - Go `database/sql`

## 6. 变更影响面

- schema 变化会影响本地 `demo-data/demo.sqlite3`
- payload 字段变化会影响 `apps/demo-web/src/types.ts`
- 恢复策略变化会影响 API 重启后的 busy state 与 job 终态展示

## 7. 维护建议

- 优先通过 `ON CONFLICT` 更新现有记录，保持 job id 稳定
- 增加状态值时同步更新前端状态颜色和 Go 契约测试
- 需要并发写入增强时再引入 WAL / busy timeout；当前单机工作台先保持串行访问
