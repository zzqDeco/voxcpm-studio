# `scripts/train_voxcpm_finetune.py` 技术说明

## 1. 文件定位

- 项目：`voxcpm-studio`
- 源文件：`scripts/train_voxcpm_finetune.py`
- 文档文件：`doc/src/scripts/train_voxcpm_finetune.py.plan.md`
- 文件类型：Python 源码

## 2. 核心职责

- 作为 studio 内训练入口脚本
- 加载配置、构建模型、准备数据、执行训练与验证
- 负责 checkpoint 恢复、保存与样例音频输出

## 3. 输入与输出

- 输入来源：
  - YAML 配置文件
  - 本地训练 manifest
  - 训练模型目录
- 输出结果：
  - checkpoint
  - 训练日志
  - TensorBoard 数据
  - 样例音频

## 4. 关键实现细节

- 支持自动识别 `voxcpm` / `voxcpm2` 架构
- 支持 LoRA 与 Full FT
- 训练设备与精度模式由 `Accelerator` 统一接管
- CPU 训练被显式拒绝
- MPS 下：
  - LoRA 为推荐路径
  - Full FT 标实验
  - FP32 为默认路径

## 5. 依赖关系

- 内部依赖：
  - `src/voxcpm.model`
  - `src/voxcpm.training`
- 外部依赖：
  - PyTorch
  - transformers
  - tensorboardX
  - argbind

## 6. 变更影响面

- 会直接影响训练配置语义、恢复行为和生成样例逻辑
- 前端 training 页面实际调用的就是这条脚本链路

## 7. 维护建议

- 保持 YAML 配置字段稳定，避免后端 orchestration 层频繁适配
- 精度与设备约束要与 `Accelerator` 保持一致，不在脚本里重复做隐式回退
