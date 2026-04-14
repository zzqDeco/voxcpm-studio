# `voxcpm-studio` 仓库初始化计划

## 目标

将原 `OpenBMB/VoxCPM` 仓库中的本地工作台能力独立为新仓库，并建立清晰的分支治理、文档治理与独立运行边界。

## 当前实施范围

- 保留完整工作台能力：
  - Playground
  - Compare
  - Bench
  - Training
  - History
- 保留 Python 运行时与训练入口
- 保留 MPS 训练支持
- 保留 CUDA Docker 启动路径

## 初始化要求

- 仓库名：`voxcpm-studio`
- 主干分支：`master`
- 开发分支：`dev`
- 文档分层：
  - `plan/`
  - `doc/`
  - `doc/src/`

## 完成定义

- 新仓库可独立构建
- 新仓库不再依赖原仓库目录结构
- README、分支规则、文档同步规则齐全
- `/api/models` 能识别本地 `VoxCPM2`
- 前后端可在新仓库根目录启动
