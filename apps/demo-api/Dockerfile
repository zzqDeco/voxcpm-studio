FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

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
COPY apps/demo-api ./apps/demo-api

RUN pip install --upgrade pip && pip install -e .[demo]

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "/app/apps/demo-api"]
