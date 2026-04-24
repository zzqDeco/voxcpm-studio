FROM golang:1.22 AS go-builder

WORKDIR /src/apps/demo-api

COPY apps/demo-api/go.mod apps/demo-api/go.sum ./
RUN go mod download

COPY apps/demo-api/cmd ./cmd
COPY apps/demo-api/internal ./internal

RUN CGO_ENABLED=0 GOOS=linux go build -o /out/demo-api ./cmd/demo-api

FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEMO_WORKER_PYTHON=python3 \
    DEMO_WORKER_SCRIPT=/app/apps/demo-worker/bridge.py \
    VOXCPM_REPO_ROOT=/app

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md README_CN.md LICENSE NOTICE ./
COPY conf ./conf
COPY src ./src
COPY scripts ./scripts
COPY examples ./examples
COPY apps/demo-api/demo_api ./apps/demo-api/demo_api
COPY apps/demo-worker ./apps/demo-worker
COPY --from=go-builder /out/demo-api /app/bin/demo-api

RUN pip install --upgrade pip && pip install -e .[demo]

EXPOSE 8000

CMD ["/app/bin/demo-api"]
