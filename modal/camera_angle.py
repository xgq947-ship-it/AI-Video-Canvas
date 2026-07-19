"""
camera_angle.py
Modal serverless deployment for Qwen Camera Angle Control — ComfyUI edition.

Deploy with: modal deploy modal/camera_angle.py
Test with:   modal run modal/camera_angle.py

架构（对齐 Liblib 同款多角度方案）：
  Three.js 3D 控制器（前端，未变）
    -> 拖拽位置转成 <sks> [方位] [俯仰] [景别] 结构化 prompt（build_camera_prompt）
    -> Qwen-Image-Edit-2511 + fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA
    -> 容器内常驻的 headless ComfyUI 服务执行官方 comfyui-workflow-multiple-angles.json
       （用 ComfyUI 自己的 /object_info 接口把 UI 导出格式转成 /prompt 需要的 API 格式，
       不手写每个节点的参数名，官方 workflow 更新了也不用跟着改代码）

模型文件全部下载进持久 Modal Volume（camera-angle-models），跟旧版共用同一个
Volume 名字，但目录结构换成了 ComfyUI 的 models/<subdir>/ 布局——因为换了模型
本身，旧版缓存的 diffusers 格式文件用不上，首次部署仍要花几分钟重新下载。

NOTE: First request downloads ~35-40GB of model weights (5-10 min).
      Subsequent cold starts reuse the cached Volume (~60s); warm requests
      are a few seconds.
"""

import json
import os
import subprocess
import time
import uuid

import modal

# ============================================================================
# CONTAINER IMAGE
# ============================================================================

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libgl1", "libglib2.0-0", "wget")
    .pip_install("comfy-cli", "huggingface-hub>=0.20.0", "requests", "fastapi")
    .run_commands(
        # --skip-prompt 是 comfy 的全局 flag（必须在 install 前面，不是 install 的参数），
        # 装到默认路径 ~/comfy/ComfyUI（对应下面的 COMFYUI_ROOT），不加 --here。
        # 不锁定具体 ComfyUI 版本，装最新版——Qwen-Image-Edit-2511 是新模型，装旧版
        # 反而可能因为缺相关节点支持而跑不起来。
        "comfy --skip-prompt install --nvidia --fast-deps"
    )
)

app = modal.App("camera-angle-control", image=image)

COMFYUI_ROOT = "/root/comfy/ComfyUI"
COMFYUI_PORT = 8188

# ============================================================================
# MODEL CONFIGURATION
# ============================================================================
# (repo_id, path_in_repo, models子目录, 本地文件名) —— 全部来自官方仓库，直接对应
# fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA 模型卡给出的 ComfyUI workflow 要求。
MODEL_FILES = [
    ("Comfy-Org/Qwen-Image-Edit_ComfyUI",
     "split_files/diffusion_models/qwen_image_edit_2511_bf16.safetensors",
     "diffusion_models", "qwen_image_edit_2511_bf16.safetensors"),
    ("Comfy-Org/Qwen-Image_ComfyUI",
     "split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors",
     "text_encoders", "qwen_2.5_vl_7b_fp8_scaled.safetensors"),
    ("Comfy-Org/Qwen-Image_ComfyUI",
     "split_files/vae/qwen_image_vae.safetensors",
     "vae", "qwen_image_vae.safetensors"),
    ("lightx2v/Qwen-Image-Edit-2511-Lightning",
     "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
     "loras", "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"),
    ("fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA",
     "qwen-image-edit-2511-multiple-angles-lora.safetensors",
     "loras", "qwen-image-edit-2511-multiple-angles-lora.safetensors"),
]

WORKFLOW_REPO = "fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA"
WORKFLOW_FILE = "comfyui-workflow-multiple-angles.json"

# Modal Volume 持久缓存：跟旧版本共用同一个 Volume 名字（内容换成新布局）。
model_volume = modal.Volume.from_name("camera-angle-models", create_if_missing=True)
MODEL_CACHE_PATH = "/models"

# UI 导出格式里，seed 之类数字输入旁边会带一个 UI 专用的「control_after_generate」
# 值（fixed/increment/decrement/randomize），/prompt 的 API 格式并不需要它——转换
# 时要把这几个字面量过滤掉，否则位置对不上，后面的采样参数全部错位。
_CONTROL_AFTER_GENERATE_MARKERS = {"fixed", "increment", "decrement", "randomize"}

