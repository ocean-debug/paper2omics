import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COLLECTOR = ROOT / "scripts" / "collect-repo-evidence.js"


class RepoEvidenceCollectorTests(unittest.TestCase):
    maxDiff = None

    def run_node(self, *args):
        return subprocess.run(
            ["node", str(COLLECTOR), *args],
            capture_output=True,
            text=True
        )

    def test_collects_local_repo_metadata_without_github_api(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            (root / "README.md").write_text(
                "\n".join(
                    [
                        "# DemoOmics",
                        "Install with `pip install demo-omics`.",
                        "Usage: python scripts/run_demo.py --help",
                        "This tutorial uses scRNA-seq notebooks."
                    ]
                ),
                encoding="utf-8"
            )
            (root / "pyproject.toml").write_text(
                "[project]\nname = \"demo-omics\"\n",
                encoding="utf-8"
            )
            (root / "src").mkdir()
            (root / "src" / "workflow.py").write_text(
                "\n".join(
                    [
                        "import scanpy as sc",
                        "def run_workflow(input_path, out_path='results.csv'):",
                        "    adata = sc.read(input_path)",
                        "    adata.write_h5ad('prepared.h5ad')",
                        "    return out_path"
                    ]
                ),
                encoding="utf-8"
            )
            (root / "docs").mkdir()
            (root / "docs" / "tutorial.ipynb").write_text(
                json.dumps(
                    {
                        "cells": [
                            {"cell_type": "markdown", "source": ["# Tutorial"]},
                            {"cell_type": "code", "source": ["import demo_omics\nadata = demo_omics.load('input.h5ad')\nadata.write_h5ad('output.h5ad')"]}
                        ],
                        "metadata": {},
                        "nbformat": 4,
                        "nbformat_minor": 5
                    }
                ),
                encoding="utf-8"
            )

            completed = self.run_node(
                "--github-url",
                "https://github.com/example/DemoOmics",
                "--local-path",
                str(root),
                "--max-files",
                "20"
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            payload = json.loads(completed.stdout)
            self.assertEqual(payload["repo"]["repo"], "DemoOmics")
            self.assertEqual(payload["repo"]["localPath"], str(root.resolve()))
            self.assertEqual(payload["packageInfo"]["packageType"], "python_package")
            self.assertTrue(payload["packageInfo"]["hasDocs"])
            self.assertTrue(payload["packageInfo"]["hasNotebooks"])
            self.assertIn("python", payload["languages"])
            self.assertIn("docs/tutorial.ipynb", payload["pathIndex"]["notebookFiles"])
            self.assertTrue(any("pip install demo-omics" in item for item in payload["installHints"]))
            self.assertTrue(any("--help" in item for item in payload["cliHints"]))
            self.assertIn("miningMetadata", payload)
            self.assertTrue(payload["miningMetadata"]["notebooks"])
            self.assertTrue(payload["miningMetadata"]["scripts"])
            self.assertTrue(payload["miningMetadata"]["execution_order"])
            self.assertTrue(payload["miningMetadata"]["variable_flow"])
            self.assertTrue(payload["miningMetadata"]["file_flow"])
            self.assertTrue(payload["miningMetadata"]["function_call_graph"])


if __name__ == "__main__":
    unittest.main()
