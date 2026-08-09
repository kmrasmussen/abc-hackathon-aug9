#!/usr/bin/env bash
# Fetch SlimSAM ONNX weights for in-browser segmentation (~13MB).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/models/onnx
BASE="https://huggingface.co/Xenova/slimsam-77-uniform/resolve/main"
curl -sL -o public/models/config.json               "$BASE/config.json"
curl -sL -o public/models/preprocessor_config.json  "$BASE/preprocessor_config.json"
curl -sL -o public/models/onnx/vision_encoder_quantized.onnx \
     "$BASE/onnx/vision_encoder_quantized.onnx"
curl -sL -o public/models/onnx/prompt_encoder_mask_decoder_quantized.onnx \
     "$BASE/onnx/prompt_encoder_mask_decoder_quantized.onnx"
echo "SlimSAM weights in public/models/"
