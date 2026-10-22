"""Pin and normalize evaluator-only memory fixtures; never seed gold into memory."""
import argparse
import hashlib
import json
import re
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

DATA_REVISION = '98d7416c24c778c2fee6e6f3006e7a073259d48f'
DATA_SHA256 = 'd6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442'
TYPES = ['single-session-user', 'single-session-assistant', 'single-session-preference',
         'multi-session', 'temporal-reasoning', 'knowledge-update']


def digest(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def date_ms(value):
    # Upstream dates have no timezone. Explicit UTC interpretation is an adapter convention.
    cleaned = re.sub(r'\s*\([^)]*\)', '', value)
    return int(datetime.strptime(cleaned, '%Y/%m/%d %H:%M').replace(tzinfo=timezone.utc).timestamp() * 1000)


def select(rows, per_type=20):
    selected = []
    for kind in TYPES:
        group = sorted((r for r in rows if r['question_type'] == kind and time_consistent(r)), key=lambda r: digest(r['question_id']))
        if len(group) < per_type:
            raise ValueError(f'Insufficient {kind}: {len(group)}')
        # Abstention is a cross-cutting ID label, not a seventh question_type.
        abstain = [r for r in group if r['question_id'].endswith('_abs')]
        chosen = abstain[:min(2, len(abstain), per_type)]
        chosen += [r for r in group if r not in chosen][:per_type-len(chosen)]
        selected.extend(chosen)
    return selected


def time_consistent(row):
    if 'question_date' not in row:  # Minimal unit-test selection records have no source history.
        return True
    return all(date_ms(date) <= date_ms(row['question_date']) for date in row['haystack_dates'])


def normalize(row):
    sessions, refs, evidence, excluded = [], {}, [], []
    cutoff = date_ms(row['question_date'])
    if len({len(row[key]) for key in ['haystack_session_ids', 'haystack_dates', 'haystack_sessions']}) != 1:
        raise ValueError('Mismatched session arrays')
    session_map = {}
    for ordinal, (sid, date, turns) in enumerate(zip(row['haystack_session_ids'], row['haystack_dates'], row['haystack_sessions'])):
        timestamp = date_ms(date)
        if timestamp > cutoff:
            excluded.append(sid)
            continue
        visible_id = f'history-{ordinal+1:04d}'
        session_map[visible_id] = sid
        messages = []
        for index, turn in enumerate(turns):
            ref = f'{visible_id}:{index}'
            refs[ref] = turn['content']
            if turn.get('has_answer'):
                evidence.append(ref)
            # Preserve exact original text and role; has_answer is deliberately stripped.
            messages.append({'id': ref, 'role': turn['role'], 'content': turn['content'], 'timestamp': timestamp})
        sessions.append({'id': visible_id, 'timestamp': timestamp, 'messages': messages})
    return {'id': 'lme-' + row['question_id'], 'suite': 'longmemeval-s-120', 'category': row['question_type'],
            'worldId': row['question_id'], 'split': 'baseline-diagnostic', 'sessions': sessions,
            'query': row['question'], 'queryTime': cutoff, 'knowledgeCutoff': cutoff,
            'excludedFutureSessionIds': excluded,
            'gold': {'answer': row['answer'], 'abstention': row['question_id'].endswith('_abs'),
                     'evidenceRefs': evidence,
                     'evidenceSessionIds': [visible for visible, original in session_map.items() if original in row['answer_session_ids']],
                     'originalSessionIds': session_map}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', default='.xopc-evals/memory-upstream/longmemeval_s_cleaned.json')
    parser.add_argument('--out', default='.xopc-evals/memory-fixtures-v1')
    parser.add_argument('--per-type', type=int, default=20)
    parser.add_argument('--chinese-version', type=int, choices=[1, 2], default=2)
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=False)
    data = Path(args.data)
    if not data.exists():
        data.parent.mkdir(parents=True, exist_ok=True)
        url = f'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/{DATA_REVISION}/{data.name}'
        with urllib.request.urlopen(url, timeout=120) as response:
            payload = response.read()
        data.write_bytes(payload)
    payload = data.read_bytes()
    if digest(payload) != DATA_SHA256:
        raise ValueError('Dataset SHA-256 mismatch')
    rows = select(json.loads(payload), args.per_type)
    cases = [normalize(row) for row in rows]
    from chinese import build_worlds
    chinese = build_worlds(args.chinese_version)
    cases += [case for case in chinese if case['split'] == 'development']
    for case in cases:
        (out / (case['id'] + '.json')).write_text(json.dumps(case, ensure_ascii=False), encoding='utf8')
    manifest = {'schemaVersion': 1, 'dataRevision': DATA_REVISION, 'dataSha256': DATA_SHA256,
                'datasetLicense': 'MIT (HF dataset card checked 2026-10-22)',
                'sampling': 'Time-consistent histories only, then SHA256(question_id), per-type; reserve up to two abstention IDs/type before filling',
                'timeInconsistentUpstreamIds': [r['question_id'] for r in json.loads(payload) if not time_consistent(r)],
                'cases': [{'id': c['id'], 'suite': c['suite'], 'category': c['category'],
                           'sha256': digest((out / (c['id'] + '.json')).read_bytes())} for c in cases],
                'counts': dict(Counter(c['category'] for c in cases)),
                'abstention': sum(c['gold'].get('abstention', False) for c in cases),
                'futureFilteredCases': sum(bool(c.get('excludedFutureSessionIds')) for c in cases),
                'futureFilteredSessions': sum(len(c.get('excludedFutureSessionIds', [])) for c in cases),
                'chineseVersion': args.chinese_version, 'chineseWorlds': 24, 'chineseChecks': len(chinese), 'chineseBaselineChecks': 64,
                'limitations': ['Stratified diagnostic sample, not official full 500 benchmark',
                                'Upstream timezone unspecified; parsed as UTC',
                                'Future-dated sessions excluded at query cutoff; product-adapted, not official protocol',
                                'Gold/evidence labels never passed to ingestion or candidate']}
    (out / 'selection.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
    # Holdout worlds are materialized for integrity checks, not included in the baseline schedule.
    (out / 'chinese-all.json').write_text(json.dumps(chinese, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'out': str(out), 'cases': len(cases), 'counts': manifest['counts'], 'abstention': manifest['abstention']}))


if __name__ == '__main__':
    main()
