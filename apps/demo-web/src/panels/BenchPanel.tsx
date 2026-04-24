import { BenchJob } from "../types";
import { benchScenarioLabels, BenchRow } from "../workbench";
import { DataList, EmptyState, MetricTile, SectionCard, StatusPill, Toolbar } from "../components/primitives";
import { toStatusTone } from "../utils";

export function BenchPanel({
  benchJob,
  benchRows,
  benchScenarios,
  loading,
  selectedModelLabel,
  selectedDevice,
  selectedLora,
  onScenarioToggle,
  onStartBench,
}: {
  benchJob: BenchJob | null;
  benchRows: BenchRow[];
  benchScenarios: Record<string, boolean>;
  loading: boolean;
  selectedModelLabel: string;
  selectedDevice: string;
  selectedLora: string;
  onScenarioToggle: (scenario: string, checked: boolean) => void;
  onStartBench: () => void;
}) {
  return (
    <section className="workspace-grid workspace-grid-bench">
      <SectionCard
        eyebrow="Scenario Matrix"
        title="批量场景评估"
        description="固定场景、固定设备、固定 LoRA 条件下，把运行结果组织成可比较的评估矩阵。"
        className="form-card"
      >
        <div className="compare-summary-grid">
          <MetricTile label="模型" value={selectedModelLabel || "-"} />
          <MetricTile label="设备" value={selectedDevice} />
          <MetricTile label="LoRA" value={selectedLora || "none"} />
          <MetricTile label="已选场景" value={String(Object.values(benchScenarios).filter(Boolean).length)} />
        </div>

        <div className="scenario-grid">
          {Object.keys(benchScenarios).map((scenario) => (
            <label key={scenario} className="toggle-card">
              <input type="checkbox" checked={benchScenarios[scenario]} onChange={(event) => onScenarioToggle(scenario, event.target.checked)} />
              <div>
                <strong>{benchScenarioLabels[scenario] ?? scenario}</strong>
                <span>{scenario}</span>
              </div>
            </label>
          ))}
        </div>

        <Toolbar className="toolbar-spacious">
          <button className="button button-primary" onClick={onStartBench} disabled={loading || !selectedModelLabel}>
            启动 Bench
          </button>
        </Toolbar>
      </SectionCard>

      <SectionCard
        eyebrow="Job Feed"
        title="Bench Result"
        description={benchJob ? `${benchJob.id} · ${benchJob.device}` : "尚未创建 Bench 任务"}
        actions={benchJob ? <StatusPill tone={toStatusTone(benchJob.status)}>{benchJob.status}</StatusPill> : null}
        className="viewer-card"
      >
        {benchJob ? (
          <>
            <div className="compare-summary-grid">
              <MetricTile label="完成场景" value={String(benchJob.runs.length)} />
              <MetricTile label="跳过场景" value={String(benchJob.skipped.length)} />
              <MetricTile label="模型" value={benchJob.model_id} />
              <MetricTile label="设备" value={benchJob.device} />
            </div>

            {benchRows.length > 0 ? (
              <DataList>
                <div className="data-row data-row-header data-row-bench">
                  <span>Scenario</span>
                  <span>Run ID</span>
                  <span>Device</span>
                  <span>RTF</span>
                  <span>Metric</span>
                </div>
                {benchRows.map((row) => (
                  <div key={`${row.scenario}-${row.runId}`} className="data-row data-row-bench">
                    <span>{benchScenarioLabels[row.scenario] ?? row.scenario}</span>
                    <code>{row.runId}</code>
                    <span>{row.device}</span>
                    <span>{row.rtf}</span>
                    <span>{row.metric}</span>
                  </div>
                ))}
              </DataList>
            ) : (
              <EmptyState title="等待结果写入" description="任务已经创建，结果表会在运行产物持久化后更新。" />
            )}

            {benchJob.skipped.length > 0 ? (
              <div className="chip-row">
                {benchJob.skipped.map((item) => (
                  <span key={`${item.scenario}-${item.reason}`} className="meta-chip tone-warning">
                    {item.scenario}: {item.reason}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState title="暂无 Bench 任务" description="选择场景后启动任务，结果表和跳过原因会显示在这里。" />
        )}
      </SectionCard>
    </section>
  );
}
