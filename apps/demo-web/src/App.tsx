import { ChangeEvent, useEffect, useMemo, useState } from "react";

import {
  BenchJob,
  CheckpointInfo,
  ModelInfo,
  RunRecord,
  RuntimeInfo,
  TrainingJob,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const WS_BASE = API_BASE.replace(/^http/, "ws");

type TabKey = "playground" | "compare" | "bench" | "training" | "history";
type ModeKey = "design" | "controlled_clone" | "ultimate_clone";

type PlaygroundState = {
  modelId: string;
  device: string;
  mode: ModeKey;
  text: string;
  controlInstruction: string;
  promptText: string;
  normalize: boolean;
  denoise: boolean;
  cfgValue: number;
  inferenceTimesteps: number;
  loraCheckpoint: string;
  streaming: boolean;
};

type TrainingFormState = {
  modelId: string;
  trainingMode: "lora" | "full_ft";
  device: string;
  precisionMode: "auto" | "fp32" | "amp";
  trainManifest: string;
  valManifest: string;
  learningRate: number;
  batchSize: number;
  numIters: number;
  gradAccumSteps: number;
  saveInterval: number;
  loraRank: number;
  loraAlpha: number;
  loraDropout: number;
};

type HistoryFilters = {
  modelId: string;
  mode: string;
  device: string;
  status: string;
};

type BenchRow = {
  scenario: string;
  runId: string;
  device: string;
  rtf: string;
  metric: string;
  loraCheckpoint?: string | null;
};

const defaultPlaygroundState: PlaygroundState = {
  modelId: "",
  device: "auto",
  mode: "design",
  text: "你好，这是 VoxCPM 本地工作台测试。",
  controlInstruction: "年轻女性，温柔甜美",
  promptText: "",
  normalize: false,
  denoise: false,
  cfgValue: 2.0,
  inferenceTimesteps: 10,
  loraCheckpoint: "",
  streaming: false,
};

const defaultTrainingState: TrainingFormState = {
  modelId: "",
  trainingMode: "lora",
  device: "auto",
  precisionMode: "auto",
  trainManifest: "",
  valManifest: "",
  learningRate: 1e-4,
  batchSize: 1,
  numIters: 1000,
  gradAccumSteps: 1,
  saveInterval: 500,
  loraRank: 32,
  loraAlpha: 16,
  loraDropout: 0.0,
};

const defaultHistoryFilters: HistoryFilters = {
  modelId: "",
  mode: "",
  device: "",
  status: "",
};

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    const raw = await response.text();
    try {
      const parsed = JSON.parse(raw) as { detail?: string };
      throw new Error(parsed.detail || raw || `Request failed: ${response.status}`);
    } catch {
      throw new Error(raw || `Request failed: ${response.status}`);
    }
  }
  return response.json() as Promise<T>;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function metricValue(value?: number | null, digits = 2): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

function absoluteArtifactUrl(path?: string): string | undefined {
  if (!path) {
    return undefined;
  }
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  return `${API_BASE}${path}`;
}

