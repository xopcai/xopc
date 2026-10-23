import importlib.util
import json
import hashlib
import tempfile
import unittest
from pathlib import Path
HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('coverage_fixtures',HERE/'prepare-source-coverage.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class SourceCoverageTests(unittest.TestCase):
    def test_consumed_bytes_and_source_only_controls_are_declared(self):
        # The preceding generator creates the reproducible 16+8 consumed cohorts.
        import subprocess,sys
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);old=root/'v3';consumed=root/'time';new=root/'coverage'
            subprocess.run([sys.executable,str(HERE/'prepare-episodes.py'),'--out',str(old)],check=True,capture_output=True)
            subprocess.run([sys.executable,str(HERE/'prepare-time-separation.py'),'--consumed',str(old),'--out',str(consumed)],check=True,capture_output=True)
            module.prepare(consumed,new)
            dev=json.loads((new/'development/selection.json').read_text())['cases'];valid=json.loads((new/'validation/selection.json').read_text())['cases']
            self.assertEqual((len(dev),len(valid)),(24,8));self.assertFalse({r['worldId'] for r in dev}&{r['worldId'] for r in valid})
            for row in dev:
                source=next((consumed/split/(row['id']+'.json')) for split in ['development','validation'] if (consumed/split/(row['id']+'.json')).exists())
                self.assertEqual(source.read_bytes(),(new/'development'/(row['id']+'.json')).read_bytes())
            controls=0
            for row in valid:
                payload=(new/'validation'/(row['id']+'.json')).read_bytes();self.assertEqual(hashlib.sha256(payload).hexdigest(),row['sha256'])
                case=json.loads(payload);controls+=any(s.get('learningMode')=='source-only' for s in case['sessions'])
                refs=[m['id'] for s in case['sessions'] for m in s['messages'] if m['role']=='user'];self.assertEqual(refs,case['gold']['evidenceRefs'])
            self.assertEqual(controls,4)
if __name__=='__main__':unittest.main()
