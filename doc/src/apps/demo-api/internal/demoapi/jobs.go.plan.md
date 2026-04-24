# `apps/demo-api/internal/demoapi/jobs.go` 技术说明

## 1. 文件定位

- 项目：`voxcpm-studio`
- 源文件：`apps/demo-api/internal/demoapi/jobs.go`
- 文档文件：`doc/src/apps/demo-api/internal/demoapi/jobs.go.plan.md`
- 文件类型：Go 源码

## 2. 核心职责

- Go 侧接管 Training 和 Bench 作业编排
- 启动、停止和轮询训练子进程
- 读取训练日志尾部内容
- 按固定场景执行 Bench，并把每个场景的 run 写入 SQLite

## 3. 输入与输出

- 输入来源：
  - `/api/train/start` 的训练参数
  - `/api/train/stop`、`/api/train/status`、`/api/train/logs` 查询参数
  - `/api/bench/run` 的模型、设备、场景和 LoRA 参数
- 输出结果：
  - `TrainingJob` JSON
  - `BenchJob` JSON
  - `demo-data/training/<job_id>/train_config.yaml`
  - `demo-data/training/<job_id>/logs/train.log`
  - SQLite 中的 training、bench 和 run 生命周期记录

## 4. 关键实现细节

- 训练继续调用 `scripts/train_voxcpm_finetune.py`，Go 负责配置生成、进程启动、日志收集和状态落库
- 训练配置写成 JSON 兼容 YAML，Python 侧仍通过 `yaml.safe_load` 读取
- `trainingRunner` 只保存当前活动训练进程，API 重启后由 storage 恢复逻辑修正旧 running 状态
- Bench 复用 Python worker 的 `infer` 命令，不在 Go 内重写 PyTorch 推理
- Bench 的 `design`、`controlled_clone`、`ultimate_clone`、`streaming`、`lora_compare` 场景保持旧 Python runtime 的语义

## 5. 依赖关系

- 内部依赖：
  - `worker.go`
  - `storage.go`
  - `server.go`
- 外部依赖：
  - Go `os/exec`
  - Go `encoding/json`

## 6. 变更影响面

- 训练状态、日志和 Bench 轮询直接影响前端 `Training` 和 `Bench` 工作区
- Bench 场景失败会进入 `skipped`，不会中断整个 job
- 停止训练会先返回 `stopping`，进程退出后收敛到 `stopped` 或 `failed`

## 7. 维护建议

- 不要把模型执行或训练内核迁入 Go；Go 只负责控制面、作业生命周期和持久化
- 增加 Bench 场景时同步更新前端场景列表和契约测试
- 修改训练配置字段时同步检查 `scripts/train_voxcpm_finetune.py`
