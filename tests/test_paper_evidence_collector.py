import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COLLECTOR = ROOT / "scripts" / "collect-paper-evidence.js"
ARTICLE_FIXTURE = ROOT / "tests" / "fixtures" / "sc-tenifold-knk.paper.html"


class PaperEvidenceCollectorTests(unittest.TestCase):
    maxDiff = None

    def run_node(self, *args):
        return subprocess.run(
            ["node", str(COLLECTOR), *args],
            capture_output=True,
            text=True
        )

    def test_collects_article_file_and_infers_keywords(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            out_path = Path(tmp_dir) / "paper-evidence.json"
            completed = self.run_node(
                "--article-file",
                str(ARTICLE_FIXTURE),
                "--paper-url",
                "https://doi.org/10.1016/j.patter.2022.100434",
                "--out",
                str(out_path)
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)

            payload = json.loads(out_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["paper"]["sourceType"], "article_file")
            self.assertIn("scTenifoldKnk", payload["paper"]["resolvedTitle"])
            self.assertIn("single-cell RNA-seq", payload["paper"]["abstract"])
            self.assertIn("virtual knockout", payload["inferred"]["analysisHints"])
            self.assertIn("single-cell", payload["inferred"]["modalityHints"])

    def test_title_only_mode_emits_minimal_record(self):
        completed = self.run_node(
            "--paper-title",
            "Example execution-contract paper"
        )
        self.assertEqual(completed.returncode, 0, msg=completed.stderr)

        payload = json.loads(completed.stdout)
        self.assertEqual(payload["paper"]["sourceType"], "title_only")
        self.assertEqual(payload["paper"]["resolvedTitle"], "Example execution-contract paper")


if __name__ == "__main__":
    unittest.main()
