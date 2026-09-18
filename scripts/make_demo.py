"""Generate original synthetic fixtures; these are not recordings of singers."""
from pathlib import Path
import numpy as np
from scipy import signal
import soundfile as sf

ROOT=Path(__file__).resolve().parents[1]
SR=44100


def generate(folder, seconds=24, reference=False):
    folder.mkdir(parents=True,exist_ok=True)
    rng=np.random.default_rng(42)
    t=np.arange(int(seconds*SR))/SR
    vocal=np.zeros(len(t)); drums=np.zeros(len(t)); bass=np.zeros(len(t))
    notes=[196,220,246.94,220,164.81,196,220,174.61]
    for i,start in enumerate(np.arange(.6,seconds-.6,.8)):
        pos=int(start*SR);n=min(int(.55*SR),len(t)-pos);u=np.arange(n)/SR
        env=np.minimum(u/.03,1)*np.minimum((n/SR-u)/.12,1)
        freq=notes[i%len(notes)]
        vocal[pos:pos+n]+=.09*env*sum(np.sin(2*np.pi*freq*k*u+.02*np.sin(2*np.pi*5*u))/k for k in range(1,9))
    for i,start in enumerate(np.arange(.2,seconds-.3,.5)):
        pos=int(start*SR);n=min(int(.35*SR),len(t)-pos);u=np.arange(n)/SR
        kick=np.sin(2*np.pi*(48*u+2*(1-np.exp(-u*30))))*np.exp(-u*18)
        hit=.22*kick if i%2==0 else .1*rng.normal(size=n)*np.exp(-u*30)
        drums[pos:pos+n]+=hit*(1 if reference or start<8 else 1.5)
        bass[pos:pos+n]+=.12*np.sin(2*np.pi*55*u)*np.minimum(u/.012,1)*np.exp(-u*3)*(1 if reference or start<16 else 1.6)
    # Wide sustained bed and small high-frequency percussive accents.
    left=.025*np.sin(2*np.pi*329.63*t)+.022*np.sin(2*np.pi*440*t)
    right=.025*np.sin(2*np.pi*329.8*t+.6)+.022*np.sin(2*np.pi*440.2*t+1.2)
    pad=np.column_stack([left,right])*(.6+.4*np.sin(2*np.pi*.2*t)**2)[:,None]
    stems={"vocals":np.column_stack([vocal,vocal]),"drums":np.column_stack([drums,drums]),"bass":np.column_stack([bass,bass]),"other":pad}
    for name,x in stems.items():sf.write(folder/f"{name}.wav",x,SR,subtype="FLOAT")
    sf.write(folder/"mix.wav",sum(stems.values()),SR,subtype="FLOAT")
    return folder


if __name__=='__main__':
    generate(ROOT/'demo-audio')
    generate(ROOT/'demo-audio'/'reference',reference=True)
    print('Created synthetic audio in demo-audio/ (24 seconds, no real vocals).')
