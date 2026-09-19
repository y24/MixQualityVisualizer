"""Timbral boundary proposals, not verse/chorus or downbeat recognition.

Box checkerboard novelty equals squared distance between local feature means;
compute that directly to avoid a quadratic self-similarity matrix.
"""
import numpy as np
from scipy.signal import find_peaks


def structure(band_power, times, duration):
    step, context = .5, 4.
    count = int(np.ceil(duration/step))
    pooled = np.zeros((count, band_power.shape[1]), dtype=np.float64)
    indices = np.minimum((np.asarray(times)/step).astype(int), count-1)
    np.add.at(pooled, indices, band_power)
    counts = np.bincount(indices, minlength=count)
    pooled /= np.maximum(counts, 1)[:, None]
    energy = pooled.sum(axis=1)
    active = energy > max(1e-12, float(energy.max(initial=0))*1e-6)
    # Square-root spectral proportions: scalar gain changes alone are ignored.
    features = np.sqrt(np.divide(pooled, energy[:, None],
                       out=np.zeros_like(pooled), where=active[:, None]))
    cumulative = np.vstack([np.zeros(pooled.shape[1]), np.cumsum(features, axis=0)])
    radius = int(context/step)
    novelty = np.zeros(count)
    # Require complete context on both sides and a full last bin.
    for i in range(radius, int(duration/step)-radius+1):
        left = (cumulative[i]-cumulative[i-radius])/radius
        right = (cumulative[i+radius]-cumulative[i])/radius
        novelty[i] = np.sum((right-left)**2)/2
    peaks, _ = find_peaks(novelty, height=.12, prominence=.08, distance=int(8/step))
    boundaries = [{'time':float(i*step), 'novelty':float(novelty[i])} for i in peaks]
    edges = [0.] + [b['time'] for b in boundaries] + [float(duration)]
    return {'times':np.arange(count)*step, 'novelty':novelty, 'boundaries':boundaries,
            'segments':[{'start':a, 'end':b} for a,b in zip(edges[:-1],edges[1:])],
            'status':'insufficient' if duration<2*context else 'proposed' if boundaries else 'no_change',
            'method':'ERB spectral proportions / 0.5 s bins / 4 s context each side / 8 s minimum spacing',
            'threshold':.12, 'prominence':.08}
