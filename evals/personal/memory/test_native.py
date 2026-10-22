"""Native scoring must preserve prompt and captured-answer provenance."""
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).parent


class NativeProtocolTests(unittest.TestCase):
    def test_formatter_checks_hash_and_does_not_import_evaluator(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root/'upstream.py'
            raw = b'raise RuntimeError("must not execute module")\ndef get_anscheck_prompt(t,q,a,r,b):\n    return "|".join([t,q,a,r,str(b)])\n'
            source.write_bytes(raw)
            meta = root/'source.json'
            meta.write_text(json.dumps({'sha256':hashlib.sha256(raw).hexdigest()}))
            args = [sys.executable, str(HERE/'format-native.py'), str(source), str(meta)]
            data = json.dumps({'type':'temporal-reasoning','question':'q','answer':'a','response':'r','abstention':False})
            result = subprocess.run(args,input=data,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(result.stdout.strip(),'temporal-reasoning|q|a|r|False')
            source.write_bytes(raw+b'\n')
            result = subprocess.run(args,input=data,capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('hash mismatch',result.stderr)

    def test_retry_requires_completed_capture_and_skips_valid_low_grades(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); run=root/'run'; run.mkdir()
            args=[sys.executable,str(HERE/'retry-judges.py'),'--run',str(run)]
            result=subprocess.run(args+['--out',str(root/'premature')],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertFalse((root/'premature').exists())
            (run/'completion.json').write_text('{}')
            (run/'manifest.json').write_text(json.dumps({'models':{'candidate':'test','judge':'test'}}))
            (run/'summary.json').write_text(json.dumps({'results':[{'id':'low','judgment':{'correct':False}}]}))
            result=subprocess.run(args+['--out',str(root/'done')],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(json.loads((root/'done/summary.json').read_text())['results'],[])
            self.assertFalse((root/'done/pools').exists())

    def test_combiner_rejects_duplicate_or_changed_capture(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            run, native = root/'run', root/'native'
            capture = run/'cases/lme-1/capture'
            capture.mkdir(parents=True)
            native.mkdir()
            (run/'manifest.json').write_text(json.dumps({'cases':[{'id':'lme-1','suite':'longmemeval-s-120','category':'multi-session'}]}))
            (run/'summary.json').write_text(json.dumps({'results':[{'id':'lme-1','judgment':{'correct':True}}]}))
            (capture/'result.json').write_text(json.dumps({'answer':'saved answer'}))
            sha = lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
            (native/'manifest.json').write_text(json.dumps({'capturedManifestHash':sha(run/'manifest.json'),'model':'test','officialEvaluator':{}}))
            (native/'summary.json').write_text(json.dumps({'results':[{'id':'lme-1','category':'multi-session','correct':True,
                'captureHash':sha(capture/'result.json'),'answerHash':hashlib.sha256(b'saved answer').hexdigest()}]}))
            args = [sys.executable,str(HERE/'report-native.py'),'--run',str(run),'--native',str(native)]
            result = subprocess.run(args+['--out',str(root/'ok'),'--require-complete'],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            result = subprocess.run(args+[str(native),'--out',str(root/'duplicate')],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('Duplicate',result.stderr)
            (capture/'result.json').write_text(json.dumps({'answer':'replacement answer'}))
            result = subprocess.run(args+['--out',str(root/'tampered')],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('artifact changed',result.stderr)


if __name__ == '__main__':
    unittest.main()
