import numpy as np
import pytest
from backend.rhythm import rhythm


def clicks(bpm,seconds=12):
    sr=44100
    x=np.zeros((int(seconds*sr),2),np.float32)
    for time in np.arange(.2,seconds-.1,60/bpm):
        t=np.arange(2205)/sr
        hit=.2*np.sin(2*np.pi*100*t)*np.exp(-t*70)
        x[int(time*sr):int(time*sr)+len(hit)] = hit[:,None]
    return x


@pytest.mark.parametrize('bpm',[75,100,120,150])
def test_periodic_clicks_propose_correct_tempo(bpm):
    x=clicks(bpm)
    r=rhythm(x,x*.5)
    assert r['bpm']==pytest.approx(bpm,abs=1)
    assert r['periodicity']>.8
    assert r['offset']==pytest.approx(.2,abs=.03)
    scaled=rhythm(x*.5,x*.25)
    assert scaled['bpm']==r['bpm']
    assert scaled['offset']==r['offset']


def test_silence_and_short_audio_do_not_invent_beats():
    x=np.zeros((44100*5,2),np.float32)
    assert rhythm(x,x)['bpm'] is None
    x=clicks(120,2)
    assert rhythm(x,x)['bpm'] is None


def test_irregular_noise_is_uncertain():
    x=np.random.default_rng(18).normal(0,.01,(44100*6,2)).astype(np.float32)
    assert rhythm(x,x)['bpm'] is None
