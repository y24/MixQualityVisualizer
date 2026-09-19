"""Discover CUDA capability and validate user-selected separation devices."""
from __future__ import annotations


def runtime_info():
    import torch
    devices = []
    reason = None
    try:
        if torch.cuda.is_available():
            for index in range(torch.cuda.device_count()):
                properties = torch.cuda.get_device_properties(index)
                devices.append({"id": f"cuda:{index}", "name": properties.name,
                                "memory_gb": round(properties.total_memory / 1024**3, 1)})
        elif torch.version.cuda is None:
            reason = "CPU専用のPyTorchです。「解析環境」からNVIDIA GPU版をセットアップできます。"
        else:
            reason = "CUDA対応GPUを利用できません。NVIDIAドライバーとGPUの状態を確認してください。"
    except Exception as exc:
        reason = f"CUDAの確認に失敗しました: {exc}"
    return {"torch_version": torch.__version__, "cuda_version": torch.version.cuda,
            "cuda": bool(devices), "gpus": devices, "cuda_reason": reason}


def choose_device(requested="auto", info=None):
    if not isinstance(requested, str):
        raise ValueError("分離デバイスは自動・CPU・検出されたGPUから選択してください。")
    if requested == "cpu":
        return "cpu"
    info = runtime_info() if info is None else info
    ids = [gpu["id"] for gpu in info["gpus"]]
    if requested == "auto":
        return ids[0] if ids else "cpu"
    if requested == "cuda":
        requested = "cuda:0"
    if requested in ids:
        return requested
    if requested.startswith("cuda"):
        raise ValueError("選択したGPUを利用できません。CPUまたは自動を選択してください。 "
                         + (info.get("cuda_reason") or "GPU一覧を再確認してください。"))
    raise ValueError("分離デバイスの指定が不正です。")
