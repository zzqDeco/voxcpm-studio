import { GitCompare } from "lucide-react";

import { RunRecord } from "../types";
import { formatTime, metricValue, toStatusTone } from "../utils";
import { RunViewer } from "../components/RunViewer";
import { MetricTile, SectionCard, StatusPill } from "../components/primitives";

function deltaValue(left?: number | null, right?: number | null, digits = 3) {
  if (left === undefined || left === null || right === undefined || right === null) {
    return "-";
  }
  const delta = right - left;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(digits)}`;
}

function RunPreview({ run, side }: { run: RunRecord | null; side: string }) {
  if (!run) {
    return (
      <div className="run-preview-card">
        <strong>{side}</strong>
        <span>未选择 run</span>
      </div>
    );
  }

  return (
    <div className="run-preview-card">
      <div>
        <strong>{run.model_id}</strong>
        <span>{formatTime(run.created_at)}</span>
      </div>
      <div className="run-preview-meta">
        <StatusPill tone={toStatusTone(run.status)}>{run.status}</StatusPill>
        <span>{run.mode}</span>
        <span>{run.device}</span>
        <span>RTF {metricValue(run.metrics.rtf, 3)}</span>
      </div>
    </div>
  );
}

export function ComparePanel({
  compareRuns,
  leftRunId,
  rightRunId,
  leftRun,
  rightRun,
  onSelectLeft,
  onSelectRight,
}: {
  compareRuns: RunRecord[];
  leftRunId: string;
  rightRunId: string;
  leftRun: RunRecord | null;
  rightRun: RunRecord | null;
  onSelectLeft: (value: string) => void;
  onSelectRight: (value: string) => void;
}) {
  return (
    <section className="workspace-stack">
      <SectionCard
        eyebrow="Analysis Desk"
        title="Select Pair -> Inspect Deltas"
        description="把两个候选结果放到并列槽位里，先看指标差异，再进入听感和频谱细节。"
        className="form-card"
      >
        <div className="compare-slot-grid">
          <label className="run-slot">
            <span>Left Slot</span>
            <select value={leftRunId} onChange={(event) => onSelectLeft(event.target.value)}>
              <option value="">请选择</option>
              {compareRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.id} · {run.model_id} · {run.mode} · RTF {metricValue(run.metrics.rtf, 3)}
                </option>
              ))}
            </select>
            <RunPreview run={leftRun} side="Left" />
          </label>
          <label className="run-slot">
            <span>Right Slot</span>
            <select value={rightRunId} onChange={(event) => onSelectRight(event.target.value)}>
              <option value="">请选择</option>
              {compareRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.id} · {run.model_id} · {run.mode} · RTF {metricValue(run.metrics.rtf, 3)}
                </option>
              ))}
            </select>
            <RunPreview run={rightRun} side="Right" />
          </label>
        </div>

        <div className="delta-strip">
          <div className="delta-strip-title">
            <GitCompare size={18} />
            <span>Right - Left</span>
          </div>
          <MetricTile label="RTF Delta" value={deltaValue(leftRun?.metrics.rtf, rightRun?.metrics.rtf)} />
          <MetricTile label="Duration Delta" value={deltaValue(leftRun?.metrics.audio_duration_s, rightRun?.metrics.audio_duration_s, 2)} detail="seconds" />
          <MetricTile label="Quality Delta" value={deltaValue(leftRun?.metrics.metric_value, rightRun?.metrics.metric_value)} />
          <MetricTile label="Mode" value={leftRun && rightRun ? `${leftRun.mode} / ${rightRun.mode}` : "-"} />
        </div>
      </SectionCard>

      <div className="viewer-compare-grid">
        <RunViewer run={leftRun} title="Left Candidate" description="左侧结果作为基线，优先判断 RTF、音色稳定性与文本一致性。" />
        <RunViewer run={rightRun} title="Right Candidate" description="右侧结果与基线并排，重点看韵律、ASR 与质量指标差异。" />
      </div>
    </section>
  );
}