# ============================================================================
# 姿态量化：把连续的拖拽值吸附到 LoRA 训练时用的 96 个离散机位之一
# （8 方位角 x 4 俯仰角 x 3 景别，来自 fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA
# 模型卡给出的精确映射表）
# ============================================================================

AZIMUTHS = [
    (0, "front view"),
    (45, "front-right quarter view"),
    (90, "right side view"),
    (135, "back-right quarter view"),
    (180, "back view"),
    (225, "back-left quarter view"),
    (270, "left side view"),
    (315, "front-left quarter view"),
]
ELEVATIONS = [
    (-30, "low-angle shot"),
    (0, "eye-level shot"),
    (30, "elevated shot"),
    (60, "high-angle shot"),
]
DISTANCES = [
    (0, "wide shot"),
    (50, "medium shot"),
    (100, "close-up"),
]


def _nearest_linear(value: float, options: list) -> str:
    return min(options, key=lambda o: abs(o[0] - value))[1]


def _nearest_circular(value: float, options: list, period: float = 360) -> str:
    def circular_dist(a: float, b: float) -> float:
        d = abs(a - b) % period
        return min(d, period - d)
    return min(options, key=lambda o: circular_dist(o[0], value))[1]


def build_camera_prompt(rotation: float = 0.0, tilt: float = 0.0, zoom: float = 0.0) -> str:
    """把 rotation/tilt/zoom 吸附到最近的离散机位，拼成 LoRA 要求的
    "<sks> [方位] [俯仰] [景别]" 结构化 prompt（<sks> 是训练用的触发词，逐字保留）。

    rotation: -180~180，正值=相机绕主体向右移动（沿用旧版语义，前端不用改）
    tilt: -90~90，正值=俯视；LoRA 只支持 -30~60，超出范围会钳到边界再找最近档
    zoom: 0~100，越大越靠近（沿用旧版语义），映射到 wide/medium/close 三档
    """
    azimuth = _nearest_circular(rotation % 360, AZIMUTHS)
    elevation = _nearest_linear(max(-30.0, min(60.0, tilt)), ELEVATIONS)
    distance = _nearest_linear(max(0.0, min(100.0, zoom)), DISTANCES)
    return f"<sks> {azimuth} {elevation} {distance}"


# ============================================================================
# MODAL CLASS
# ============================================================================

