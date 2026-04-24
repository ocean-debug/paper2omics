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
CLI = ROOT / "scripts" / "paper2omics-skill.js"
SPEC = ROOT / "examples" / "sc-tenifold-knk.contract.json"
REPO_EVIDENCE = ROOT / "tests" / "fixtures" / "celloracle.evidence.json"


def default_quick_validate():
    env_value = os.environ.get("SKILL_CREATOR_QUICK_VALIDATE")
    if env_value:
        return Path(env_value)

    candidates = [
        Path(r"C:\Users\wang\.codex\skills\.system\skill-creator\scripts\quick_validate.py"),
        Path.home() / ".codex" / "skills" / ".system" / "skill-creator" / "scripts" / "quick_validate.py",
        Path.home() / ".codex" / "skills" / "skill-creator" / "scripts" / "quick_validate.py"
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate

    raise unittest.SkipTest("Set SKILL_CREATOR_QUICK_VALIDATE to the quick_validate.py path.")


class ContractGeneratorTests(unittest.TestCase):
    maxDiff = None

    def run_node(self, *args):
        return subprocess.run(
            ["node", str(GENERATOR), *args],
            capture_output=True,
            text=True
        )

    def run_cli(self, *args):
        return subprocess.run(
            ["node", str(CLI), *args],
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
                "algorithm_classification.yaml",
                "skill.yaml",
                "workflow.yaml",
                "evidence_report.md",
                "config_schema.yaml",
                "configs/default.yaml",
                "configs/demo.yaml",
                "agents/openai.yaml",
                "sc_tenifold_knk.py",
                "scripts/00_validate_input.py",
                "scripts/05_calculate_differential_regulation.py",
                "reports/report_template.md",
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
                "workflow.yaml",
                "algorithm_classification.yaml",
                "evidence_report.md",
                "references/methods.md",
                "references/papers.md",
                "knowledge/guardrails.md"
            ]:
                (target / relative).read_text(encoding="utf-8")

            evidence_report = (target / "evidence_report.md").read_text(encoding="utf-8")
            for marker in [
                "Each item uses the same fields: Claim, Evidence ID, Value, Status, Priority, and Sources.",
                "- Claim: classification.primary_modality",
                "Evidence ID:",
                "- Claim: perturbation.target_type",
                "- Claim: parameter.knockout_gene",
                "- Claim: workflow_step.00_validate_input",
                "- Claim: dag_edge.00_validate_input->01_preprocess_expression_matrix",
                "  - Value:",
                "  - Status: confirmed",
                "  - Priority:",
                "  - Priority: function_signature",
                "  - Priority: variable_flow",
                "  - Sources:",
                "function_signature: R/scTenifoldKnk.R",
                "running_example_notebook_demo_script: inst/manuscript/AHR/Code/Preenterocytes_DataPreProcessing.R",
                "## Evidence Priority",
                "running_example_notebook_demo_script",
                "## Classification Evidence",
                "### Perturbation Facets",
                "target_type",
                "action",
                "modeling_mechanism",
                "output_interpretation",
                "## Parameter Evidence",
                "## Workflow Step Evidence",
                "## DAG Edge Evidence"
            ]:
                self.assertIn(marker, evidence_report)

            generated_skill = (target / "SKILL.md").read_text(encoding="utf-8")
            self.assertIn("Evidence ID:", generated_skill)
            for forbidden in ["bi" + "lingual", "notebook" + "_only", "Skill /", "Paper /", "Status /", "Result status /"]:
                self.assertNotIn(forbidden, generated_skill)

            for script in sorted((target / "scripts").glob("*.py")):
                help_run = subprocess.run(
                    [sys.executable, str(script), "--help"],
                    capture_output=True,
                    text=True
                )
                self.assertEqual(help_run.returncode, 0, msg=help_run.stderr)

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

    def test_cli_build_and_validate_generated_skill(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            completed = self.run_cli(
                "build",
                "--paper-title",
                "CellOracle: dissecting cell identity changes by network perturbation",
                "--github-url",
                "https://github.com/morris-lab/CellOracle",
                "--evidence-file",
                str(REPO_EVIDENCE),
                "--out-root",
                tmp_dir,
                "--force"
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            target = Path(completed.stdout.strip())
            self.assertTrue((target / "evidence_report.md").exists())

            validation = self.run_cli("validate", "--skill-dir", str(target))
            self.assertEqual(validation.returncode, 0, msg=validation.stderr)
            self.assertIn("validated", validation.stdout)

    def test_cli_schema_and_diff_commands(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            old_contract = Path(tmp_dir) / "old.json"
            new_contract = Path(tmp_dir) / "new.json"
            spec = json.loads(SPEC.read_text(encoding="utf-8"))
            old_contract.write_text(json.dumps(spec, indent=2), encoding="utf-8")
            spec["metadata"]["analysis_type"] = "gene-regulatory-network"
            new_contract.write_text(json.dumps(spec, indent=2), encoding="utf-8")

            schema = self.run_cli("schema", "--contract", str(old_contract))
            self.assertEqual(schema.returncode, 0, msg=schema.stderr)

            diff = self.run_cli("diff", "--old-contract", str(old_contract), "--new-contract", str(new_contract))
            self.assertEqual(diff.returncode, 0, msg=diff.stderr)
            self.assertIn("metadata.analysis_type", diff.stdout)


if __name__ == "__main__":
    unittest.main()
