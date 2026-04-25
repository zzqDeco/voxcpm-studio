import { Gauge, Play, Rows3 } from "lucide-react";

import { BenchJob } from "../types";
import { benchScenarioLabels, BenchRow } from "../workbench";
import { DataList, EmptyState, MetricTile, SectionCard, StatusPill, Toolbar } from "../components/primitives";
import { toStatusTone } from "../utils";

const scenarioDescriptions: Record<string, string> = {
  design: "zero-shot 文本设计场景",
  controlled_clone: "参考音频控制克隆",
  ultimate_clone: "参考音频 + prompt text",
  streaming: "WebSocket chunk 延迟观察",
  lora_compare: "LoRA checkpoint 对照",
};

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
  const selectedCount = Object.values(benchScenarios).filter(Boolean).length;

  return (
    <section className="workspace-grid workspace-grid-bench">
      <SectionCard
        eyebrow="Scenario Matrix"
        title="Configure Matrix -> Run"
        description="Bench 不再只是列表按钮，而是一个可扫描的评估矩阵：先明确场景、设备和 checkpoint，再启动批量评估。"
        className="form-card"
      >
        <div className="compare-summary-grid">
          <MetricTile label="模型" value={selectedModelLabel || "-"} />
          <MetricTile label="设备" value={selectedDevice} />
          <MetricTile label="LoRA" value={selectedLora || "none"} />
          <MetricTile label="已选场景" value={String(selectedCount)} tone={selectedCount > 0 ? "info" : "warning"} />
        </div>

        <div className="scenario-grid">
          {Object.keys(benchScenarios).map((scenario) => (
            <label key={scenario} className="scenario-card">
              <input type="checkbox" checked={benchScenarios[scenario]} onChange={(event) => onScenarioToggle(scenario, event.target.checked)} />
              <span className="scenario-card-icon">
                <Rows3 size={18} />
              </span>
              <div>
                <strong>{benchScenarioLabels[scenario] ?? scenario}</strong>
                <small>{scenarioDescriptions[scenario] ?? scenario}</small>
              </div>
            </label>
          ))}
        </div>

        <Toolbar className="toolbar-spacious action-row">
          <button className="button button-primary" type="button" onClick={onStartBench} disabled={loading || !selectedModelLabel}>
            <Play size={16} />
            启动 Bench
          </button>
          <StatusPill tone={selectedLora ? "info" : "neutral"}>{selectedLora ? "LoRA included" : "base model only"}</StatusPill>
        </Toolbar>
      </SectionCard>

      <SectionCard
        eyebrow="Job Feed"
        title="Review Results / Skips"
        description={benchJob ? `${benchJob.id} · ${benchJob.device}` : "尚未创建 Bench 任务"}
        actions={benchJob ? <StatusPill tone={toStatusTone(benchJob.status)}>{benchJob.status}</StatusPill> : null}
        className="viewer-card"
      >
        {benchJob ? (
          <>
            <div className="job-overview">
              <MetricTile label="完成场景" value={String(benchJob.runs.length)} tone={benchJob.runs.length > 0 ? "success" : "neutral"} />
              <MetricTile label="跳过场景" value={String(benchJob.skipped.length)} tone={benchJob.skipped.length > 0 ? "warning" : "neutral"} />
              <MetricTile label="模型" value={benchJob.model_id} />
              <MetricTile label="设备" value={benchJob.device} />
            </div>

            {benchRows.length > 0 ? (
              <DataList className="bench-result-list">
                <div className="data-row data-row-header data-row-bench">
                  <span>Scenario</span>
                  <span>Run ID</span>
                  <span>Device</span>
                  <span>RTF</span>
                  <span>Metric</span>
                </div>
                {benchRows.map((row) => (
                  <div key={`${row.scenario}-${row.runId}`} className="data-row data-row-bench">
                    <span data-label="Scenario">{benchScenarioLabels[row.scenario] ?? row.scenario}</span>
                    <code data-label="Run ID">{row.runId}</code>
                    <span data-label="Device">{row.device}</span>
                    <span data-label="RTF">{row.rtf}</span>
                    <span data-label="Metric">{row.metric}</span>
                  </div>
                ))}
              </DataList>
            ) : (
              <EmptyState title="等待结果写入" description="任务已经创建，结果表会在运行产物持久化后更新。" />
            )}

            {benchJob.skipped.length > 0 ? (
              <div className="skip-grid">
                {benchJob.skipped.map((item) => (
                  <article key={`${item.scenario}-${item.reason}`} className="skip-card">
                    <Gauge size={16} />
                    <strong>{benchScenarioLabels[item.scenario] ?? item.scenario}</strong>
                    <span>{item.reason}</span>
                  </article>
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
