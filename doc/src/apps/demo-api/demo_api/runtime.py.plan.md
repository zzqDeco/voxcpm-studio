# `apps/demo-api/demo_api/runtime.py` 技术说明

## 1. 文件定位

- 项目：`voxcpm-studio`
- 源文件：`apps/demo-api/demo_api/runtime.py`
- 文档文件：`doc/src/apps/demo-api/demo_api/runtime.py.plan.md`
- 文件类型：Python 源码

## 2. 核心职责

- 统一管理 demo 运行时状态
- 扫描本地模型与 LoRA checkpoint
- 协调推理、流式推理、ASR、Bench、Training 与 History
- 维护 busy state，避免单设备任务冲突

## 3. 输入与输出

- 输入来源：
  - HTTP / WebSocket 请求
  - 本地模型目录、LoRA 目录、训练输出目录
  - 训练脚本子进程输出
- 输出结果：
  - API 返回的运行记录、指标、状态和任务信息
  - `demo-data/` 下的音频、mel、日志与 SQLite 元数据

## 4. 关键实现细节

- `runtime_info()` 提供设备能力矩阵、活动模型和忙碌状态
- `scan_models()` 与 `scan_lora_checkpoints()` 负责本地资源发现，并跟随目录符号链接
- `load_model()` 与 `_activate_lora()` 负责活动模型生命周期
- `_perform_inference()` 统一处理普通推理与流式推理
- `start_training()` 通过子进程调用 `scripts/train_voxcpm_finetune.py`
- `start_bench()` 复用统一推理逻辑批量跑固定场景

## 5. 依赖关系

- 内部依赖：
  - `demo_api.config`
  - `demo_api.storage`
  - `demo_api.utils`
  - `src/voxcpm`
- 外部依赖：
  - FastAPI
  - PyTorch
  - NumPy
  - FunASR

## 6. 变更影响面

- 修改该文件会直接影响后端 API 行为、任务调度和指标写入
- 前端所有工作区都依赖这里返回的状态和记录结构
- 训练与 Bench 逻辑也通过这里统一编排

## 7. 维护建议

- 保持 API 字段兼容，优先在这里做后端收敛
- 新增任务类型时先明确 busy-state 语义
- 任何模型目录、训练目录、路径规则变化都要同步更新 `README` 和 `doc/README.md`
