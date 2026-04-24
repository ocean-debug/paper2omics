# paper2omics

paper2omics is a Codex skill for converting an omics paper plus its official
code repository into a reusable execution-contract child skill.

It is designed for paper-grounded workflow extraction, not generic paper
summarization. The generated child skill should be routable, executable when
the source evidence supports execution, validated, reproducible, and
report-producing.

## What It Produces

paper2omics produces two English-only outputs:

- An English workflow summary for the current conversation.
- A paper-specific child skill under `generated-paper-workflows/<domain>/<skill-name>`.

The child skill is generated as a contract bundle, not a prose-only method note.

## Current Classification Model

Perturbation workflows are represented with structured facets:

- `target_type`
- `action`
- `modeling_mechanism`
- `output_interpretation`

Implementation metadata separates language, execution mode, and workflow engine.
Snakemake, Nextflow, and CWL are workflow engines, not languages. Notebook-based
workflows are execution modes, not languages.

Workflow mining is example-first:

1. running examples, notebooks, and demo scripts
2. official docs and tutorials
3. source code and API signatures
4. README
5. paper Methods
6. paper abstract

Generated `evidence_report.md` records traceable evidence IDs for
classifications, parameters, workflow steps, and DAG edges.

## When To Use

Use this skill when you have:

- A paper source: `paper_title`, `article_url`, `article_file`, `pdf_path`, or `paper_evidence_file`.
- An official repository source: `github_url` or `repo_evidence_file`.
- A goal such as method understanding, first run, paper reproduction, or reusable skill generation.

Do not use it when the request is only a quick literature summary, a runtime-only
execution task, or an analysis with no credible paper/repository evidence.

## Inputs

Required:

- One paper source.
- One official repository source.

Optional:

- `focus`: for example `preprocessing`, `benchmarking`, `reproduction`, or `reporting`.
- `goal`: for example `method-understanding`, `first-run`, `paper-reproduction`, or `skill-generation`.

Prefer local PDFs or article files over title-only inputs when available.

## Evidence Priority

paper2omics aligns three evidence layers:

- Paper method: the biological question, omics modality, algorithm, validation, and reported outputs.
- Repository implementation: README, dependencies, entrypoints, core source files, signatures, and examples.
- Reproduction branches: manuscript files, examples, tutorials, benchmark scripts, and validation notebooks.

Missing or unsupported claims must be marked explicitly as:

```text
Not confirmed in paper or code
```

## Child Skill Contract

Generated child skills use a fixed execution-contract shape:

- `SKILL.md`: agent-facing routing and execution contract.
- `algorithm_classification.yaml`: normalized modality, task, perturbation, and implementation metadata.
- `skill.yaml`: compact generated skill metadata.
- `workflow.yaml`: ordered workflow steps with script, input, output, DAG edges, and evidence IDs.
- `evidence_report.md`: traceability report for classification, parameter, workflow step, and DAG edge evidence.
- `config_schema.yaml` and `configs/*.yaml`: generated input/config contracts.
- `scripts/*.py`: step-level scaffold scripts with `--help`.
- `<skill_name>.py`: Python orchestrator with `plan`, `run`, `validate-output`, and `report` commands.
- `tests/test_<skill_name>.py`: smoke and contract tests.
- `references/methods.md`: method and implementation notes.
- `references/papers.md`: paper citations and evidence notes.
- `reports/report_template.md`: editable report skeleton.
- `examples/demo_input/`: lightweight demo inputs or placeholders.
- `examples/expected_output/`: expected output shape.
- `knowledge/guardrails.md`: safety and interpretation boundaries.
- `knowledge/troubleshooting.md`: failure modes and recovery.
- `agents/openai.yaml`: Codex skill metadata for routing.

Every dry-run or run should produce a result directory containing:

- `README.md`
- `report.md`
- `result.json`
- `tables/`
- `figures/`
- `figure_data/`
- `parameters/`
- `qc/`
- `workflow/`
- `reproducibility/`
- `logs/`

## Local Commands

Run the end-to-end builder:

```powershell
node scripts/paper2omics-skill.js build `
  --paper-title "<paper title>" `
  --github-url <official-github-url> `
  --out-root generated-paper-workflows
```

Validate a generated child skill:

```powershell
node scripts/paper2omics-skill.js validate `
  --skill-dir generated-paper-workflows/<domain>/<skill-name>
```

Compare two contract specs before refreshing a child skill:

```powershell
node scripts/paper2omics-skill.js diff `
  --old-contract generated-paper-workflows/<domain>/<skill-name>/contract.json `
  --new-contract updated-contract.json
```

Collect repository evidence:

```powershell
node scripts/collect-repo-evidence.js `
  --github-url <official-github-url> `
  --out repo-evidence.json
```

Collect repository evidence from an already-cloned local repository:

```powershell
node scripts/collect-repo-evidence.js `
  --github-url <official-github-url> `
  --local-path <local-repo-path> `
  --out repo-evidence.json
```

Collect paper evidence:

```powershell
node scripts/collect-paper-evidence.js `
  --paper-title "<paper title>" `
  --out paper-evidence.json
```

Build a contract spec:

```powershell
node scripts/build-contract-spec.js `
  --paper-evidence-file paper-evidence.json `
  --evidence-file repo-evidence.json `
  --out contract.json
```

Scaffold a child skill:

```powershell
node scripts/scaffold-paper-skill.js `
  --spec-file contract.json `
  --out-root generated-paper-workflows
```

## Validation

Run the bundled generator tests:

```powershell
python -m unittest discover -s tests -p "test_*.py" -v
```

Check JavaScript syntax:

```powershell
node --check scripts/paper2omics-skill.js
node --check scripts/build-contract-spec.js
node --check scripts/collect-paper-evidence.js
node --check scripts/collect-repo-evidence.js
node --check scripts/scaffold-paper-skill.js
```

Validate the parent skill with the official skill validator when available:

```powershell
python C:\Users\wang\.codex\skills\.system\skill-creator\scripts\quick_validate.py .
```

## Included Example

The repository includes an example contract spec:

```text
examples/sc-tenifold-knk.contract.json
```

This example captures the scTenifoldKnk workflow as a contract-style child skill:
WT scRNA-seq input, scGRN construction, tensor decomposition, virtual knockout,
manifold alignment, differential regulation, and manuscript/example branch mapping.

## Safety Boundaries

- Do not infer missing biological state silently.
- Do not swap methods when the paper or repository does not support the replacement.
- Do not present manuscript-only validation branches as the core inference workflow.
- Do not treat plots or exploratory outputs as final biological conclusions without QC support.
- Keep parameter sources explicit: user-required, auto-detected, literature defaults, or wrapper defaults.

## Repository Layout

```text
paper2omics/
|-- SKILL.md
|-- agents/
|-- examples/
|-- references/
|-- scripts/
`-- tests/
```

## License

No license file is currently included. Add one before redistributing or packaging
this repository for public reuse.
