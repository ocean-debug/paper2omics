import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import importlib.util
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None


ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "scripts" / "scaffold-paper-skill.js"
CLI = ROOT / "scripts" / "paper2omics-skill.js"
SPEC = ROOT / "examples" / "sc-tenifold-knk.contract.json"
REPO_EVIDENCE = ROOT / "tests" / "fixtures" / "celloracle.evidence.json"


def default_quick_validate():
    if importlib.util.find_spec("yaml") is None:
        raise unittest.SkipTest(
            "quick_validate.py requires PyYAML. Install with: pip install pyyaml"
        )

    env_value = os.environ.get("SKILL_CREATOR_QUICK_VALIDATE")
    if env_value:
        return Path(env_value)

    candidates = [
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
                "schemas/parameter_schema.yaml",
                "evidence_report.md",
                "config_schema.yaml",
                "config/default.yaml",
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

            if yaml is None:
                self.skipTest("PyYAML is required to parse generated parameter schema.")

            parameter_schema = yaml.safe_load((target / "schemas" / "parameter_schema.yaml").read_text(encoding="utf-8"))
            self.assertEqual(parameter_schema["schema_version"], "0.2.0")
            self.assertEqual(parameter_schema["skill"]["name"], "sc-tenifold-knk")
            self.assertEqual(
                parameter_schema["parameter_resolution"]["priority"],
                ["user_cli", "user_config", "method_defaults", "global_defaults", "auto_detect", "error"]
            )
            self.assertEqual(parameter_schema["export"]["effective_parameters_file"], "effective_parameters.json")
            self.assertIn("virtual-knockout", parameter_schema["methods"])

            parameter_sections = [
                "global_params",
                "execution_params",
                "output_params",
                "qc_params",
                "workflow_params"
            ]
            for section in parameter_sections:
                for name, spec in (parameter_schema.get(section) or {}).items():
                    for required_key in ["type", "required", "default", "description"]:
                        self.assertIn(required_key, spec, f"{section}.{name}.{required_key}")

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

    def test_generated_child_uses_parameter_schema_for_cli_and_effective_parameters(self):
        if yaml is None:
            self.skipTest("PyYAML is required to parse generated YAML files.")

        with tempfile.TemporaryDirectory() as tmp_dir:
            completed = self.run_node("--spec-file", str(SPEC), "--out-root", tmp_dir)
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            target = Path(completed.stdout.strip())
            wrapper = target / "sc_tenifold_knk.py"
            demo_input = target / "examples" / "demo_input" / "input_manifest.json"

            with tempfile.TemporaryDirectory() as out_dir:
                cli_plan = subprocess.run(
                    [
                        sys.executable,
                        str(wrapper),
                        "plan",
                        "--input",
                        str(demo_input),
                        "--out",
                        out_dir,
                        "--knockout-gene",
                        "TP53"
                    ],
                    cwd=target,
                    capture_output=True,
                    text=True
                )
                self.assertEqual(cli_plan.returncode, 0, msg=cli_plan.stderr)
                payload = json.loads(cli_plan.stdout)
                effective = payload["effective_parameters"]
                self.assertEqual(effective["effective_parameters"]["knockout_gene"], "TP53")
                self.assertEqual(effective["parameter_sources"]["knockout_gene"], "user_cli")
                self.assertTrue((Path(out_dir) / "effective_parameters.json").exists())
                self.assertTrue((Path(out_dir) / "parameters" / "effective_parameters.json").exists())

            with tempfile.TemporaryDirectory() as out_dir:
                config_path = Path(out_dir) / "override.json"
                config_path.write_text(
                    json.dumps({"analysis": {"knockout_gene": "MYC"}}),
                    encoding="utf-8"
                )
                config_plan = subprocess.run(
                    [
                        sys.executable,
                        str(wrapper),
                        "plan",
                        "--input",
                        str(demo_input),
                        "--out",
                        out_dir,
                        "--config",
                        str(config_path)
                    ],
                    cwd=target,
                    capture_output=True,
                    text=True
                )
                self.assertEqual(config_plan.returncode, 0, msg=config_plan.stderr)
                payload = json.loads(config_plan.stdout)
                effective = payload["effective_parameters"]
                self.assertEqual(effective["effective_parameters"]["knockout_gene"], "MYC")
                self.assertEqual(effective["parameter_sources"]["knockout_gene"], "user_config")

            with tempfile.TemporaryDirectory() as out_dir:
                bad_plan = subprocess.run(
                    [
                        sys.executable,
                        str(wrapper),
                        "plan",
                        "--input",
                        str(demo_input),
                        "--out",
                        out_dir,
                        "--analysis-mode",
                        "invalid_mode"
                    ],
                    cwd=target,
                    capture_output=True,
                    text=True
                )
                self.assertNotEqual(bad_plan.returncode, 0)
                self.assertIn("analysis_mode", bad_plan.stderr)
                self.assertIn("Invalid parameter", bad_plan.stderr)

            with tempfile.TemporaryDirectory() as out_dir:
                config_path = Path(out_dir) / "dry-run.json"
                config_path.write_text(
                    json.dumps({"runtime": {"dry_run": True}}),
                    encoding="utf-8"
                )
                dry_run = subprocess.run(
                    [
                        sys.executable,
                        str(wrapper),
                        "run",
                        "--input",
                        str(demo_input),
                        "--out",
                        out_dir,
                        "--config",
                        str(config_path)
                    ],
                    cwd=target,
                    capture_output=True,
                    text=True
                )
                self.assertEqual(dry_run.returncode, 0, msg=dry_run.stderr)
                payload = json.loads(dry_run.stdout)
                self.assertEqual(payload["status"], "dry_run_ready")
                self.assertTrue(payload["effective_parameters"]["effective_parameters"]["dry_run"])
                self.assertEqual(payload["effective_parameters"]["parameter_sources"]["dry_run"], "user_config")

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
