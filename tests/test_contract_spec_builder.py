import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None


ROOT = Path(__file__).resolve().parents[1]
SPEC_BUILDER = ROOT / "scripts" / "build-contract-spec.js"
SCAFFOLDER = ROOT / "scripts" / "scaffold-paper-skill.js"
EVIDENCE_FIXTURE = ROOT / "tests" / "fixtures" / "sc-tenifold-knk.evidence.json"
CELLORACLE_EVIDENCE_FIXTURE = ROOT / "tests" / "fixtures" / "celloracle.evidence.json"
ARTICLE_FIXTURE = ROOT / "tests" / "fixtures" / "sc-tenifold-knk.paper.html"


def default_quick_validate():
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
            self.assertEqual(spec["schema_version"], "paper2omics.contract.v1")
            self.assertIn("evidenceSchema", spec)
            self.assertEqual(spec["skillName"], "sc-tenifold-knk")
            self.assertEqual(spec["metadata"]["domain"], "single-cell")
            self.assertEqual(spec["metadata"]["analysis_type"], "virtual-knockout")
            self.assertEqual(spec["metadata"]["tool_runtime"], "r")
            self.assertEqual(
                spec["algorithmClassification"]["classification"]["primary_modality"],
                "single_cell_transcriptomics"
            )
            self.assertEqual(
                spec["algorithmClassification"]["classification"]["primary_task"],
                "perturbation_analysis"
            )
            self.assertEqual(
                spec["algorithmClassification"]["classification"]["perturbation"]["target_type"]["value"],
                "gene"
            )
            self.assertEqual(
                spec["algorithmClassification"]["classification"]["perturbation"]["action"]["value"],
                "virtual_knockout"
            )
            self.assertEqual(
                spec["algorithmClassification"]["implementation"]["preferred_language"],
                "python"
            )
            self.assertIn("r_api", spec["algorithmClassification"]["implementation"]["execution_modes"])
            self.assertIn("r", spec["algorithmClassification"]["implementation"]["languages"])
            self.assertIn("workflow_engines", spec["algorithmClassification"]["implementation"])
            self.assertIn("R", spec["metadata"]["dependencies"])
            self.assertIn("scTenifoldKnk", spec["metadata"]["trigger_keywords"])
            self.assertEqual(spec["testContract"]["demo_input_manifest"]["inputs"]["knockout_gene"], "AHR")
            self.assertIn("wt_counts.csv", spec["testContract"]["demo_files"])
            self.assertTrue(spec["references"]["methods"])
            self.assertTrue(spec["references"]["papers"])
            step_ids = [step["id"] for step in spec["executionContract"]["workflow_steps"]]
            self.assertIn("05_calculate_differential_regulation", step_ids)
            self.assertTrue(all("script" in step for step in spec["executionContract"]["workflow_steps"]))
            self.assertTrue(all("evidence_sources" in step for step in spec["executionContract"]["workflow_steps"]))
            self.assertTrue(all("evidence_id" in step for step in spec["executionContract"]["workflow_steps"]))
            self.assertTrue(all("evidence_priority_class" in step for step in spec["executionContract"]["workflow_steps"]))
            self.assertEqual(
                spec["executionContract"]["workflow_mining_priority"][0],
                "running_example_notebook_demo_script"
            )
            self.assertTrue(spec["executionContract"]["dag_edges"])
            self.assertIn("inference", spec["executionContract"]["dag_edges"][0])
            self.assertIn("evidence_sources", spec["executionContract"]["dag_edges"][0])
            self.assertIn("evidence_id", spec["executionContract"]["dag_edges"][0])
            self.assertIn("structured_signals", spec["executionContract"]["dag_edges"][0])
            self.assertEqual(
                spec["executionContract"]["dag_edges"][0]["evidence_priority_class"],
                spec["executionContract"]["dag_edges"][0]["inference"]
            )
            self.assertTrue(spec["executionContract"]["runtime_adapters"])
            self.assertEqual(
                spec["executionContract"]["native_run_status"]["status"],
                "blocked_until_adapter_is_implemented"
            )
            dag_inferences = [edge["inference"] for edge in spec["executionContract"]["dag_edges"]]
            self.assertIn("variable_flow", dag_inferences)
            self.assertIn("file_flow", dag_inferences)
            self.assertEqual(
                spec["parameterPolicy"]["evidence_priority"][0],
                "running_example_notebook_demo_script"
            )
            knockout_gene = next(
                item for item in spec["parameterPolicy"]["user_required"]
                if item["name"] == "knockout_gene"
            )
            self.assertEqual(knockout_gene["evidence_priority_class"], "function_signature")
            self.assertIn("evidence_id", knockout_gene)
            self.assertTrue(knockout_gene["evidence_sources"])

    def test_build_contract_spec_for_celloracle_case(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            spec_path = Path(tmp_dir) / "celloracle-contract.json"
            completed = self.run_node(
                SPEC_BUILDER,
                "--paper-title",
                "Dissecting cell identity via network inference and in silico gene perturbation",
                "--paper-url",
                "https://www.nature.com/articles/s41586-022-05688-9",
                "--github-url",
                "https://github.com/morris-lab/CellOracle",
                "--evidence-file",
                str(CELLORACLE_EVIDENCE_FIXTURE),
                "--out",
                str(spec_path)
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            spec = json.loads(spec_path.read_text(encoding="utf-8"))
            self.assertEqual(spec["skillName"], "cell-oracle")
            self.assertEqual(spec["metadata"]["analysis_type"], "tf-perturbation")
            self.assertEqual(spec["metadata"]["tool_runtime"], "python")
            self.assertEqual(
                spec["algorithmClassification"]["classification"]["primary_modality"],
                "single_cell_transcriptomics"
            )
            self.assertIn(
                "single_cell_epigenomics",
                spec["algorithmClassification"]["classification"]["secondary_modalities"]
            )
            self.assertEqual(
                spec["algorithmClassification"]["classification"]["primary_task"],
                "perturbation_analysis"
            )
            self.assertEqual(
                spec["algorithmClassification"]["classification"]["perturbation"]["target_type"]["value"],
                "transcription_factor"
            )
            self.assertEqual(
                spec["algorithmClassification"]["classification"]["perturbation"]["output_interpretation"]["value"],
                "cell_identity_transition"
            )
            self.assertEqual(
                spec["algorithmClassification"]["implementation"]["preferred_language"],
                "python"
            )
            self.assertIn("notebook", spec["algorithmClassification"]["implementation"]["execution_modes"])
            self.assertNotIn("notebook" + "_only", spec["algorithmClassification"]["implementation"]["execution_modes"])
            step_titles = [step["titleEn"] for step in spec["executionContract"]["workflow_steps"]]
            self.assertIn("run_TF_perturbation", step_titles)
            self.assertTrue(
                spec["executionContract"]["workflow_steps"][0]["evidence"][0].endswith(".ipynb")
            )
            self.assertEqual(
                spec["executionContract"]["workflow_steps"][0]["evidence_priority_class"],
                "running_example_notebook_demo_script"
            )
            self.assertIn(
                "variable_flow",
                [edge["inference"] for edge in spec["executionContract"]["dag_edges"]]
            )

    def test_build_then_scaffold_celloracle_mvp_layout(self):
        if yaml is None:
            self.skipTest("PyYAML is required to parse generated YAML files.")

        with tempfile.TemporaryDirectory() as tmp_dir:
            spec_path = Path(tmp_dir) / "celloracle-contract.json"
            completed = self.run_node(
                SPEC_BUILDER,
                "--paper-title",
                "Dissecting cell identity via network inference and in silico gene perturbation",
                "--paper-url",
                "https://www.nature.com/articles/s41586-022-05688-9",
                "--github-url",
                "https://github.com/morris-lab/CellOracle",
                "--evidence-file",
                str(CELLORACLE_EVIDENCE_FIXTURE),
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

            expected = [
                "algorithm_classification.yaml",
                "skill.yaml",
                "workflow.yaml",
                "evidence_report.md",
                "config_schema.yaml",
                "configs/default.yaml",
                "configs/demo.yaml",
                "scripts/04_run_perturbation.py",
                "reports/report_template.md"
            ]
            for relative in expected:
                self.assertTrue((target / relative).exists(), relative)

            classification = yaml.safe_load((target / "algorithm_classification.yaml").read_text(encoding="utf-8"))
            workflow = yaml.safe_load((target / "workflow.yaml").read_text(encoding="utf-8"))
            skill = yaml.safe_load((target / "skill.yaml").read_text(encoding="utf-8"))
            evidence_report = (target / "evidence_report.md").read_text(encoding="utf-8")
            self.assertEqual(classification["classification"]["primary_task"], "perturbation_analysis")
            self.assertEqual(classification["classification"]["perturbation"]["target_type"]["value"], "transcription_factor")
            self.assertIn("04_run_perturbation", [step["id"] for step in workflow["steps"]])
            self.assertEqual(workflow["steps"][0]["evidence_priority_class"], "running_example_notebook_demo_script")
            self.assertEqual(workflow["steps"][0]["evidence_sources"][0]["category"], "running_example_notebook_demo_script")
            self.assertTrue(workflow["edges"][0]["inference"])
            self.assertEqual(workflow["edges"][0]["evidence_priority_class"], workflow["edges"][0]["inference"])
            self.assertEqual(skill["implementation"]["preferred_language"], "python")
            self.assertIn("DAG Edge Evidence", evidence_report)
            self.assertIn("Evidence ID:", evidence_report)
            generated_skill = (target / "SKILL.md").read_text(encoding="utf-8")
            for forbidden in ["Paper /", "Status /", "Input /", "Output /", "bi" + "lingual", "notebook" + "_only"]:
                self.assertNotIn(forbidden, generated_skill)

    def test_workflow_engines_are_not_languages(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            evidence_path = Path(tmp_dir) / "workflow-engine-evidence.json"
            spec_path = Path(tmp_dir) / "workflow-engine-contract.json"
            evidence_path.write_text(
                json.dumps(
                    {
                        "repo": {
                            "repo": "WorkflowEngineTool",
                            "githubUrl": "https://github.com/example/WorkflowEngineTool"
                        },
                        "selections": {
                            "readme": [
                                {
                                    "path": "README.md",
                                    "preview": "Python API with optional Snakemake, Nextflow, and CWL workflow engines."
                                }
                            ],
                            "dependencies": [
                                {"path": "Snakefile", "preview": "rule all:"},
                                {"path": "nextflow.config", "preview": "process.executor = 'local'"},
                                {"path": "workflow.cwl", "preview": "cwlVersion: v1.2"}
                            ],
                            "entrypoints": [
                                {"path": "src/workflow_engine_tool.py", "preview": "import pandas as pd"}
                            ],
                            "examples": []
                        }
                    },
                    indent=2
                ),
                encoding="utf-8"
            )
            completed = self.run_node(
                SPEC_BUILDER,
                "--paper-title",
                "Workflow engine separation for omics workflow generation",
                "--paper-url",
                "https://example.org/workflow-engine-paper",
                "--github-url",
                "https://github.com/example/WorkflowEngineTool",
                "--evidence-file",
                str(evidence_path),
                "--out",
                str(spec_path)
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            spec = json.loads(spec_path.read_text(encoding="utf-8"))
            implementation = spec["algorithmClassification"]["implementation"]
            self.assertIn("python", implementation["languages"])
            self.assertNotIn("snakemake", implementation["languages"])
            self.assertNotIn("nextflow", implementation["languages"])
            self.assertNotIn("cwl", implementation["languages"])
            self.assertIn("snakemake", implementation["workflow_engines"])
            self.assertIn("nextflow", implementation["workflow_engines"])
            self.assertIn("cwl", implementation["workflow_engines"])

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