@app.cls(
    gpu="A100",  # 40GB VRAM
    memory=65536,  # 64GB RAM
    timeout=900,  # 15 min，首次下载模型用
    scaledown_window=300,  # 5 分钟无请求自动缩容
    volumes={MODEL_CACHE_PATH: model_volume},
)
class CameraAngle:
    """Qwen-Image-Edit-2511 + 多角度 LoRA，透过容器内常驻 ComfyUI 服务执行。"""

    @modal.enter()
    def setup(self):
        import requests
        from huggingface_hub import hf_hub_download

        print(f"[Enter] Model cache: {MODEL_CACHE_PATH}")

        # --- 1. 下载模型权重到持久 Volume（已存在则跳过），软链进 ComfyUI 的
        #        models/ 目录 ---
        for repo, path_in_repo, subdir, filename in MODEL_FILES:
            volume_dir = os.path.join(MODEL_CACHE_PATH, subdir)
            os.makedirs(volume_dir, exist_ok=True)
            volume_path = os.path.join(volume_dir, filename)
            if not os.path.exists(volume_path):
                print(f"[Enter] Downloading {filename} from {repo} ...")
                downloaded = hf_hub_download(
                    repo_id=repo, filename=path_in_repo, cache_dir="/tmp/hf_cache"
                )
                os.replace(downloaded, volume_path)
            else:
                print(f"[Enter] Cached: {filename}")

            comfy_dir = os.path.join(COMFYUI_ROOT, "models", subdir)
            os.makedirs(comfy_dir, exist_ok=True)
            comfy_path = os.path.join(comfy_dir, filename)
            if not os.path.exists(comfy_path):
                os.symlink(volume_path, comfy_path)

        # --- 2. 下载工作流模板（体积很小）---
        workflow_volume_path = os.path.join(MODEL_CACHE_PATH, WORKFLOW_FILE)
        if not os.path.exists(workflow_volume_path):
            downloaded = hf_hub_download(
                repo_id=WORKFLOW_REPO, filename=WORKFLOW_FILE, cache_dir="/tmp/hf_cache"
            )
            os.replace(downloaded, workflow_volume_path)
        with open(workflow_volume_path) as f:
            ui_workflow = json.load(f)

        model_volume.commit()

        # --- 3. 启动 headless ComfyUI ---
        print("[Enter] Starting ComfyUI server...")
        self.comfy_process = subprocess.Popen(
            ["python", "main.py", "--listen", "127.0.0.1", "--port", str(COMFYUI_PORT)],
            cwd=COMFYUI_ROOT,
        )
        self._wait_for_comfyui_ready()

        # --- 4. UI 格式 -> API 格式（问 ComfyUI 自己的 /object_info 要每个节点类型
        #        的权威输入 schema，而不是硬编码参数名）---
        self.api_workflow_template = self._convert_ui_to_api(ui_workflow)

        print("[Enter] Ready.")

    def _wait_for_comfyui_ready(self, timeout: int = 180):
        import requests

        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                r = requests.get(f"http://127.0.0.1:{COMFYUI_PORT}/system_stats", timeout=3)
                if r.status_code == 200:
                    return
            except requests.RequestException:
                pass
            time.sleep(1)
        raise RuntimeError("ComfyUI 服务在超时时间内没有就绪")

    def _convert_ui_to_api(self, ui_workflow: dict) -> dict:
        """把 ComfyUI 网页端导出的 UI 格式（nodes/links 数组）转成 /prompt 接口
        需要的 API 格式（{node_id: {class_type, inputs}}）。

        widgets_values 是按节点类型固定顺序排列的位置参数，顺序由节点类型自己的
        INPUT_TYPES() 决定——直接问正在跑的 ComfyUI 服务的 /object_info 接口拿权威
        schema，不猜每个节点类型的参数名，官方 workflow 以后更新了也不用跟着改。
        """
        import requests

        links_by_id = {link[0]: link for link in ui_workflow["links"]}
        object_info_cache: dict = {}

        def get_object_info(node_type: str) -> dict:
            if node_type not in object_info_cache:
                r = requests.get(
                    f"http://127.0.0.1:{COMFYUI_PORT}/object_info/{node_type}", timeout=10
                )
                r.raise_for_status()
                object_info_cache[node_type] = r.json()[node_type]
            return object_info_cache[node_type]

        api_workflow: dict = {}
        for node in ui_workflow["nodes"]:
            node_type = node["type"]
            if node_type == "Note":
                continue  # 纯注释节点，不参与执行

            node_id = str(node["id"])
            inputs: dict = {}
            linked_names = set()

            for inp in node.get("inputs") or []:
                linked_names.add(inp["name"])
                if inp.get("link") is not None:
                    link = links_by_id[inp["link"]]
                    origin_node_id, origin_slot = link[1], link[2]
                    inputs[inp["name"]] = [str(origin_node_id), origin_slot]
                # link 为 None 的可选输入（比如 image2/image3）直接不写，
                # ComfyUI 对声明为可选的输入允许缺省。

            widgets_values = node.get("widgets_values")
            if widgets_values:
                filtered_values = [
                    v for v in widgets_values if v not in _CONTROL_AFTER_GENERATE_MARKERS
                ]
                info = get_object_info(node_type)
                ordered_widget_names = [
                    name
                    for group in ("required", "optional")
                    for name in info.get("input", {}).get(group, {})
                    if name not in linked_names
                ]
                for name, value in zip(ordered_widget_names, filtered_values):
                    inputs[name] = value

            api_workflow[node_id] = {"class_type": node_type, "inputs": inputs}

        return api_workflow

    def _wait_for_result(self, prompt_id: str, timeout: int = 300) -> bytes:
        import requests

        deadline = time.time() + timeout
        while time.time() < deadline:
            r = requests.get(f"http://127.0.0.1:{COMFYUI_PORT}/history/{prompt_id}", timeout=10)
            history = r.json()
            if prompt_id in history:
                outputs = history[prompt_id]["outputs"]
                for node_output in outputs.values():
                    if "images" in node_output:
                        img_info = node_output["images"][0]
                        img_resp = requests.get(
                            f"http://127.0.0.1:{COMFYUI_PORT}/view",
                            params={
                                "filename": img_info["filename"],
                                "subfolder": img_info.get("subfolder", ""),
                                "type": img_info.get("type", "output"),
                            },
                            timeout=30,
                        )
                        img_resp.raise_for_status()
                        return img_resp.content
                raise RuntimeError("ComfyUI 执行完成，但 history 里没有图片输出")
            time.sleep(1)
        raise RuntimeError(f"等待 ComfyUI 生成结果超过 {timeout} 秒")

    @modal.fastapi_endpoint(method="POST")
    def generate(self, request: dict) -> dict:
        """Generate camera angle adjusted image."""
        import base64
        import random

        import requests

        image_b64 = request.get("image", "")
        rotation = request.get("rotation", 0.0)
        tilt = request.get("tilt", 0.0)
        zoom = request.get("zoom", 0.0)
        seed = request.get("seed")
        num_steps = request.get("num_steps", 4)

        print("=" * 60)
        print("[Generate] Received request:")
        print(f"  rotation: {rotation}  tilt: {tilt}  zoom: {zoom}  seed: {seed}")

        prompt_text = build_camera_prompt(rotation, tilt, zoom)
        print(f"[Generate] Built prompt: {prompt_text}")
        print("=" * 60)

        if rotation == 0 and tilt == 0 and zoom == 0:
            print("[Generate] No movement - returning original image")
            return {"image": image_b64, "prompt": prompt_text, "seed": 0}

        if "," in image_b64:
            image_b64 = image_b64.split(",")[1]
        image_bytes = base64.b64decode(image_b64)

        # 把输入图写进 ComfyUI 的 input 目录，LoadImage 节点靠文件名读取。
        input_filename = f"input_{uuid.uuid4().hex}.png"
        input_path = os.path.join(COMFYUI_ROOT, "input", input_filename)
        with open(input_path, "wb") as f:
            f.write(image_bytes)

        if seed is None:
            seed = random.randint(0, 2**32 - 1)

        # 深拷贝模板，按本次请求 patch 输入图片 / 角度 prompt / seed / steps。
        workflow = json.loads(json.dumps(self.api_workflow_template))
        for node in workflow.values():
            if node["class_type"] == "LoadImage":
                node["inputs"]["image"] = input_filename
            elif node["class_type"] == "TextEncodeQwenImageEditPlus":
                # 官方模板里两个 TextEncodeQwenImageEditPlus 节点，一个是负向
                # prompt（模板里留空），一个是承载角度描述的正向 prompt——用
                # 「模板原本非空」这个特征区分，不写死具体节点 id，避免官方
                # workflow 改了节点编号就失效。
                if str(node["inputs"].get("prompt", "")).strip():
                    node["inputs"]["prompt"] = prompt_text
            elif node["class_type"] == "KSampler":
                node["inputs"]["seed"] = seed
                node["inputs"]["steps"] = num_steps

        start_time = time.time()
        resp = requests.post(
            f"http://127.0.0.1:{COMFYUI_PORT}/prompt",
            json={"prompt": workflow, "client_id": uuid.uuid4().hex},
            timeout=30,
        )
        resp.raise_for_status()
        prompt_id = resp.json()["prompt_id"]

        result_image_bytes = self._wait_for_result(prompt_id, timeout=300)
        inference_time = (time.time() - start_time) * 1000

        result_b64 = base64.b64encode(result_image_bytes).decode("utf-8")
        os.remove(input_path)

        return {
            "image": result_b64,
            "prompt": prompt_text,
            "seed": seed,
            "inference_time_ms": inference_time,
        }

    @modal.fastapi_endpoint(method="GET")
    def health(self) -> dict:
        """Health check endpoint."""
        return {"status": "ok", "model": "Qwen-Image-Edit-2511 Camera Angle Control (ComfyUI)"}


# ============================================================================
# LOCAL TESTING
# ============================================================================

@app.local_entrypoint()
def main():
    """Test the model locally."""
    print("Testing Camera Angle Control...")
    camera = CameraAngle()
    print(camera.health.remote())
    print("Test complete!")
