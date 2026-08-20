from pathlib import Path
import hashlib

ROOT = Path("sand_one/source")
EXPECTED = {
    "part00.js.txt": "0207da46d4f2717932192bf1056c26f27f17766bd1815a3c8fc0d19e17103534",
    "part05_01.js.txt": "5ccb76d2c1b7d9025a4c5924665d38045e8635c72d07e81103f6e22ace806889",
    "part07_01.js.txt": "32db17aab08e1e9eb1b0eb88fda90de3de872e42bdd115478b415f0096e5b422",
}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def replace_once(path, old, new, label):
    text = path.read_text()
    if text.count(old) != 1:
        raise SystemExit(f"anchor {label} expected once, found {text.count(old)}")
    path.write_text(text.replace(old, new, 1))

for name, expected in EXPECTED.items():
    actual = sha(ROOT / name)
    if actual != expected:
        raise SystemExit(f"source drift before Web/Live gate: {name} {actual} != {expected}")
BOOTSTRAP = Path("tools/sand-one-web-live-bootstrap")
for required in ["part08_00.js.txt", "part08_01.js.txt"]:
    source = BOOTSTRAP / required
    if not source.is_file():
        raise SystemExit(f"missing extension source: {source}")
    (ROOT / required).write_bytes(source.read_bytes())

# Registry containers are mutable only at module bootstrap; each registered entry is frozen.
replace_once(ROOT / "part00.js.txt", "const CAPABILITY_FAMILIES = Object.freeze({", "const CAPABILITY_FAMILIES = {", "families-open")
replace_once(ROOT / "part00.js.txt", '  personal_system: Object.freeze({ label: "Personal/System", role: "profile, settings, global search, audit and undo", state: "planned" }),\n});\nconst CAPABILITY_FAMILY_IDS', '  personal_system: Object.freeze({ label: "Personal/System", role: "profile, settings, global search, audit and undo", state: "planned" }),\n};\nconst CAPABILITY_FAMILY_IDS', "families-close")
replace_once(ROOT / "part00.js.txt", "const CAPABILITY_FAMILY_CONTRACTS = Object.freeze({", "const CAPABILITY_FAMILY_CONTRACTS = {", "contracts-open")
replace_once(ROOT / "part00.js.txt", '  }),\n});\nconst CAPABILITY_FAMILY_CATALOG', '  }),\n};\nconst CAPABILITY_FAMILY_CATALOG', "contracts-close")

# Future families attach through these two hooks; Shopping/Work stay unchanged.
replace_once(ROOT / "part05_01.js.txt", '  throw new SandPlanError("BAD_CAPABILITY_STEP", `Unhandled family operation: ${op}`);\n}', '  const extensionStep = validateCapabilityExtensionStep(family, op, a, refs, index);\n  if (extensionStep) return extensionStep;\n  throw new SandPlanError("BAD_CAPABILITY_STEP", `Unhandled family operation: ${op}`);\n}', "validator-extension")
replace_once(ROOT / "part05_01.js.txt", '  if (family === "work") return executeWorkPlan(env, { chatId, updateId, operationId, mainStepIndex, plan, refs });\n  throw new SandPlanError("CAPABILITY_NOT_READY", `Family not executable: ${family}`);', '  if (family === "work") return executeWorkPlan(env, { chatId, updateId, operationId, mainStepIndex, plan, refs });\n  const extension = await executeCapabilityExtensionPlan(env, { chatId, updateId, operationId, mainStepIndex, family, plan, refs });\n  if (extension) return extension;\n  throw new SandPlanError("CAPABILITY_NOT_READY", `Family not executable: ${family}`);', "executor-extension")

# Every registered extension contributes deterministic selftests to the normal gate.
replace_once(ROOT / "part07_01.js.txt", '  push("voice_adapter_contract", VOICE_MAX_BYTES === 25 * 1024 * 1024 && omniAudioUrl({ OMNIAI_SERVICE: { fetch() {} } }) === "https://omniai.internal/v1/audio/transcriptions", { max_bytes: VOICE_MAX_BYTES });\n\n  const selfChat = "__sand_v2_selftest__";', '  push("voice_adapter_contract", VOICE_MAX_BYTES === 25 * 1024 * 1024 && omniAudioUrl({ OMNIAI_SERVICE: { fetch() {} } }) === "https://omniai.internal/v1/audio/transcriptions", { max_bytes: VOICE_MAX_BYTES });\n  for (const test of await runCapabilityExtensionSelftests(env)) push(test.name, test.ok, test.detail ?? null);\n\n  const selfChat = "__sand_v2_selftest__";', "extension-selftests")

parts = sorted(ROOT.glob("part*.js.txt"))
Path("SAND_ONE_1.0.js").write_bytes(b"".join(p.read_bytes() for p in parts))
print("WEB_LIVE_APPLY_OK", sha(Path("SAND_ONE_1.0.js")), Path("SAND_ONE_1.0.js").stat().st_size)
