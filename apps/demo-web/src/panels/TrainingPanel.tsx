import { CheckpointInfo, DeviceCapability, ModelInfo, RuntimeInfo, TrainingJob } from "../types";
import { FieldUpdater, TrainingFormState } from "../workbench";
import { DataList, EmptyState, MetricTile, SectionCard, StatusPill, Toolbar } from "../components/primitives";
import { toStatusTone } from "../utils";

export function TrainingPanel({
  models,
  runtime,
  checkpoints,
  trainingForm,
  trainingStatus,
  trainingLogs,
  loading,
  trainingDisabledReason,
  trainingNotice,
  effectiveTrainingDevice,
  recommendedTrainingPrecision,
  selectedTrainingCaps,
  onTrainingChange,
  onStartTraining,
  onStopTraining,
  onApplyCheckpoint,
}: {
  models: ModelInfo[];
  runtime: RuntimeInfo | null;
  checkpoints: CheckpointInfo[];
  trainingForm: TrainingFormState;
  trainingStatus: TrainingJob | null;
  trainingLogs: string;
  loading: boolean;
  trainingDisabledReason: string;
  trainingNotice: string;
  effectiveTrainingDevice: string;
  recommendedTrainingPrecision: "fp32" | "amp";
  selectedTrainingCaps?: DeviceCapability;
  onTrainingChange: FieldUpdater<TrainingFormState>;
  onStartTraining: () => void;
  onStopTraining: () => void;
  onApplyCheckpoint: (checkpointId: string) => void;
}) {
  return (
    <section className="workspace-stack">
      <div className="workspace-grid workspace-grid-training">
        <SectionCard
          eyebrow="Fine-Tuning Bay"
          title="训练控制台"
          description="LoRA 与 Full FT 共用一套控制面板，但把设备限制、精度建议和实验风险直观暴露出来。"
          className="form-card"
        >
          <div className={`notice-banner ${effectiveTrainingDevice === "mps" ? "tone-warning" : "tone-info"}`}>{trainingNotice}</div>
          {trainingDisabledReason ? <div className="notice-banner tone-warning">{trainingDisabledReason}</div> : null}

          <div className="field-group-grid">
            <fieldset className="field-group">
              <legend>训练目标</legend>
              <div className="field-grid two-columns">
                <label>
                  模型
                  <select value={trainingForm.modelId} onChange={(event) => onTrainingChange("modelId", event.target.value)}>
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
                  <select value={trainingForm.device} onChange={(event) => onTrainingChange("device", event.target.value)}>
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
                  <select value={trainingForm.trainingMode} onChange={(event) => onTrainingChange("trainingMode", event.target.value as TrainingFormState["trainingMode"])}>
                    <option value="lora">LoRA</option>
                    <option value="full_ft">Full FT (experimental on MPS)</option>
                  </select>
                </label>
                <label>
                  精度
                  <select value={trainingForm.precisionMode} onChange={(event) => onTrainingChange("precisionMode", event.target.value as TrainingFormState["precisionMode"])}>
                    <option value="auto">auto (recommended: {recommendedTrainingPrecision})</option>
                    <option value="fp32">fp32</option>
                    <option value="amp" disabled={!selectedTrainingCaps?.supports_amp_training}>
                      amp
                    </option>
                  </select>
                </label>
              </div>
            </fieldset>

            <fieldset className="field-group">
              <legend>数据与训练预算</legend>
              <div className="field-grid two-columns">
                <label>
                  train_manifest
                  <input value={trainingForm.trainManifest} onChange={(event) => onTrainingChange("trainManifest", event.target.value)} />
                </label>
                <label>
                  val_manifest
                  <input value={trainingForm.valManifest} onChange={(event) => onTrainingChange("valManifest", event.target.value)} />
                </label>
                <label>
                  learning_rate
                  <input type="number" step="0.00001" value={trainingForm.learningRate} onChange={(event) => onTrainingChange("learningRate", Number(event.target.value))} />
                </label>
                <label>
                  batch_size
                  <input type="number" value={trainingForm.batchSize} onChange={(event) => onTrainingChange("batchSize", Number(event.target.value))} />
                </label>
                <label>
                  num_iters
                  <input type="number" value={trainingForm.numIters} onChange={(event) => onTrainingChange("numIters", Number(event.target.value))} />
                </label>
                <label>
                  grad_accum_steps
                  <input type="number" value={trainingForm.gradAccumSteps} onChange={(event) => onTrainingChange("gradAccumSteps", Number(event.target.value))} />
                </label>
                <label>
                  save_interval
                  <input type="number" value={trainingForm.saveInterval} onChange={(event) => onTrainingChange("saveInterval", Number(event.target.value))} />
                </label>
              </div>
            </fieldset>

            {trainingForm.trainingMode === "lora" ? (
              <fieldset className="field-group">
                <legend>LoRA 配置</legend>
                <div className="field-grid three-columns">
                  <label>
                    lora_rank
                    <input type="number" value={trainingForm.loraRank} onChange={(event) => onTrainingChange("loraRank", Number(event.target.value))} />
                  </label>
                  <label>
                    lora_alpha
                    <input type="number" value={trainingForm.loraAlpha} onChange={(event) => onTrainingChange("loraAlpha", Number(event.target.value))} />
                  </label>
                  <label>
                    lora_dropout
                    <input type="number" step="0.05" value={trainingForm.loraDropout} onChange={(event) => onTrainingChange("loraDropout", Number(event.target.value))} />
                  </label>
                </div>
              </fieldset>
            ) : null}
          </div>

          <Toolbar className="toolbar-spacious">
            <button className="button button-primary" onClick={onStartTraining} disabled={loading || Boolean(trainingDisabledReason)}>
              启动训练
            </button>
            <button className="button button-secondary" onClick={onStopTraining} disabled={loading || trainingStatus?.status !== "running"}>
              停止训练
            </button>
          </Toolbar>
        </SectionCard>

        <SectionCard
          eyebrow="Run Monitor"
          title="训练摘要与日志"
          description={trainingStatus?.id ? `${trainingStatus.id} · ${trainingStatus.status}` : "暂无训练任务"}
          actions={trainingStatus?.status ? <StatusPill tone={toStatusTone(trainingStatus.status)}>{trainingStatus.status}</StatusPill> : null}
          className="viewer-card"
        >
          <div className="viewer-metrics-grid">
            <MetricTile label="设备" value={trainingStatus?.device ?? "-"} />
            <MetricTile label="模式" value={trainingStatus?.training_mode ?? "-"} />
            <MetricTile label="精度" value={trainingStatus?.precision_mode ?? "-"} />
            <MetricTile label="当前忙碌" value={trainingStatus?.busy ? "yes" : "no"} />
            <MetricTile label="推荐精度" value={recommendedTrainingPrecision} />
            <MetricTile label="能力" value={selectedTrainingCaps?.supports_training ? "trainable" : "inference only"} />
          </div>

          <div className="console-card">
            <div className="console-head">
              <h3>实时日志</h3>
              {trainingStatus?.experimental ? <StatusPill tone="warning">experimental</StatusPill> : null}
            </div>
            <pre className="console-log">{trainingLogs || "暂无日志"}</pre>
          </div>

          <div className="meta-grid">
            <article className="result-block">
              <h4>输出目录</h4>
              <div className="result-block-body">{trainingStatus?.output_dir ?? "-"}</div>
            </article>
            <article className="result-block">
              <h4>日志文件</h4>
              <div className="result-block-body">{trainingStatus?.log_path ?? "-"}</div>
            </article>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        eyebrow="Checkpoint Gallery"
        title="训练产物"
        description="新训练出的 LoRA 会回流到这里，确认后可以直接送到 Playground 做听感验证。"
        className="viewer-card"
      >
        {checkpoints.length > 0 ? (
          <DataList>
            <div className="data-row data-row-header data-row-checkpoint">
              <span>Checkpoint</span>
              <span>Base Model</span>
              <span>Origin</span>
              <span>Action</span>
            </div>
            {checkpoints.map((checkpoint) => (
              <div key={checkpoint.id} className="data-row data-row-checkpoint">
                <span>{checkpoint.label}</span>
                <span>{checkpoint.base_model ?? "-"}</span>
                <span>{checkpoint.origin}</span>
                <button className="button button-secondary button-small" onClick={() => onApplyCheckpoint(checkpoint.id)}>
                  送到 Playground
                </button>
              </div>
            ))}
          </DataList>
        ) : (
          <EmptyState title="还没有可用 checkpoint" description="训练完成并保存后，新的 LoRA checkpoint 会显示在这里。" />
        )}
      </SectionCard>
    </section>
  );
}
