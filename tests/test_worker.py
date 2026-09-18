from pathlib import Path
import json
import numpy as np
import pytest
import soundfile as sf
from backend.analysis import SR, load_audio
from backend import worker


def make_stems(directory,seconds=1):
    directory.mkdir(parents=True,exist_ok=True)
    t=np.arange(int(SR*seconds))/SR
    stems={}
    for key,f in zip(worker.PARTS,[440,1000,55,250]):
        x=.03*np.sin(2*np.pi*f*t)
        stems[key]=np.column_stack([x,x]).astype(np.float32)
        sf.write(directory/f'{key}.wav',stems[key],SR,subtype='FLOAT')
    mix=sum(stems.values());sf.write(directory/'mix.wav',mix,SR,subtype='FLOAT')
    return {'path':str(directory/'mix.wav'),'mode':'stems','stems':{k:str(directory/f'{k}.wav') for k in stems}}


def test_worker_cache_and_gain_change_invalidate(tmp_path,monkeypatch):
    monkeypatch.setattr(worker,'DATA',tmp_path/'cache')
    request=make_stems(tmp_path/'input')
    first=worker.run(request)
    assert not first['cached']
    assert worker.run(request)['cached']
    assert set(first['media_paths'])=={'mix','mid','side','mono','vocals','drums','bass','other'}
    json.dumps(first,allow_nan=False)
    filename=Path(request['stems']['bass']);x,sr=sf.read(filename)
    sf.write(filename,x*2,sr,subtype='FLOAT')
    changed=worker.run(request)
    assert changed['id']!=first['id']
    assert changed['summary']['bass_db']['median']-first['summary']['bass_db']['median']==pytest.approx(6.0206,abs=.02)


def test_stem_alignment_rejected(tmp_path,monkeypatch):
    monkeypatch.setattr(worker,'DATA',tmp_path/'cache')
    request=make_stems(tmp_path/'input')
    sf.write(request['stems']['vocals'],np.zeros((SR*2,2)),SR)
    with pytest.raises(ValueError,match='長さ'):
        worker.run(request)


def test_separation_cache_survives_analysis_revision(tmp_path,monkeypatch):
    monkeypatch.setattr(worker,'DATA',tmp_path/'cache')
    request=make_stems(tmp_path/'input')
    calls=[]
    def fake_separator(mix,model,device):
        calls.append(model)
        return {k:mix/4 for k in worker.PARTS},device
    monkeypatch.setattr(worker,'separate',fake_separator)
    monkeypatch.setattr(worker,'runtime_info',lambda: {'gpus':[], 'torch_version':'test'})
    job={'path':request['path'],'mode':'separate','model':'htdemucs'}
    first=worker.run(job)
    monkeypatch.setattr(worker,'VERSION',worker.VERSION+'-test-revision')
    second=worker.run(job)
    assert first['id']!=second['id']
    assert calls==['htdemucs']
    assert second['parts']['vocals']['summary']['median']==pytest.approx(first['parts']['vocals']['summary']['median'],abs=.001)


def test_device_choice_reaches_separator_and_uses_distinct_caches(tmp_path,monkeypatch):
    monkeypatch.setattr(worker,'DATA',tmp_path/'cache')
    hardware={'gpus':[{'id':'cuda:0','name':'Test GPU'}], 'torch_version':'test'}
    monkeypatch.setattr(worker,'runtime_info',lambda:hardware)
    calls=[]
    def fake_separator(mix,model,device):
        calls.append(device)
        return {k:mix/4 for k in worker.PARTS},device
    monkeypatch.setattr(worker,'separate',fake_separator)
    request=make_stems(tmp_path/'input')
    job={'path':request['path'],'mode':'separate','model':'htdemucs'}
    cpu=worker.run({**job,'device':'cpu'})
    gpu=worker.run({**job,'device':'cuda:0'})
    auto=worker.run({**job,'device':'auto'})
    assert cpu['id']!=gpu['id']
    assert auto['id']==gpu['id'] and auto['cached']
    assert cpu['device']=='cpu' and gpu['device']=='cuda:0'
    assert auto['requested_device']=='auto'
    assert calls==['cpu','cuda:0']


@pytest.mark.parametrize('extension',['wav','flac','mp3'])
def test_supported_audio_decode(tmp_path,extension):
    t=np.arange(SR)/SR
    x=np.column_stack([.1*np.sin(2*np.pi*440*t)]*2)
    filename=tmp_path/f'a.{extension}'
    if extension=='mp3':
        import lameenc
        encoder=lameenc.Encoder();encoder.set_bit_rate(128);encoder.set_in_sample_rate(SR);encoder.set_channels(2);encoder.set_quality(2)
        pcm=(x*32767).astype(np.int16)
        filename.write_bytes(encoder.encode(pcm.tobytes())+encoder.flush())
    else:sf.write(filename,x,SR)
    decoded,meta=load_audio(filename)
    assert len(decoded)>=SR*.95
    assert np.isfinite(decoded).all()
    assert np.sqrt(np.mean(decoded**2))==pytest.approx(.0707,abs=.01)
