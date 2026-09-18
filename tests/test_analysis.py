import json
import numpy as np
import pytest
from backend.analysis import SR, analyze, components, window_power, db_ratio, transients, clean, band_power, competition


def tone(f=440,seconds=1,amp=.1):
    t=np.arange(int(SR*seconds))/SR
    a=(amp*np.sin(2*np.pi*f*t)).astype(np.float32)
    return np.column_stack([a,a])


def test_ms_transform_energy_and_inverse():
    x=np.random.default_rng(1).normal(size=(1024,2)).astype(np.float32)
    ms=components(x)
    restored=np.column_stack([(ms[:,0]+ms[:,1])/np.sqrt(2),(ms[:,0]-ms[:,1])/np.sqrt(2)])
    np.testing.assert_allclose(x,restored,atol=1e-6)
    assert np.sum(x*x)==pytest.approx(np.sum(ms*ms),rel=1e-6)


@pytest.mark.parametrize('kind,side,mono,corr',[('mono',0,0,1),('anti',100,None,-1),('left',50,-3.0103,None)])
def test_spatial_known_signals(kind,side,mono,corr):
    x=tone()
    if kind=='anti':x[:,1]*=-1
    if kind=='left':x[:,1]=0
    r=analyze(x)
    assert r['summary']['side_pct']['median']==pytest.approx(side,abs=.001)
    if mono is None:assert r['summary']['mono_db']['median'] is None
    else:assert r['summary']['mono_db']['median']==pytest.approx(mono,abs=.001)
    if corr is None:assert r['summary']['correlation']['median'] is None
    else:assert r['summary']['correlation']['median']==pytest.approx(corr,abs=.001)


def test_silence_is_not_a_good_score():
    r=analyze(np.zeros((SR,2),np.float32))
    for key in ['low_pct','side_pct','density_pct','correlation']:
        assert r['summary'][key]['median'] is None
    json.dumps(r,allow_nan=False)


def test_low_frequency_ratio_changes_without_ms_change():
    low=analyze(tone(55)); high=analyze(tone(3000))
    assert low['summary']['low_pct']['median']>99
    assert high['summary']['low_pct']['median']<1
    assert high['summary']['side_pct']['median']==low['summary']['side_pct']['median']


def test_k_weight_filter_is_temporal_and_matches_pyloudnorm():
    import pyloudnorm as pyln
    x=tone(1000,2)
    times=np.array([1.])
    computed=10*np.log10(2*window_power(x,times,.4,True)[0])-.691
    expected=pyln.Meter(SR).integrated_loudness(x)
    assert computed==pytest.approx(expected,abs=.02)


def test_gain_ratio_and_common_gain_invariance():
    x=tone(700,2);other=tone(230,2)
    t=np.array([.5,1,1.5]);a=window_power(x,t,k_weight=True);b=window_power(other,t,k_weight=True)
    assert np.median(db_ratio(window_power(x*10**(3/20),t,k_weight=True),b)-db_ratio(a,b))==pytest.approx(3,abs=.001)
    np.testing.assert_allclose(db_ratio(a,b),db_ratio(a*.1,b*.1),atol=1e-6)


def test_stft_parseval_energy():
    x=tone(1000,2)
    _,bands=band_power(x)
    # Ignore padded edges; broad bank sums to the stereo RMS power sum.
    actual=bands[8:-8,32:,:].sum(axis=(1,2)).mean()
    assert actual==pytest.approx(np.mean(x*x)*2,rel=.01)


def test_competition_target_absent_is_null_and_gain_helps():
    target=np.ones((3,32))*1e-4;rest=target*2;active=np.array([True,False,True])
    c=competition(target,rest,active)
    assert c['rate'][0]==100
    assert np.isnan(c['rate'][1])
    assert competition(target*4,rest,active)['rate'][0]==0
    assert np.isnan(competition(target*0,rest,active)['rate']).all()


def test_transient_shape_invariant_under_gain():
    x=np.zeros((SR*2,2),np.float32)
    rng=np.random.default_rng(4)
    for start in [.2,.8,1.4]:
        n=int(.3*SR);t=np.arange(n)/SR
        hit=.2*rng.normal(size=n)*np.minimum(t/.005,1)*np.exp(-t*35)
        x[int(start*SR):int(start*SR)+n]=hit[:,None]
    first=transients(x);second=transients(x*.5)
    assert len(first['events'])>=3
    a=[e['attack_body_db'] for e in first['events']]
    b=[e['attack_body_db'] for e in second['events']]
    np.testing.assert_allclose(a,b,atol=1e-3,equal_nan=True)


def test_json_clean_retains_missing_values():
    assert clean({'a':np.array([np.nan,np.inf,1.5])})=={'a':[None,None,1.5]}
    json.dumps(clean({'b':np.bool_(True)}),allow_nan=False)
