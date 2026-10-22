import ast, hashlib, json, sys
from pathlib import Path
source, meta = Path(sys.argv[1]), Path(sys.argv[2])
raw = source.read_bytes()
if hashlib.sha256(raw).hexdigest() != json.loads(meta.read_text())["sha256"]:
    raise ValueError("Official evaluator source hash mismatch")
function = next(n for n in ast.parse(raw).body if isinstance(n, ast.FunctionDef) and n.name == "get_anscheck_prompt")
if function.decorator_list: raise ValueError("Unexpected prompt function decorator")
namespace = {}
exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), namespace)
data = json.load(sys.stdin)
print(namespace["get_anscheck_prompt"](data["type"], data["question"], data["answer"], data["response"], data["abstention"]))
