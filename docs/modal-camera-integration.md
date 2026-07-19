# Camera Angle Control - Modal Integration Plan

## Overview

This document describes how to deploy and integrate the Qwen Camera Angle Control model using Modal serverless GPUs. The execution engine is a headless **ComfyUI** server running inside the Modal container, driving the official multi-angle workflow published alongside the LoRA — this mirrors the Liblib reference architecture (Three.js 3D controller → structured angle prompt → Qwen-Image-Edit + Multi-Angle LoRA → ComfyUI workflow).

## Architecture

```
┌─────────────────────┐        HTTPS         ┌───────────────────────────────┐
│      Evan App       │  ─────────────────▶  │   Modal Serverless             │
│   (Frontend,         │                      │   (A100 GPU, 40GB VRAM)        │
│   Three.js 3D dial)  │                      │  ┌───────────────────────────┐ │
└─────────────────────┘                      │  │ headless ComfyUI server    │ │
                                              │  │  Qwen-Image-Edit-2511      │ │
                                              │  │  + Multi-Angle LoRA        │ │
                                              │  │  + Lightning 4-step LoRA   │ │
                                              │  └───────────────────────────┘ │
                                              └─────────────────────────────────┘
```

**Model:** `Qwen/Qwen-Image-Edit-2511` (via `Comfy-Org/Qwen-Image-Edit_ComfyUI` split files)
**Camera LoRA:** [`fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA`](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA) — 96 discrete poses (8 azimuths × 4 elevations × 3 distances), trained on Gaussian Splatting data.
**Speed LoRA:** `lightx2v/Qwen-Image-Edit-2511-Lightning` (4-step distillation, stacked on top of the angle LoRA).
**Workflow:** the official `comfyui-workflow-multiple-angles.json` from the LoRA's model card, converted from ComfyUI's UI-export format to `/prompt`-ready API format at container startup (via ComfyUI's own `/object_info` schema — no hand-maintained node parameter names).

## Setup Steps

### 1. Install Modal CLI
```bash
pip install modal
python -m modal setup  # Opens browser for authentication
```

### 2. Deploy to Modal
```bash
modal deploy modal/camera_angle.py
```

### 3. Get Your Endpoint URLs
After deployment, Modal provides URLs like:
- `https://sankai-aicareer--camera-angle-control-cameraangle-generate.modal.run`
- `https://sankai-aicareer--camera-angle-control-cameraangle-health.modal.run`

### 4. Add to Environment
```env
# .env
VITE_MODAL_CAMERA_ENDPOINT=https://your-username--camera-angle-control-cameraangle-generate.modal.run
```

---

## API Reference

### POST /generate

Generate a camera-angle-adjusted image.

**Request:**
```json
{
  "image": "base64-encoded-image",
  "rotation": 45.0,    // -180 to 180 degrees (horizontal, snapped to 8 azimuths)
  "tilt": 20.0,        // -90 to 90 degrees (vertical, clamped to -30..60, snapped to 4 elevations)
  "zoom": 0.0,         // 0-100 (snapped to 3 distance tiers: wide/medium/close-up)
  "seed": 12345,       // optional
  "num_steps": 4       // optional (default: 4, matches the Lightning speed LoRA)
}
```

`rotation`/`tilt`/`zoom` are quantized server-side (`build_camera_prompt` in `modal/camera_angle.py`) to the nearest of the LoRA's 96 trained poses and rendered into the structured prompt the LoRA expects, e.g. `<sks> front-right quarter view high-angle shot close-up`.

**Response:**
```json
{
  "image": "base64-encoded-result",
  "prompt": "<sks> front-right quarter view high-angle shot close-up",
  "seed": 12345,
  "inference_time_ms": 15234.5
}
```

### GET /health

Check model status.

**Response:**
```json
{
  "status": "ok",
  "model": "Qwen-Image-Edit-2511 Camera Angle Control (ComfyUI)"
}
```

---

## Frontend Integration

### Update ChangeAnglePanel.tsx

The actual frontend call lives in `src/services/cameraAngleService.ts` (`generateCameraAngle()`), invoked from `src/hooks/useImageNodeHandlers.ts` (`handleChangeAngleGenerate`). `ChangeAnglePanel.tsx` only owns the Three.js 3D dial UI and calls `onGenerate()`, which the parent wires to that handler. Neither needs to change for this ComfyUI-based deployment — the request/response shape is unchanged.

---

## Cost Breakdown

A100-40GB is billed at **$0.000583/sec**. `scaledown_window=300` means the container stays billed for 5 minutes after the *last* request, not just active inference time — this dominates the cost of an isolated, one-off generation.

| Scenario | Billed time | Cost |
|-------|------|------|
| Isolated single generation (no follow-up within 5 min) | ~15-30s inference + 300s idle wind-down | **~$0.18-0.19** |
| Each additional generation within the same 5-min warm window | ~15-30s inference only | **~$0.006-0.017** |
| First-ever call after deploy (downloads ~35-40GB) | 5-10 min | **~$0.17-0.35**, one-time |
| Fully idle (container scaled to zero) | — | Free |

To trade cost for latency, lower `scaledown_window` in `modal/camera_angle.py` (shorter idle billing window, more frequent cold starts on sparse usage).

---

## Model Caching

Models are cached in a Modal Volume (`camera-angle-models`), laid out under ComfyUI's own `models/<subdir>/` structure (`diffusion_models/`, `text_encoders/`, `vae/`, `loras/`):
- First request after a fresh deploy downloads ~35-40GB (takes 5-10 min)
- Subsequent container starts symlink from the cached Volume (~60s)
- Volume persists across deployments and redeploys

---

## Troubleshooting

### Cold Start Takes Long
- First request after idle downloads/loads models
- Wait 60-120 seconds for warm-up
- Use health endpoint to pre-warm (note: this itself incurs the cost/idle-window described above)

### Out of Memory
- Increase `memory=65536` (64GB) in `@app.cls` if needed
- Configured for A100-40GB by default (`gpu="A100"`)

### Model Download Fails
- Check Modal logs: `modal app logs camera-angle-control`
- Verify HuggingFace access to the model repos listed in `MODEL_FILES` in `modal/camera_angle.py`

### ComfyUI Workflow Errors ("invalid prompt" / node validation failures)
- The UI→API conversion in `_convert_ui_to_api()` relies on the live ComfyUI server's `/object_info` schema — if the official `comfyui-workflow-multiple-angles.json` changes its node graph upstream, re-check that the node types this file assumes (`LoadImage`, `TextEncodeQwenImageEditPlus`, `KSampler`) still exist with matching names.
- Check Modal logs for the exact validation error ComfyUI's `/prompt` endpoint returned.

---

## Files

| File | Purpose |
|------|---------|
| `modal/camera_angle.py` | Modal deployment definition (ComfyUI + Qwen-Image-Edit-2511 + Multi-Angle LoRA) |
| `src/services/cameraAngleService.ts` | Frontend → Modal endpoint call |
| `src/hooks/useImageNodeHandlers.ts` | Wires generation into the canvas node lifecycle |
| `src/components/canvas/ChangeAnglePanel.tsx` + `OrbitCameraControl.tsx` | Three.js 3D angle dial UI |
| `.env` | Modal endpoint URL (`VITE_MODAL_CAMERA_ENDPOINT`) |
