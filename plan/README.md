# VoxCPM Studio Plan

本目录只保留当前有效、可直接实施的计划，不保留历史计划副本。

## 当前权威方案

- [studio-repo-bootstrap](studio-repo-bootstrap.md)
  - 主题：把原 `VoxCPM` 仓库中的 demo 前后端、运行时和训练能力独立成 `voxcpm-studio`
  - 作用：作为新仓库的初始化基线与治理方案

## 目录约定

- `plan/` 只放当前有效的实施计划
- `doc/src/` 放代码文件对应的技术说明，不与 `plan/` 重复承担变更方案职责
- `doc/` 顶层放文档总览、研究和流程说明
- 历史 plan 不在工作区长期保留；如需追溯，直接从 Git 历史查看
- 变更流转以 `master` 为主干、`dev` 为开发缓冲分支；实施分支先进入 `dev`，再由 `dev` 统一进入 `master`
