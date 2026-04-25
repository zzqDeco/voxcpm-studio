import { Copy, Download, GitCompare, RotateCcw } from "lucide-react";

import { RunRecord } from "../types";
import { absoluteArtifactUrl, formatTime, metricValue, toStatusTone } from "../utils";
import { EmptyState, MetricTile, SectionCard, StatusPill, Toolbar } from "./primitives";

function Waveform({ points }: { points?: number[] }) {
  if (!points || points.length === 0) {
    return <EmptyState title="暂无波形数据" compact />;
  }

  const width = 640;
  const height = 160;
  const step = width / Math.max(points.length - 1, 1);
  const path = points
    .map((point, index) => {
      const x = index * step;
      const y = height / 2 - point * (height / 2 - 16);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="viewer-waveform" role="img" aria-label="audio waveform">
      <line x1="0" y1={height / 2} x2={width} y2={height / 2} className="viewer-waveform-baseline" />
      <path d={path} className="viewer-waveform-path" />
    </svg>
  );
}

function ResultBlock({ title, value }: { title: string; value: string }) {
  return (
    <article className="result-block">
      <h4>{title}</h4>
      <div className="result-block-body">{value}</div>
    </article>
  );
}

export function RunViewer({
  run,
  title,
  description,
  onReuse,
  onCompare,
}: {
  run?: RunRecord | null;
  title: string;
  description?: string;
  onReuse?: (run: RunRecord) => void;
  onCompare?: (run: RunRecord) => void;
}) {
  if (!run) {
    return (
      <SectionCard eyebrow="Result Deck" title={title} description={description} className="viewer-card result-deck">
        <EmptyState title="还没有结果" description="执行推理、训练或选择历史记录后，结果会显示在这里。" />
      </SectionCard>
    );
  }

  const activeRun = run;
  const audioUrl = absoluteArtifactUrl(activeRun.result.audio_url);
  const melUrl = absoluteArtifactUrl(activeRun.result.mel_url);
  const metricLabel = (activeRun.metrics.metric_name ?? "quality").toUpperCase();
  const metricTone = activeRun.status === "completed" ? "success" : activeRun.status === "failed" ? "danger" : "neutral";

  async function copyText() {
    await navigator.clipboard?.writeText(activeRun.request.resolved_text || activeRun.request.text);
  }

  function openAudio() {
    if (audioUrl) {
      window.open(audioUrl, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <SectionCard
      eyebrow="Result Deck"
      title={title}
      description={`${run.model_id} · ${run.mode} · ${run.device} · ${formatTime(run.created_at)}`}
      actions={<StatusPill tone={toStatusTone(run.status)}>{run.status}</StatusPill>}
      className="viewer-card result-deck"
    >
      <div className="result-command-row">
        <Toolbar>
          {onReuse ? (
            <button className="button button-secondary button-small" type="button" onClick={() => onReuse(run)}>
              <RotateCcw size={14} />
              复用参数
            </button>
          ) : null}
          {onCompare ? (
            <button className="button button-secondary button-small" type="button" onClick={() => onCompare(run)}>
              <GitCompare size={14} />
              送入 Compare
            </button>
          ) : null}
          <button className="button button-text button-small" type="button" onClick={() => void copyText()}>
            <Copy size={14} />
            复制文本
          </button>
          <button className="button button-text button-small" type="button" onClick={openAudio} disabled={!audioUrl}>
            <Download size={14} />
            打开音频
          </button>
        </Toolbar>
      </div>

      <div className="viewer-metrics-grid">
        <MetricTile label="总耗时" value={`${metricValue(run.metrics.wall_time_ms)} ms`} tone={metricTone} />
        <MetricTile label="音频时长" value={`${metricValue(run.metrics.audio_duration_s)} s`} />
        <MetricTile label="RTF" value={metricValue(run.metrics.rtf, 3)} tone={run.metrics.rtf && run.metrics.rtf < 1 ? "success" : "neutral"} />
        <MetricTile label="采样率" value={run.metrics.sample_rate ? `${run.metrics.sample_rate} Hz` : "-"} />
        <MetricTile label={metricLabel} value={metricValue(run.metrics.metric_value, 3)} />
        <MetricTile
          label="首包延迟"
          value={
            run.metrics.first_chunk_latency_ms !== undefined && run.metrics.first_chunk_latency_ms !== null
              ? `${metricValue(run.metrics.first_chunk_latency_ms)} ms`
              : "-"
          }
          detail={run.metrics.chunk_count ? `${run.metrics.chunk_count} chunks` : undefined}
        />
      </div>

      {audioUrl ? <audio className="viewer-audio" controls src={audioUrl} preload="none" /> : null}

      <div className="viewer-media-grid">
        <article className="result-block">
          <h4>Waveform</h4>
          <Waveform points={run.result.waveform_points} />
        </article>
        <article className="result-block">
          <h4>Mel Spectrogram</h4>
          {melUrl ? <img className="viewer-mel" src={melUrl} alt="mel spectrogram" /> : <EmptyState title="暂无频谱图" compact />}
        </article>
      </div>

      <div className="viewer-text-grid">
        <ResultBlock title="目标文本" value={run.request.resolved_text || run.request.text} />
        <ResultBlock title="ASR 转写" value={run.result.asr_text ?? "暂无 ASR 结果"} />
      </div>

      {run.request.notes && run.request.notes.length > 0 ? (
        <div className="viewer-note-row">
          {run.request.notes.map((note) => (
            <span key={note} className="meta-chip">
              {note}
            </span>
          ))}
        </div>
      ) : null}
    </SectionCard>
  );
}
