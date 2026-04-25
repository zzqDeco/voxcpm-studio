import { Activity, FileAudio, Play, Radio, Wand2 } from "lucide-react";

import { CheckpointInfo, ModelInfo, RuntimeInfo } from "../types";
import { FieldUpdater, modeLabels, PlaygroundState, StreamEventItem } from "../workbench";
import {
  EmptyState,
  FileDropzone,
  MetricTile,
  SectionCard,
  SegmentedControl,
  SliderInput,
  StatusPill,
  Toolbar,
} from "../components/primitives";

function capabilityChips(model: ModelInfo | null) {
  if (!model) {
    return [];
  }
  return [
    { label: model.family, tone: "neutral" as const },
    { label: "reference audio", tone: model.capabilities.supports_reference_audio ? ("success" as const) : ("neutral" as const) },
    { label: "voice design", tone: model.capabilities.supports_voice_design ? ("success" as const) : ("neutral" as const) },
    { label: "prompt text", tone: model.capabilities.supports_prompt_text ? ("success" as const) : ("neutral" as const) },
    { label: "streaming", tone: model.capabilities.supports_streaming ? ("success" as const) : ("neutral" as const) },
    { label: "lora", tone: model.capabilities.supports_lora ? ("success" as const) : ("neutral" as const) },
  ];
}

