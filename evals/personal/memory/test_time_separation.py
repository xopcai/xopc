import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE=Path(__file__).parent
class TimeSeparationFixturesTest(unittest.TestCase):
    def test_consumed_bytes_and_new_holdout_are_disjoint_and_immutable(self):
        with tempfile.TemporaryDirectory() as folder:
            old=Path(folder)/'old';new=Path(folder)/'new'
            subprocess.run([sys.executable,str(HERE/'prepare-episodes.py'),'--version','3','--out',str(old)],check=True,capture_output=True)
            command=[sys.executable,str(HERE/'prepare-time-separation.py'),'--consumed',str(old),'--out',str(new)]
            subprocess.run(command,check=True,capture_output=True)
            selections={s:json.loads((new/s/'selection.json').read_text())['cases'] for s in ['development','validation']}
            self.assertEqual([len(selections[s]) for s in selections],[16,8])
            worlds={}
            for split,rows in selections.items():
                worlds[split]=set()
                for row in rows:
                    data=(new/split/(row['id']+'.json')).read_bytes();case=json.loads(data)
                    self.assertEqual(hashlib.sha256(data).hexdigest(),row['sha256']);worlds[split].add(case['worldId'])
                    if split=='development': self.assertEqual(data,(old/row['originalSplit']/(row['id']+'.json')).read_bytes())
            self.assertFalse(worlds['development']&worlds['validation'])
            self.assertEqual(sum(r['consumedValidation'] for r in selections['development']),8)
            self.assertNotEqual(subprocess.run(command,capture_output=True).returncode,0)
if __name__=='__main__': unittest.main()
