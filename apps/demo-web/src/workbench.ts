export type TabKey = "playground" | "compare" | "bench" | "training" | "history";
export type ModeKey = "design" | "controlled_clone" | "ultimate_clone";
export type BannerTone = "idle" | "loading" | "success" | "error" | "busy";
export type StreamEventTone = "chunk" | "info" | "success" | "error";

export type PlaygroundState = {
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

export type TrainingFormState = {
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

export type HistoryFilters = {
  modelId: string;
  mode: string;
  device: string;
  status: string;
};

export type StreamEventItem = {
  id: string;
  tone: StreamEventTone;
  label: string;
  detail: string;
};

export type BenchRow = {
  scenario: string;
  runId: string;
  device: string;
  rtf: string;
  metric: string;
  loraCheckpoint?: string | null;
};

export type FieldUpdater<T> = <K extends keyof T>(key: K, value: T[K]) => void;

export const defaultPlaygroundState: PlaygroundState = {
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

export const defaultTrainingState: TrainingFormState = {
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
  loraDropout: 0,
};

export const defaultHistoryFilters: HistoryFilters = {
  modelId: "",
  mode: "",
  device: "",
  status: "",
};

export const tabMeta: Array<{
  key: TabKey;
  label: string;
  caption: string;
  eyebrow: string;
}> = [
  { key: "playground", label: "Playground", caption: "生成与监听", eyebrow: "Inference Lab" },
  { key: "compare", label: "Compare", caption: "并排分析", eyebrow: "Analysis Desk" },
  { key: "bench", label: "Bench", caption: "批量场景评估", eyebrow: "Scenario Matrix" },
  { key: "training", label: "Training", caption: "训练控制台", eyebrow: "Fine-Tuning Bay" },
  { key: "history", label: "History", caption: "结果回溯", eyebrow: "Archive Lens" },
];

export const modeLabels: Record<ModeKey, string> = {
  design: "design / zero-shot",
  controlled_clone: "controlled_clone",
  ultimate_clone: "ultimate_clone",
};

export const benchScenarioLabels: Record<string, string> = {
  design: "Text Design",
  controlled_clone: "Controlled Clone",
  ultimate_clone: "Ultimate Clone",
  streaming: "Streaming",
  lora_compare: "LoRA Compare",
};