export function PlaygroundPanel({
  models,
  checkpoints,
  runtime,
  selectedModel,
  playground,
  referenceFileName,
  streamEvents,
  loading,
  onPlaygroundChange,
  onReferenceFileChange,
  onPromptTranscribe,
  onRunInference,
}: {
  models: ModelInfo[];
  checkpoints: CheckpointInfo[];
  runtime: RuntimeInfo | null;
  selectedModel: ModelInfo | null;
  playground: PlaygroundState;
  referenceFileName: string;
  streamEvents: StreamEventItem[];
  loading: boolean;
  onPlaygroundChange: FieldUpdater<PlaygroundState>;
  onReferenceFileChange: (file: File | null) => void;
  onPromptTranscribe: () => void;
  onRunInference: () => void;
}) {
  const chips = capabilityChips(selectedModel);
  const chunkCount = streamEvents.filter((event) => event.tone === "chunk").length;
  const lastStreamEvent = streamEvents[streamEvents.length - 1];

  return (
    <SectionCard
      eyebrow="Inference Lab"
      title="Compose -> Generate -> Inspect"
      description="把模型、模式、音色条件和推理配方收束到同一控制面板，减少生成前后的上下文切换。"
      className="form-card playground-control-card"
    >
      <div className="workflow-steps" aria-label="Playground workflow">
        <span className="workflow-step is-active">
          <Wand2 size={16} />
          Compose
        </span>
        <span className={loading ? "workflow-step is-active" : "workflow-step"}>
          <Play size={16} />
          Generate
        </span>
        <span className={streamEvents.length > 0 ? "workflow-step is-active" : "workflow-step"}>
          <Activity size={16} />
          Inspect
        </span>
      </div>

      {chips.length > 0 ? (
        <div className="chip-row">
          {chips.map((chip) => (
            <StatusPill key={chip.label} tone={chip.tone}>
              {chip.label}
            </StatusPill>
          ))}
        </div>
      ) : null}

      <div className="field-group-grid">
        <fieldset className="field-group">
          <legend>01 Model + Mode</legend>
          <div className="field-grid two-columns">
            <label>
              模型
              <select value={playground.modelId} onChange={(event) => onPlaygroundChange("modelId", event.target.value)}>
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
              <select value={playground.device} onChange={(event) => onPlaygroundChange("device", event.target.value)}>
                <option value="auto">auto</option>
                {runtime?.available_devices.map((device) => (
                  <option key={device} value={device}>
                    {device}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <SegmentedControl
            label="生成模式"
            value={playground.mode}
            onChange={(value) => onPlaygroundChange("mode", value)}
            options={[
              { value: "design", label: "Design", hint: modeLabels.design },
              {
                value: "controlled_clone",
                label: "Controlled",
                hint: "reference audio",
                disabled: !selectedModel?.capabilities.supports_reference_audio,
              },
              {
                value: "ultimate_clone",
                label: "Ultimate",
                hint: "prompt text",
                disabled: !selectedModel?.capabilities.supports_prompt_text,
              },
            ]}
          />

          <label>
            LoRA checkpoint
            <select value={playground.loraCheckpoint} onChange={(event) => onPlaygroundChange("loraCheckpoint", event.target.value)}>
              <option value="">不使用 LoRA</option>
              {checkpoints.map((checkpoint) => (
                <option key={checkpoint.id} value={checkpoint.id}>
                  {checkpoint.label}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset className="field-group">
          <legend>02 Text + Voice</legend>
          <label>
            目标文本
            <textarea value={playground.text} onChange={(event) => onPlaygroundChange("text", event.target.value)} rows={5} />
          </label>
          <label>
            Control Instruction
            <textarea
              value={playground.controlInstruction}
              onChange={(event) => onPlaygroundChange("controlInstruction", event.target.value)}
              rows={3}
              disabled={!selectedModel?.capabilities.supports_voice_design}
            />
          </label>
        </fieldset>

        <fieldset className="field-group">
          <legend>03 Reference + Prompt</legend>
          <div className="field-grid two-columns">
            <FileDropzone label="Reference Audio" fileName={referenceFileName} accept="audio/*" onChange={onReferenceFileChange} />
            <label>
              Prompt Text
              <textarea
                value={playground.promptText}
                onChange={(event) => onPlaygroundChange("promptText", event.target.value)}
                rows={5}
                disabled={!selectedModel?.capabilities.supports_prompt_text}
              />
            </label>
          </div>
          <Toolbar className="toolbar-spacious">
            <button className="button button-secondary" type="button" onClick={onPromptTranscribe} disabled={!referenceFileName || loading}>
              <FileAudio size={16} />
              ASR 自动填充 Prompt
            </button>
            <StatusPill tone={referenceFileName ? "success" : "neutral"}>{referenceFileName || "未上传参考音频"}</StatusPill>
          </Toolbar>
        </fieldset>

        <fieldset className="field-group">
          <legend>04 Recipe</legend>
          <div className="recipe-grid">
            <SliderInput label="CFG" value={playground.cfgValue} min={0} max={5} step={0.1} onChange={(value) => onPlaygroundChange("cfgValue", value)} />
            <SliderInput
              label="推理步数"
              value={playground.inferenceTimesteps}
              min={1}
              max={50}
              step={1}
              onChange={(value) => onPlaygroundChange("inferenceTimesteps", value)}
            />
          </div>
          <div className="toggle-row">
            <label className="toggle-field">
              <input type="checkbox" checked={playground.normalize} onChange={(event) => onPlaygroundChange("normalize", event.target.checked)} />
              文本规范化
            </label>
            <label className="toggle-field">
              <input type="checkbox" checked={playground.denoise} onChange={(event) => onPlaygroundChange("denoise", event.target.checked)} />
              参考音频增强
            </label>
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={playground.streaming}
                onChange={(event) => onPlaygroundChange("streaming", event.target.checked)}
                disabled={!selectedModel?.capabilities.supports_streaming}
              />
              流式生成
            </label>
          </div>
        </fieldset>
      </div>

      <Toolbar className="toolbar-spacious action-row">
        <button className="button button-primary" type="button" onClick={onRunInference} disabled={loading}>
          {playground.streaming ? <Radio size={16} /> : <Play size={16} />}
          {playground.streaming ? "开始流式推理" : "开始生成"}
        </button>
        <MetricTile label="Chunk" value={String(chunkCount)} detail={lastStreamEvent?.label ?? "等待事件"} tone={chunkCount > 0 ? "info" : "neutral"} />
      </Toolbar>

      {playground.streaming ? (
        <div className="timeline-card">
          <div className="timeline-head">
            <div>
              <h3>Streaming Timeline</h3>
              <p>WebSocket chunk / completed / error 事件按时间线滚动显示。</p>
            </div>
            <StatusPill tone={streamEvents.length > 0 ? "info" : "neutral"}>{streamEvents.length} events</StatusPill>
          </div>
          {streamEvents.length > 0 ? (
            <ol className="stream-timeline">
              {streamEvents.map((event) => (
                <li key={event.id} className={`timeline-item tone-${event.tone}`}>
                  <div className="timeline-dot" />
                  <div>
                    <strong>{event.label}</strong>
                    <p>{event.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="暂无流式事件" description="开启流式生成后，chunk 事件会按时间线堆叠显示。" compact />
          )}
        </div>
      ) : null}
    </SectionCard>
  );
}
