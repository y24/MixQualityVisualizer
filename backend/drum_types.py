"""Conservative sound-shape labels, not a trained instrument classifier."""
import numpy as np
from scipy import fft, signal


def describe_hits(x, events, max_freq=20000, sr=44100):
    for event in events:
        event['sound_type']='unknown'
        event['type_method']='spectral-shape rules v1; not instrument identity'
        start=int(event['time']*sr)
        frame=x[start:min(len(x),start+int(.08*sr))].astype(np.float64)
        if len(frame)<int(.04*sr) or max_freq<20000:
            continue
        spectrum=np.abs(fft.rfft(frame*signal.windows.hann(len(frame),sym=False)[:,None],axis=0))**2
        power=spectrum.sum(axis=1)
        frequency=fft.rfftfreq(len(frame),1/sr)
        masks=[(frequency>=lo)&(frequency<hi) for lo,hi in ((20,200),(200,2000),(2000,20000))]
        energies=np.array([power[m].sum() for m in masks])
        total=energies.sum()
        if np.mean(frame**2)<=1e-12 or total<=0:
            continue
        shares=energies/total
        def flatness(mask):
            p=power[mask]
            if not len(p) or p.mean()<=0:return 0.
            return float(np.exp(np.mean(np.log(np.maximum(p,p.mean()*1e-12))))/p.mean())
        flats=[flatness(m) for m in masks]
        valid=(frequency>=20)&(frequency<20000)
        centroid=float((frequency[valid]*power[valid]).sum()/total)
        event['spectral_shape']={'band_share':shares,'flatness':flats,'centroid_hz':centroid,'window_ms':len(frame)/sr*1000}
        low,mid,high=shares
        # Joint spectral criteria rather than equating a frequency band with an instrument.
        if low>=.65 and high<.15 and centroid<500 and flats[0]<.35:
            event['sound_type']='low_tonal'
        elif high>=.65 and flats[2]>.1 and centroid>3000:
            event['sound_type']='high_noise'
        elif low<.25 and mid>=.18 and high>=.18 and flats[1]>.08 and flats[2]>.08:
            event['sound_type']='broad_noise'
    return events
