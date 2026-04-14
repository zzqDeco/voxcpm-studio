# Documentation Guide

## Directory Roles

- `plan/` stores active implementation plans that are still meant to be executed.
- `doc/src/` stores per-file technical notes that explain the current codebase shape.
- `doc/` top level stores overview, research, and documentation workflow notes.

## Sync Rules

- Any feature, fix, refactor, or docs-only change should update the matching `doc/src/<source-file>.plan.md` files when behavior or structure changes.
- Project-level workflow or architecture changes should also update the relevant entry docs such as `README.md`, `README_CN.md`, `AGENTS.md`, and `CLAUDE.md`.
- Test-plan docs should describe what behavior a file or flow protects, not restate each assertion line-by-line.

## Branch Workflow

- `master` is the trunk branch.
- `dev` is the development buffer branch.
- Topic branches should be created from `dev`.
- All routine pull requests merge into `dev` first.
- `dev` is merged into `master` after integration has been verified.
