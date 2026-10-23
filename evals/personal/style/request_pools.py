"""Shared local request limits for independent evaluation processes."""
import argparse
import contextlib
import json
import os
import re
import threading
import time
import uuid
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def is_transport_error(error):
    return bool(re.search(r'overload|rate.?limit|\b429\b|timed?\s*out|timeout|temporarily unavailable|connection reset', str(error), re.I))


class RequestPools:
    def __init__(self, limits=None, journal=None, targets=None):
        self.limits = dict(limits or {'generation': 4, 'judge': 4, 'scene': 3})
        self.targets = dict(self.limits)
        for key,value in (targets or {}).items():
            if key not in self.limits or not isinstance(value,int) or not 1 <= value <= self.limits[key]:
                raise ValueError('Initial target must stay within its pool limit')
            self.targets[key] = value
        self.active = {}
        self.queues = {key: deque() for key in self.limits}
        self.condition = threading.Condition()
        self.journal = journal
        self.events = []

    def event(self, kind, **data):
        row = {'event': kind, 'time': time.time(), **data}
        self.events.append(row)
        if self.journal:
            with Path(self.journal).open('a') as stream:
                stream.write(json.dumps(row, ensure_ascii=False) + '\n')

    def acquire(self, pool, context=None):
        with self.condition:
            if pool not in self.limits:
                raise ValueError('Unknown pool')
            ticket = uuid.uuid4().hex
            self.queues[pool].append(ticket)
            queued = time.monotonic()
            while True:
                expired = [key for key, item in self.active.items() if time.monotonic() - item['started'] > 900]
                for key in expired:
                    item = self.active.pop(key)
                    self.event('expired', lease=key, pool=item['pool'])
                active = sum(item['pool'] == pool for item in self.active.values())
                if self.queues[pool][0] == ticket and active < self.targets[pool]:
                    self.queues[pool].popleft()
                    self.active[ticket] = {'pool': pool, 'started': time.monotonic()}
                    self.event('acquired', lease=ticket, pool=pool, context=context, active=active + 1,
                               target=self.targets[pool], queuedSeconds=time.monotonic() - queued)
                    self.condition.notify_all()
                    return ticket
                self.condition.wait(.2)

    def release(self, lease, error=None):
        with self.condition:
            if lease not in self.active:
                raise ValueError('Unknown or already released lease')
            item = self.active.pop(lease)
            pool = item['pool']
            if pool != 'scene' and is_transport_error(error or ''):
                self.targets[pool] = max(1, self.targets[pool] // 2)
            self.event('released', lease=lease, pool=pool, error=error,
                       durationSeconds=time.monotonic() - item['started'], target=self.targets[pool])
            self.condition.notify_all()

    def snapshot(self):
        with self.condition:
            return {'limits': self.limits, 'targets': self.targets,
                    'active': {key: sum(v['pool'] == key for v in self.active.values()) for key in self.limits},
                    'queued': {key: len(v) for key, v in self.queues.items()}}


def request(path, body):
    req = urllib.request.Request(os.environ['XOPC_STYLE_POOL_URL'] + path, data=json.dumps(body).encode(),
                                 headers={'Authorization': 'Bearer ' + os.environ['XOPC_STYLE_POOL_TOKEN'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=3600) as response:
        return json.load(response)


@contextlib.contextmanager
def shared_lease(pool, context):
    if not os.environ.get('XOPC_STYLE_POOL_URL'):
        yield
        return
    lease = request('/acquire', {'pool': pool, 'context': context})['lease']
    error = None
    try:
        yield
    except BaseException as exception:
        error = str(exception)
        raise
    finally:
        request('/release', {'lease': lease, 'error': error})


def serve(out, targets=None):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=False)
    token = uuid.uuid4().hex
    pools = RequestPools(journal=out / 'events.jsonl', targets=targets)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            if self.headers.get('Authorization') != 'Bearer ' + token:
                self.send_error(401)
                return
            try:
                data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if self.path == '/acquire':
                    result = {'lease': pools.acquire(data['pool'], data.get('context'))}
                elif self.path == '/release':
                    pools.release(data['lease'], data.get('error'))
                    result = pools.snapshot()
                elif self.path == '/status':
                    result = pools.snapshot()
                else:
                    raise ValueError('Unknown operation')
                body = json.dumps(result).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as error:
                self.send_error(400, str(error))

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = True
    endpoint = out / 'endpoint.json'
    endpoint.write_text(json.dumps({'url': f'http://127.0.0.1:{server.server_port}', 'token': token}))
    endpoint.chmod(0o600)
    print('Shared generation4/judge4/scene3 pools ready.', flush=True)
    try:
        server.serve_forever()
    finally:
        (out / 'final-status.json').write_text(json.dumps(pools.snapshot(), indent=2) + '\n')
        endpoint.unlink(missing_ok=True)
        server.server_close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--generation-target',type=int,default=4)
    parser.add_argument('--judge-target',type=int,default=4)
    args=parser.parse_args()
    serve(args.out,{'generation':args.generation_target,'judge':args.judge_target})
