import { ModelInfo, RunRecord } from "../types";
import { RunViewer } from "../components/RunViewer";
import { DataList, EmptyState, SectionCard, StatusPill, Toolbar } from "../components/primitives";
import { FieldUpdater, HistoryFilters } from "../workbench";
import { formatTime, toStatusTone } from "../utils";

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
}) {
  const modes = Array.from(new Set(runs.map((run) => run.mode)));
  const devices = Array.from(new Set(runs.map((run) => run.device)));
  const statuses = Array.from(new Set(runs.map((run) => run.status)));

  return (
    <section className="workspace-grid workspace-grid-history">
      <SectionCard
        eyebrow="Archive Lens"
        title="结果回溯"
        description="按模型、模式、设备和状态快速筛选，把历史运行结果恢复成可继续分析的样子。"
        className="form-card"
      >
        <div className="field-grid two-columns">
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

        <Toolbar>
          <button className="button button-secondary" onClick={onResetFilters}>
            清空筛选
          </button>
          <StatusPill tone="neutral">{historyRuns.length} runs</StatusPill>
        </Toolbar>

        {historyRuns.length > 0 ? (
          <DataList className="history-list">
            {historyRuns.map((run) => (
              <button
                key={run.id}
                className={`history-row ${historySelectedRunId === run.id ? "is-selected" : ""}`}
                onClick={() => onSelectRun(run.id)}
              >
                <div className="history-row-main">
                  <strong>{run.model_id}</strong>
                  <span>{run.mode}</span>
                  <span>{run.device}</span>
                </div>
                <div className="history-row-meta">
                  <StatusPill tone={toStatusTone(run.status)}>{run.status}</StatusPill>
                  <span>{formatTime(run.created_at)}</span>
                  <span>RTF {run.metrics.rtf !== undefined && run.metrics.rtf !== null ? run.metrics.rtf.toFixed(3) : "-"}</span>
                </div>
              </button>
            ))}
          </DataList>
        ) : (
          <EmptyState title="没有匹配的记录" description="调整过滤条件后，这里会展示符合条件的本地运行历史。" />
        )}
      </SectionCard>

      <RunViewer run={historyRun} title="History Detail" description="右侧保持固定详情视图，方便边筛边看。" />
    </section>
  );
}
