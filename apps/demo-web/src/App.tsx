import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Cpu, Database, Gauge, Loader2, RefreshCw, Server, Settings2, Sparkles, Zap } from "lucide-react";

import { BenchJob, CheckpointInfo, ModelInfo, RunRecord, RuntimeInfo, TrainingJob } from "./types";
import {
  BannerTone,
  BenchRow,
  defaultHistoryFilters,
  defaultPlaygroundState,
  defaultTrainingState,
  HistoryFilters,
  PlaygroundState,
  StreamEventItem,
  tabMeta,
  TabKey,
  TrainingFormState,
} from "./workbench";
import {
  WS_BASE,
  fetchJson,
  formatError,
  isBackendFeatureGap,
  metricValue,
  resolveDeviceSelection,
  resolveRecommendedPrecision,
  summarizeSettled,
  toBannerToneClass,
} from "./utils";
import { EmptyState, IconButton, SectionCard, StatChip, StatusPill, Toolbar } from "./components/primitives";
import { RunViewer } from "./components/RunViewer";
import { PlaygroundPanel } from "./panels/PlaygroundPanel";
import { ComparePanel } from "./panels/ComparePanel";
import { BenchPanel } from "./panels/BenchPanel";
import { TrainingPanel } from "./panels/TrainingPanel";
import { HistoryPanel } from "./panels/HistoryPanel";

function nextStreamEventId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function initialTab(): TabKey {
  const hash = window.location.hash.replace("#", "");
  return tabMeta.some((item) => item.key === hash) ? (hash as TabKey) : "playground";
}