function formatTime(value?: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function resolveDeviceSelection(selected: string, runtime: RuntimeInfo | null): string {
  if (selected && selected !== "auto") {
    return selected;
  }
  return runtime?.device ?? runtime?.available_devices[0] ?? "cpu";
}

function resolveRecommendedPrecision(selectedDevice: string, runtime: RuntimeInfo | null): "fp32" | "amp" {
  const device = resolveDeviceSelection(selectedDevice, runtime);
  const capability = runtime?.device_capabilities?.[device];
  return capability?.recommended_precision_mode === "amp" ? "amp" : "fp32";
}

function Waveform({ points }: { points?: number[] }) {
  if (!points || points.length === 0) {
    return <div className="empty-state small">暂无波形数据</div>;
  }
  const width = 640;
  const height = 140;
  const step = width / Math.max(points.length - 1, 1);
  const path = points
    .map((point, index) => {
      const x = index * step;
      const y = height / 2 - point * (height / 2 - 12);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="waveform">
      <line x1="0" y1={height / 2} x2={width} y2={height / 2} className="waveform-baseline" />
      <path d={path} className="waveform-path" />
    </svg>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
    </div>
  );
}

function TextBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="text-block">
      <h4>{title}</h4>
      <div className="text-block-body">{value}</div>
    </div>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RunViewer({ run, title }: { run?: RunRecord | null; title: string }) {
  if (!run) {
    return (
      <section className="panel viewer-panel">
        <div className="panel-header">
          <h3>{title}</h3>
        </div>
        <div className="empty-state">还没有结果</div>
      </section>
    );
  }

  const audioUrl = absoluteArtifactUrl(run.result.audio_url);
  const melUrl = absoluteArtifactUrl(run.result.mel_url);
  const metricLabel = (run.metrics.metric_name ?? "quality").toUpperCase();

  return (
    <section className="panel viewer-panel">
      <div className="panel-header">
        <div>
          <h3>{title}</h3>
          <p className="muted">
            {run.model_id} · {run.mode} · {run.device} · {formatTime(run.created_at)}
          </p>
        </div>
        <span className={`badge badge-${run.status}`}>{run.status}</span>
      </div>
      <div className="metrics-grid">
        <MetricCard label="总耗时" value={`${metricValue(run.metrics.wall_time_ms)} ms`} />
        <MetricCard label="音频时长" value={`${metricValue(run.metrics.audio_duration_s)} s`} />
        <MetricCard label="RTF" value={metricValue(run.metrics.rtf, 3)} />
        <MetricCard label="采样率" value={run.metrics.sample_rate ? `${run.metrics.sample_rate} Hz` : "-"} />
        <MetricCard
          label={metricLabel}
          value={run.metrics.metric_value !== undefined && run.metrics.metric_value !== null ? metricValue(run.metrics.metric_value, 3) : "-"}
        />
        <MetricCard
          label="首包延迟"
          value={run.metrics.first_chunk_latency_ms !== undefined && run.metrics.first_chunk_latency_ms !== null ? `${metricValue(run.metrics.first_chunk_latency_ms)} ms` : "-"}
        />
      </div>
      {audioUrl ? <audio className="audio-player" controls src={audioUrl} /> : null}
      <div className="two-column">
        <div>
          <h4>波形</h4>
          <Waveform points={run.result.waveform_points} />
        </div>
        <div>
          <h4>Mel 频谱</h4>
          {melUrl ? <img className="mel-image" src={melUrl} alt="mel spectrogram" /> : <div className="empty-state small">暂无频谱</div>}
        </div>
      </div>
      <div className="two-column">
        <TextBlock title="目标文本" value={run.request.resolved_text} />
        <TextBlock title="ASR 转写" value={run.result.asr_text ?? "暂无 ASR 结果"} />
      </div>
      {run.request.notes && run.request.notes.length > 0 ? (
        <div className="notes-block">
          {run.request.notes.map((note) => (
            <div key={note} className="note-chip">
              {note}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [tab, setTab] = useState<TabKey>("playground");
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [latestRun, setLatestRun] = useState<RunRecord | null>(null);
  const [leftRunId, setLeftRunId] = useState<string>("");
  const [rightRunId, setRightRunId] = useState<string>("");
  const [historySelectedRunId, setHistorySelectedRunId] = useState<string>("");
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>(defaultHistoryFilters);
  const [playground, setPlayground] = useState<PlaygroundState>(defaultPlaygroundState);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("准备就绪");
  const [streamEvents, setStreamEvents] = useState<string[]>([]);
  const [benchJob, setBenchJob] = useState<BenchJob | null>(null);
  const [benchScenarios, setBenchScenarios] = useState<Record<string, boolean>>({
    design: true,
    controlled_clone: true,
    ultimate_clone: true,
    streaming: true,
    lora_compare: true,
  });
  const [trainingForm, setTrainingForm] = useState<TrainingFormState>(defaultTrainingState);
  const [trainingStatus, setTrainingStatus] = useState<TrainingJob | null>(null);
  const [trainingLogs, setTrainingLogs] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const selectedModel = useMemo(
    () => models.find((item) => item.id === playground.modelId) ?? null,
    [models, playground.modelId],
  );
  const runsById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);
  const leftRun = useMemo(() => (leftRunId ? runsById.get(leftRunId) ?? null : null), [leftRunId, runsById]);
  const rightRun = useMemo(() => (rightRunId ? runsById.get(rightRunId) ?? null : null), [rightRunId, runsById]);
  const historyRun = useMemo(
    () => (historySelectedRunId ? runsById.get(historySelectedRunId) ?? null : null),
    [historySelectedRunId, runsById],
  );
  const currentDeviceCaps = runtime?.device_capabilities?.[runtime.device];
  const effectiveTrainingDevice = resolveDeviceSelection(trainingForm.device, runtime);
  const selectedTrainingCaps = runtime?.device_capabilities?.[effectiveTrainingDevice];
  const recommendedTrainingPrecision = resolveRecommendedPrecision(trainingForm.device, runtime);
  const compareRuns = useMemo(() => runs.slice(0, 100), [runs]);

  const historyRuns = useMemo(() => {
    return runs.filter((run) => {
      if (historyFilters.modelId && run.model_id !== historyFilters.modelId) {
        return false;
      }
      if (historyFilters.mode && run.mode !== historyFilters.mode) {
        return false;
      }
      if (historyFilters.device && run.device !== historyFilters.device) {
        return false;
      }
      if (historyFilters.status && run.status !== historyFilters.status) {
        return false;
      }
      return true;
    });
  }, [historyFilters, runs]);

  const benchRows = useMemo<BenchRow[]>(() => {
    if (!benchJob) {
      return [];
    }
    return benchJob.runs.map((item) => {
      const run = runsById.get(item.run_id);
      return {
        scenario: item.scenario,
        runId: item.run_id,
        device: run?.device ?? benchJob.device,
        rtf: run ? metricValue(run.metrics.rtf, 3) : "-",
        metric:
          run && run.metrics.metric_name && run.metrics.metric_value !== undefined && run.metrics.metric_value !== null
            ? `${run.metrics.metric_name.toUpperCase()} ${metricValue(run.metrics.metric_value, 3)}`
            : "-",
        loraCheckpoint: item.lora_checkpoint ?? null,
      };
    });
  }, [benchJob, runsById]);

  const trainingDisabledReason = useMemo(() => {
    if (!selectedTrainingCaps?.supports_training) {
      return "当前设备不支持训练。CPU 仅提供推理能力。";
    }
    if (runtime?.busy_state.kind && !["idle", "training"].includes(runtime.busy_state.kind)) {
      return `当前设备正被 ${runtime.busy_state.kind} 任务占用。`;
    }
    return "";
  }, [runtime?.busy_state.kind, selectedTrainingCaps?.supports_training]);

  const trainingNotice = useMemo(() => {
    if (!selectedTrainingCaps?.supports_training) {
      return "Training 当前被禁用。切换到 CUDA 或 MPS 才能启动训练任务。";
    }
    if (effectiveTrainingDevice === "mps" && trainingForm.trainingMode === "full_ft") {
      return "MPS + Full FT 已开放，但仍按实验特性处理。推荐优先使用 LoRA + FP32。";
    }
    if (effectiveTrainingDevice === "mps") {
      return "MPS 训练默认建议 FP32。AMP 仅作为实验开关暴露，环境不支持时后端会直接报错。";
    }
    if (effectiveTrainingDevice.startsWith("cuda")) {
      return "CUDA 默认建议使用 AMP；如果要排查数值问题，可以手动切回 FP32。";
    }
    return "当前设备仅支持推理。";
  }, [effectiveTrainingDevice, selectedTrainingCaps?.supports_training, trainingForm.trainingMode]);

  useEffect(() => {
    void refreshAll();
    const interval = window.setInterval(() => {
      void refreshBackground();
    }, 4000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (models.length > 0 && !playground.modelId) {
      setPlayground((prev) => ({ ...prev, modelId: models[0].id }));
      setTrainingForm((prev) => ({ ...prev, modelId: models[0].id }));
    }
  }, [models, playground.modelId]);

  useEffect(() => {
    if (!leftRunId && compareRuns[0]) {
      setLeftRunId(compareRuns[0].id);
    }
    if (!rightRunId && compareRuns[1]) {
      setRightRunId(compareRuns[1].id);
    }
  }, [compareRuns, leftRunId, rightRunId]);

  useEffect(() => {
    if (historyRuns.length > 0 && !historyRuns.some((run) => run.id === historySelectedRunId)) {
      setHistorySelectedRunId(historyRuns[0].id);
    }
    if (historyRuns.length === 0) {
      setHistorySelectedRunId("");
    }
  }, [historyRuns, historySelectedRunId]);

  async function refreshAll() {
    await Promise.all([refreshRuntime(), refreshModels(), refreshRuns(), refreshTraining(), refreshBench()]);
  }

  async function refreshBackground() {
    await Promise.all([refreshRuntime(), refreshRuns(), refreshTraining(), refreshBench()]);
  }

  async function refreshRuntime() {
    const data = await fetchJson<RuntimeInfo>("/api/runtime");
    setRuntime(data);
  }

  async function refreshModels() {
    const data = await fetchJson<{ models: ModelInfo[]; lora_checkpoints: CheckpointInfo[] }>("/api/models");
    setModels(data.models);
    setCheckpoints(data.lora_checkpoints);
  }

  async function refreshRuns() {
    const data = await fetchJson<{ runs: RunRecord[] }>("/api/runs?limit=200");
    setRuns(data.runs);
  }

  async function refreshTraining() {
    const [status, logs] = await Promise.all([
      fetchJson<TrainingJob>("/api/train/status"),
      fetchJson<{ job_id: string | null; content: string }>("/api/train/logs"),
    ]);
    setTrainingStatus(status);
    setTrainingLogs(logs.content);
  }

  async function refreshBench() {
    if (!benchJob?.id) {
      return;
    }
    const next = await fetchJson<BenchJob>(`/api/bench/${benchJob.id}`);
    setBenchJob(next);
  }

  function updatePlayground<K extends keyof PlaygroundState>(key: K, value: PlaygroundState[K]) {
    setPlayground((prev) => ({ ...prev, [key]: value }));
  }

  function updateTraining<K extends keyof TrainingFormState>(key: K, value: TrainingFormState[K]) {
    setTrainingForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateHistoryFilters<K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) {
    setHistoryFilters((prev) => ({ ...prev, [key]: value }));
  }

  async function handlePromptTranscribe() {
    if (!referenceFile) {
      setStatusMessage("请先上传参考音频。");
      return;
    }
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", referenceFile);
      form.append("device", playground.device);
      const response = await fetchJson<{ text: string }>("/api/asr/transcribe", {
        method: "POST",
        body: form,
      });
      updatePlayground("promptText", response.text);
      setStatusMessage("ASR 转写完成，Prompt Text 已更新。");
    } catch (error) {
      setStatusMessage(`ASR 失败: ${formatError(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleRunInference() {
    if (!playground.modelId) {
      setStatusMessage("请先选择模型。");
      return;
    }
    setLoading(true);
    setStatusMessage(playground.streaming ? "正在进行流式推理..." : "正在生成音频...");
    setStreamEvents([]);
    try {
      if (playground.streaming) {
        const payload: Record<string, unknown> = {
          model_id: playground.modelId,
          device: playground.device,
          mode: playground.mode,
          text: playground.text,
          control_instruction: playground.controlInstruction,
          prompt_text: playground.promptText,
          normalize: playground.normalize,
          denoise: playground.denoise,
          cfg_value: playground.cfgValue,
          inference_timesteps: playground.inferenceTimesteps,
          lora_checkpoint: playground.loraCheckpoint || null,
        };
        if (referenceFile) {
          payload.reference_audio_base64 = await fileToBase64(referenceFile);
        }
        await openStreamingSession(payload);
      } else {
        const form = new FormData();
        form.append("model_id", playground.modelId);
        form.append("device", playground.device);
        form.append("mode", playground.mode);
        form.append("text", playground.text);
        form.append("control_instruction", playground.controlInstruction);
        form.append("prompt_text", playground.promptText);
        form.append("normalize", String(playground.normalize));
        form.append("denoise", String(playground.denoise));
        form.append("cfg_value", String(playground.cfgValue));
        form.append("inference_timesteps", String(playground.inferenceTimesteps));
        form.append("lora_checkpoint", playground.loraCheckpoint);
        if (referenceFile) {
          form.append("reference_audio", referenceFile);
        }
        const run = await fetchJson<RunRecord>("/api/infer/run", {
          method: "POST",
          body: form,
        });
        setLatestRun(run);
        setStatusMessage(`生成完成: ${run.id}`);
      }
      await refreshRuns();
      await refreshRuntime();
    } catch (error) {
      setStatusMessage(`推理失败: ${formatError(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function openStreamingSession(payload: Record<string, unknown>) {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${WS_BASE}/api/ws/infer-stream`);
      let settled = false;

      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        callback();
      };

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify(payload));
      });

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data) as {
          event: string;
          run?: RunRecord;
          detail?: string;
          chunk_index?: number;
        };
        if (message.event === "chunk") {
          setStreamEvents((prev) => [...prev.slice(-19), `chunk #${message.chunk_index}`]);
          return;
        }
        if (message.event === "completed" && message.run) {
          setLatestRun(message.run);
          setStatusMessage(`流式推理完成: ${message.run.id}`);
          finish(resolve);
          socket.close();
          return;
        }
        if (message.event === "error") {
          finish(() => reject(new Error(message.detail || "stream error")));
          socket.close();
        }
      });

      socket.addEventListener("error", () => {
        finish(() => reject(new Error("WebSocket 连接失败")));
      });

      socket.addEventListener("close", () => {
        if (!settled) {
          finish(() => reject(new Error("WebSocket 连接已关闭")));
        }
      });
    });
  }

  async function handleLoadModel() {
    if (!playground.modelId) {
      setStatusMessage("请先选择模型。");
      return;
    }
    setLoading(true);
    try {
      await fetchJson<ModelInfo>("/api/models/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: playground.modelId, device: playground.device }),
      });
      setStatusMessage("模型已加载。");
      await refreshRuntime();
    } catch (error) {
      setStatusMessage(`模型加载失败: ${formatError(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartBench() {
    if (!playground.modelId) {
      setStatusMessage("请先选择模型。");
      return;
    }
    const scenarios = Object.entries(benchScenarios)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);
    if (scenarios.length === 0) {
      setStatusMessage("Bench 至少需要一个场景。");
      return;
    }
    setLoading(true);
    try {
      const job = await fetchJson<BenchJob>("/api/bench/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: playground.modelId,
          device: playground.device,
          scenarios,
          lora_checkpoint: playground.loraCheckpoint || null,
        }),
      });
      setBenchJob(job);
      setStatusMessage(`Bench 已启动: ${job.id}`);
      await refreshRuntime();
    } catch (error) {
      setStatusMessage(`Bench 启动失败: ${formatError(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartTraining() {
    if (!trainingForm.modelId) {
      setStatusMessage("请先选择训练模型。");
      return;
    }
    if (!trainingForm.trainManifest) {
      setStatusMessage("train_manifest 不能为空。");
      return;
    }
    if (trainingDisabledReason) {
      setStatusMessage(trainingDisabledReason);
      return;
    }

    setLoading(true);
    try {
      const resolvedPrecision =
        trainingForm.precisionMode === "auto" ? recommendedTrainingPrecision : trainingForm.precisionMode;
      const job = await fetchJson<TrainingJob>("/api/train/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: trainingForm.modelId,
          training_mode: trainingForm.trainingMode,
          device: trainingForm.device,
          precision_mode: resolvedPrecision,
          train_manifest: trainingForm.trainManifest,
          val_manifest: trainingForm.valManifest,
          learning_rate: trainingForm.learningRate,
          batch_size: trainingForm.batchSize,
          num_iters: trainingForm.numIters,
          grad_accum_steps: trainingForm.gradAccumSteps,
          save_interval: trainingForm.saveInterval,
          lora_rank: trainingForm.loraRank,
          lora_alpha: trainingForm.loraAlpha,
          lora_dropout: trainingForm.loraDropout,
        }),
      });
      setTrainingStatus(job);
      setStatusMessage(`训练已启动: ${job.id}`);
      await Promise.all([refreshRuntime(), refreshTraining(), refreshModels()]);
    } catch (error) {
      setStatusMessage(`训练启动失败: ${formatError(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleStopTraining() {
    setLoading(true);
    try {
      await fetchJson<TrainingJob>("/api/train/stop", { method: "POST" });
      setStatusMessage("训练终止请求已发送。");
      await Promise.all([refreshTraining(), refreshRuntime()]);
    } catch (error) {
      setStatusMessage(`停止训练失败: ${formatError(error)}`);
    } finally {
      setLoading(false);
    }
  }

  function applyCheckpointToPlayground(checkpointId: string) {
    setPlayground((prev) => ({ ...prev, loraCheckpoint: checkpointId }));
    setTab("playground");
    setStatusMessage(`已选中 LoRA checkpoint: ${checkpointId}`);
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">VoxCPM Studio</p>
          <h1>本地推理 / 训练 / 对比 / 基准一体化工作台</h1>
          <p className="hero-copy">
            覆盖 VoxCPM2、V1.5、0.5B 与本地 LoRA。统一展示音频结果、Mel、ASR、CER/WER、RTF 和训练日志，兼容 CUDA 与 MPS。
          </p>
        </div>
        <div className="status-strip">
          <StatusItem label="当前设备" value={runtime?.device ?? "-"} />
          <StatusItem label="运行方式" value={runtime?.run_mode ?? "-"} />
          <StatusItem label="任务状态" value={runtime?.busy_state.kind ?? "idle"} />
          <StatusItem label="ASR 设备" value={runtime?.sensevoice_device ?? "-"} />
          <StatusItem label="训练能力" value={currentDeviceCaps?.supports_training ? "enabled" : "disabled"} />
          <StatusItem label="AMP" value={currentDeviceCaps?.supports_amp_training ? "available" : "fp32 only"} />
        </div>
      </header>

      <nav className="tabs">
        {[
          ["playground", "Playground"],
          ["compare", "Compare"],
          ["bench", "Bench"],
          ["training", "Training"],
          ["history", "History"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`tab-button ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key as TabKey)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="banner">
        <span>{statusMessage}</span>
        <div className="banner-actions">
          <button className="secondary-button" onClick={() => void refreshAll()} disabled={loading}>
            刷新
          </button>
          <button className="primary-button" onClick={() => void handleLoadModel()} disabled={loading || !playground.modelId}>
            预加载模型
          </button>
        </div>
      </div>

      {tab === "playground" ? (
        <section className="content-grid">
          <section className="panel form-panel">
            <div className="panel-header">
              <div>
                <h2>Playground</h2>
                <p>统一测试 design、可控克隆、极致克隆与流式推理。</p>
              </div>
            </div>

            {selectedModel ? (
              <div className="notes-block capability-grid">
                <div className="note-chip">{selectedModel.family}</div>
                <div className="note-chip">
                  reference_audio {selectedModel.capabilities.supports_reference_audio ? "enabled" : "disabled"}
                </div>
                <div className="note-chip">
                  voice_design {selectedModel.capabilities.supports_voice_design ? "enabled" : "disabled"}
                </div>
                <div className="note-chip">
                  streaming {selectedModel.capabilities.supports_streaming ? "enabled" : "disabled"}
                </div>
              </div>
            ) : null}

            <div className="form-grid">
              <label>
                模型
                <select value={playground.modelId} onChange={(event) => updatePlayground("modelId", event.target.value)}>
                  <option value="">请选择模型</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label} ({model.family})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                设备
                <select value={playground.device} onChange={(event) => updatePlayground("device", event.target.value)}>
                  <option value="auto">auto</option>
                  {runtime?.available_devices.map((device) => (
                    <option key={device} value={device}>
                      {device}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                LoRA
                <select value={playground.loraCheckpoint} onChange={(event) => updatePlayground("loraCheckpoint", event.target.value)}>
                  <option value="">不使用 LoRA</option>
                  {checkpoints.map((checkpoint) => (
                    <option key={checkpoint.id} value={checkpoint.id}>
                      {checkpoint.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                模式
                <select value={playground.mode} onChange={(event) => updatePlayground("mode", event.target.value as ModeKey)}>
                  <option value="design">design / zero-shot</option>
                  {selectedModel?.capabilities.supports_reference_audio ? <option value="controlled_clone">controlled_clone</option> : null}
                  {selectedModel?.capabilities.supports_prompt_text ? <option value="ultimate_clone">ultimate_clone</option> : null}
                </select>
              </label>
            </div>

            <label>
              目标文本
              <textarea value={playground.text} onChange={(event) => updatePlayground("text", event.target.value)} rows={4} />
            </label>

            <label>
              Control Instruction
              <textarea
                value={playground.controlInstruction}
                onChange={(event) => updatePlayground("controlInstruction", event.target.value)}
                rows={3}
                disabled={!selectedModel?.capabilities.supports_voice_design}
              />
            </label>

            <div className="two-column form-grid">
              <label>
                参考音频
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const file = event.target.files?.[0] ?? null;
                    setReferenceFile(file);
                  }}
                />
              </label>
              <label>
                Prompt Text
                <textarea
                  value={playground.promptText}
                  onChange={(event) => updatePlayground("promptText", event.target.value)}
                  rows={3}
                  disabled={!selectedModel?.capabilities.supports_prompt_text}
                />
              </label>
            </div>

            <div className="inline-actions">
              <button className="secondary-button" onClick={() => void handlePromptTranscribe()} disabled={!referenceFile || loading}>
                ASR 自动填充 Prompt Text
              </button>
            </div>

            <div className="form-grid compact">
              <label>
                CFG
                <input type="number" step="0.1" value={playground.cfgValue} onChange={(event) => updatePlayground("cfgValue", Number(event.target.value))} />
              </label>
              <label>
                推理步数
                <input type="number" min={1} value={playground.inferenceTimesteps} onChange={(event) => updatePlayground("inferenceTimesteps", Number(event.target.value))} />
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={playground.normalize} onChange={(event) => updatePlayground("normalize", event.target.checked)} />
                文本规范化
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={playground.denoise} onChange={(event) => updatePlayground("denoise", event.target.checked)} />
                参考音频增强
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={playground.streaming}
                  onChange={(event) => updatePlayground("streaming", event.target.checked)}
                  disabled={!selectedModel?.capabilities.supports_streaming}
                />
                流式生成
              </label>
            </div>

            <div className="inline-actions">
              <button className="primary-button" onClick={() => void handleRunInference()} disabled={loading}>
                {playground.streaming ? "开始流式推理" : "开始生成"}
              </button>
            </div>

            {playground.streaming ? (
              <div className="stream-log">
                <h4>Streaming Events</h4>
                {streamEvents.length > 0 ? streamEvents.map((event) => <div key={event}>{event}</div>) : <div className="empty-state small">暂无 chunk 事件</div>}
              </div>
            ) : null}
          </section>

          <RunViewer run={latestRun} title="Latest Result" />
        </section>
      ) : null}

      {tab === "compare" ? (
        <section className="content-grid compare-layout">
          <section className="panel form-panel">
            <div className="panel-header">
              <div>
                <h2>Compare</h2>
                <p>从历史结果中选两次运行，直接对比音频、Mel、ASR 与指标。</p>
              </div>
            </div>
            <div className="form-grid">
              <label>
                Left Run
                <select value={leftRunId} onChange={(event) => setLeftRunId(event.target.value)}>
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
                <select value={rightRunId} onChange={(event) => setRightRunId(event.target.value)}>
                  <option value="">请选择</option>
                  {compareRuns.map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.id} · {run.model_id} · {run.mode}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="alert-box">
              当前对比支持跨模型、跨 LoRA、跨设备查看。如果要对比新训练出的 LoRA，先到 Training 页确认 checkpoint，再回到这里从历史中选取运行结果。
            </div>
          </section>
          <div className="compare-results">
            <RunViewer run={leftRun} title="Left" />
            <RunViewer run={rightRun} title="Right" />
          </div>
        </section>
      ) : null}

      {tab === "bench" ? (
        <section className="content-grid">
          <section className="panel form-panel">
            <div className="panel-header">
              <div>
                <h2>Bench</h2>
                <p>批量跑固定场景集，快速比较模型、LoRA 与设备表现。</p>
              </div>
            </div>
            <div className="scenario-grid">
              {Object.keys(benchScenarios).map((scenario) => (
                <label key={scenario} className="checkbox">
                  <input
                    type="checkbox"
                    checked={benchScenarios[scenario]}
                    onChange={(event) => setBenchScenarios((prev) => ({ ...prev, [scenario]: event.target.checked }))}
                  />
                  {scenario}
                </label>
              ))}
            </div>
            <div className="inline-actions">
              <button className="primary-button" onClick={() => void handleStartBench()} disabled={loading || !playground.modelId}>
                启动 Bench
              </button>
            </div>
          </section>

          <section className="panel viewer-panel">
            <div className="panel-header">
              <div>
                <h3>Bench Result</h3>
                <p className="muted">{benchJob ? `${benchJob.id} · ${benchJob.status} · ${benchJob.device}` : "暂无 Bench 任务"}</p>
              </div>
            </div>
            {benchJob ? (
              <>
                {benchRows.length > 0 ? (
                  <div className="list-table">
                    {benchRows.map((row) => (
                      <div key={`${row.scenario}-${row.runId}`} className="list-row list-row-bench">
                        <span>{row.scenario}</span>
                        <code>{row.runId}</code>
                        <span>{row.device}</span>
                        <span>RTF {row.rtf}</span>
                        <span>{row.metric}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">Bench 任务已创建，等待结果写入。</div>
                )}
                {benchJob.skipped.length > 0 ? (
                  <div className="notes-block">
                    {benchJob.skipped.map((item) => (
                      <div key={`${item.scenario}-${item.reason}`} className="note-chip">
                        {item.scenario}: {item.reason}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty-state">暂无 Bench 结果</div>
            )}
          </section>
        </section>
      ) : null}

      {tab === "training" ? (
        <section className="content-grid">
          <section className="panel form-panel">
            <div className="panel-header">
              <div>
                <h2>Training</h2>
                <p>LoRA 为 MPS 正式路径，Full FT 在 MPS 下按实验特性展示。</p>
              </div>
            </div>

            <div className={`alert-box ${effectiveTrainingDevice === "mps" ? "alert-warning" : ""}`}>{trainingNotice}</div>
            {trainingDisabledReason ? <div className="alert-box alert-warning">{trainingDisabledReason}</div> : null}

            <div className="form-grid">
              <label>
                模型
                <select value={trainingForm.modelId} onChange={(event) => updateTraining("modelId", event.target.value)}>
                  <option value="">请选择模型</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                设备
                <select value={trainingForm.device} onChange={(event) => updateTraining("device", event.target.value)}>
                  <option value="auto">auto</option>
                  {runtime?.available_devices.map((device) => (
                    <option key={device} value={device}>
                      {device}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                训练模式
                <select value={trainingForm.trainingMode} onChange={(event) => updateTraining("trainingMode", event.target.value as "lora" | "full_ft")}>
                  <option value="lora">LoRA</option>
                  <option value="full_ft">Full FT (experimental on MPS)</option>
                </select>
              </label>
              <label>
                精度
                <select value={trainingForm.precisionMode} onChange={(event) => updateTraining("precisionMode", event.target.value as "auto" | "fp32" | "amp")}>
                  <option value="auto">auto (recommended: {recommendedTrainingPrecision})</option>
                  <option value="fp32">fp32</option>
                  <option value="amp" disabled={!selectedTrainingCaps?.supports_amp_training}>
                    amp
                  </option>
                </select>
              </label>
              <label>
                train_manifest
                <input value={trainingForm.trainManifest} onChange={(event) => updateTraining("trainManifest", event.target.value)} />
              </label>
              <label>
                val_manifest
                <input value={trainingForm.valManifest} onChange={(event) => updateTraining("valManifest", event.target.value)} />
              </label>
              <label>
                learning_rate
                <input type="number" step="0.00001" value={trainingForm.learningRate} onChange={(event) => updateTraining("learningRate", Number(event.target.value))} />
              </label>
              <label>
                batch_size
                <input type="number" value={trainingForm.batchSize} onChange={(event) => updateTraining("batchSize", Number(event.target.value))} />
              </label>
              <label>
                num_iters
                <input type="number" value={trainingForm.numIters} onChange={(event) => updateTraining("numIters", Number(event.target.value))} />
              </label>
              <label>
                grad_accum_steps
                <input type="number" value={trainingForm.gradAccumSteps} onChange={(event) => updateTraining("gradAccumSteps", Number(event.target.value))} />
              </label>
              <label>
                save_interval
                <input type="number" value={trainingForm.saveInterval} onChange={(event) => updateTraining("saveInterval", Number(event.target.value))} />
              </label>
              {trainingForm.trainingMode === "lora" ? (
                <>
                  <label>
                    lora_rank
                    <input type="number" value={trainingForm.loraRank} onChange={(event) => updateTraining("loraRank", Number(event.target.value))} />
                  </label>
                  <label>
                    lora_alpha
                    <input type="number" value={trainingForm.loraAlpha} onChange={(event) => updateTraining("loraAlpha", Number(event.target.value))} />
                  </label>
                  <label>
                    lora_dropout
                    <input type="number" step="0.05" value={trainingForm.loraDropout} onChange={(event) => updateTraining("loraDropout", Number(event.target.value))} />
                  </label>
                </>
              ) : null}
            </div>

            <div className="inline-actions">
              <button className="primary-button" onClick={() => void handleStartTraining()} disabled={loading || Boolean(trainingDisabledReason)}>
                启动训练
              </button>
              <button className="secondary-button" onClick={() => void handleStopTraining()} disabled={loading || trainingStatus?.status !== "running"}>
                停止训练
              </button>
            </div>
          </section>

          <section className="panel viewer-panel">
            <div className="panel-header">
              <div>
                <h3>Training Status</h3>
                <p className="muted">{trainingStatus?.id ? `${trainingStatus.id} · ${trainingStatus.status}` : "暂无训练任务"}</p>
              </div>
              {trainingStatus?.experimental ? <span className="badge badge-warning">experimental</span> : null}
            </div>
            <div className="metrics-grid">
              <MetricCard label="设备" value={trainingStatus?.device ?? "-"} />
              <MetricCard label="模式" value={trainingStatus?.training_mode ?? "-"} />
              <MetricCard label="精度" value={trainingStatus?.precision_mode ?? "-"} />
              <MetricCard label="任务状态" value={trainingStatus?.status ?? "-"} />
              <MetricCard label="当前忙碌" value={trainingStatus?.busy ? "yes" : "no"} />
              <MetricCard label="推荐精度" value={recommendedTrainingPrecision} />
            </div>
            <TextBlock title="输出目录" value={trainingStatus?.output_dir ?? "-"} />
            <div className="text-block">
              <h4>实时日志</h4>
              <pre className="log-viewer">{trainingLogs || "暂无日志"}</pre>
            </div>
          </section>

          <section className="panel viewer-panel">
            <div className="panel-header">
              <div>
                <h3>Checkpoint Gallery</h3>
                <p className="muted">新训练出的 LoRA 会自动出现在这里，可直接回流到 Playground。</p>
              </div>
            </div>
            {checkpoints.length > 0 ? (
              <div className="list-table">
                {checkpoints.map((checkpoint) => (
                  <div key={checkpoint.id} className="list-row list-row-checkpoint">
                    <span>{checkpoint.label}</span>
                    <span>{checkpoint.base_model ?? "-"}</span>
                    <span>{checkpoint.origin}</span>
                    <button className="secondary-button small-button" onClick={() => applyCheckpointToPlayground(checkpoint.id)}>
                      送到 Playground
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">还没有可用的 LoRA checkpoint。</div>
            )}
          </section>
        </section>
      ) : null}

      {tab === "history" ? (
        <section className="content-grid">
          <section className="panel form-panel">
            <div className="panel-header">
              <div>
                <h2>History</h2>
                <p>所有推理结果保留在本地，可按模型、模式、设备和状态过滤。</p>
              </div>
            </div>
            <div className="form-grid">
              <label>
                模型
                <select value={historyFilters.modelId} onChange={(event) => updateHistoryFilters("modelId", event.target.value)}>
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
                <select value={historyFilters.mode} onChange={(event) => updateHistoryFilters("mode", event.target.value)}>
                  <option value="">全部模式</option>
                  {Array.from(new Set(runs.map((run) => run.mode))).map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                设备
                <select value={historyFilters.device} onChange={(event) => updateHistoryFilters("device", event.target.value)}>
                  <option value="">全部设备</option>
                  {Array.from(new Set(runs.map((run) => run.device))).map((device) => (
                    <option key={device} value={device}>
                      {device}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                状态
                <select value={historyFilters.status} onChange={(event) => updateHistoryFilters("status", event.target.value)}>
                  <option value="">全部状态</option>
                  {Array.from(new Set(runs.map((run) => run.status))).map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="inline-actions">
              <button className="secondary-button" onClick={() => setHistoryFilters(defaultHistoryFilters)}>
                清空筛选
              </button>
            </div>
            <div className="list-table history-list">
              {historyRuns.map((run) => (
                <button key={run.id} className={`history-item ${historySelectedRunId === run.id ? "selected" : ""}`} onClick={() => setHistorySelectedRunId(run.id)}>
                  <span>{run.id}</span>
                  <span>{run.model_id}</span>
                  <span>{run.mode}</span>
                  <span>{run.device}</span>
                </button>
              ))}
              {historyRuns.length === 0 ? <div className="empty-state small">当前筛选条件下没有结果。</div> : null}
            </div>
          </section>
          <RunViewer run={historyRun} title="History Detail" />
        </section>
      ) : null}
    </div>
  );
}
