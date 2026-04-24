import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "scripts" / "scaffold-paper-skill.js"
SPEC = ROOT / "examples" / "sc-tenifold-knk.contract.json"


def default_quick_validate():
    env_value = os.environ.get("SKILL_CREATOR_QUICK_VALIDATE")
    if env_value:
        return Path(env_value)

    windows_default = Path(r"C:\Users\wang\.codex\skills\.system\skill-creator\scripts\quick_validate.py")
    if windows_default.exists():
        return windows_default

    raise RuntimeError("Set SKILL_CREATOR_QUICK_VALIDATE to the quick_validate.py path.")


class ContractGeneratorTests(unittest.TestCase):
    maxDiff = None

    def run_node(self, *args):
        return subprocess.run(
            ["node", str(GENERATOR), *args],
            capture_output=True,
            text=True
        )

    def run_quick_validate(self, target):
        env = os.environ.copy()
        env.setdefault("PYTHONUTF8", "1")
        return subprocess.run(
            [sys.executable, str(default_quick_validate()), str(target)],
            capture_output=True,
            text=True,
            env=env
        )

    def test_missing_required_block_fails(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            spec = json.loads(SPEC.read_text(encoding="utf-8"))
            spec.pop("qcContract")
            bad_spec = Path(tmp_dir) / "bad.json"
            bad_spec.write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
            completed = self.run_node("--spec-file", str(bad_spec), "--out-root", tmp_dir)
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("qcContract.rules", completed.stderr)

    def test_scaffold_generates_contract_layout_and_utf8_files(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            completed = self.run_node("--spec-file", str(SPEC), "--out-root", tmp_dir)
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            target = Path(completed.stdout.strip())
            expected = [
                "SKILL.md",
                "agents/openai.yaml",
                "sc_tenifold_knk.py",
                "tests/test_sc_tenifold_knk.py",
                "references/methods.md",
                "references/papers.md",
                "examples/demo_input/input_manifest.json",
                "examples/demo_input/wt_counts.csv",
                "examples/expected_output/result.json",
                "knowledge/guardrails.md",
                "knowledge/troubleshooting.md"
            ]
            for relative in expected:
                self.assertTrue((target / relative).exists(), relative)

            for relative in [
                "SKILL.md",
                "references/methods.md",
                "references/papers.md",
                "knowledge/guardrails.md"
            ]:
                (target / relative).read_text(encoding="utf-8")

    def test_generated_skill_passes_quick_validate(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            completed = self.run_node("--spec-file", str(SPEC), "--out-root", tmp_dir)
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            target = Path(completed.stdout.strip())
            validation = self.run_quick_validate(target)
            self.assertEqual(validation.returncode, 0, msg=validation.stderr)

    def test_generated_child_tests_pass(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            completed = self.run_node("--spec-file", str(SPEC), "--out-root", tmp_dir)
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            target = Path(completed.stdout.strip())
            unittest_run = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "unittest",
                    "discover",
                    "-s",
                    str(target / "tests"),
                    "-p",
                    "test_*.py",
                    "-v"
                ],
                cwd=target,
                capture_output=True,
                text=True,
                env=os.environ.copy()
            )
            self.assertEqual(unittest_run.returncode, 0, msg=unittest_run.stdout + unittest_run.stderr)


if __name__ == "__main__":
    unittest.main()
