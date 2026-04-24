import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC_BUILDER = ROOT / "scripts" / "build-contract-spec.js"
SCAFFOLDER = ROOT / "scripts" / "scaffold-paper-skill.js"
EVIDENCE_FIXTURE = ROOT / "tests" / "fixtures" / "sc-tenifold-knk.evidence.json"
ARTICLE_FIXTURE = ROOT / "tests" / "fixtures" / "sc-tenifold-knk.paper.html"


def default_quick_validate():
    env_value = os.environ.get("SKILL_CREATOR_QUICK_VALIDATE")
    if env_value:
        return Path(env_value)

    windows_default = Path(r"C:\Users\wang\.codex\skills\.system\skill-creator\scripts\quick_validate.py")
    if windows_default.exists():
        return windows_default

    raise RuntimeError("Set SKILL_CREATOR_QUICK_VALIDATE to the quick_validate.py path.")


class ContractSpecBuilderTests(unittest.TestCase):
    maxDiff = None

    def run_node(self, script, *args):
        return subprocess.run(
            ["node", str(script), *args],
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

    def test_build_contract_spec_from_evidence_fixture(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            spec_path = Path(tmp_dir) / "contract.json"
            completed = self.run_node(
                SPEC_BUILDER,
                "--paper-title",
                "scTenifoldKnk: An efficient virtual knockout tool for gene function predictions via single-cell gene regulatory network perturbation",
                "--paper-url",
                "https://doi.org/10.1016/j.patter.2022.100434",
                "--github-url",
                "https://github.com/cailab-tamu/scTenifoldKnk",
                "--evidence-file",
                str(EVIDENCE_FIXTURE),
                "--out",
                str(spec_path)
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            spec = json.loads(spec_path.read_text(encoding="utf-8"))
            self.assertEqual(spec["skillName"], "sc-tenifold-knk")
            self.assertEqual(spec["metadata"]["domain"], "single-cell")
            self.assertEqual(spec["metadata"]["analysis_type"], "virtual-knockout")
            self.assertEqual(spec["metadata"]["tool_runtime"], "r")
            self.assertIn("R", spec["metadata"]["dependencies"])
            self.assertIn("scTenifoldKnk", spec["metadata"]["trigger_keywords"])
            self.assertEqual(spec["testContract"]["demo_input_manifest"]["inputs"]["knockout_gene"], "AHR")
            self.assertIn("wt_counts.csv", spec["testContract"]["demo_files"])
            self.assertTrue(spec["references"]["methods"])
            self.assertTrue(spec["references"]["papers"])

    def test_build_contract_spec_merges_article_fixture_without_explicit_title(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            spec_path = Path(tmp_dir) / "contract.json"
            completed = self.run_node(
                SPEC_BUILDER,
                "--paper-url",
                "https://doi.org/10.1016/j.patter.2022.100434",
                "--article-file",
                str(ARTICLE_FIXTURE),
                "--github-url",
                "https://github.com/cailab-tamu/scTenifoldKnk",
                "--evidence-file",
                str(EVIDENCE_FIXTURE),
                "--out",
                str(spec_path)
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            spec = json.loads(spec_path.read_text(encoding="utf-8"))
            self.assertIn("scTenifoldKnk", spec["paperTitle"])
            self.assertEqual(spec["paperUrl"], "https://doi.org/10.1016/j.patter.2022.100434")
            self.assertEqual(spec["metadata"]["domain"], "single-cell")
            self.assertEqual(spec["metadata"]["analysis_type"], "virtual-knockout")
            papers_sections = spec["references"]["papers"]
            self.assertTrue(any(section["title"].startswith("Paper evidence") for section in papers_sections))

    def test_build_then_scaffold_and_validate_generated_skill(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            spec_path = Path(tmp_dir) / "contract.json"
            completed = self.run_node(
                SPEC_BUILDER,
                "--paper-title",
                "scTenifoldKnk: An efficient virtual knockout tool for gene function predictions via single-cell gene regulatory network perturbation",
                "--paper-url",
                "https://doi.org/10.1016/j.patter.2022.100434",
                "--github-url",
                "https://github.com/cailab-tamu/scTenifoldKnk",
                "--evidence-file",
                str(EVIDENCE_FIXTURE),
                "--out",
                str(spec_path)
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            scaffold = self.run_node(
                SCAFFOLDER,
                "--spec-file",
                str(spec_path),
                "--out-root",
                tmp_dir
            )
            self.assertEqual(scaffold.returncode, 0, msg=scaffold.stderr)
            target = Path(scaffold.stdout.strip())

            validation = self.run_quick_validate(target)
            self.assertEqual(validation.returncode, 0, msg=validation.stderr)

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

    def test_invalid_evidence_fixture_fails_fast(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            bad_path = Path(tmp_dir) / "bad.json"
            bad_path.write_text(
                json.dumps(
                    {
                        "repo": {
                            "repo": "broken",
                            "githubUrl": "https://github.com/example/broken"
                        },
                        "selections": {}
                    },
                    indent=2
                ),
                encoding="utf-8"
            )
            completed = self.run_node(
                SPEC_BUILDER,
                "--paper-title",
                "Broken Example",
                "--paper-url",
                "https://example.org/paper",
                "--github-url",
                "https://github.com/example/broken",
                "--evidence-file",
                str(bad_path)
            )
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("selections.readme", completed.stderr)


if __name__ == "__main__":
    unittest.main()
