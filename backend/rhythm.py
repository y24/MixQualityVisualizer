"""Fixed/local tempo pulse proposals and power envelopes, not downbeat detection."""
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
    if maximum > 1e-6:
        novelty /= maximum
    else:
        novelty[:] = 0
    def db(x):
        return np.where(x>1e-12,10*np.log10(np.maximum(x,1e-12)),np.nan)
    result = {'step':dt, 'drum_dbfs':db(p), 'rest_dbfs':db(r),
              'bpm':None, 'offset':None, 'periodicity':0., 'candidates':[],
              'method':'fixed-tempo autocorrelation, 60–200 BPM, 10 ms envelope',
              'status':'insufficient'}
    result.update(estimate(novelty,dt))
    result['adaptive'] = adaptive_pulses(novelty,dt)
    return result


def estimate(novelty, dt=.01):
    result = {'bpm':None, 'offset':None, 'periodicity':0., 'candidates':[], 'status':'insufficient'}
    maximum = float(novelty.max()) if len(novelty) else 0.
    if len(novelty)<400 or maximum<1e-6 or np.count_nonzero(novelty>.2)<4:
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



def adaptive_pulses(novelty,dt=.01):
    """Local tempo proposals snapped to observed onsets; leave uncertain gaps."""
    window=int(8/dt)
    step=int(2/dt)
    duration=len(novelty)*dt
    beats=[];sections=[]
    for start in range(0,len(novelty),step):
        end=min(len(novelty),start+step)
        center=(start+end)//2
        lo=max(0,center-window//2)
        hi=min(len(novelty),lo+window)
        lo=max(0,hi-window)
        local=novelty[lo:hi]
        maximum=float(local.max()) if len(local) else 0.
        proposed=estimate(local/maximum if maximum>0 else local,dt)
        section={'start':start*dt,'end':min(duration,end*dt),
                 'bpm':proposed['bpm'],'periodicity':proposed['periodicity']}
        sections.append(section)
        if proposed['bpm'] is None or maximum<.01:continue
        period=60/proposed['bpm']
        origin=lo*dt+proposed['offset']
        first=max(0,int(np.ceil((start*dt-origin)/period)))
        radius=max(1,int(min(.08,period*.2)/dt))
        for n in range(first,first+int(2/period)+3):
            time=origin+n*period
            if time>=end*dt:break
            index=int(round(time/dt))
            a=max(start,index-radius);b=min(end,index+radius+1)
            if b<=a:continue
            snapped=a+int(np.argmax(novelty[a:b]))
            # Do not hallucinate a pulse in a pause or a weak/unsupported region.
            if novelty[snapped]<maximum*.15:continue
            actual=snapped*dt
            if beats and actual-beats[-1]['time']<.2:continue
            beats.append({'time':actual,'bpm':proposed['bpm'],'periodicity':proposed['periodicity']})
    return {'beats':beats,'sections':sections,'method':'8 s local autocorrelation / 2 s regions / onset snap <=80 ms'}
