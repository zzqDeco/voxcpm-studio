from __future__ import annotations

import base64
import io
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

CHINESE_RE = re.compile(r"[\u4e00-\u9fff]")


def _require_soundfile():
    try:
        import soundfile as sf
    except ImportError as exc:
        raise RuntimeError("soundfile is required for audio export. Install the demo dependencies first.") from exc
    return sf


def _require_plotting():
    try:
        import librosa
        import librosa.display
        import matplotlib
        import matplotlib.pyplot as plt
    except ImportError as exc:
        raise RuntimeError(
            "librosa and matplotlib are required for mel spectrogram generation. Install the demo dependencies first."
        ) from exc
    matplotlib.use("Agg")
    return librosa, plt


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def generate_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def contains_chinese(text: str) -> bool:
    return bool(CHINESE_RE.search(text or ""))


def tokenize_for_quality(text: str) -> list[str]:
    if contains_chinese(text):
        return list((text or "").strip())
    return [part for part in re.split(r"\s+", (text or "").strip()) if part]


def levenshtein_distance(seq1: list[str], seq2: list[str]) -> int:
    if not seq1:
        return len(seq2)
    if not seq2:
        return len(seq1)

    prev = list(range(len(seq2) + 1))
    for i, left in enumerate(seq1, start=1):
        curr = [i]
        for j, right in enumerate(seq2, start=1):
            cost = 0 if left == right else 1
            curr.append(min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost))
        prev = curr
    return prev[-1]


def compute_quality_metrics(target_text: str, asr_text: str | None) -> dict[str, float | str | None]:
    if not asr_text:
        metric_name = "cer" if contains_chinese(target_text) else "wer"
        return {"metric_name": metric_name, "metric_value": None}

    ref_tokens = tokenize_for_quality(target_text)
    hyp_tokens = tokenize_for_quality(asr_text)
    denom = max(len(ref_tokens), 1)
    metric_value = levenshtein_distance(ref_tokens, hyp_tokens) / denom
    metric_name = "cer" if contains_chinese(target_text) else "wer"
    return {"metric_name": metric_name, "metric_value": metric_value}


def build_waveform_points(audio: np.ndarray, *, max_points: int = 512) -> list[float]:
    if audio.ndim > 1:
        audio = np.mean(audio, axis=0)
    if audio.size == 0:
        return []
    step = max(1, audio.size // max_points)
    sampled = audio[::step][:max_points]
    peak = float(np.max(np.abs(sampled))) or 1.0
    return (sampled / peak).astype(np.float32).tolist()


def save_audio(path: Path, audio: np.ndarray, sample_rate: int) -> None:
    sf = _require_soundfile()
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, audio.astype(np.float32), sample_rate)


def save_mel_spectrogram(path: Path, audio: np.ndarray, sample_rate: int) -> None:
    librosa, plt = _require_plotting()
    path.parent.mkdir(parents=True, exist_ok=True)
    audio = np.asarray(audio, dtype=np.float32).flatten()
    mel = librosa.feature.melspectrogram(y=audio, sr=sample_rate, n_mels=128, fmax=sample_rate // 2)
    mel_db = librosa.power_to_db(mel, ref=np.max)
    fig, ax = plt.subplots(figsize=(10, 4))
    img = librosa.display.specshow(mel_db, sr=sample_rate, x_axis="time", y_axis="mel", fmax=sample_rate // 2, ax=ax)
    ax.set_title("Mel Spectrogram")
    fig.colorbar(img, ax=ax, format="%+2.0f dB", pad=0.02)
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


def audio_duration(audio: np.ndarray, sample_rate: int) -> float:
    if sample_rate <= 0:
        return 0.0
    return float(np.asarray(audio).size) / float(sample_rate)


def to_pcm16_bytes(audio: np.ndarray) -> bytes:
    audio = np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0)
    return (audio * 32767.0).astype(np.int16).tobytes()


def encode_pcm16_base64(audio: np.ndarray) -> str:
    return base64.b64encode(to_pcm16_bytes(audio)).decode("utf-8")


def decode_base64_file(data: str) -> bytes:
    payload = data.split(",", 1)[-1]
    return base64.b64decode(payload)


def write_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
