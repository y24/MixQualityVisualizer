"""Transparent, versioned signal descriptors. No inferred quality scores.

Band energy uses Parseval-normalized, one-sided Hann STFT power. All ratios
share the same frame grid. NaN means unmeasurable and is serialized as null.
"""
from __future__ import annotations

import math
import json
from pathlib import Path
import numpy as np
from scipy import signal, ndimage, fft
import soundfile as sf
import pyloudnorm as pyln

VERSION = json.loads((Path(__file__).resolve().parents[1]/"analysis-version.json").read_text(encoding="utf-8"))["version"]
SR = 44100
FLOOR = 1e-12
PARTS = ("vocals", "drums", "bass", "other")
BROAD_EDGES = np.array([20, 60, 200, 500, 2000, 6000, 20000.])
BROAD_NAMES = ["20–60 Hz", "60–200 Hz", "200–500 Hz", "500 Hz–2 kHz", "2–6 kHz", "6–20 kHz"]
ERB_EDGES = (10 ** (np.linspace(21.4*np.log10(1+.00437*20), 21.4*np.log10(1+.00437*20000), 33)/21.4)-1)/.00437


def load_audio(path):
    x, sr = sf.read(str(path), dtype="float32", always_2d=True)
    if x.shape[1] not in (1, 2):
        raise ValueError("モノラル／ステレオ音源のみ対応しています。")
    if len(x) < sr * .4:
        raise ValueError("0.4秒以上の音源を選んでください。")
    if not np.isfinite(x).all():
        raise ValueError("音源に不正なサンプル値が含まれています。")
    channels = x.shape[1]
    if channels == 1:
        x = np.repeat(x, 2, axis=1)
    if sr != SR:
        d = math.gcd(sr, SR)
        x = signal.resample_poly(x, SR//d, sr//d, axis=0).astype(np.float32)
    return x, {"source_sample_rate": sr, "source_channels": channels, "analysis_sample_rate": SR}


def db_ratio(a, b):
    a, b = np.broadcast_arrays(a, b)
    result = np.full(a.shape, np.nan, dtype=float)
    ok = (a > FLOOR) & (b > FLOOR)
    result[ok] = 10*np.log10(a[ok]/b[ok])
    return result


def fraction(a, total):
    a, total = np.broadcast_arrays(a, total)
    return np.divide(100*a, total, out=np.full(a.shape, np.nan), where=total > FLOOR)


def summary(values):
    v = np.asarray(values, dtype=float)
    v = v[np.isfinite(v)]
    return {"median": float(np.median(v)) if len(v) else None,
            "p10": float(np.percentile(v, 10)) if len(v) else None,
            "p90": float(np.percentile(v, 90)) if len(v) else None,
            "count": len(v)}


def clean(value):
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, np.ndarray):
        # Convert NumPy scalars in bulk; preserve Python's existing rounding.
        return clean(value.tolist())
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if isinstance(value, (float, np.floating)):
        return round(float(value), 6) if np.isfinite(value) else None
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def components(x):
    return np.column_stack(((x[:, 0]+x[:, 1])/np.sqrt(2), (x[:, 0]-x[:, 1])/np.sqrt(2)))


