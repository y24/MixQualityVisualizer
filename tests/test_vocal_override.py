import numpy as np
from backend.analysis import SR, analyze


def test_manual_vocals_restore_quiet_signal_but_not_silence():
    t=np.arange(SR*6)/SR
    vocal=(.1*np.sin(2*np.pi*440*t)).astype(np.float32)
    vocal[SR*2:SR*4]*=.001
    vocal[SR*4:]=0
    vocal=np.column_stack([vocal,vocal])
    other=np.column_stack([.1*np.sin(2*np.pi*550*t)]*2).astype(np.float32)
    result=analyze(vocal+other,{'vocals':vocal,'other':other})
    quiet=np.argmin(np.abs(np.array(result['times'])-3))
    silent=np.argmin(np.abs(np.array(result['times'])-5))
    assert result['series']['vocals_db'][quiet] is None
    assert result['vocal_ungated']['series']['vocals_db'][quiet] is not None
    assert result['vocal_ungated']['series']['vocals_competition'][quiet] is not None
    assert result['vocal_ungated']['series']['vocals_db'][silent] is None
    assert result['vocal_ungated']['series']['vocals_competition'][silent] is None
