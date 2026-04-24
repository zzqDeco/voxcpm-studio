# `apps/demo-api/internal/demoapi/server.go` 技术说明

## 1. 文件定位

- 项目：`voxcpm-studio`
- 源文件：`apps/demo-api/internal/demoapi/server.go`
- 文档文件：`doc/src/apps/demo-api/internal/demoapi/server.go.plan.md`
- 文件类型：Go 源码

## 2. 核心职责

- 创建 Go demo API 的 HTTP 路由
- 维护 runtime busy state 与活动模型摘要
- 暴露模型、推理、ASR、History、Bench、Training 和 checkpoint API
- 挂载 `demo-data/` 到 `/artifacts`

## 3. 输入与输出

- 输入来源：
  - 前端 HTTP / WebSocket 请求
  - 本地 `models/`、`lora/` 和 `demo-data/training/`
  - Python worker 返回的推理结果
- 输出结果：
  - 与旧 FastAPI 兼容的 JSON 响应
  - WebSocket `chunk` / `completed` / `error` 事件
  - SQLite 中的 run、training job、bench job 记录

## 4. 关键实现细节

- `Router()` 注册公共 `/api/*` 路由，路径和字段名保持前端兼容
- `handleInferRun()`、`handleInferStream()` 和 `handleInferStreamWS()` 通过 Python worker 执行模型推理
- `/api/runs` 与 `/api/runs/{id}` 直接读取 Go SQLite storage
- `/api/bench/*` 与 `/api/train/*` 已由 Go 接管，具体编排逻辑在 `jobs.go`
- `NewDemoAPI()` 启动时调用 storage 恢复逻辑，把重启前遗留的 running 作业修正为终态

## 5. 依赖关系

- 内部依赖：
  - `config.go`
  - `storage.go`
  - `worker.go`
  - `jobs.go`
- 外部依赖：
  - `chi`
  - `gorilla/websocket`

## 6. 变更影响面

- 路由签名变化会直接影响 `apps/demo-web`
- busy state 语义会影响推理、训练和 Bench 的互斥行为
- artifacts mount 变化会影响历史结果中的音频、mel 和日志链接

## 7. 维护建议

- 继续保持 `/api/*` 路径和 JSON 字段与 `apps/demo-web/src/types.ts` 对齐
- 新增任务类型时先明确 busy state、SQLite 状态和前端轮询合同
- Go cutover 前不要再扩展旧 FastAPI 路由能力，只把它作为行为参照
