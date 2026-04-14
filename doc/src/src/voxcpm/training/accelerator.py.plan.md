# `src/voxcpm/training/accelerator.py` 技术说明

## 1. 文件定位

- 项目：`voxcpm-studio`
- 源文件：`src/voxcpm/training/accelerator.py`
- 文档文件：`doc/src/src/voxcpm/training/accelerator.py.plan.md`
- 文件类型：Python 源码

## 2. 核心职责

- 统一训练侧设备、AMP、DDP 与 dataloader 准备逻辑
- 为 CUDA 和 MPS 提供一致的训练入口抽象

## 3. 输入与输出

- 输入来源：
  - 训练脚本传入的设备与精度模式
  - `torchrun` 环境变量
- 输出结果：
  - 设备上下文
  - autocast / scaler / DDP 封装
  - dataloader 与 model 准备逻辑

## 4. 关键实现细节

- `device` 支持 `auto / cuda / cuda:N / mps / cpu`
- `precision_mode` 支持 `auto / amp / fp32`
- 多卡 DDP 仅在 CUDA 上允许
- MPS 路径不走 DDP，AMP 需要显式探测支持能力

## 5. 依赖关系

- 内部依赖：
  - `voxcpm.model.utils.resolve_runtime_device`
- 外部依赖：
  - PyTorch
  - NumPy

## 6. 变更影响面

- 会直接影响训练行为、精度模式和设备兼容性
- MPS 支持的稳定性主要取决于这里的行为约束

## 7. 维护建议

- 任何 MPS 训练策略变化都要同步更新训练文档与前端说明
- 不要在这里引入隐式设备回退，失败必须明确可见
