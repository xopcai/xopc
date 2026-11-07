"""OSWorld agent interface backed by xopc's shared model adapter, VM input only."""
import ast
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import queue
import re
import struct
import subprocess
import threading
import xml.etree.ElementTree as ET


DEFAULT_MODEL = "openai/gpt-6.1-sol"
REPO = Path(__file__).resolve().parents[2]
STATE_NS = "https://accessibility.ubuntu.example.org/ns/state"
COMPONENT_NS = "https://accessibility.ubuntu.example.org/ns/component"


def png_size(image):
    if not isinstance(image, bytes) or not 24 <= len(image) <= 5 * 1024 * 1024:
        raise ValueError("OSWORLD_INVALID_IMAGE")
    if image[:8] != b"\x89PNG\r\n\x1a\n" or image[12:16] != b"IHDR":
        raise ValueError("OSWORLD_INVALID_IMAGE")
    width, height = struct.unpack(">II", image[16:24])
    if not (0 < width <= 16384 and 0 < height <= 16384 and width * height <= 16000000):
        raise ValueError("OSWORLD_INVALID_IMAGE")
    return width, height


def window_context(tree, width, height):
    """Expose current AT-SPI editable bounds without inventing native action refs."""
    context = {"platform": "linux", "elements": [], "truncated": True}
    if not isinstance(tree, str) or len(tree) > 2 * 1024 * 1024 or "<!" in tree:
        return json.dumps(context)
    try:
        root = ET.fromstring(tree)
    except ET.ParseError:
        return json.dumps(context)
    fields, labels = [], []
    for index, node in enumerate(root.iter()):
        if index >= 20000:
            raise ValueError("OSWORLD_CONTEXT_LIMIT")
        attrs = node.attrib
        role = node.tag.rsplit("}", 1)[-1]
        if "password" in role.lower() or attrs.get(f"{{{STATE_NS}}}protected") == "true":
            continue
        label = attrs.get("name", "")[:200]
        if label and len(labels) < 40:
            labels.append(label)
        if attrs.get(f"{{{STATE_NS}}}editable") != "true" or attrs.get(f"{{{STATE_NS}}}enabled") != "true":
            continue
        try:
            x, y = ast.literal_eval(attrs.get(f"{{{COMPONENT_NS}}}screencoord", ""))
            w, h = ast.literal_eval(attrs.get(f"{{{COMPONENT_NS}}}size", ""))
            if not all(type(v) in (int, float) and math.isfinite(v) for v in (x, y, w, h)):
                continue
            if not (w > 0 and h > 0 and x >= 0 and y >= 0 and x + w <= width and y + h <= height):
                continue
        except (ValueError, SyntaxError, TypeError):
            continue
        fields.append({"role": "AXTextField", "label": label,
                       "bounds": {"x": x, "y": y, "width": w, "height": h},
                       "enabled": True, "semanticActions": []})
    # Do not omit editable candidates: the common adapter must detect overlap.
    context["elements"] = fields
    context["text"] = "\n".join(labels)
    summary = json.dumps(context, ensure_ascii=False)
    if len(summary) > 12000:
        raise ValueError("OSWORLD_CONTEXT_LIMIT")
    return summary


def _point(point, width, height):
    if not isinstance(point, dict) or set(point) != {"x", "y"}:
        raise ValueError("OSWORLD_INVALID_ACTION")
    x, y = point["x"], point["y"]
    if not all(type(v) in (float, int) and math.isfinite(v) for v in (x, y)):
        raise ValueError("OSWORLD_INVALID_ACTION")
    if not (0 <= x < width and 0 <= y < height):
        raise ValueError("OSWORLD_POINT_OUTSIDE_FRAME")
    return int(x), int(y)


def action_code(action, width, height):
    """Generate only fixed PyAutoGUI calls; model-authored code is never evaluated."""
    if not isinstance(action, dict):
        raise ValueError("OSWORLD_INVALID_ACTION")
    kind = action.get("kind")
    fields = {"click": {"point", "button", "count"}, "drag": {"from", "to"},
              "typeText": {"point", "text"}, "pressKeys": {"keys"},
              "scroll": {"point", "deltaX", "deltaY"}, "wait": {"durationMs"}}
    if kind not in fields or set(action) != fields[kind] | {"kind"}:
        raise ValueError("OSWORLD_UNSUPPORTED_ACTION")
    if kind == "click":
        x, y = _point(action["point"], width, height)
        if action["button"] not in ("left", "right") or type(action["count"]) is not int or action["count"] not in (1, 2):
            raise ValueError("OSWORLD_INVALID_ACTION")
        return f"pyautogui.click({x}, {y}, clicks={action['count']}, button={action['button']!r})"
    if kind == "drag":
        x, y = _point(action["from"], width, height)
        tx, ty = _point(action["to"], width, height)
        return f"pyautogui.moveTo({x}, {y}); pyautogui.dragTo({tx}, {ty}, duration=0.5)"
    if kind == "typeText":
        x, y = _point(action["point"], width, height)
        text = action["text"]
        if not isinstance(text, str) or len(text) > 16384:
            raise ValueError("OSWORLD_INVALID_ACTION")
        return f"import pyperclip; pyautogui.click({x}, {y}); pyperclip.copy({text!r}); pyautogui.hotkey('ctrl', 'v')"
    if kind == "pressKeys":
        keys = action["keys"]
        aliases = {"return": "enter"}
        allowed = {"enter", "tab", "escape", "up", "down", "left", "right", "space", "delete", "backspace",
                   "home", "end", "pageup", "pagedown"} | {f"f{i}" for i in range(1, 13)} | set("abcdefghijklmnopqrstuvwxyz0123456789")
        if not isinstance(keys, list) or not 1 <= len(keys) <= 4 or not all(isinstance(k, str) for k in keys):
            raise ValueError("OSWORLD_INVALID_ACTION")
        keys = [aliases.get(k, k) for k in keys]
        if any(k not in {"ctrl", "alt", "shift"} for k in keys[:-1]) or keys[-1] not in allowed:
            raise ValueError("OSWORLD_INVALID_ACTION")
        return "pyautogui.hotkey(" + ", ".join(repr(k) for k in keys) + ")"
    if kind == "wait":
        ms = action["durationMs"]
        if type(ms) is not int or not 0 <= ms <= 2000:
            raise ValueError("OSWORLD_INVALID_ACTION")
        return f"time.sleep({ms / 1000})"
    x, y = _point(action["point"], width, height)
    dx, dy = action["deltaX"], action["deltaY"]
    if any(type(v) is not int or abs(v) > 2000 for v in (dx, dy)) or (dx == 0 and dy == 0):
        raise ValueError("OSWORLD_INVALID_ACTION")
    def ticks(delta):
        return (-1 if delta > 0 else 1) * max(1, round(abs(delta) / 100))
    parts = [f"pyautogui.moveTo({x}, {y})"]
    if dy:
        parts.append(f"pyautogui.scroll({ticks(dy)})")
    if dx:
        parts.append(f"pyautogui.hscroll({-ticks(dx)})")
    return "; ".join(parts)


