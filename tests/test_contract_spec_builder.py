import json
import os
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
SPEC_BUILDER = ROOT / "scripts" / "build-contract-spec.js"
SCAFFOLDER = ROOT / "scripts" / "scaffold-paper-skill.js"
EVIDENCE_FIXTURE = ROOT / "tests" / "fixtures" / "sc-tenifold-knk.evidence.json"
CELLORACLE_EVIDENCE_FIXTURE = ROOT / "tests" / "fixtures" / "celloracle.evidence.json"
ARTICLE_FIXTURE = ROOT / "tests" / "fixtures" / "sc-tenifold-knk.paper.html"


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
            open_category = spec["algorithmClassification"]["classification"]["open_categories"][0]
            self.assertEqual(open_category["label"], "virtual_gene_knockout")
            self.assertEqual(open_category["hierarchy"]["source"], "paper2omics_open_taxonomy")
            self.assertEqual(open_category["hierarchy"]["domain"], "singlecell")
            self.assertEqual(open_category["hierarchy"]["task"], "virtual_gene_knockout")
            external_taxonomy_marker = "".join(["omics", "claw"])
            self.assertNotIn(external_taxonomy_marker, json.dumps(spec).lower())
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
            dependency_preflight = spec["reproducibilityContract"]["dependency_preflight"]
            self.assertEqual(
                dependency_preflight["scope"],
                ["runtime_executables", "python_packages", "r_packages"]
            )
            self.assertEqual(dependency_preflight["install_requires_confirmation"], True)
            self.assertEqual(
                dependency_preflight["install_command_priority"][0],
                "official_docs_tutorial"
            )
            self.assertTrue(spec["reproducibilityContract"]["install_guidance_sources"])
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
                "schemas/parameter_schema.yaml",
                "evidence_report.md",
                "config_schema.yaml",
                "config/default.yaml",
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
            self.assertIn("classification.classification_basis", evidence_report)
            self.assertIn("## Open Classification Categories", evidence_report)
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
                        },
                        "structuredInstallHints": [
                            {
                                "source_path": "docs/tutorial.md",
                                "source_priority": "official_docs_tutorial",
                                "command_or_line": "pip install workflow-engine-tool[tutorial]"
                            },
                            {
                                "source_path": "requirements.txt",
                                "source_priority": "dependency_file",
                                "command_or_line": "pip install workflow-engine-tool"
                            }
                        ]
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
            sources = spec["reproducibilityContract"]["install_guidance_sources"]
            self.assertEqual(sources[0]["source_path"], "docs/tutorial.md")
            self.assertIn("[tutorial]", sources[0]["command_or_line"])

    def test_cli_install_guidance_does_not_fallback_to_pip(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            evidence_path = Path(tmp_dir) / "cli-evidence.json"
            spec_path = Path(tmp_dir) / "cli-contract.json"
            evidence_path.write_text(
                json.dumps(
                    {
                        "repo": {
                            "repo": "FastqcWrapper",
                            "githubUrl": "https://github.com/example/FastqcWrapper"
                        },
                        "selections": {
                            "readme": [
                                {
                                    "path": "README.md",
                                    "preview": "Run fastqc input.fastq.gz to generate quality reports."
                                }
                            ],
                            "entrypoints": [],
                            "examples": [],
                            "dependencies": []
                        }
                    },
                    indent=2
                ),
                encoding="utf-8"
            )
            completed = self.run_node(
                SPEC_BUILDER,
                "--paper-title",
                "FastqcWrapper",
                "--paper-url",
                "https://example.org/fastqc-wrapper",
                "--github-url",
                "https://github.com/example/FastqcWrapper",
                "--evidence-file",
                str(evidence_path),
                "--tool-runtime",
                "cli",
                "--primary-tool",
                "fastqc",
                "--out",
                str(spec_path)
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            spec = json.loads(spec_path.read_text(encoding="utf-8"))
            sources = spec["reproducibilityContract"]["install_guidance_sources"]
            self.assertTrue(sources)
            self.assertTrue(all("pip install" not in item["command_or_line"] for item in sources))
            self.assertEqual(sources[-1]["source_priority"], "executable_environment")
            self.assertIn("PATH", sources[-1]["command_or_line"])
            self.assertIn("conda", sources[-1]["command_or_line"])

    def test_python_prefixed_packages_remain_in_install_guidance_fallback(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            evidence_path = Path(tmp_dir) / "python-prefixed-evidence.json"
            spec_path = Path(tmp_dir) / "python-prefixed-contract.json"
            evidence_path.write_text(
                json.dumps(
                    {
                        "repo": {
                            "repo": "PythonIgraphWorkflow",
                            "githubUrl": "https://github.com/example/PythonIgraphWorkflow"
                        },
                        "selections": {
                            "readme": [
                                {
                                    "path": "README.md",
                                    "preview": "Run graph analysis with python-igraph."
                                }
                            ],
                            "entrypoints": [],
                            "examples": [],
                            "dependencies": []
                        }
                    },
                    indent=2
                ),
                encoding="utf-8"
            )
            completed = self.run_node(
                SPEC_BUILDER,
                "--paper-title",
                "PythonIgraphWorkflow",
                "--paper-url",
                "https://example.org/python-igraph-workflow",
                "--github-url",
                "https://github.com/example/PythonIgraphWorkflow",
                "--evidence-file",
                str(evidence_path),
                "--tool-runtime",
                "python",
                "--primary-tool",
                "python-igraph",
                "--out",
                str(spec_path)
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            spec = json.loads(spec_path.read_text(encoding="utf-8"))
            sources = spec["reproducibilityContract"]["install_guidance_sources"]
            fallback = next(item for item in sources if item["source_path"] == "metadata.dependencies")
            self.assertIn("python-igraph", fallback["command_or_line"])
            self.assertNotIn("python>=3.10", fallback["command_or_line"])

    def test_legacy_install_hints_rank_docs_before_dockerfile(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            evidence_path = Path(tmp_dir) / "legacy-install-hints-evidence.json"
            spec_path = Path(tmp_dir) / "legacy-install-hints-contract.json"
            evidence_path.write_text(
                json.dumps(
                    {
                        "repo": {
                            "repo": "LegacyHints",
                            "githubUrl": "https://github.com/example/LegacyHints"
                        },
                        "installHints": [
                            "Dockerfile: RUN pip install container-only-demo",
                            "docs/tutorial.md: conda install -c bioconda demo-omics"
                        ],
                        "selections": {
                            "readme": [],
                            "dependencies": [],
                            "entrypoints": [],
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
                "LegacyHints",
                "--paper-url",
                "https://example.org/legacy-hints",
                "--github-url",
                "https://github.com/example/LegacyHints",
                "--evidence-file",
                str(evidence_path),
                "--tool-runtime",
                "python",
                "--primary-tool",
                "demo-omics",
                "--out",
                str(spec_path)
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            spec = json.loads(spec_path.read_text(encoding="utf-8"))
            sources = spec["reproducibilityContract"]["install_guidance_sources"]
            self.assertEqual(sources[0]["source_path"], "docs/tutorial.md")
            self.assertEqual(sources[0]["source_priority"], "official_docs_tutorial")
            docker_hint = next(item for item in sources if item["source_path"] == "Dockerfile")
            self.assertEqual(docker_hint["source_priority"], "dependency_file")

    def test_classification_prefers_tutorial_application_over_abstract(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            evidence_path = Path(tmp_dir) / "trajectory-evidence.json"
            paper_path = Path(tmp_dir) / "trajectory-paper.json"
            spec_path = Path(tmp_dir) / "trajectory-contract.json"
            evidence_path.write_text(
                json.dumps(
                    {
                        "repo": {
                            "repo": "TrajectoryIntentTool",
                            "githubUrl": "https://github.com/example/TrajectoryIntentTool"
                        },
                        "selections": {
                            "docs": [
                                {
                                    "path": "docs/tutorial.md",
                                    "preview": "Tutorial: run trajectory transition analysis, infer fate transition maps, and visualize cell state transitions."
                                }
                            ],
                            "examples": [
                                {
                                    "path": "examples/trajectory_transition_demo.py",
                                    "preview": "run_trajectory_transition_analysis(adata); plot_fate_transition_map(adata)"
                                }
                            ],
                            "entrypoints": [
                                {
                                    "path": "trajectory_intent_tool/api.py",
                                    "preview": "def run_trajectory_transition_analysis(adata): return adata"
                                }
                            ],
                            "readme": [
                                {
                                    "path": "README.md",
                                    "preview": "A package for single-cell trajectory applications."
                                }
                            ],
                            "dependencies": [
                                {
                                    "path": "pyproject.toml",
                                    "preview": "[project]\nname='trajectory-intent-tool'"
                                }
                            ]
                        }
                    },
                    indent=2
                ),
                encoding="utf-8"
            )
            paper_path.write_text(
                json.dumps(
                    {
                        "paper": {
                            "requestedTitle": "TrajectoryIntentTool",
                            "resolvedTitle": "TrajectoryIntentTool",
                            "sourceType": "fixture",
                            "abstract": "We present a general integration benchmark algorithm for comparing latent spaces across datasets."
                        }
                    },
                    indent=2
                ),
                encoding="utf-8"
            )
            completed = self.run_node(
                SPEC_BUILDER,
                "--paper-title",
                "TrajectoryIntentTool",
                "--paper-evidence-file",
                str(paper_path),
                "--github-url",
                "https://github.com/example/TrajectoryIntentTool",
                "--evidence-file",
                str(evidence_path),
                "--out",
                str(spec_path)
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            spec = json.loads(spec_path.read_text(encoding="utf-8"))
            classification = spec["algorithmClassification"]["classification"]
            self.assertEqual(spec["metadata"]["analysis_type"], "trajectory_transition_analysis")
            self.assertEqual(classification["primary_task"], "trajectory_transition_analysis")
            self.assertEqual(classification["classification_basis"], "tutorial_application_first")
            self.assertIn("integration", classification["secondary_tasks"])
            self.assertTrue(any("abstract" in note for note in classification["classification_notes"]))
            for item in classification["open_categories"]:
                for required_key in ["axis", "label", "confidence", "source_priority", "evidence_id", "evidence_sources"]:
                    self.assertIn(required_key, item)
                self.assertTrue(item["evidence_sources"])
            primary = classification["open_categories"][0]
            self.assertEqual(primary["label"], "trajectory_transition_analysis")
            self.assertEqual(primary["source_priority"], "running_example_notebook_demo_script")

    def test_classification_allows_new_open_category_without_generic_fallback(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            evidence_path = Path(tmp_dir) / "pathway-score-evidence.json"
            spec_path = Path(tmp_dir) / "pathway-score-contract.json"
            evidence_path.write_text(
                json.dumps(
                    {
                        "repo": {
                            "repo": "MetaboPathScore",
                            "githubUrl": "https://github.com/example/MetaboPathScore"
                        },
                        "selections": {
                            "docs": [
                                {
                                    "path": "vignettes/pathway_activity_scoring.md",
                                    "preview": "Vignette: calculate pathway activity scoring from metabolite abundance tables and rank metabolic pathway activity."
                                }
                            ],
                            "entrypoints": [
                                {
                                    "path": "metabopathscore/core.py",
                                    "preview": "def score_pathway_activity(metabolite_table, pathway_sets): return scores"
                                }
                            ],
                            "examples": [],
                            "readme": [],
                            "dependencies": []
                        }
                    },
                    indent=2
                ),
                encoding="utf-8"
            )
            completed = self.run_node(
                SPEC_BUILDER,
                "--paper-title",
                "MetaboPathScore: pathway activity scoring for metabolomics",
                "--paper-url",
                "https://example.org/metabopathscore",
                "--github-url",
                "https://github.com/example/MetaboPathScore",
                "--evidence-file",
                str(evidence_path),
                "--out",
                str(spec_path)
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            spec = json.loads(spec_path.read_text(encoding="utf-8"))
            classification = spec["algorithmClassification"]["classification"]
            self.assertEqual(classification["primary_task"], "pathway_activity_scoring")
            self.assertNotEqual(classification["primary_task"], "omics_analysis")
            self.assertIn("pathway_activity_scoring", classification["task_family"])
            self.assertEqual(classification["open_categories"][0]["source_priority"], "official_docs_tutorial")

    def test_classification_source_priority_beats_lower_priority_keyword_density(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            evidence_path = Path(tmp_dir) / "priority-evidence.json"
            paper_path = Path(tmp_dir) / "priority-paper.json"
            spec_path = Path(tmp_dir) / "priority-contract.json"
            evidence_path.write_text(
                json.dumps(
                    {
                        "repo": {
                            "repo": "PriorityClassifier",
                            "githubUrl": "https://github.com/example/PriorityClassifier"
                        },
                        "selections": {
                            "docs": [
                                {
                                    "path": "docs/tutorial.md",
                                    "preview": "Tutorial: score pathway activity from a metabolomics matrix."
                                }
                            ],
                            "entrypoints": [
                                {
                                    "path": "priority_classifier/api.py",
                                    "preview": "def integrate_latent_spaces(adata): return adata"
                                }
                            ],
                            "readme": [
                                {
                                    "path": "README.md",
                                    "preview": "Integration, batch correction, Harmony, and latent space alignment."
                                }
                            ],
                            "examples": [],
                            "dependencies": []
                        }
                    },
                    indent=2
                ),
                encoding="utf-8"
            )
            paper_path.write_text(
                json.dumps(
                    {
                        "paper": {
                            "requestedTitle": "PriorityClassifier",
                            "resolvedTitle": "PriorityClassifier",
                            "sourceType": "fixture",
                            "abstract": "This paper studies integration, batch correction, Harmony, and latent space alignment."
                        }
                    },
                    indent=2
                ),
                encoding="utf-8"
            )
            completed = self.run_node(
                SPEC_BUILDER,
                "--paper-title",
                "PriorityClassifier",
                "--paper-evidence-file",
                str(paper_path),
                "--github-url",
                "https://github.com/example/PriorityClassifier",
                "--evidence-file",
                str(evidence_path),
                "--out",
                str(spec_path)
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            spec = json.loads(spec_path.read_text(encoding="utf-8"))
            classification = spec["algorithmClassification"]["classification"]
            self.assertEqual(spec["metadata"]["analysis_type"], "pathway_activity_scoring")
            self.assertEqual(classification["primary_task"], "pathway_activity_scoring")
            self.assertEqual(classification["open_categories"][0]["source_priority"], "official_docs_tutorial")
            self.assertIn("integration", classification["secondary_tasks"])

    def test_classification_extracts_open_label_beyond_known_rules(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            evidence_path = Path(tmp_dir) / "communication-evidence.json"
            paper_path = Path(tmp_dir) / "communication-paper.json"
            spec_path = Path(tmp_dir) / "communication-contract.json"
            evidence_path.write_text(
                json.dumps(
                    {
                        "repo": {
                            "repo": "CommTool",
                            "githubUrl": "https://github.com/example/CommTool"
                        },
                        "selections": {
                            "docs": [
                                {
                                    "path": "docs/tutorial.md",
                                    "preview": "Tutorial: run cell-cell communication analysis from a ligand receptor matrix."
                                }
                            ],
                            "examples": [
                                {
                                    "path": "examples/ligand_receptor_demo.py",
                                    "preview": "run_ligand_receptor_analysis(adata)"
                                }
                            ],
                            "entrypoints": [],
                            "readme": [],
                            "dependencies": []
                        }
                    },
                    indent=2
                ),
                encoding="utf-8"
            )
            paper_path.write_text(
                json.dumps(
                    {
                        "paper": {
                            "requestedTitle": "CommTool",
                            "resolvedTitle": "CommTool",
                            "sourceType": "fixture",
                            "abstract": "This method also includes integration and batch correction benchmarking."
                        }
                    },
                    indent=2
                ),
                encoding="utf-8"
            )
            completed = self.run_node(
                SPEC_BUILDER,
                "--paper-title",
                "CommTool",
                "--paper-evidence-file",
                str(paper_path),
                "--paper-url",
                "https://example.org/commtool",
                "--github-url",
                "https://github.com/example/CommTool",
                "--evidence-file",
                str(evidence_path),
                "--out",
                str(spec_path)
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            spec = json.loads(spec_path.read_text(encoding="utf-8"))
            classification = spec["algorithmClassification"]["classification"]
            self.assertEqual(spec["metadata"]["analysis_type"], "cell_communication")
            self.assertEqual(classification["primary_task"], "omics_analysis")
            self.assertEqual(classification["open_categories"][0]["label"], "cell_communication")
            self.assertEqual(classification["open_categories"][0]["source_priority"], "official_docs_tutorial")
            self.assertIn("integration", [item["label"] for item in classification["open_categories"]])
            self.assertTrue(classification["open_categories"][0]["evidence_sources"])

    def test_known_task_prefers_curated_rule_over_generic_open_phrase(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            evidence_path = Path(tmp_dir) / "knockout-evidence.json"
            paper_path = Path(tmp_dir) / "knockout-paper.json"
            spec_path = Path(tmp_dir) / "knockout-contract.json"
            evidence_path.write_text(
                json.dumps(
                    {
                        "repo": {
                            "repo": "KnockTool",
                            "githubUrl": "https://github.com/example/KnockTool"
                        },
                        "selections": {
                            "docs": [
                                {
                                    "path": "docs/tutorial.md",
                                    "preview": "Tutorial: run virtual knockout analysis on a wild-type single-cell matrix."
                                }
                            ],
                            "examples": [],
                            "entrypoints": [],
                            "readme": [],
                            "dependencies": []
                        }
                    },
                    indent=2
                ),
                encoding="utf-8"
            )
            paper_path.write_text(
                json.dumps(
                    {
                        "paper": {
                            "requestedTitle": "KnockTool",
                            "resolvedTitle": "KnockTool",
                            "sourceType": "fixture",
                            "abstract": "A single-cell method benchmark."
                        }
                    },
                    indent=2
                ),
                encoding="utf-8"
            )
            completed = self.run_node(
                SPEC_BUILDER,
                "--paper-title",
                "KnockTool",
                "--paper-evidence-file",
                str(paper_path),
                "--paper-url",
                "https://example.org/knocktool",
                "--github-url",
                "https://github.com/example/KnockTool",
                "--evidence-file",
                str(evidence_path),
                "--out",
                str(spec_path)
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            spec = json.loads(spec_path.read_text(encoding="utf-8"))
            classification = spec["algorithmClassification"]["classification"]
            self.assertEqual(spec["metadata"]["analysis_type"], "virtual-knockout")
            self.assertNotEqual(spec["metadata"]["analysis_type"], "run_virtual_knockout_analysis")
            self.assertEqual(classification["primary_task"], "perturbation_analysis")
            self.assertIn(
                "virtual_gene_knockout",
                [item["label"] for item in classification["open_categories"]]
            )

    def test_classification_extracts_specific_open_label_for_rna_velocity(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            evidence_path = Path(tmp_dir) / "velocity-evidence.json"
            spec_path = Path(tmp_dir) / "velocity-contract.json"
            evidence_path.write_text(
                json.dumps(
                    {
                        "repo": {
                            "repo": "VelocityTool",
                            "githubUrl": "https://github.com/example/VelocityTool"
                        },
                        "selections": {
                            "docs": [
                                {
                                    "path": "docs/tutorial.md",
                                    "preview": "Tutorial: estimate RNA velocity and visualize velocity streams."
                                }
                            ],
                            "examples": [],
                            "entrypoints": [],
                            "readme": [],
                            "dependencies": []
                        }
                    },
                    indent=2
                ),
                encoding="utf-8"
            )
            completed = self.run_node(
                SPEC_BUILDER,
                "--paper-title",
                "VelocityTool",
                "--paper-url",
                "https://example.org/velocitytool",
                "--github-url",
                "https://github.com/example/VelocityTool",
                "--evidence-file",
                str(evidence_path),
                "--out",
                str(spec_path)
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            spec = json.loads(spec_path.read_text(encoding="utf-8"))
            classification = spec["algorithmClassification"]["classification"]
            self.assertEqual(spec["metadata"]["analysis_type"], "rna_velocity")
            self.assertEqual(classification["open_categories"][0]["label"], "rna_velocity")

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
