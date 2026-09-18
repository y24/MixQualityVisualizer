import numpy as np
from backend.drum_types import describe_hits


def sample(kind):
    sr=44100;n=sr
    rng=np.random.default_rng(22)
    frequencies=np.fft.rfftfreq(n,1/sr)
    spectrum=np.fft.rfft(rng.normal(size=n))
    if kind=='high_noise':spectrum[frequencies<2000]=0
    elif kind=='broad_noise':
        spectrum[frequencies<200]=0
        spectrum[(frequencies>=200)&(frequencies<2000)]*=3
    noise=np.fft.irfft(spectrum,n)
    if kind=='low_tonal':noise=np.sin(2*np.pi*80*np.arange(n)/sr)
    if kind=='unknown':noise=np.sin(2*np.pi*800*np.arange(n)/sr)
    noise=.1*noise*np.exp(-np.arange(n)/sr*20)
    return np.column_stack([noise,noise]).astype(np.float32)


def test_known_spectral_shapes_and_gain_invariance():
    for kind in ('low_tonal','broad_noise','high_noise','unknown'):
        x=sample(kind)
        first=describe_hits(x,[{'time':0}])[0]
        second=describe_hits(x*.1,[{'time':0}])[0]
        assert first['sound_type']==kind
        assert second['sound_type']==kind
        np.testing.assert_allclose(first['spectral_shape']['band_share'],second['spectral_shape']['band_share'],atol=1e-6)


def test_silence_short_tail_and_missing_bandwidth_are_unknown():
    x=sample('low_tonal')
    for audio,events,limit in ((x,[{'time':.99}],20000),(x,[{'time':0}],8000),(x*0,[{'time':0}],20000)):
        assert describe_hits(audio,events,limit)[0]['sound_type']=='unknown'
