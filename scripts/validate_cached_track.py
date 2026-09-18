"""Reanalyze an existing separated track and verify unchanged core descriptors."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import time
from backend import worker


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('analysis_id')
    args=parser.parse_args()
    if not re.fullmatch('[a-f0-9]{24}',args.analysis_id):
        parser.error('invalid analysis ID')
    old=json.loads((worker.DATA/'analyses'/args.analysis_id/'result.json').read_text(encoding='utf8'))
    if old['mode']!='separate':
        raise ValueError('Existing separated track required')
    spec={'mix':old['source_fingerprints']['mix'],'model':old['model'],'separation_version':1,'compute':old['compute']}
    key=hashlib.sha256(json.dumps(spec,sort_keys=True).encode()).hexdigest()[:24]
    if not (worker.DATA/'separated'/key/'complete.json').exists():
        raise ValueError('Cached separated stems required')
    start=time.perf_counter()
    original_progress=worker.progress
    milestones=[]
    def progress(percent,message):
        milestones.append({'percent':percent,'elapsed_seconds':round(time.perf_counter()-start,3)})
        print(f'{percent}% {message}',flush=True)
    worker.progress=progress
    try:
        result=worker.run({'path':old['source'],'mode':'separate','model':old['model'],'device':old['device']})
    finally:
        worker.progress=original_progress
    report={'duration':result['duration'],'elapsed_seconds':time.perf_counter()-start,
            'cache_hit':result['cached'],'separation_reused':result['separation_cached'],
            'core_series_exactly_equal':result['series']==old['series'],
            'core_heatmaps_exactly_equal':result['heatmaps']==old['heatmaps'],
            'milestones':milestones,'result_id':result['id']}
    (worker.DATA/'real-track-validation.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    print(json.dumps(report),flush=True)
    assert report['core_series_exactly_equal'] and report['core_heatmaps_exactly_equal']


if __name__=='__main__':main()
