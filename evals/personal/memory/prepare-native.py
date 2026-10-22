"""Download the exact upstream QA prompt source without evaluator dependencies."""
import argparse
import hashlib
import json
import urllib.request
from pathlib import Path

COMMIT = '9e0b455f4ef0e2ab8f2e582289761153549043fc'
SHA256 = 'ecce9c4c79dc89d99534ac17b383a5cbb5b9f0c69ee98adaf0684742e3d95251'
URL = f'https://raw.githubusercontent.com/xiaowu0162/LongMemEval/{COMMIT}/src/evaluation/evaluate_qa.py'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='.xopc-evals/memory-upstream')
    args = parser.parse_args()
    folder = Path(args.out)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / 'evaluate_qa.py'
    raw = path.read_bytes() if path.exists() else urllib.request.urlopen(URL, timeout=60).read()
    if hashlib.sha256(raw).hexdigest() != SHA256:
        raise ValueError('Official evaluator source hash mismatch')
    path.write_bytes(raw)
    (folder / 'evaluator-source.json').write_text(json.dumps({'url': URL, 'commit': COMMIT, 'sha256': SHA256}, indent=2)+'\n')
    print(path)


if __name__ == '__main__':
    main()
