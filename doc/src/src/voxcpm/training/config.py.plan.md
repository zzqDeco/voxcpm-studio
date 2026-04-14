# `src/voxcpm/training/config.py` 技术说明

## 1. 文件定位

- 项目：`voxcpm-studio`
- 源文件：`src/voxcpm/training/config.py`
- 文档文件：`doc/src/src/voxcpm/training/config.py.plan.md`
- 文件类型：Python 源码

## 2. 核心职责

- 统一加载训练 YAML 配置
- 把 YAML 参数和 argbind CLI 参数合并成单一参数字典
- 为训练脚本提供稳定的配置入口

## 3. 输入与输出

- 输入来源：
  - `config_path` 指定的 YAML 文件
  - 命令行参数
- 输出结果：
  - 可传给训练入口的参数字典

## 4. 关键实现细节

- `load_yaml_config()` 只接受顶层为 mapping 的 YAML
- `parse_args_with_config()` 先解析 CLI，再把 YAML 值通过 argbind 合并
- 仓库内默认可参考 `conf/voxcpm_v2/voxcpm_finetune_lora.yaml` 这一类预置配置

## 5. 依赖关系

- 内部依赖：
  - 无
- 外部依赖：
  - `argbind`
  - `pyyaml`

## 6. 变更影响面

- 配置加载规则变化会直接影响训练脚本和 demo training 编排
- YAML 字段兼容性变化会影响已有训练模板

## 7. 维护建议

- 保持 CLI 和 YAML 合并规则稳定
- 任何预置配置路径或命名变化都要同步更新 README 和训练文档
