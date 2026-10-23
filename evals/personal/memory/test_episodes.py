"""Episode versioning, split integrity and immutable output guards; no model calls."""
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PREPARE=Path(__file__).with_name('prepare-episodes.py')

class EpisodeFixturesTests(unittest.TestCase):
    def prepare(self,root,version):
        subprocess.run([sys.executable,str(PREPARE),'--version',str(version),'--out',str(root)],check=True,capture_output=True)

    def test_original_v1_bytes_remain_reproducible(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'fixtures';self.prepare(root,1)
            expected={'development':'e51b2ea4b137189202be46593387afcb17530812a3fefbcf8cc996b385aa5d7d',
                      'validation':'e2f9558f75ef85ab0a56f641e37edbe434bad474be2a7680226db3dfc7d4ce45'}
            for split,digest in expected.items():
                self.assertEqual(hashlib.sha256((root/split/'selection.json').read_bytes()).hexdigest(),digest)

    def test_v3_has_disjoint_locked_worlds_and_new_validation_event_structures(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'fixtures';self.prepare(root,3);worlds={};cases={}
            for split in ['development','validation']:
                selection=json.loads((root/split/'selection.json').read_text());self.assertEqual(len(selection['cases']),8)
                worlds[split]=set()
                for row in selection['cases']:
                    path=root/split/(row['id']+'.json');self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),row['sha256'])
                    case=json.loads(path.read_text());worlds[split].add(case['worldId']);cases[case['id']]=case
            self.assertFalse(worlds['development']&worlds['validation'])
            self.assertIn('11月18日',cases['episode-validation-02']['sessions'][1]['messages'][0]['content'])
            self.assertEqual(cases['episode-validation-07']['gold']['episode']['authorizedIndices'],[2,4])
            self.assertIn('```text',cases['episode-validation-08']['liveTurns'][0])
            self.assertEqual(len(cases['episode-validation-08']['liveTurns']),3)

    def test_output_cannot_overwrite_existing_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'fixtures';root.mkdir();marker=root/'keep';marker.write_text('original')
            result=subprocess.run([sys.executable,str(PREPARE),'--out',str(root)],capture_output=True)
            self.assertNotEqual(result.returncode,0);self.assertEqual(marker.read_text(),'original')

if __name__=='__main__':unittest.main()
