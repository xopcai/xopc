import ast
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from agent import XopcAgent, action_code, png_size, window_context, DEFAULT_MODEL


def image(width=800, height=600):
    return b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + struct.pack(">II", width, height)


TREE = '''<desktop xmlns:s="https://accessibility.ubuntu.example.org/ns/state" xmlns:c="https://accessibility.ubuntu.example.org/ns/component">
<entry name="Search" s:editable="true" s:enabled="true" c:screencoord="(10, 20)" c:size="(200, 40)" />
<password-text name="Secret" s:editable="true" c:screencoord="(10, 100)" c:size="(200, 40)" />
<entry name="Disabled" s:editable="true" s:enabled="false" c:screencoord="(10, 200)" c:size="(200, 40)" />
<entry name="Offscreen" s:editable="true" c:screencoord="(-20, 20)" c:size="(200, 40)" />
</desktop>'''


class ActionsTest(unittest.TestCase):
    def test_keyboard_direction_and_no_native_or_arbitrary_code(self):
        for key in ("delete", "backspace"):
            self.assertEqual(action_code({"kind": "pressKeys", "keys": ["ctrl", key]}, 800, 600),
                             f"pyautogui.hotkey('ctrl', '{key}')")
        for action in ({"kind": "activate", "ref": "invented"}, {"kind": "batch", "actions": []},
                       {"kind": "pressKeys", "keys": ["cmd", "a"]},
                       {"kind": "pressKeys", "keys": ["a');print('injected"]},
                       {"kind": "click", "point": {"x": 10, "y": 20}, "button": "left", "count": 1, "code": "print('injected')"}):
            with self.assertRaises(ValueError):
                action_code(action, 800, 600)

    def test_text_roundtrip_is_data_and_unicode_is_preserved(self):
        text = "中文🙂');__import__('os').system('injected')\n"
        code = action_code({"kind": "typeText", "point": {"x": 10, "y": 20}, "text": text}, 800, 600)
        pyautogui, clipboard = Mock(), Mock()
        with patch.dict(sys.modules, {"pyperclip": clipboard}):
            exec(compile(ast.parse(code), "generated-input", "exec"), {"pyautogui": pyautogui})
        clipboard.copy.assert_called_once_with(text)
        pyautogui.hotkey.assert_called_once_with("ctrl", "v")

    def test_bounds_and_nonfinite_coordinates_are_rejected_before_dispatch(self):
        for x in (-1, 800, float("nan"), float("inf"), True):
            with self.assertRaises(ValueError):
                action_code({"kind": "click", "point": {"x": x, "y": 10}, "button": "left", "count": 1}, 800, 600)
        self.assertEqual(action_code({"kind": "scroll", "point": {"x": 1, "y": 1}, "deltaX": 100, "deltaY": 100}, 800, 600),
                         "pyautogui.moveTo(1, 1); pyautogui.scroll(-1); pyautogui.hscroll(1)")
        with self.assertRaises(ValueError):
            action_code({"kind": "wait", "durationMs": 2001}, 800, 600)

    def test_accessibility_does_not_invent_refs_or_drop_overlapping_fields(self):
        context = json.loads(window_context(TREE, 800, 600))
        self.assertEqual(context["platform"], "linux")
        self.assertEqual([field["label"] for field in context["elements"]], ["Search"])
        self.assertNotIn("Secret", json.dumps(context))
        self.assertNotIn("ref", context["elements"][0])
        overlapped = TREE.replace("</desktop>", '<entry name="Overlap" s:editable="true" s:enabled="true" c:screencoord="(10,20)" c:size="(200,40)" /></desktop>')
        self.assertEqual(len(json.loads(window_context(overlapped, 800, 600))["elements"]), 2)
        for tree in (None, "not xml", '<!DOCTYPE x [<!ENTITY x "secret">]><desktop/>'):
            self.assertEqual(json.loads(window_context(tree, 800, 600))["elements"], [])

    def test_invalid_images_fail_without_model_calls(self):
        self.assertEqual(png_size(image()), (800, 600))
        for value in (b"invalid", image(0, 600), image(5000, 5000)):
            with self.assertRaises(ValueError):
                png_size(value)


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)

    def agent(self, source):
        path = Path(self.root.name) / "bridge.py"
        path.write_text(source)
        agent = XopcAgent(bridge_command=[sys.executable, "-u", str(path)])
        self.addCleanup(agent.close)
        return agent

    def test_real_subprocess_protocol_preserves_history_and_resets_between_episodes(self):
        agent = self.agent('''import sys,json
for line in sys.stdin:
    request=json.loads(line)
    if request['op']=='preflight':
        print(json.dumps({'ok':True,'modelRef':'openai/gpt-6.1-sol','modelIdentity':'a'*64}),flush=True);continue
    expected=0 if not request['history'] else 1
    assert len(request['history'])==expected
    if expected: assert request['history'][0]['dispatch']=='completed'
    proposal={'kind':'action','action':{'kind':'pressKeys','keys':['backspace']}} if not expected else {'kind':'finished','claimedSuccess':True}
    print(json.dumps({'ok':True,'modelRef':'openai/gpt-6.1-sol','modelIdentity':'a'*64,'proposal':proposal,'modelRequests':1}),flush=True)
''')
        self.assertEqual(agent.preflight()["modelRef"], DEFAULT_MODEL)
        obs = {"screenshot": image(), "accessibility_tree": TREE}
        self.assertEqual(agent.predict("Remove one character", obs)[1], ["pyautogui.hotkey('backspace')"])
        self.assertEqual(agent.predict("Remove one character", obs)[1], ["DONE"])
        self.assertEqual(agent.model_requests, 2)
        self.assertTrue(agent.claimed_success)
        old = agent.process
        agent.reset()
        self.assertIsNotNone(old.poll())
        self.assertEqual(agent.model_requests, 0)
        self.assertEqual(agent.history, [])

    def test_provider_failure_is_not_retried_or_substituted_and_request_count_survives(self):
        agent = self.agent('''import sys,json
for line in sys.stdin:
    print(json.dumps({'ok':False,'errorCode':'COMPUTER_MODEL_HTTP_403','modelRequests':1}),flush=True)
''')
        with self.assertRaisesRegex(RuntimeError, "OSWORLD_BRIDGE_FAILED"):
            agent.predict("Inspect", {"screenshot": image()})
        self.assertEqual(agent.model_requests, 1)
        self.assertIsNone(agent.process)

    def test_another_model_cannot_silently_replace_the_requested_model(self):
        agent = self.agent('''import sys,json
for line in sys.stdin: print(json.dumps({'ok':True,'modelRef':'another/model'}),flush=True)
''')
        with self.assertRaises(RuntimeError):
            agent.preflight()

    def test_bridge_exit_keeps_request_accounting_unknown_instead_of_inventing_zero(self):
        agent = self.agent("import sys; sys.stdin.readline(); sys.exit(1)\n")
        with self.assertRaises(RuntimeError):
            agent.predict("Inspect", {"screenshot": image()})
        self.assertTrue(agent.requests_unknown)
        self.assertIsNone(agent.process)


if __name__ == "__main__":
    unittest.main()