export default function App() {
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    playground: null,
    compare: null,
    bench: null,
    training: null,
    history: null,
  });
  const [tab, setTab] = useState<TabKey>(() => initialTab());
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
  const [banner, setBanner] = useState<{ tone: BannerTone; message: string }>({
    tone: "idle",
    message: "工作台已就绪。现在可以加载模型、发起生成或查看历史结果。",
  });
  const [streamEvents, setStreamEvents] = useState<StreamEventItem[]>([]);
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

  const deferredHistoryFilters = useDeferredValue(historyFilters);
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
  const effectiveTrainingDevice = resolveDeviceSelection(trainingForm.device, runtime);
  const selectedTrainingCaps = runtime?.device_capabilities?.[effectiveTrainingDevice];
  const recommendedTrainingPrecision = resolveRecommendedPrecision(trainingForm.device, runtime);
  const compareRuns = useMemo(() => runs.slice(0, 100), [runs]);

  const historyRuns = useMemo(() => {
    return runs.filter((run) => {
      if (deferredHistoryFilters.modelId && run.model_id !== deferredHistoryFilters.modelId) {
        return false;
      }
      if (deferredHistoryFilters.mode && run.mode !== deferredHistoryFilters.mode) {
        return false;
      }
      if (deferredHistoryFilters.device && run.device !== deferredHistoryFilters.device) {
        return false;
      }
      if (deferredHistoryFilters.status && run.status !== deferredHistoryFilters.status) {
        return false;
      }
      return true;
    });
  }, [deferredHistoryFilters, runs]);

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
    void refreshAll({ announce: false });
    const interval = window.setInterval(() => {
      void refreshBackground();
    }, 4000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      setTab(initialTab());
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
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

  useEffect(() => {
    const activeTabButton = tabRefs.current[tab];
    activeTabButton?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
    if (window.location.hash.replace("#", "") !== tab) {
      window.history.replaceState(null, "", `#${tab}`);
    }
  }, [tab]);

  function updatePlayground<K extends keyof PlaygroundState>(key: K, value: PlaygroundState[K]) {
    setPlayground((prev) => ({ ...prev, [key]: value }));
  }

  function updateTraining<K extends keyof TrainingFormState>(key: K, value: TrainingFormState[K]) {
    setTrainingForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateHistoryFilters<K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) {
    setHistoryFilters((prev) => ({ ...prev, [key]: value }));
  }

  async function refreshAll({ announce = true }: { announce?: boolean } = {}) {
    if (announce) {
      setBanner({ tone: "loading", message: "正在同步工作台状态..." });
    }
    const results = await Promise.allSettled([refreshRuntime(), refreshModels(), refreshRuns(), refreshTraining(), refreshBench()]);
    const summary = summarizeSettled(results);
    if (summary) {
      setBanner({ tone: "error", message: `刷新失败: ${summary}` });
      return;
    }
    if (announce) {
      setBanner({ tone: "success", message: "工作台数据已刷新。" });
    }
  }

  async function refreshBackground() {
    const results = await Promise.allSettled([refreshRuntime(), refreshRuns(), refreshTraining(), refreshBench()]);
    const summary = summarizeSettled(results);
    if (summary) {
      setBanner((prev) => (prev.tone === "loading" ? prev : { tone: "busy", message: "后台同步遇到异常，请手动刷新以确认状态。" }));
    }
  }

  async function refreshRuntime() {
    const data = await fetchJson<RuntimeInfo>("/api/runtime");
    startTransition(() => setRuntime(data));
  }

  async function refreshModels() {
    const data = await fetchJson<{ models: ModelInfo[]; lora_checkpoints: CheckpointInfo[] }>("/api/models");
    startTransition(() => {
      setModels(data.models);
      setCheckpoints(data.lora_checkpoints);
    });
  }

  async function refreshRuns() {
    const data = await fetchJson<{ runs: RunRecord[] }>("/api/runs?limit=200");
    startTransition(() => setRuns(data.runs));
  }

  async function refreshTraining() {
    try {
      const [status, logs] = await Promise.all([
        fetchJson<TrainingJob>("/api/train/status"),
        fetchJson<{ job_id: string | null; content: string }>("/api/train/logs"),
      ]);
      startTransition(() => {
        setTrainingStatus(status);
        setTrainingLogs(logs.content);
      });
    } catch (error) {
      if (!isBackendFeatureGap(error)) {
        throw error;
      }
      startTransition(() => {
        setTrainingStatus(null);
        setTrainingLogs("");
      });
    }
  }

  async function refreshBench() {
    if (!benchJob?.id) {
      return;
    }
    const next = await fetchJson<BenchJob>(`/api/bench/${benchJob.id}`);
    startTransition(() => setBenchJob(next));
  }

  async function handlePromptTranscribe() {
    if (!referenceFile) {
      setBanner({ tone: "error", message: "请先上传参考音频。" });
      return;
    }
    setLoading(true);
    setBanner({ tone: "loading", message: "正在做 ASR 转写并填充 Prompt Text..." });
    try {
      const form = new FormData();
      form.append("file", referenceFile);
      form.append("device", playground.device);
      const response = await fetchJson<{ text: string }>("/api/asr/transcribe", {
        method: "POST",
        body: form,
      });
      updatePlayground("promptText", response.text);
      setBanner({ tone: "success", message: "ASR 转写完成，Prompt Text 已更新。" });
    } catch (error) {
      setBanner({ tone: "error", message: `ASR 失败: ${formatError(error)}` });
    } finally {
      setLoading(false);
    }
  }

  async function handleRunInference() {
    if (!playground.modelId) {
      setBanner({ tone: "error", message: "请先选择模型。" });
      return;
    }

    setLoading(true);
    setBanner({
      tone: playground.streaming ? "busy" : "loading",
      message: playground.streaming ? "正在进行流式推理..." : "正在生成音频...",
    });
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
        setBanner({ tone: "success", message: `生成完成: ${run.id}` });
      }
      await Promise.allSettled([refreshRuns(), refreshRuntime()]);
    } catch (error) {
      setBanner({ tone: "error", message: `推理失败: ${formatError(error)}` });
      setStreamEvents((prev) => [
        ...prev.slice(-9),
        {
          id: nextStreamEventId(),
          tone: "error",
          label: "推理失败",
          detail: formatError(error),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function openStreamingSession(payload: Record<string, unknown>) {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${WS_BASE}/api/ws/infer-stream`);
      finishStreamingSocket(socket, payload, {
        onChunk: (label, detail) => {
          setStreamEvents((prev) => [
            ...prev.slice(-11),
            {
              id: nextStreamEventId(),
              tone: "chunk",
              label,
              detail,
            },
          ]);
        },
        onSuccess: (run) => {
          setLatestRun(run);
          setStreamEvents((prev) => [
            ...prev.slice(-11),
            {
              id: nextStreamEventId(),
              tone: "success",
              label: "流式推理完成",
              detail: run.id,
            },
          ]);
          setBanner({ tone: "success", message: `流式推理完成: ${run.id}` });
          resolve();
        },
        onError: (message) => {
          setStreamEvents((prev) => [
            ...prev.slice(-11),
            {
              id: nextStreamEventId(),
              tone: "error",
              label: "流式推理失败",
              detail: message,
            },
          ]);
          reject(new Error(message));
        },
      });
    });
  }

  async function handleLoadModel() {
    if (!playground.modelId) {
      setBanner({ tone: "error", message: "请先选择模型。" });
      return;
    }
    setLoading(true);
    setBanner({ tone: "loading", message: "正在预加载模型..." });
    try {
      await fetchJson<ModelInfo>("/api/models/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: playground.modelId, device: playground.device }),
      });
      setBanner({ tone: "success", message: "模型已加载。" });
      await refreshRuntime();
    } catch (error) {
      setBanner({ tone: "error", message: `模型加载失败: ${formatError(error)}` });
    } finally {
      setLoading(false);
    }
  }

  async function handleStartBench() {
    if (!playground.modelId) {
      setBanner({ tone: "error", message: "请先选择模型。" });
      return;
    }
    const scenarios = Object.entries(benchScenarios)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);
    if (scenarios.length === 0) {
      setBanner({ tone: "error", message: "Bench 至少需要一个场景。" });
      return;
    }
    setLoading(true);
    setBanner({ tone: "loading", message: "正在启动 Bench 任务..." });
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
      setBanner({ tone: "success", message: `Bench 已启动: ${job.id}` });
      await refreshRuntime();
    } catch (error) {
      setBanner({ tone: "error", message: `Bench 启动失败: ${formatError(error)}` });
    } finally {
      setLoading(false);
    }
  }

  async function handleStartTraining() {
    if (!trainingForm.modelId) {
      setBanner({ tone: "error", message: "请先选择训练模型。" });
      return;
    }
    if (!trainingForm.trainManifest) {
      setBanner({ tone: "error", message: "train_manifest 不能为空。" });
      return;
    }
    if (trainingDisabledReason) {
      setBanner({ tone: "error", message: trainingDisabledReason });
      return;
    }

    setLoading(true);
    setBanner({ tone: "loading", message: "正在启动训练任务..." });
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
      setBanner({ tone: "success", message: `训练已启动: ${job.id}` });
      await Promise.allSettled([refreshRuntime(), refreshTraining(), refreshModels()]);
    } catch (error) {
      setBanner({ tone: "error", message: `训练启动失败: ${formatError(error)}` });
    } finally {
      setLoading(false);
    }
  }

  async function handleStopTraining() {
    setLoading(true);
    setBanner({ tone: "loading", message: "正在发送停止训练请求..." });
    try {
      await fetchJson<TrainingJob>("/api/train/stop", { method: "POST" });
      setBanner({ tone: "success", message: "训练终止请求已发送。" });
      await Promise.allSettled([refreshTraining(), refreshRuntime()]);
    } catch (error) {
      setBanner({ tone: "error", message: `停止训练失败: ${formatError(error)}` });
    } finally {
      setLoading(false);
    }
  }

  function applyCheckpointToPlayground(checkpointId: string) {
    setPlayground((prev) => ({ ...prev, loraCheckpoint: checkpointId }));
    setTab("playground");
    setBanner({ tone: "success", message: `已选中 LoRA checkpoint: ${checkpointId}` });
  }

  function reuseRunInPlayground(run: RunRecord) {
    setPlayground((prev) => ({
      ...prev,
      modelId: run.model_id,
      device: run.request.device || run.device,
      mode: (run.mode as PlaygroundState["mode"]) || prev.mode,
      text: run.request.text || run.request.resolved_text,
      controlInstruction: run.request.control_instruction,
      promptText: run.request.prompt_text ?? "",
      cfgValue: run.request.cfg_value,
      inferenceTimesteps: run.request.inference_timesteps,
      normalize: run.request.normalize,
      denoise: run.request.denoise,
      loraCheckpoint: run.request.lora_checkpoint ?? "",
    }));
    setTab("playground");
    setBanner({ tone: "success", message: `已复用运行参数: ${run.id}` });
  }

  function sendRunsToCompare(leftId: string, rightId: string) {
    setLeftRunId(leftId);
    setRightRunId(rightId);
    setTab("compare");
    setBanner({ tone: "success", message: `已送入 Compare: ${leftId} / ${rightId}` });
  }

  function sendRunToCompare(run: RunRecord) {
    setLeftRunId((prev) => (prev && prev !== run.id ? prev : compareRuns.find((item) => item.id !== run.id)?.id ?? run.id));
    setRightRunId(run.id);
    setTab("compare");
    setBanner({ tone: "success", message: `已送入 Compare: ${run.id}` });
  }

  const activeTab = tabMeta.find((item) => item.key === tab) ?? tabMeta[0];
  const busyKind = runtime?.busy_state.kind ?? "idle";
  const busyTone = busyKind === "idle" ? "neutral" : busyKind === "training" ? "warning" : "info";
  const activeTaskLabel = runtime?.busy_state.task_id ?? (busyKind === "idle" ? "no active task" : "task pending");

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="command-header">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Sparkles size={18} />
          </div>
          <div>
            <p className="section-eyebrow">VoxCPM Studio</p>
            <h1>本地语音实验控制台</h1>
            <p>{activeTab.eyebrow} / {activeTab.caption}</p>
          </div>
        </div>

        <div className="runtime-strip" aria-label="Runtime summary">
          <StatChip label="设备" value={runtime?.device ?? "-"} hint={runtime?.run_mode ?? "runtime"} tone="info" />
          <StatChip label="Busy" value={busyKind} hint={activeTaskLabel} tone={busyTone} pulse={busyKind !== "idle"} />
          <StatChip label="模型" value={runtime?.active_model?.label ?? "未加载"} hint={runtime?.active_model?.family ?? selectedModel?.family ?? "model idle"} />
          <StatChip label="ASR" value={runtime?.sensevoice_device ?? "-"} hint="speech bridge" />
        </div>

        <Toolbar className="command-actions">
          <IconButton label="刷新工作台" onClick={() => void refreshAll()} disabled={loading}>
            <RefreshCw size={18} className={loading ? "is-spinning" : ""} />
          </IconButton>
          <IconButton label="预加载模型" onClick={() => void handleLoadModel()} disabled={loading || !playground.modelId}>
            <Zap size={18} />
          </IconButton>
          <IconButton label="设置入口暂未开放" disabled>
            <Settings2 size={18} />
          </IconButton>
        </Toolbar>
      </header>

      <div className="sticky-command-bar">
        <nav className="tab-rail" aria-label="Workspace navigation">
          {tabMeta.map((item) => (
            <button
              key={item.key}
              ref={(node) => {
                tabRefs.current[item.key] = node;
              }}
              className={`tab-rail-button ${tab === item.key ? "is-active" : ""}`}
              onClick={() => setTab(item.key)}
            >
              <span className="tab-rail-icon">
                {item.key === "playground" ? <Activity size={16} /> : null}
                {item.key === "compare" ? <Gauge size={16} /> : null}
                {item.key === "bench" ? <Server size={16} /> : null}
                {item.key === "training" ? <Cpu size={16} /> : null}
                {item.key === "history" ? <Database size={16} /> : null}
              </span>
              <span>{item.label}</span>
              <small>{item.caption}</small>
            </button>
          ))}
        </nav>

        <section className={`task-banner ${toBannerToneClass(banner.tone)}`}>
          <div>
            <p className="section-eyebrow">Workspace Status</p>
            <strong>{banner.message}</strong>
            <span>
              {models.length} models / {checkpoints.length} LoRA / {runs.length} runs
            </span>
          </div>
          <Toolbar>
            <button className="button button-secondary" onClick={() => void refreshAll()} disabled={loading}>
              {loading ? <Loader2 size={16} className="is-spinning" /> : <RefreshCw size={16} />}
              刷新
            </button>
            <button className="button button-primary" onClick={() => void handleLoadModel()} disabled={loading || !playground.modelId}>
              <Zap size={16} />
              预加载模型
            </button>
          </Toolbar>
        </section>
      </div>

      <main id="main-content" className="workspace-frame">
        {tab === "playground" ? (
          <div className="workspace-fade workspace-grid workspace-grid-playground">
            <PlaygroundPanel
              models={models}
              checkpoints={checkpoints}
              runtime={runtime}
              selectedModel={selectedModel}
              playground={playground}
              referenceFileName={referenceFile?.name ?? ""}
              streamEvents={streamEvents}
              loading={loading}
              onPlaygroundChange={updatePlayground}
              onReferenceFileChange={setReferenceFile}
              onPromptTranscribe={() => void handlePromptTranscribe()}
              onRunInference={() => void handleRunInference()}
            />
            <RunViewer
              run={latestRun}
              title="Latest Result"
              description="右侧保持最新生成结果，便于边调参数边听边看指标。"
              onReuse={reuseRunInPlayground}
              onCompare={sendRunToCompare}
            />
          </div>
        ) : null}

        {tab === "compare" ? (
          <div className="workspace-fade">
            <ComparePanel
              compareRuns={compareRuns}
              leftRunId={leftRunId}
              rightRunId={rightRunId}
              leftRun={leftRun}
              rightRun={rightRun}
              onSelectLeft={setLeftRunId}
              onSelectRight={setRightRunId}
            />
          </div>
        ) : null}

        {tab === "bench" ? (
          <div className="workspace-fade">
            <BenchPanel
              benchJob={benchJob}
              benchRows={benchRows}
              benchScenarios={benchScenarios}
              loading={loading}
              selectedModelLabel={selectedModel?.label ?? ""}
              selectedDevice={playground.device}
              selectedLora={playground.loraCheckpoint}
              onScenarioToggle={(scenario, checked) => setBenchScenarios((prev) => ({ ...prev, [scenario]: checked }))}
              onStartBench={() => void handleStartBench()}
            />
          </div>
        ) : null}

        {tab === "training" ? (
          <div className="workspace-fade">
            <TrainingPanel
              models={models}
              runtime={runtime}
              checkpoints={checkpoints}
              trainingForm={trainingForm}
              trainingStatus={trainingStatus}
              trainingLogs={trainingLogs}
              loading={loading}
              trainingDisabledReason={trainingDisabledReason}
              trainingNotice={trainingNotice}
              effectiveTrainingDevice={effectiveTrainingDevice}
              recommendedTrainingPrecision={recommendedTrainingPrecision}
              selectedTrainingCaps={selectedTrainingCaps}
              onTrainingChange={updateTraining}
              onStartTraining={() => void handleStartTraining()}
              onStopTraining={() => void handleStopTraining()}
              onApplyCheckpoint={applyCheckpointToPlayground}
            />
          </div>
        ) : null}

        {tab === "history" ? (
          <div className="workspace-fade">
            <HistoryPanel
              models={models}
              runs={runs}
              historyFilters={historyFilters}
              historyRuns={historyRuns}
              historySelectedRunId={historySelectedRunId}
              historyRun={historyRun}
              onHistoryFilterChange={updateHistoryFilters}
              onResetFilters={() => setHistoryFilters(defaultHistoryFilters)}
              onSelectRun={setHistorySelectedRunId}
              onCompareRuns={sendRunsToCompare}
              onReuseRun={reuseRunInPlayground}
            />
          </div>
        ) : null}

        {models.length === 0 && !loading ? (
          <SectionCard
            eyebrow="Empty Workspace"
            title="还没有检测到模型"
            description="先确认后端已启动且 models 目录中存在可扫描模型，再从顶部刷新同步。"
            className="viewer-card"
          >
            <EmptyState title="工作台等待数据源" description="当前页面已经完成重构，但前端仍完全依赖现有后端契约与本地模型清单。" />
          </SectionCard>
        ) : null}
      </main>
    </div>
  );
}

function finishStreamingSocket(
  socket: WebSocket,
  payload: Record<string, unknown>,
  callbacks: {
    onChunk: (label: string, detail: string) => void;
    onSuccess: (run: RunRecord) => void;
    onError: (message: string) => void;
  },
) {
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
      callbacks.onChunk(`Chunk #${message.chunk_index ?? "?"}`, "音频片段已接收并写入时间线。");
      return;
    }

    if (message.event === "completed" && message.run) {
      finish(() => callbacks.onSuccess(message.run as RunRecord));
      socket.close();
      return;
    }

    if (message.event === "error") {
      finish(() => callbacks.onError(message.detail || "stream error"));
      socket.close();
    }
  });

  socket.addEventListener("error", () => {
    finish(() => callbacks.onError("WebSocket 连接失败"));
  });

  socket.addEventListener("close", () => {
    if (!settled) {
      finish(() => callbacks.onError("WebSocket 连接已关闭"));
    }
  });
}
