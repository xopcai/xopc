"""Retry only empty service-error judge responses; retain every original artifact."""
import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import subprocess
import time
import traceback
from pathlib import Path

PATTERN=re.compile(r'overload|rate.?limit|429|timed?\s*out|timeout|provider_error|502|503',re.I)
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--run',required=True)
    parser.add_argument('--out',required=True)
    parser.add_argument('--endpoint')
    parser.add_argument('--max-retries',type=int,choices=[1,2,3],default=2)
    args=parser.parse_args()
    RUN,OUT=Path(args.run).resolve(),Path(args.out).resolve()
    if not (RUN/'completion.json').exists():raise ValueError('Wait for candidate capture completion')
    OUT.mkdir(parents=True,exist_ok=False)
    POOL=OUT/'pools'
    captured=json.loads((RUN/'manifest.json').read_text())
    MODELS={'model':captured['models']['candidate'],'judge':captured['models']['judge']}
    worker=Path('evals/personal/memory/worker.mts')
    prompt=re.search(r'const systemPrompt = `(.+?)`;',worker.read_text(),re.S).group(1)
    summary=json.loads((RUN/'summary.json').read_text()); targets=[]
    for row in summary['results']:
        folder=RUN/'cases'/row['id']; raw=folder/'judge/raw.json'; capture=folder/'capture/result.json'
        if row.get('judgment') or not raw.exists() or not capture.exists():continue
        response=json.loads(raw.read_text()); saved=json.loads(capture.read_text())
        if not saved.get('error') and not response.get('raw','').strip() and PATTERN.search(response.get('error') or ''):
            targets.append({'id':row['id'],'originalRawHash':sha(raw),'inputHash':sha(folder/'judge-input.json'),
                            'captureHash':sha(capture),'originalError':response['error']})
    manifest={'targets':targets,'models':MODELS,'candidateRegeneration':False,'maxServiceRetries':args.max_retries,
              'judgePromptHash':hashlib.sha256(prompt.encode()).hexdigest(),
              'capturedManifestHash':sha(RUN/'manifest.json'),'workerHash':sha(worker),'protocol':'Only empty transport/service-error judge outputs. No valid low grade is retried. Original records untouched.'}
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    if not targets:
        (OUT/'summary.json').write_text(json.dumps({'results':[],'resolved':0},indent=2)+'\n')
        return
    if args.endpoint and not Path(args.endpoint).exists():raise FileNotFoundError(args.endpoint)
    server=None if args.endpoint else subprocess.Popen(['python3','evals/personal/style/request_pools.py','--out',str(POOL)])
    try:
        endpoint_path=Path(args.endpoint) if args.endpoint else POOL/'endpoint.json'
        while not endpoint_path.exists():
            if server is not None and server.poll() is not None:raise ValueError('Retry pool exited')
            time.sleep(.1)
        endpoint=json.loads(endpoint_path.read_text()); env={**os.environ,'XOPC_STYLE_POOL_URL':endpoint['url'],'XOPC_STYLE_POOL_TOKEN':endpoint['token']}
        def grade(target):
            attempts=[]
            for index in range(1,args.max_retries+1):
                folder=OUT/'cases'/target['id']/f'attempt-{index}'; folder.mkdir(parents=True)
                with (folder/'worker.log').open('w') as log:
                    result=subprocess.run(['node','--import','tsx','evals/personal/memory/worker.mts','--mode','judge',
                        '--input',str(RUN/'cases'/target['id']/'judge-input.json'),'--out',str(folder),
                        '--model',MODELS['model'],'--judge',MODELS['judge']],env=env,stdout=log,stderr=log)
                attempts.append({'folder':str(folder),'exitCode':result.returncode})
                if (folder/'result.json').exists():return {**target,'attempts':attempts,'selected':str(folder),'resolved':True}
                response=json.loads((folder/'raw.json').read_text()) if (folder/'raw.json').exists() else {}
                if response.get('raw','').strip() or not PATTERN.search(response.get('error') or ''):break
            return {**target,'attempts':attempts,'resolved':False}
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            results=list(executor.map(grade,targets))
        (OUT/'summary.json').write_text(json.dumps({'results':results,'resolved':sum(r['resolved'] for r in results)},indent=2)+'\n')
    finally:
        if server is not None:
            server.send_signal(2);server.wait(timeout=10)
    print('Judge service retry finished',flush=True)


if __name__=='__main__':
    main()
