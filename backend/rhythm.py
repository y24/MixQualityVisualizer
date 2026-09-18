"""Fixed-tempo pulse proposal and compact power envelopes, not downbeat detection."""
import numpy as np
from scipy import signal, ndimage


def rhythm(drums, rest, sr=44100):
    hop = sr//100
    dt = hop/sr
    def power(x):
        n = len(x)//hop
        # No stereo cancellation; exclude the incomplete final 10 ms block.
        return np.mean(np.square(x[:n*hop].reshape(n,hop,2), dtype=np.float64),axis=(1,2))
    p, r = power(drums), power(rest)
    amplitude = np.sqrt(p)
    novelty = np.maximum(0, amplitude-np.r_[amplitude[0], amplitude[:-1]])
    novelty = np.maximum(0, novelty-ndimage.uniform_filter1d(novelty,21))
    maximum = float(novelty.max())
    if maximum > 0:
        novelty /= maximum
    def db(x):
        return np.where(x>1e-12,10*np.log10(np.maximum(x,1e-12)),np.nan)
    result = {'step':dt, 'drum_dbfs':db(p), 'rest_dbfs':db(r),
              'bpm':None, 'offset':None, 'periodicity':0., 'candidates':[],
              'method':'fixed-tempo autocorrelation, 60–200 BPM, 10 ms envelope',
              'status':'insufficient'}
    if len(p)<400 or maximum<1e-6 or np.count_nonzero(novelty>.2)<4:
        return result
    y = novelty-novelty.mean()
    ac = signal.correlate(y,y,mode='full',method='fft')[len(y)-1:]
    energy = np.r_[0.,np.cumsum(y*y)]
    lags = np.arange(30,101)
    denom = np.sqrt(energy[len(y)-lags]*(energy[-1]-energy[lags]))
    score = np.divide(ac[lags],denom,out=np.zeros(len(lags)),where=denom>1e-12)
    peaks,_ = signal.find_peaks(np.r_[-np.inf,score,-np.inf])
    peaks = peaks-1
    # Slight tie-break preference near 120 BPM; keep alternatives visible.
    ranked = sorted(peaks,key=lambda i:score[i]-.02*abs(np.log2((60/(lags[i]*dt))/120)),reverse=True)
    for i in ranked[:3]:
        result['candidates'].append({'bpm':float(60/(lags[i]*dt)), 'periodicity':float(max(0,score[i]))})
    if not ranked:
        return result
    best = ranked[0]
    period = int(lags[best])
    periodicity = float(np.clip(score[best],0,1))
    result['periodicity'] = periodicity
    if periodicity < .25:
        result['status']='uncertain'
        return result
    # Sum onset evidence per phase; no snapping that would conceal drift.
    phase = int(np.argmax([novelty[i::period].sum() for i in range(period)]))
    result.update(bpm=float(60/(period*dt)), offset=phase*dt, status='estimated')
    return result
