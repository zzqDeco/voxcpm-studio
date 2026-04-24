import { RunRecord } from "../types";
import { formatTime } from "../utils";
import { RunViewer } from "../components/RunViewer";
import { MetricTile, SectionCard } from "../components/primitives";

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
        title="并排分析"
        description="对同一文本、不同模型、不同 LoRA 或不同设备结果做直接并列判断。"
        className="form-card"
      >
        <div className="field-grid two-columns">
          <label>
            Left Run
            <select value={leftRunId} onChange={(event) => onSelectLeft(event.target.value)}>
              <option value="">请选择</option>
              {compareRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.id} · {run.model_id} · {run.mode}
                </option>
              ))}
            </select>
          </label>
          <label>
            Right Run
            <select value={rightRunId} onChange={(event) => onSelectRight(event.target.value)}>
              <option value="">请选择</option>
              {compareRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.id} · {run.model_id} · {run.mode}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="compare-summary-grid">
          <MetricTile label="Left" value={leftRun ? leftRun.model_id : "-"} detail={leftRun ? formatTime(leftRun.created_at) : "未选择"} />
          <MetricTile label="Right" value={rightRun ? rightRun.model_id : "-"} detail={rightRun ? formatTime(rightRun.created_at) : "未选择"} />
          <MetricTile label="模式差异" value={leftRun && rightRun ? `${leftRun.mode} vs ${rightRun.mode}` : "-"} />
          <MetricTile label="设备差异" value={leftRun && rightRun ? `${leftRun.device} vs ${rightRun.device}` : "-"} />
        </div>
      </SectionCard>

      <div className="viewer-compare-grid">
        <RunViewer run={leftRun} title="Left Candidate" description="左侧结果用于基线判断与差异比较。" />
        <RunViewer run={rightRun} title="Right Candidate" description="右侧结果与基线并排，重点看韵律、ASR 与指标差异。" />
      </div>
    </section>
  );
}
