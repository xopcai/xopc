"""Bounded-memory summary of Chromium renderer timings in a native test interval."""
import json
import re
import sys
from pathlib import Path

metadata = json.loads(Path('/tmp/xopc-packaged-e2e.json').read_text())
window = json.loads(Path('/tmp/xopc-packaged-motion-window.json').read_text())
threads = set()
names = ['ThreadControllerImpl::RunTask', 'FireAnimationFrame', 'Layout', 'Paint', 'UpdateLayoutTree']
samples = {name: [] for name in names}
# Chromium emits one event object per line; do not load a long native trace into memory.
with Path(metadata['trace']).open() as source:
    for line in source:
        if not any(name in line for name in names + ['thread_name']):
            continue
        match = re.search(r'(\{.*\})\s*,?\s*$', line)
        if not match:
            continue
        try:
            event = json.loads(match[1])
        except json.JSONDecodeError:
            continue
        key = (event.get('pid'), event.get('tid'))
        if event.get('name') == 'thread_name' and event.get('args', {}).get('name') == 'CrRendererMain':
            threads.add(key)
        if key not in threads or event.get('ph') != 'X' or event.get('name') not in samples:
            continue
        if window['startUs'] <= event.get('ts', 0) <= window['endUs']:
            samples[event['name']].append(event.get('dur', 0) / 1000)
result = {'trace': metadata['trace'], 'window': window, 'rendererThreads': len(threads), 'timingsMs': {}}
for name, values in samples.items():
    values.sort()
    result['timingsMs'][name] = {'samples': len(values), 'p95': values[int(len(values) * .95)] if values else 0, 'max': max(values, default=0), 'over50ms': sum(v > 50 for v in values)}
if not samples[names[0]]:
    sys.exit('No renderer tasks in motion interval; trace/window evidence is incomplete')
Path('/tmp/xopc-packaged-motion-metrics.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
