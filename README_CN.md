# VoxCPM Studio

[English README](README.md)

## 项目说明

`VoxCPM Studio` 是一个从 `OpenBMB/VoxCPM` 独立出来的本地工作台仓库，用于：

- 本地推理与流式生成
- 音色设计与语音克隆效果验证
- Bench 批量场景测试
- LoRA / Full FT 训练入口
- 运行历史、指标与日志可视化

当前仓库保留上游 Apache-2.0 许可，并继续兼容现有 VoxCPM 运行时与 API 形状。

## 主要能力

- **Playground**：零样本音色设计、可控克隆、极致克隆、流式生成
- **Compare**：并排比较音频、Mel、ASR、CER/WER 与运行指标
- **Bench**：本地固定场景批量测试
- **Training**：训练任务启动、状态、日志与 checkpoint 回流
- **History**：本地运行记录与结果持久化

## 技术栈

- 后端：Go 1.22 API 控制面、Python worker、PyTorch、VoxCPM 运行时
- 前端：React 18、TypeScript、Vite 5
- 持久化：SQLite + 本地文件目录 `demo-data/`

## 目录结构

```text
voxcpm-studio/
├── apps/
│   ├── demo-api/
│   ├── demo-worker/
│   └── demo-web/
├── conf/
├── src/voxcpm/
├── scripts/
├── examples/
├── doc/
├── plan/
├── README.md
├── README_CN.md
├── AGENTS.md
└── CLAUDE.md
```

## 快速开始

### 1. 创建虚拟环境

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -e ".[demo]"
```

### 2. 安装前端依赖

```bash
cd apps/demo-web
npm install
cd ../..
```

### 3. 准备环境变量

```bash
cp .env.demo.example .env.demo
```

### 4. 下载模型

```bash
PATH="$PWD/.venv/bin:$PATH" ./scripts/download_model.sh
```

默认会把 `openbmb/VoxCPM2` 下载到 `models/VoxCPM2`。

## 启动方式

MPS 原生启动：

```bash
PATH="$PWD/.venv/bin:$PATH" ./scripts/run_demo_mps.sh
```

CUDA 原生启动：

```bash
PATH="$PWD/.venv/bin:$PATH" ./scripts/run_demo_cuda.sh
```

前后端分开启动：

```bash
PATH="$PWD/.venv/bin:$PATH" ./scripts/run_demo_api_native.sh
./scripts/run_demo_web_native.sh
```

`run_demo_api_go_native.sh` 保留为旧本地说明的兼容 wrapper。

CUDA Docker Compose：

```bash
docker compose -f docker-compose.demo.yml up --build
```

## 默认访问地址

- 前端：`http://localhost:5173`
- 后端：`http://localhost:8000`

## 分支流转

- `master`：主干分支
- `dev`：开发缓冲分支
- 主题分支从 `dev` 切出并优先合入 `dev`
- `dev` 集成验证通过后再合入 `master`

## 文档管理

- `plan/`：只放当前有效的实施计划
- `doc/src/`：关键源码文件的技术说明
- `doc/`：总览、研究、流程说明

推荐同时阅读：

- `doc/README.md`
- `plan/README.md`
- `AGENTS.md`
- `CLAUDE.md`
