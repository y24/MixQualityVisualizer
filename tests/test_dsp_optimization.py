"""Exact regression checks against the pre-optimization calculation paths."""
import numpy as np
import pytest
from scipy import signal, fft
import pyloudnorm as pyln
from backend.analysis import SR, ERB_EDGES, BROAD_EDGES, band_power, window_powers, clean


@pytest.mark.parametrize('dtype', [np.float32, np.float64])
def test_band_frames_match_original_indexing_exactly(dtype):
    # More than one chunk; partial final frame and non-default frequency limit.
    x = np.random.default_rng(19).normal(0, .1, (SR*10+17, 2)).astype(dtype)
    times, actual = band_power(x, 16000)
    nfft = 4096
    centers = np.arange(0, len(x), 2205)
    padded = np.pad(x, ((2048, 2048), (0, 0)))
    f = fft.rfftfreq(nfft, 1/SR)
    limits = [(min(lo,16000), min(hi,16000)) for bank in (ERB_EDGES, BROAD_EDGES)
              for lo,hi in zip(bank[:-1], bank[1:])]
    starts = np.array([np.searchsorted(f,lo) for lo,hi in limits])
    stops = np.array([np.searchsorted(f,hi) for lo,hi in limits])
    window = signal.windows.hann(nfft, sym=False).astype(np.float32)
    scale = np.full(len(f), 2/(nfft*np.sum(window**2)), dtype=np.float32)
    scale[[0,-1]] *= .5
    expected = np.empty_like(actual)
    for start in range(0,len(centers),192):
        c = centers[start:start+192]
        frames = padded[c[:,None]+np.arange(nfft)[None,:]]*window[None,:,None]
        z = fft.rfft(frames, axis=1)
        power = (z.real**2+z.imag**2)*scale[None,:,None]
        cumulative = np.concatenate([np.zeros((len(c),1,2)), np.cumsum(power,axis=1,dtype=np.float64)],axis=1)
        expected[start:start+len(c)] = cumulative[:,stops]-cumulative[:,starts]
    np.testing.assert_array_equal(times, centers/SR)
    np.testing.assert_array_equal(actual, expected)


@pytest.mark.parametrize('weighted', [False, True])
def test_shared_power_windows_match_separate_calculations(weighted):
    x = np.random.default_rng(8).normal(0,.1,(SR*4+31,2)).astype(np.float32)
    times = np.arange(0,len(x),2205)/SR
    actual = window_powers(x,times,k_weight=weighted)
    for seconds, found in zip((.4,3.),actual):
        original = x.copy()
        if weighted:
            original = original.astype(np.float64)
            for filt in pyln.Meter(SR)._filters.values():
                original = signal.lfilter(filt.b,filt.a,original,axis=0)*filt.passband_gain
        c = np.r_[0.,np.cumsum(np.mean(np.square(original,dtype=np.float64),axis=1))]
        centers = np.rint(times*SR).astype(int)
        lo = np.maximum(0,centers-int(seconds*SR/2))
        hi = np.minimum(len(x),centers+int(seconds*SR/2))
        np.testing.assert_array_equal(found,(c[hi]-c[lo])/np.maximum(1,hi-lo))


def test_bulk_scalar_conversion_preserves_rounding_and_nulls():
    for dtype in (np.float32,np.float64):
        x = np.array([[np.nan,np.inf,-np.inf,-0.0],[1.2345675,1e-12,123456.789,0]],dtype=dtype)
        expected = [[round(float(v),6) if np.isfinite(v) else None for v in row] for row in x]
        assert clean(x) == expected
    assert clean(np.array([True,False])) == [True,False]
