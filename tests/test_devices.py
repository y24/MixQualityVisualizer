import pytest
from backend.devices import choose_device

CPU={"gpus":[],"cuda_reason":"CPU専用のPyTorchです。"}
GPU={"gpus":[{"id":"cuda:0","name":"RTX test"},{"id":"cuda:1","name":"Second GPU"}]}

def test_auto_prefers_cuda_and_cpu_remains_explicit():
    assert choose_device('auto',GPU)=='cuda:0'
    assert choose_device('cpu',GPU)=='cpu'
    assert choose_device('auto',CPU)=='cpu'
    assert choose_device('cuda:1',GPU)=='cuda:1'

def test_missing_gpu_does_not_silently_run_on_cpu():
    with pytest.raises(ValueError,match='CPU専用'):
        choose_device('cuda:0',CPU)
    with pytest.raises(ValueError,match='利用できません'):
        choose_device('cuda:3',GPU)

@pytest.mark.parametrize('value',['mps','gpu',None,3])
def test_invalid_device_is_rejected(value):
    with pytest.raises(ValueError):choose_device(value,GPU)
