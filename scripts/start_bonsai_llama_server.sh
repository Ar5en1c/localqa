#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LLAMA_SERVER="$ROOT_DIR/bonsai-webgpu/vendor/prism-llama.cpp/build/bin/llama-server"
MODEL="$ROOT_DIR/bonsai-webgpu/models/Bonsai-8B.gguf"
HOST="${BONSAI_HOST:-127.0.0.1}"
PORT="${BONSAI_PORT:-18081}"
CTX_SIZE="${BONSAI_CTX_SIZE:-4096}"
GPU_LAYERS="${BONSAI_GPU_LAYERS:-99}"
PARALLEL="${BONSAI_PARALLEL:-1}"
BATCH_SIZE="${BONSAI_BATCH_SIZE:-2048}"
UBATCH_SIZE="${BONSAI_UBATCH_SIZE:-512}"
FLASH_ATTN="${BONSAI_FLASH_ATTN:-on}"
CACHE_TYPE_K="${BONSAI_CACHE_TYPE_K:-f16}"
CACHE_TYPE_V="${BONSAI_CACHE_TYPE_V:-f16}"
CACHE_RAM="${BONSAI_CACHE_RAM:-8192}"
CACHE_REUSE="${BONSAI_CACHE_REUSE:-256}"
FIT="${BONSAI_FIT:-on}"
POLL="${BONSAI_POLL:-50}"
WARMUP_FLAG="${BONSAI_WARMUP_FLAG:---no-warmup}"

if [ ! -x "$LLAMA_SERVER" ]; then
  echo "Missing PrismML llama-server: $LLAMA_SERVER" >&2
  echo "Build it with:" >&2
  echo "  cmake -S bonsai-webgpu/vendor/prism-llama.cpp -B bonsai-webgpu/vendor/prism-llama.cpp/build -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=ON -DGGML_METAL=ON -DCMAKE_BUILD_TYPE=Release" >&2
  echo "  cmake --build bonsai-webgpu/vendor/prism-llama.cpp/build --target llama-cli llama-server -j 8" >&2
  exit 1
fi

if [ ! -f "$MODEL" ]; then
  echo "Missing Bonsai GGUF: $MODEL" >&2
  exit 1
fi

exec "$LLAMA_SERVER" \
  -m "$MODEL" \
  --host "$HOST" \
  --port "$PORT" \
  -c "$CTX_SIZE" \
  -b "$BATCH_SIZE" \
  -ub "$UBATCH_SIZE" \
  -ngl "$GPU_LAYERS" \
  -np "$PARALLEL" \
  -fa "$FLASH_ATTN" \
  -fit "$FIT" \
  -ctk "$CACHE_TYPE_K" \
  -ctv "$CACHE_TYPE_V" \
  --cache-ram "$CACHE_RAM" \
  --cache-reuse "$CACHE_REUSE" \
  --poll "$POLL" \
  --jinja \
  --reasoning off \
  $WARMUP_FLAG
