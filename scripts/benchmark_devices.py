"""Real-model CPU/CUDA comparison, bypassing all separation/result caches."""
from pathlib import Path
import argparse
import json
import time
import numpy as np
from backend.analysis import load_audio,SR
from backend.worker import separate
from backend.devices import runtime_info


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--seconds',type=float,default=12)
    parser.add_argument('--model',choices=['htdemucs','htdemucs_ft'],default='htdemucs_ft')
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    info=runtime_info()
    if not info['cuda']:raise RuntimeError(info['cuda_reason'])
    x,_=load_audio(root/'demo-audio'/'mix.wav')
    x=x[:int(args.seconds*SR)]
    results={}
    reference=None
    for device in ['cpu',info['gpus'][0]['id']]:
        started=time.perf_counter()
        sources,actual=separate(x,args.model,device)
        elapsed=time.perf_counter()-started
        assert actual==device
        assert all(v.shape==x.shape and np.isfinite(v).all() for v in sources.values())
        results[device]={'seconds':round(elapsed,3)}
        if reference is None:reference=sources
        else:results[device]['max_absolute_sample_difference_vs_cpu']=float(max(np.max(np.abs(sources[k]-reference[k])) for k in sources))
        print(f'BENCHMARK {device}: {elapsed:.3f} sec',flush=True)
    gpu=info['gpus'][0]['id']
    report={'audio_seconds':len(x)/SR,'model':args.model,'hardware':info,'results':results,
            'cpu_time_over_gpu_time':results['cpu']['seconds']/results[gpu]['seconds'],
            'scope':'model loading + separation, existing model files, no result/stem cache, one run per device; excludes subsequent DSP'}
    out=root/'.data'/'device-benchmark.json'
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
