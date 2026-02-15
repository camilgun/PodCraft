#!/usr/bin/env bash
#
# download-models.sh — Download MLX models from HuggingFace for PodCraft
#
# Usage:
#   ./scripts/download-models.sh           # Download all models
#   ./scripts/download-models.sh --model asr       # Download only ASR
#   ./scripts/download-models.sh --model aligner   # Download only Aligner
#   ./scripts/download-models.sh --model tts       # Download only TTS
#
# Environment:
#   HF_HOME  Target directory (default: ~/.podcraft/models)
#

set -euo pipefail

# ── Source .env from monorepo root if present ──────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    # shellcheck source=/dev/null
    source "$ROOT_DIR/.env"
    set +a
fi

# ── Configuration ──────────────────────────────────────────────────────────

MODELS_DIR="${HF_HOME:-$HOME/.podcraft/models}"

# Model definitions (bash 3.x compatible — no associative arrays)
# Format: key|repo_id|dir_name|size
MODELS="
asr|mlx-community/Qwen3-ASR-1.7B-bf16|Qwen3-ASR-1.7B-bf16|~4.08 GB
aligner|mlx-community/Qwen3-ForcedAligner-0.6B-bf16|Qwen3-ForcedAligner-0.6B-bf16|~1.84 GB
tts|mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16|Qwen3-TTS-12Hz-1.7B-Base-bf16|~4.54 GB
"

# ── Helpers ────────────────────────────────────────────────────────────────

log() { echo "[download-models] $*"; }
err() { echo "[download-models] ERROR: $*" >&2; }

check_prerequisites() {
    if ! command -v uv &>/dev/null; then
        err "'uv' not found. Install it: curl -LsSf https://astral.sh/uv/install.sh | sh"
        exit 1
    fi
}

get_model_info() {
    local key="$1"
    local model_key repo dir_name size

    while IFS='|' read -r model_key repo dir_name size; do
        if [ -z "${model_key}" ]; then
            continue
        fi
        if [ "$model_key" = "$key" ]; then
            printf "%s|%s|%s\n" "$repo" "$dir_name" "$size"
            return 0
        fi
    done <<EOF
$MODELS
EOF

    return 1
}

download_model() {
    local key="$1"
    local repo dir_name size target_dir model_info

    if ! model_info="$(get_model_info "$key")"; then
        err "Unknown model: ${key}. Valid options: asr, aligner, tts"
        exit 1
    fi
    IFS='|' read -r repo dir_name size <<EOF
$model_info
EOF

    target_dir="${MODELS_DIR}/${dir_name}"

    # Check if already downloaded (look for weight files)
    if [ -d "$target_dir" ]; then
        local weight_count
        weight_count=$(find "$target_dir" \( -name "*.safetensors" -o -name "*.bin" \) 2>/dev/null | wc -l | tr -d ' ')
        if [ "$weight_count" -gt 0 ]; then
            log "SKIP: ${dir_name} already downloaded (${weight_count} weight file(s) found)"
            return 0
        fi
        log "WARN: ${dir_name} directory exists but no weight files found. Re-downloading..."
    fi

    log "Downloading ${dir_name} (${size}) from ${repo}..."
    log "Target: ${target_dir}"

    uv run --project "${ROOT_DIR}/services/ml" \
        hf download \
        "${repo}" \
        --local-dir "${target_dir}" \
        --local-dir-use-symlinks False

    log "DONE: ${dir_name}"
}

# ── Main ───────────────────────────────────────────────────────────────────

main() {
    check_prerequisites

    mkdir -p "${MODELS_DIR}"
    log "Models directory: ${MODELS_DIR}"

    local target_model=""

    while [ $# -gt 0 ]; do
        case "$1" in
            --model)
                target_model="${2:-}"
                shift 2
                ;;
            --help|-h)
                head -12 "$0" | tail -9
                exit 0
                ;;
            *)
                err "Unknown argument: $1. Use --help for usage."
                exit 1
                ;;
        esac
    done

    if [ -n "$target_model" ]; then
        download_model "$target_model"
    else
        log "Downloading all models (~10.5 GB total)..."
        log ""
        for key in asr aligner tts; do
            download_model "$key"
            log ""
        done
    fi

    log "NOTE: NISQA quality model (~50 MB) auto-downloads on first use via torchmetrics."
    log ""
    log "Disk usage:"
    du -sh "${MODELS_DIR}" 2>/dev/null || true
}

main "$@"