def band_power(x, max_freq=20000):
    """Return [frames, bands, L/R] on one fixed 50ms grid; bounded FFT memory."""
    nfft, hop = 4096, 2205
    centers = np.arange(0, len(x), hop)
    padded = np.pad(x, ((nfft//2, nfft//2), (0, 0)))
    f = fft.rfftfreq(nfft, 1/SR)
    # Separate banks so broad-band boundaries stay exact in the sampled FFT grid.
    banks = [ERB_EDGES, BROAD_EDGES]
    limits = [(min(lo,max_freq),min(hi,max_freq)) for bank in banks for lo,hi in zip(bank[:-1],bank[1:])]
    starts = np.array([np.searchsorted(f,lo) for lo,hi in limits])
    stops = np.array([np.searchsorted(f,hi) for lo,hi in limits])
    window = signal.windows.hann(nfft, sym=False).astype(np.float32)
    scale = np.full(len(f), 2/(nfft*np.sum(window**2)), dtype=np.float32)
    scale[[0, -1]] *= .5
    out = np.empty((len(centers), len(limits), 2), dtype=np.float32)
    # A strided view avoids building/copying a large integer-indexed frame array.
    frames_view = np.lib.stride_tricks.sliding_window_view(padded, nfft, axis=0)[::hop].transpose(0, 2, 1)
    for start in range(0, len(centers), 192):
        c = centers[start:start+192]
        frames = frames_view[start:start+len(c)] * window[None, :, None]
        z = fft.rfft(frames, axis=1)
        power = (z.real**2+z.imag**2)*scale[None, :, None]
        cumulative = np.concatenate([np.zeros((len(c),1,2)),np.cumsum(power,axis=1,dtype=np.float64)],axis=1)
        out[start:start+len(c)] = cumulative[:,stops]-cumulative[:,starts]
    return centers/SR, out


def window_power(x, times, seconds=.4, k_weight=False):
    return window_powers(x, times, (seconds,), k_weight)[0]


def window_powers(x, times, durations=(.4, 3.), k_weight=False):
    """Reuse the exact same filtering and cumulative power for multiple windows."""
    if k_weight:
        meter = pyln.Meter(SR)
        x = x.astype(np.float64)
        for filt in meter._filters.values():
            x = signal.lfilter(filt.b, filt.a, x, axis=0)*filt.passband_gain
    p = np.mean(np.square(x, dtype=np.float64), axis=1)
    c = np.r_[0., np.cumsum(p)]
    centers = np.rint(times*SR).astype(int)
    result = []
    for seconds in durations:
        lo = np.maximum(0, centers-int(seconds*SR/2))
        hi = np.minimum(len(x), centers+int(seconds*SR/2))
        result.append((c[hi]-c[lo])/np.maximum(1, hi-lo))
    return result


def activity(p):
    # Energy gate, deliberately NOT claimed to be a trained singing detector.
    return p > max(1e-10, float(np.percentile(p, 95))*10**(-3.5))


def competition(target, rest, active):
    total = target.sum(axis=1)
    # Reject negligible bands relative to the target's own active frame.
    valid = (target > np.maximum(1e-12, total[:, None]*1e-3)) & active[:, None]
    ratio = db_ratio(target, rest)
    ratio[~valid] = np.nan
    weight = np.where(valid, target, 0)
    denom = weight.sum(axis=1)
    score = fraction((weight*(rest > target)).sum(axis=1), denom)
    return {"ratio": ratio, "rate": score}


def transients(x):
    """Energy-envelope onset prototype; no instrument classification."""
    step = 44  # ~1ms, independent of spectral frame spacing
    raw = np.sqrt(np.mean(x.astype(np.float64)**2, axis=1))
    env = np.sqrt(np.maximum(0, ndimage.uniform_filter1d(raw**2, size=89, mode="nearest")))[::step]
    dt = step/SR
    lagged = np.r_[np.zeros(4),env[:-4]]
    previous_peak = ndimage.maximum_filter1d(lagged, size=21, origin=10, mode="constant", cval=0)
    novelty = np.maximum(0, env-previous_peak); novelty[:4] = 0
    floor = max(1e-6, float(env.max())*.025)
    peaks, _ = signal.find_peaks(novelty, height=floor, prominence=floor*.6, distance=int(.045/dt))
    events = []
    for j, index in enumerate(peaks):
        start_search = max(0, index-int(.025/dt))
        p = index+int(np.argmax(env[index:min(len(env), index+int(.035/dt))]))
        base = float(np.percentile(env[start_search:index+1], 10))
        height = env[p]-base
        if height <= floor:
            continue
        rising = env[start_search:p+1]
        ids10 = np.flatnonzero(rising >= base+.1*height)
        ids90 = np.flatnonzero(rising >= base+.9*height)
        if not len(ids10) or not len(ids90):
            continue
        onset = start_search+int(ids10[0])
        t = onset*dt
        next_t = peaks[j+1]*dt if j+1 < len(peaks) else len(x)/SR
        isolated = next_t-t >= .15 and t+.15 <= len(x)/SR
        attack = body = crest = relative = np.nan
        if isolated:
            a = x[int(t*SR):int((t+.03)*SR)]
            b = x[int((t+.05)*SR):int((t+.15)*SR)]
            attack, body = float(np.mean(a*a)), float(np.mean(b*b))
            segment = x[int(t*SR):int((t+.15)*SR)]
            channel_cf = db_ratio(np.max(segment**2, axis=0), np.mean(segment**2, axis=0))
            crest = float(np.max(channel_cf[np.isfinite(channel_cf)])) if np.isfinite(channel_cf).any() else np.nan
        # A sustained crossing must occur before another hit or the 500ms cap.
        end = min(len(env), int(min(next_t, t+.5)/dt))
        threshold = base+height*.1
        decay = np.nan
        hold = max(1, int(.01/dt))
        for k in range(p+1, max(p+1, end-hold)):
            if np.all(env[k:k+hold] <= threshold):
                # Reject measurements whose noise floor obscures a 20dB decay.
                if base < height*.1:
                    decay = (k-p)*dt*1000
                break
        events.append({"time": t, "attack_ms": (ids90[0]-ids10[0])*dt*1000,
                       "attack_body_db": float(db_ratio(attack, body)), "crest_db": crest,
                       "decay_ms": decay, "isolated": isolated,
                       "envelope": env[max(0,onset-10):min(len(env),onset+240):3],
                       "envelope_step_ms": dt*3000, "envelope_origin_ms": -min(10,onset)*dt*1000})
    return {"events": events, "detected": len(peaks), "measured": len(events),
            "method": "energy-envelope-v1 (not instrument classified)",
            "summary": {k: summary([e[k] for e in events]) for k in ("attack_ms", "attack_body_db", "crest_db", "decay_ms")}}


def analyze(mix, stems=None, metadata=None, progress=lambda *_: None):
    stems = stems or {}
    meta = metadata or {}
    max_freq = min(20000, meta.get("source_sample_rate", SR)/2)
    progress(55, "元音源の帯域・M/Sを解析中")
    times, lr = band_power(mix, max_freq)
    _, ms = band_power(components(mix), max_freq)
    total = lr.sum(axis=2)
    mid, side = ms[:, :, 0], ms[:, :, 1]
    broad = total[:, 32:]
    full = broad.sum(axis=1)
    mfull, sfull = mid[:, 32:].sum(axis=1), side[:, 32:].sum(axis=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        loudness = float(pyln.Meter(SR).integrated_loudness(mix))
    gain_power = 10**((-23-loudness)/10) if np.isfinite(loudness) else 1.
    occupancy = np.mean(total[:, :32]*gain_power > 10**(-55/10), axis=1)*100
    occupancy[full < FLOOR] = np.nan
    side_pct = fraction(sfull, mfull+sfull)
    # Windowed, DC-removed zero-lag correlation and level balance.
    pl = window_power(mix[:, :1], times)
    pr = window_power(mix[:, 1:], times)
    corr = np.full(len(times), np.nan)
    for i, t in enumerate(times):
        segment = mix[max(0,int((t-.2)*SR)):min(len(mix),int((t+.2)*SR))].astype(float)
        segment -= segment.mean(axis=0)
        power = np.mean(segment**2, axis=0)
        if np.all(power > FLOOR):
            corr[i] = np.clip(np.mean(segment[:,0]*segment[:,1])/np.sqrt(np.prod(power)), -1, 1)
    series = {"low_pct": fraction(broad[:, :2].sum(axis=1), full),
              "low_normalized_db": 10*np.log10(np.maximum(broad[:, :2].sum(axis=1)*gain_power,FLOOR)),
              "sub_pct": fraction(broad[:, 0], full), "side_pct": side_pct,
              "sm_db": db_ratio(sfull, mfull), "mono_db": db_ratio(mfull, mfull+sfull),
              "density_pct": occupancy, "correlation": corr, "lr_db": db_ratio(pl, pr)}
    heatmaps = {"side_pct": fraction(side[:, :32], mid[:, :32]+side[:, :32]),
                "mono_db": db_ratio(mid[:, :32], mid[:, :32]+side[:, :32]),
                "spectrum_db": 10*np.log10(np.maximum(total[:, :32], FLOOR))}
    band_denom = 2*np.sqrt(lr[:, :32, 0]*lr[:, :32, 1])
    heatmaps["band_correlation"] = np.clip(np.divide(mid[:, :32]-side[:, :32],band_denom,
        out=np.full(band_denom.shape,np.nan),where=(lr[:, :32,0]>FLOOR)&(lr[:, :32,1]>FLOOR)),-1,1)
    series["low_normalized_db"][full<FLOOR] = np.nan
    part_results = {}
    stem_bands = []
    for n, (name, x) in enumerate(stems.items()):
        progress(65+n*6, f"{name} の相対音量・帯域競合を解析中")
        rest = sum((v for k,v in stems.items() if k != name), np.zeros_like(x))
        p, p_long = window_powers(x, times, k_weight=True)
        r, r_long = window_powers(rest, times, k_weight=True)
        active = activity(p)
        ratios = db_ratio(p, r); ratios[~active] = np.nan
        long = db_ratio(p_long, r_long); long[~active] = np.nan
        series[name+"_db"] = ratios
        series[name+"_short_db"] = long
        _, xb = band_power(x, max_freq)
        _, rb = band_power(rest, max_freq)
        xb, rb = xb.sum(axis=2), rb.sum(axis=2)
        stem_bands.append(xb[:, :32])
        c = competition(xb[:, :32], rb[:, :32], active)
        series[name+"_competition"] = c["rate"]
        heatmaps[name+"_competition"] = c["ratio"]
        _, xm = band_power(components(x), max_freq)
        _, rm = band_power(components(rest), max_freq)
        for channel, label in enumerate(("mid", "side")):
            comp = competition(xm[:, :32, channel], rm[:, :32, channel], active)
            series[name+"_"+label+"_competition"] = comp["rate"]
            heatmaps[name+"_"+label+"_competition"] = comp["ratio"]
        part_results[name] = {"activity_pct": float(active.mean()*100),
                              "low_power": float(xb[:, 32:34].sum(axis=1).mean()),
                              "summary": summary(ratios)}
    if stem_bands:
        stack = np.stack(stem_bands)
        maximum = stack.max(axis=0)
        live = maximum > np.maximum(FLOOR, maximum.max(axis=1)[:,None]*.001)
        count = ((stack >= maximum[None]*10**(-12/10)) & live[None]).sum(axis=0)
        series["congestion_pct"] = fraction(((count>=2)*live).sum(axis=1), live.sum(axis=1))
    transient_result = None
    if "drums" in stems:
        progress(91, "ドラムのトランジェントを解析中")
        transient_result = transients(stems["drums"])
        rest = sum((v for k,v in stems.items() if k != "drums"), np.zeros_like(mix))
        for event in transient_result["events"]:
            t = event["time"]
            lo, hi = int(t*SR), min(len(mix), int((t+.05)*SR))
            event["relative_db"] = float(db_ratio(np.mean(stems["drums"][lo:hi]**2), np.mean(rest[lo:hi]**2)))
    warnings = ["帯域競合は聞き取れない確率ではありません。", "活動区間はエネルギーによる暫定検出です。歌唱区間の自動認識は未実装です。"]
    if not stems:
        warnings.append("ステム未指定：パート別の相対音量・競合・ドラム特性は対象外です。")
    if max_freq < 20000:
        warnings.append("入力の周波数上限が20 kHz未満です。帯域比率の比較には同じ上限の音源を使用してください。")
    if stems:
        residual = mix-sum(stems.values(), np.zeros_like(mix))
        residual_db = float(db_ratio(np.mean(residual.astype(float)**2), np.mean(mix.astype(float)**2)))
        if np.isfinite(residual_db) and residual_db > -25:
            warnings.append("ステム合計と元音源に差があります。マスター処理・タイミング・書き出しを確認してください。")
    else:
        residual_db = np.nan
    progress(97, "結果を保存中")
    return clean({"version": VERSION, "duration": len(mix)/SR, "metadata": meta,
                  "max_frequency": max_freq, "loudness_lufs": loudness, "times": times,
                  "series": series, "summary": {k: summary(v) for k,v in series.items()},
                  "heatmaps": heatmaps, "band_centers": np.sqrt(ERB_EDGES[:-1]*ERB_EDGES[1:]),
                  "broad_names": BROAD_NAMES,
                  "broad_pct": fraction(broad.mean(axis=0), full.mean()),
                  "mid_spectrum": 10*np.log10(np.maximum(mid[:, :32].mean(axis=0), FLOOR)),
                  "side_spectrum": 10*np.log10(np.maximum(side[:, :32].mean(axis=0), FLOOR)),
                  "parts": part_results, "transients": transient_result,
                  "residual_db": residual_db, "warnings": warnings})
