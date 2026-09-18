"""One local job per process, JSON lines on stdout. Audio never leaves the PC."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import sys
import traceback
import contextlib
import numpy as np
import soundfile as sf
from .analysis import VERSION, SR, PARTS, load_audio, analyze
from .devices import choose_device, runtime_info

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / ".data"
os.environ.setdefault("TORCH_HOME", str(DATA / "models"))


def emit(kind, **data):
    print(json.dumps({"type": kind, **data}, ensure_ascii=False, allow_nan=False), flush=True)


def progress(percent, message):
    emit("progress", percent=percent, message=message)


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024*1024), b""):
            h.update(chunk)
    return h.hexdigest()


def separate(mix, model_name, device="auto"):
    import torch
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    if model_name not in ("htdemucs", "htdemucs_ft"):
        raise ValueError("未対応の分離モデルです。")
    progress(8, "分離モデルを準備中（初回はダウンロード）")
    torch.manual_seed(0)
    import random
    random.seed(0)
    torch.set_num_threads(max(1, min(8, os.cpu_count() or 2)))
    device = choose_device(device)
    # Demucs' progress and library output must not corrupt the JSON protocol.
    with contextlib.redirect_stdout(sys.stderr):
        model = get_model(model_name)
    model.eval()
    progress(12, f"4パートに分離中 / {device.upper()}（数分以上かかる場合があります）")
    with contextlib.redirect_stdout(sys.stderr):
        tensor = torch.from_numpy(mix.T.copy())
        ref = tensor.mean(0)
        mean, std = ref.mean(), ref.std()
        # Anti-phase audio can have a silent mean channel; use stereo RMS then.
        if std < 1e-8:
            mean = tensor.mean()
            std = tensor.std()
        if std < 1e-8:
            return {k: np.zeros_like(mix) for k in PARTS}, device
        tensor = (tensor-mean)/std
        try:
            with torch.inference_mode():
                sources = apply_model(model, tensor[None], device=device, shifts=1, overlap=.25,
                                      split=True, progress=True, num_workers=0)[0]
        except torch.cuda.OutOfMemoryError as exc:
            raise RuntimeError("GPUメモリが不足しました。GPUを使う他のアプリを閉じるか、分離デバイスをCPUに変更して再実行してください。") from exc
        sources = (sources*std+mean).cpu().numpy()
    return {name: sources[i].T.astype(np.float32) for i,name in enumerate(model.sources)}, device


def run(request):
    path = Path(request["path"]).resolve()
    mode = request.get("mode", "separate")
    model = request.get("model", "htdemucs")
    if mode not in ("separate", "stems", "mix"):
        raise ValueError("解析モードが不正です。")
    requested_device = request.get("device", "auto") if mode == "separate" else None
    hardware = runtime_info() if mode == "separate" else None
    selected_device = choose_device(requested_device, hardware) if hardware else None
    device_label = next((g["name"] for g in hardware["gpus"] if g["id"]==selected_device), "CPU") if hardware else None
    # Device/engine-specific caches make an explicit CPU/GPU switch unambiguous.
    compute_key = {"device": selected_device, "torch":hardware["torch_version"], "gpu":device_label} if hardware else None
    stems_paths = request.get("stems", {}) if mode == "stems" else {}
    if mode == "stems" and set(stems_paths) != set(PARTS):
        raise ValueError("ボーカル・ドラム・ベース・その他の4ステムを指定してください。無音パートも同じ長さで書き出してください。")
    progress(2, "ファイルを確認中")
    fingerprints = {"mix": digest(path), **{k: digest(v) for k,v in sorted(stems_paths.items())}}
    cache_spec = {"files": fingerprints, "mode": mode, "model": model if mode=="separate" else None,"version": VERSION}
    if compute_key is not None:
        cache_spec["compute"] = compute_key
    key = hashlib.sha256(json.dumps(cache_spec, sort_keys=True).encode()).hexdigest()[:24]
    directory = DATA / "analyses" / key
    result_path = directory / "result.json"
    if result_path.exists():
        result = json.loads(result_path.read_text(encoding="utf-8"))
        if all(Path(p).exists() for p in result["media_paths"].values()):
            result.update(name=path.stem, source=str(path), cached=True, requested_device=requested_device)
            return result
    directory.mkdir(parents=True, exist_ok=True)
    mix, metadata = load_audio(path)
    stems, device, separation_cached = {}, None, False
    if mode == "stems":
        for name in PARTS:
            x, stem_meta = load_audio(stems_paths[name])
            if abs(len(x)-len(mix)) > 2:
                raise ValueError(f"{name}: ステムとミックスの長さが一致しません。同じ開始位置・終了位置で書き出してください。")
            if stem_meta["source_sample_rate"] != metadata["source_sample_rate"]:
                raise ValueError(f"{name}: ミックスと同じサンプルレートで書き出してください。")
            stems[name] = x[:len(mix)] if len(x)>=len(mix) else np.pad(x, ((0,len(mix)-len(x)),(0,0)))
    elif mode == "separate":
        # Reuse lossless separation across analysis algorithm revisions.
        separation_key = hashlib.sha256(json.dumps({"mix":fingerprints["mix"],"model":model,"separation_version":1,"compute":compute_key},sort_keys=True).encode()).hexdigest()[:24]
        separation_dir = DATA / "separated" / separation_key
        manifest = separation_dir / "complete.json"
        if manifest.exists() and all((separation_dir/f"{k}.wav").exists() for k in PARTS):
            progress(50,"保存済みの分離ステムを読み込み中")
            for name in PARTS:
                x, sr = sf.read(separation_dir/f"{name}.wav",dtype="float32",always_2d=True)
                if x.shape!=mix.shape or sr!=SR:
                    raise ValueError("分離キャッシュが不正です。.data/separated内の該当キャッシュを確認してください。")
                stems[name]=x
            device = json.loads(manifest.read_text(encoding="utf-8")).get("device")
            separation_cached = True
        else:
            stems, device = separate(mix, model, selected_device)
            separation_dir.mkdir(parents=True,exist_ok=True)
            for name,x in stems.items():
                sf.write(separation_dir/f"{name}.wav",x,SR,subtype="FLOAT")
            manifest.write_text(json.dumps({"device":device,"model":model}),encoding="utf-8")
    if mode == "separate":
        # Demucs model order, also used for legacy manifests. Float32 summation
        # must use the same order on fresh and cached separation paths.
        stems = {name: stems[name] for name in ("drums", "bass", "other", "vocals")}
    result = analyze(mix, stems, metadata, progress)
    # One shared preview gain avoids clipping without changing stem balance.
    peak = max(float(np.max(np.abs(x))) for x in [mix, *stems.values()])
    preview_gain = min(1., .98/max(peak, 1e-12))
    mid = mix.mean(axis=1)
    side = (mix[:,0]-mix[:,1])/2
    media = {"mix": mix, "mid": np.column_stack([mid,mid]),
             "side": np.column_stack([side,-side]), "mono": np.column_stack([mid,mid]), **stems}
    media_paths = {}
    for name, x in media.items():
        out = directory / f"{name}.wav"
        sf.write(out, x*preview_gain, SR, subtype="PCM_16")
        media_paths[name] = str(out)
    result.update(id=key, name=path.stem, source=str(path), mode=mode, model=model if mode=="separate" else None,
                  device=device, device_label=device_label, requested_device=requested_device,
                  compute=compute_key, separation_cached=separation_cached, cached=False, media_paths=media_paths,
                  preview_gain_db=20*np.log10(preview_gain), source_fingerprints=fingerprints)
    temp = directory / "result.partial.json"
    temp.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    temp.replace(result_path)
    return result


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    try:
        request = json.loads(sys.stdin.readline())
        if request.get("action") == "health":
            emit("result", result={"python": sys.version.split()[0], **runtime_info(),
                                  "model_ready": any((DATA/"models"/"hub"/"checkpoints").glob("*.th"))})
        else:
            emit("result", result=run(request))
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        emit("error", message=str(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
