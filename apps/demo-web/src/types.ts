export interface DeviceCapability {
  supports_training: boolean;
  supports_amp_training: boolean;
  recommended_precision_mode: "fp32" | "amp";
}

export interface RuntimeInfo {
  device: string;
  available_devices: string[];
  run_mode: string;
  supports_training: boolean;
  supports_mps_training: boolean;
  supports_amp_training: boolean;
  default_precision_mode: string;
  device_capabilities: Record<string, DeviceCapability>;
  active_model: ModelInfo | null;
  busy_state: {
    kind: string;
    task_id: string | null;
    started_at: string | null;
  };
  sensevoice_device: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  family: string;
  architecture: string;
  origin: string;
  path: string;
  device?: string;
  active_lora?: string | null;
  loaded_at?: string;
  lora_config_source?: string;
  capabilities: {
    supports_reference_audio: boolean;
    supports_prompt_text: boolean;
    supports_voice_design: boolean;
    supports_streaming: boolean;
    supports_lora: boolean;
    supports_full_ft: boolean;
  };
}

export interface CheckpointInfo {
  id: string;
  label: string;
  path: string;
  origin: string;
  base_model?: string | null;
}

export interface Metrics {
  wall_time_ms?: number | null;
  audio_duration_s?: number | null;
  sample_rate?: number | null;
  rtf?: number | null;
  text_length?: number | null;
  metric_name?: string | null;
  metric_value?: number | null;
  first_chunk_latency_ms?: number | null;
  chunk_count?: number | null;
  avg_chunk_interval_ms?: number | null;
  final_latency_ms?: number | null;
}

export interface RunRecord {
  id: string;
  created_at: string;
  updated_at: string;
  mode: string;
  model_id: string;
  device: string;
  status: string;
  request: {
    text: string;
    resolved_text: string;
    control_instruction: string;
    prompt_text?: string | null;
    cfg_value: number;
    inference_timesteps: number;
    normalize: boolean;
    denoise: boolean;
    lora_checkpoint?: string | null;
    device: string;
    notes?: string[];
  };
  result: {
    audio_url?: string;
    mel_url?: string;
    waveform_points?: number[];
    asr_text?: string | null;
  };
  metrics: Metrics;
}

export interface BenchJob {
  id: string;
  created_at: string;
  updated_at: string;
  model_id: string;
  device: string;
  status: string;
  runs: Array<{
    scenario: string;
    run_id: string;
    lora_checkpoint?: string;
  }>;
  skipped: Array<{
    scenario: string;
    reason: string;
  }>;
  error?: string;
}

export interface TrainingJob {
  id: string | null;
  created_at?: string;
  updated_at?: string;
  training_mode?: string;
  model_id?: string;
  device: string;
  precision_mode?: string;
  status: string;
  experimental?: boolean;
  output_dir?: string;
  log_path?: string;
  config_path?: string;
  command?: string[];
  busy?: boolean;
}
