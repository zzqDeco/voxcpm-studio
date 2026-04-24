# `scripts/run_demo_api_native.sh` 技术说明

## 1. 文件定位

- 项目：`voxcpm-studio`
- 源文件：`scripts/run_demo_api_native.sh`
- 文档文件：`doc/src/scripts/run_demo_api_native.sh.plan.md`
- 文件类型：Shell 脚本

## 2. 核心职责

- 作为本地默认后端启动入口
- 读取 `.env.demo`
- 映射 VoxCPM demo 所需目录、设备、精度和端口环境变量
- 启动 `apps/demo-api/cmd/demo-api` Go API

## 3. 输入与输出

- 输入来源：
  - `.env.demo`
  - 当前 shell 环境变量
  - 仓库根目录下的 `models/`、`lora/`、`demo-data/`
- 输出结果：
  - 监听 `DEMO_API_HOST:DEMO_API_PORT` 的 Go HTTP / WebSocket 服务

## 4. 关键实现细节

- 默认端口为 `8000`
- 默认设备为 `auto`
- 默认训练精度为 `auto`
- 进入 `apps/demo-api` 后执行 `go run ./cmd/demo-api`
- Python 模型执行由 Go API 通过 `apps/demo-worker/bridge.py` 调用

## 5. 维护建议

- 默认启动入口保持指向 Go API
- 如需保留旧命令名，应使用 wrapper，不再恢复 FastAPI 默认启动
- 修改环境变量默认值时同步 README、AGENTS 和 Docker Compose
