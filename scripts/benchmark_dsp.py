"""Compare uncached DSP with a saved pre-change analysis.py on synthetic audio."""
import argparse
import importlib.util
import json
from pathlib import Path
import time
import numpy as np
from backend import analysis


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--seconds', type=float, default=472)
    args = parser.parse_args()
    if args.seconds < .4:
        parser.error('--seconds must be at least 0.4')
    spec = importlib.util.spec_from_file_location('baseline_analysis', args.baseline)
    baseline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baseline)
    root = Path(__file__).resolve().parents[1]
    samples = int(args.seconds * analysis.SR)

    def audio(name):
        x, meta = analysis.load_audio(root/'demo-audio'/f'{name}.wav')
        return np.tile(x, (int(np.ceil(samples/len(x))), 1))[:samples].copy(), meta

    mix, meta = audio('mix')
    stems = {name: audio(name)[0] for name in analysis.PARTS}
    report = {'audio_seconds': args.seconds, 'scope': 'synthetic 4-stem DSP only; no separation, decoding, cache or preview writes'}
    reference = None
    for name, module in [('before', baseline), ('after', analysis)]:
        started = time.perf_counter()
        result = module.analyze(mix, stems, meta)
        report[name+'_seconds'] = time.perf_counter()-started
        print(name, report[name+'_seconds'], flush=True)
        if reference is None:
            reference = result
        else:
            report['all_output_values_exactly_equal'] = result == reference
    report['speedup'] = report['before_seconds']/report['after_seconds']
    (root/'.data'/'dsp-benchmark.json').write_text(json.dumps(report, indent=2), encoding='utf8')
    print(json.dumps(report), flush=True)
    if not report['all_output_values_exactly_equal']:
        raise AssertionError('Analysis outputs differ')


if __name__ == '__main__':
    main()
