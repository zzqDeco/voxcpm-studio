import { useState } from "react";
import { Filter, GitCompare, RotateCcw } from "lucide-react";

import { ModelInfo, RunRecord } from "../types";
import { RunViewer } from "../components/RunViewer";
import { DataList, EmptyState, SectionCard, StatusPill, Toolbar } from "../components/primitives";
import { FieldUpdater, HistoryFilters } from "../workbench";
import { formatTime, metricValue, toStatusTone } from "../utils";

export function HistoryPanel({
  models,
  runs,
  historyFilters,
  historyRuns,
  historySelectedRunId,
  historyRun,
  onHistoryFilterChange,
  onResetFilters,
  onSelectRun,
  onCompareRuns,
  onReuseRun,
}: {
  models: ModelInfo[];
  runs: RunRecord[];
  historyFilters: HistoryFilters;
  historyRuns: RunRecord[];
  historySelectedRunId: string;
  historyRun: RunRecord | null;
  onHistoryFilterChange: FieldUpdater<HistoryFilters>;
  onResetFilters: () => void;
  onSelectRun: (runId: string) => void;
  onCompareRuns: (leftRunId: string, rightRunId: string) => void;
  onReuseRun: (run: RunRecord) => void;
}) {
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const modes = Array.from(new Set(runs.map((run) => run.mode)));
  const devices = Array.from(new Set(runs.map((run) => run.device)));
  const statuses = Array.from(new Set(runs.map((run) => run.status)));

  function toggleCompare(runId: string) {
    setCompareSelection((prev) => {
      if (prev.includes(runId)) {
        return prev.filter((id) => id !== runId);
      }
      return [...prev.slice(-1), runId];
    });
  }

  function sendToCompare() {
    if (compareSelection.length === 2) {
      onCompareRuns(compareSelection[0], compareSelection[1]);
    }
  }

  return (
    <section className="workspace-grid workspace-grid-history">
      <SectionCard
        eyebrow="Archive Lens"
        title="Filter -> Select -> Reuse"
        description="历史区变成可操作的结果索引：筛选、快速扫指标、选择两个 run 进入 Compare，或复用一次成功配置。"
        className="form-card history-filter-card"
      >
        <div className="filter-toolbar">
          <div className="filter-toolbar-title">
            <Filter size={18} />
            <strong>过滤器</strong>
          </div>
          <Toolbar>
            <button className="button button-secondary button-small" type="button" onClick={onResetFilters}>
              <RotateCcw size={14} />
              清空
            </button>
            <StatusPill tone="neutral">{historyRuns.length} runs</StatusPill>
          </Toolbar>
        </div>

        <div className="field-grid two-columns compact-filter-grid">
          <label>
            模型
            <select value={historyFilters.modelId} onChange={(event) => onHistoryFilterChange("modelId", event.target.value)}>
              <option value="">全部模型</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            模式
            <select value={historyFilters.mode} onChange={(event) => onHistoryFilterChange("mode", event.target.value)}>
              <option value="">全部模式</option>
              {modes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
          <label>
            设备
            <select value={historyFilters.device} onChange={(event) => onHistoryFilterChange("device", event.target.value)}>
              <option value="">全部设备</option>
              {devices.map((device) => (
                <option key={device} value={device}>
                  {device}
                </option>
              ))}
            </select>
          </label>
          <label>
            状态
            <select value={historyFilters.status} onChange={(event) => onHistoryFilterChange("status", event.target.value)}>
              <option value="">全部状态</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Toolbar className="toolbar-spacious">
          <button className="button button-primary button-small" type="button" onClick={sendToCompare} disabled={compareSelection.length !== 2}>
            <GitCompare size={14} />
            比较选中两项
          </button>
          <StatusPill tone={compareSelection.length === 2 ? "info" : "neutral"}>{compareSelection.length}/2 selected</StatusPill>
        </Toolbar>

        {historyRuns.length > 0 ? (
          <DataList className="history-list">
            {historyRuns.map((run) => (
              <article key={run.id} className={`history-row ${historySelectedRunId === run.id ? "is-selected" : ""}`}>
                <button className="history-row-button" type="button" onClick={() => onSelectRun(run.id)}>
                  <div className="history-row-main">
                    <strong>{run.model_id}</strong>
                    <span>{run.mode}</span>
                    <span>{run.device}</span>
                  </div>
                  <div className="history-row-meta">
                    <StatusPill tone={toStatusTone(run.status)}>{run.status}</StatusPill>
                    <span>{formatTime(run.created_at)}</span>
                    <span>RTF {metricValue(run.metrics.rtf, 3)}</span>
                    <span>{run.metrics.metric_name ? `${run.metrics.metric_name.toUpperCase()} ${metricValue(run.metrics.metric_value, 3)}` : "metric -"}</span>
                  </div>
                </button>
                <label className="compare-check">
                  <input type="checkbox" checked={compareSelection.includes(run.id)} onChange={() => toggleCompare(run.id)} />
                  Compare
                </label>
              </article>
            ))}
          </DataList>
        ) : (
          <EmptyState title="没有匹配的记录" description="调整过滤条件后，这里会展示符合条件的本地运行历史。" />
        )}
      </SectionCard>

      <RunViewer
        run={historyRun}
        title="History Detail"
        description="右侧保持固定详情视图，方便边筛边看。"
        onReuse={onReuseRun}
        onCompare={(run) => onCompareRuns(compareSelection[0] || run.id, run.id)}
      />
    </section>
  );
}
