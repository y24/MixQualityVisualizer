import numpy as np
import pytest
from backend.analysis import SR, band_transients


def test_band_events_detect_distinct_hits_and_preserve_relative_level():
    x = np.zeros((SR*3,2),np.float32)
    for start,frequency in ((.3,80),(1.1,700),(1.9,7000)):
        t = np.arange(int(.25*SR))/SR
        hit = .2*np.sin(2*np.pi*frequency*t)*np.minimum(t/.005,1)*np.exp(-t*30)
        x[int(start*SR):int(start*SR)+len(t)] = hit[:,None]
    result = band_transients(x,x*.5)
    for name,start in (('low',.3),('mid',1.1),('high',1.9)):
        events = result[name]['events']
        assert any(start-.01 <= e['time'] <= start+.06 for e in events)
        measured = [e['relative_db'] for e in events if np.isfinite(e['relative_db'])]
        assert measured
        np.testing.assert_allclose(measured,6.020599913,atol=1e-6)
        assert all(e['time'] >= 0 for e in events)


def test_silent_bands_and_insufficient_source_bandwidth():
    x = np.zeros((SR,2),np.float32)
    result = band_transients(x,x,8000)
    assert result['high'] is None
    for name in ('low','mid'):
        assert result[name]['events'] == []
        assert result[name]['summary']['attack_ms']['count'] == 0