class XopcAgent:
    action_space = "pyautogui"
    observation_type = "screenshot_a11y_tree"

    def __init__(self, model=DEFAULT_MODEL, bridge_command=None):
        self.model = model
        self.model_identity = None
        self.command = bridge_command or ["node", "--import", "tsx", str(Path(__file__).with_name("model-bridge.mts")), model]
        self.process = None
        self.reset()

    def reset(self, *args, **kwargs):
        self.close()
        self.history = []
        self.pending = None
        self.model_requests = 0
        self.requests_unknown = False
        self.claimed_success = False
        self.takeover = False

    def close(self):
        if self.process is not None:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=3)
            self.process.stdin.close()
            self.process.stdout.close()
            self.process = None

    def _request(self, request):
        count_known = False
        if self.process is None:
            env = {**os.environ, "XOPC_LOG_LEVEL": "fatal", "XOPC_LOG_CONSOLE": "false", "XOPC_LOG_FILE": "false"}
            self.process = subprocess.Popen(self.command, cwd=REPO, env=env, stdin=subprocess.PIPE,
                                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            self.replies = queue.Queue()
            stream, replies = self.process.stdout, self.replies
            def read_replies():
                try:
                    for line in stream:
                        if len(line) > 128 * 1024:
                            replies.put(None)
                            return
                        replies.put(line)
                except (OSError, ValueError):
                    pass
                finally:
                    replies.put(None)
            threading.Thread(target=read_replies, daemon=True).start()
        try:
            self.process.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
            self.process.stdin.flush()
            line = self.replies.get(timeout=120)
            response = json.loads(line) if line else {}
            if not isinstance(response, dict):
                raise ValueError("OSWORLD_BRIDGE_FAILED")
            if type(response.get("modelRequests")) is int and response["modelRequests"] >= 0:
                self.model_requests += response["modelRequests"]
                count_known = True
            if response.get("ok") is not True or response.get("modelRef") != self.model:
                raise ValueError("OSWORLD_BRIDGE_FAILED")
            identity = response.get("modelIdentity", "")
            if not isinstance(identity, str) or not re.fullmatch(r"[a-f0-9]{64}", identity):
                raise ValueError("OSWORLD_BRIDGE_FAILED")
            if self.model_identity is not None and identity != self.model_identity:
                raise ValueError("OSWORLD_BRIDGE_FAILED")
            self.model_identity = identity
            return response
        except (OSError, ValueError, queue.Empty):
            if request["op"] == "predict" and not count_known:
                self.requests_unknown = True
            self.close()
            raise RuntimeError("OSWORLD_BRIDGE_FAILED") from None

    def preflight(self):
        return self._request({"op": "preflight"})

    def predict(self, instruction, obs):
        image = obs["screenshot"]
        width, height = png_size(image)
        summary = window_context(obs.get("accessibility_tree"), width, height)
        digest = hashlib.sha256(image).hexdigest()
        # Reaching predict with a new observation means the runner completed the preceding step.
        if self.pending is not None:
            self.history.append({**self.pending, "after": summary[:2000], "afterStateDigest": digest})
            self.history = self.history[-6:]
            self.pending = None
        goal = ("Operate this disposable Linux VM. Supported actions: click, drag, typeText, pressKeys, scroll, wait. "
                "There are no native action refs or native setValue operations. Observe after every primitive action. "
                "Typing requires a currently exposed editable field. Task: " + instruction)
        if len(goal) > 4000:
            raise ValueError("OSWORLD_GOAL_LIMIT")
        response = self._request({"op": "predict", "goal": goal, "summary": summary, "width": width, "height": height,
                                  "screenshotBase64": base64.b64encode(image).decode(), "history": self.history})
        proposal = response["proposal"]
        if proposal["kind"] == "finished":
            self.claimed_success = proposal["claimedSuccess"]
            return proposal, ["DONE" if self.claimed_success else "FAIL"]
        if proposal["kind"] in ("takeover", "answer"):
            self.takeover = True
            return {"kind": proposal["kind"]}, ["FAIL"]
        if proposal["kind"] != "action":
            raise ValueError("OSWORLD_INVALID_ACTION")
        action = proposal["action"]
        code = action_code(action, width, height)
        self.pending = {"goal": instruction[:1000], "action": action["kind"],
                        "actionPreview": json.dumps(action, ensure_ascii=False)[:1000],
                        "dispatch": "completed", "outcome": "unknown"}
        return proposal, [code]
