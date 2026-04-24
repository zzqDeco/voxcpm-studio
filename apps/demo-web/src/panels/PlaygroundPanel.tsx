import { ChangeEvent } from "react";

import { CheckpointInfo, ModelInfo, RuntimeInfo } from "../types";
import { FieldUpdater, modeLabels, PlaygroundState, StreamEventItem } from "../workbench";
import { EmptyState, SectionCard, StatusPill, Toolbar } from "../components/primitives";

function capabilityChips(model: ModelInfo | null) {
  if (!model) {
    return [];
  }
  return [
    model.family,
    `reference_audio ${model.capabilities.supports_reference_audio ? "enabled" : "disabled"}`,
    `voice_design ${model.capabilities.supports_voice_design ? "enabled" : "disabled"}`,
    `prompt_text ${model.capabilities.supports_prompt_text ? "enabled" : "disabled"}`,
    `streaming ${model.capabilities.supports_streaming ? "enabled" : "disabled"}`,
    `lora ${model.capabilities.supports_lora ? "enabled" : "disabled"}`,
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

  return (
    <SectionCard
      eyebrow="Inference Lab"
      title="生成与监听"
      description="把模型选择、音色条件、Prompt 辅助和高级推理参数收束到同一个控制台。"
      className="form-card"
    >
        {chips.length > 0 ? (
          <div className="chip-row">
            {chips.map((chip) => (
              <span key={chip} className="meta-chip">
                {chip}
              </span>
            ))}
          </div>
        ) : null}

        <div className="field-group-grid">
          <fieldset className="field-group">
            <legend>模型与执行环境</legend>
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
              <label>
                LoRA
                <select value={playground.loraCheckpoint} onChange={(event) => onPlaygroundChange("loraCheckpoint", event.target.value)}>
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
                <select value={playground.mode} onChange={(event) => onPlaygroundChange("mode", event.target.value as PlaygroundState["mode"])}>
                  <option value="design">{modeLabels.design}</option>
                  {selectedModel?.capabilities.supports_reference_audio ? <option value="controlled_clone">{modeLabels.controlled_clone}</option> : null}
                  {selectedModel?.capabilities.supports_prompt_text ? <option value="ultimate_clone">{modeLabels.ultimate_clone}</option> : null}
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className="field-group">
            <legend>文本与音色条件</legend>
            <div className="field-grid">
              <label>
                目标文本
                <textarea value={playground.text} onChange={(event) => onPlaygroundChange("text", event.target.value)} rows={4} />
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
            </div>
          </fieldset>

          <fieldset className="field-group">
            <legend>参考音频与 Prompt</legend>
            <div className="field-grid two-columns">
              <label>
                参考音频
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => onReferenceFileChange(event.target.files?.[0] ?? null)}
                />
              </label>
              <label>
                Prompt Text
                <textarea
                  value={playground.promptText}
                  onChange={(event) => onPlaygroundChange("promptText", event.target.value)}
                  rows={3}
                  disabled={!selectedModel?.capabilities.supports_prompt_text}
                />
              </label>
            </div>
            <Toolbar>
              <StatusPill tone={referenceFileName ? "success" : "neutral"}>{referenceFileName || "未上传参考音频"}</StatusPill>
              <button className="button button-secondary" onClick={onPromptTranscribe} disabled={!referenceFileName || loading}>
                ASR 自动填充 Prompt
              </button>
            </Toolbar>
          </fieldset>

          <fieldset className="field-group">
            <legend>推理配方</legend>
            <div className="field-grid three-columns">
              <label>
                CFG
                <input type="number" step="0.1" value={playground.cfgValue} onChange={(event) => onPlaygroundChange("cfgValue", Number(event.target.value))} />
              </label>
              <label>
                推理步数
                <input
                  type="number"
                  min={1}
                  value={playground.inferenceTimesteps}
                  onChange={(event) => onPlaygroundChange("inferenceTimesteps", Number(event.target.value))}
                />
              </label>
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

        <Toolbar className="toolbar-spacious">
          <button className="button button-primary" onClick={onRunInference} disabled={loading}>
            {playground.streaming ? "开始流式推理" : "开始生成"}
          </button>
        </Toolbar>

        {playground.streaming ? (
          <div className="timeline-card">
            <div className="timeline-head">
              <h3>Streaming Timeline</h3>
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
