import { RuntimeInfo } from "./types";

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
export const WS_BASE = API_BASE.replace(/^http/, "ws");

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
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

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isBackendFeatureGap(error: unknown): boolean {
  const message = formatError(error).toLowerCase();
  return message.includes("not yet migrated to go backend") || message.includes("not implemented");
}

export function metricValue(value?: number | null, digits = 2): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

export function absoluteArtifactUrl(path?: string): string | undefined {
  if (!path) {
    return undefined;
  }
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  return `${API_BASE}${path}`;
}

export function formatTime(value?: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

export function resolveDeviceSelection(selected: string, runtime: RuntimeInfo | null): string {
  if (selected && selected !== "auto") {
    return selected;
  }
  return runtime?.device ?? runtime?.available_devices[0] ?? "cpu";
}

export function resolveRecommendedPrecision(selectedDevice: string, runtime: RuntimeInfo | null): "fp32" | "amp" {
  const device = resolveDeviceSelection(selectedDevice, runtime);
  const capability = runtime?.device_capabilities?.[device];
  return capability?.recommended_precision_mode === "amp" ? "amp" : "fp32";
}

export function toStatusTone(status?: string | null): "neutral" | "info" | "success" | "warning" | "danger" {
  switch ((status || "").toLowerCase()) {
    case "completed":
      return "success";
    case "running":
      return "info";
    case "warning":
      return "warning";
    case "failed":
    case "error":
      return "danger";
    default:
      return "neutral";
  }
}

export function toBannerToneClass(tone: string): string {
  return tone ? `is-${tone}` : "is-idle";
}

export function summarizeSettled(results: PromiseSettledResult<unknown>[]): string | null {
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length === 0) {
    return null;
  }
  const first = failures[0].reason;
  return formatError(first);
}
