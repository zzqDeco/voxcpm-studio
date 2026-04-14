# `apps/demo-api/demo_api/app.py` 技术说明

## 1. 文件定位

- 项目：`voxcpm-studio`
- 源文件：`apps/demo-api/demo_api/app.py`
- 文档文件：`doc/src/apps/demo-api/demo_api/app.py.plan.md`
- 文件类型：Python 源码

## 2. 核心职责

- 创建 FastAPI 应用
- 注册所有 HTTP 与 WebSocket 路由
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

- `create_app()` 是唯一应用入口
- `/api/*` 提供运行时、模型、推理、训练、历史和 checkpoint 接口
- `/api/ws/infer-stream` 提供流式推理事件通道
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

- 路由签名变化会直接影响前端请求与启动校验
- WebSocket 行为变化会直接影响流式推理展示

## 7. 维护建议

- 保持路由形状稳定，避免前端协议频繁漂移
- 参数默认值调整时优先同步前端表单默认值
- 任何新增公共接口都要同步更新 README 中的能力说明
