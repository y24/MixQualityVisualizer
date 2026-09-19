import numpy as np
import pytest
from backend.structure import structure


def analyze(power):
    return structure(power, np.arange(len(power))*.05, len(power)*.05)


def test_spectral_sections_and_gain_invariance():
    power=np.zeros((1200,32))
    power[:400,2]=1; power[400:800,12]=1; power[800:,2]=1
    result=analyze(power)
    assert [b['time'] for b in result['boundaries']]==[20,40]
    assert result['segments']==[{'start':0.,'end':20.},{'start':20.,'end':40.},{'start':40.,'end':60.}]
    gains=np.geomspace(.001,10,len(power))
    np.testing.assert_allclose(analyze(power*gains[:,None])['novelty'],result['novelty'],atol=1e-12)


@pytest.mark.parametrize('kind',['silence','constant','gain','impulse','short'])
def test_no_invented_sections(kind):
    power=np.ones((1200,32))
    if kind=='silence': power[:]=0
    if kind=='gain': power[600:]*=10
    if kind=='impulse': power[600,4]=100
    if kind=='short': power=power[:100]
    result=analyze(power)
    assert result['boundaries']==[]
    assert np.isfinite(result['novelty']).all()
    if kind=='short': assert result['status']=='insufficient'


def test_silence_transition_and_partial_last_bin():
    power=np.ones((1203,32));power[400:800]=0
    result=analyze(power)
    assert [b['time'] for b in result['boundaries']]==[20,40]
    assert result['segments'][-1]['end']==pytest.approx(60.15)


def test_real_spectral_frontend_detects_tone_change():
    from backend.analysis import band_power, SR
    t=np.arange(SR*24)/SR
    x=.1*np.sin(2*np.pi*np.where(t<12,200,3000)*t)
    times,power=band_power(np.column_stack([x,x]).astype(np.float32))
    result=structure(power[:,:32].sum(axis=2),times,24.)
    assert len(result['boundaries'])==1
    assert result['boundaries'][0]['time']==pytest.approx(12,abs=.5)
