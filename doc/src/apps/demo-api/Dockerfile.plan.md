# `apps/demo-api/Dockerfile` 技术说明

## 1. 文件定位

- 项目：`voxcpm-studio`
- 源文件：`apps/demo-api/Dockerfile`
- 文档文件：`doc/src/apps/demo-api/Dockerfile.plan.md`
- 文件类型：Dockerfile

## 2. 核心职责

- 构建默认 demo API 容器镜像
- 编译 Go API 二进制
- 提供 Python worker 与 VoxCPM 运行时依赖
- 作为 `docker-compose.demo.yml` 的默认后端镜像入口

## 3. 输入与输出

- 输入来源：
  - `apps/demo-api/cmd` 与 `apps/demo-api/internal`
  - `apps/demo-worker`
  - `src/voxcpm`
  - `scripts/`
  - `conf/`、`examples/`
- 输出结果：
  - 运行 `/app/bin/demo-api` 的 CUDA runtime 镜像

## 4. 关键实现细节

- 第一阶段使用 `golang:1.22` 编译 Go API
- 运行阶段基于 `pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime`
- 镜像内通过 `DEMO_WORKER_SCRIPT=/app/apps/demo-worker/bridge.py` 固定 Python worker 入口
- 容器入口不再运行 Uvicorn 或 FastAPI app

## 5. 维护建议

- Docker 默认入口必须跟本地默认入口保持一致，都走 Go API
- Python 依赖仍来自 `pip install -e .[demo]`，因为 worker 的运行时基线仍依赖 `demo_api.runtime`
- 需要缩小镜像体积时，优先拆分 Python worker 依赖，而不是回退到 FastAPI 入口
