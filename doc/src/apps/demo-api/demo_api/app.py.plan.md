# `apps/demo-api/demo_api/app.py` 技术说明

## 1. 文件定位

- 项目：`voxcpm-studio`
- 源文件：`apps/demo-api/demo_api/app.py`
- 文档文件：`doc/src/apps/demo-api/demo_api/app.py.plan.md`
- 文件类型：Python 源码

## 2. 核心职责

- 保留旧 FastAPI 应用工厂作为迁移参照
- 描述旧 HTTP 与 WebSocket 路由形状
- 挂载静态 artifacts 目录
- 统一处理 runtime busy 异常

## 3. 输入与输出

- 输入来源：
  - 前端表单请求
  - 流式 WebSocket 请求
- 输出结果：
  - JSON API 响应
  - 流式 chunk / completed / error 事件

## 4. 关键实现细节

- `create_app()` 不再由默认启动脚本或 Docker 镜像暴露
- Go API 是当前默认 `/api/*` 入口
- 旧 `/api/ws/infer-stream` 行为仍作为流式推理事件格式参照
- `StaticFiles` 将 `demo-data/` 暴露为 `/artifacts`

## 5. 依赖关系

- 内部依赖：
  - `demo_api.config`
  - `demo_api.runtime`
  - `demo_api.schemas`
- 外部依赖：
  - FastAPI
  - Starlette

## 6. 变更影响面

- 该文件变化不应再引入新的公共后端能力
- 如需调整公共路由，优先修改 Go API 并保持前端合同兼容

## 7. 维护建议

- 保持为迁移参照，不再作为默认运行入口扩展
- 参数默认值调整时优先同步 Go API、Python worker 和前端表单默认值
