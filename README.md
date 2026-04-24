# paper2omics

paper2omics is a Codex skill for converting an omics paper plus its official
code repository into a reusable execution-contract child skill.

paper2omics 是一个 Codex skill，用于把一篇组学论文和对应官方代码仓库转换成可复用的执行合同型子 skill。

It is designed for paper-grounded workflow extraction, not for generic paper
summarization. The generated child skill should be routable, executable,
validated, reproducible, and report-producing.

它的目标不是普通论文摘要，而是基于论文和源码证据抽取可执行工作流。生成的子 skill 应该具备可路由、可执行、可校验、可复现、可报告的执行合同。

## What It Produces

paper2omics produces two outputs:

- A bilingual workflow summary for the current conversation.
- A paper-specific child skill under `generated-paper-workflows/<domain>/<skill-name>`.

The child skill is generated as a contract bundle, not a prose-only method note.

子 skill 是执行合同包，而不是单纯的方法说明书。

## When To Use

Use this skill when you have:

- A paper source: `paper_title`, `article_url`, `article_file`, `pdf_path`, or `paper_evidence_file`.
- An official repository source: `github_url` or `repo_evidence_file`.
- A goal such as method understanding, first run, paper reproduction, or reusable skill generation.

Do not use it when the request is only a quick literature summary, a runtime-only execution task, or an analysis with no credible paper/repository evidence.

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
- Repository implementation: README, dependencies, entrypoints, core source files, and examples.
- Reproduction branches: manuscript, examples, tutorials, benchmark scripts, and validation notebooks.

Missing or unsupported claims must be marked explicitly as:

```text
未在论文或代码中确认 / Not confirmed in paper or code
```

## Child Skill Contract

Generated child skills use a fixed execution-contract shape:

- `SKILL.md`: agent-facing routing and execution contract.
- `<skill_name>.py`: Python orchestrator with `plan`, `run`, `validate-output`, and `report` commands.
- `tests/test_<skill_name>.py`: smoke and contract tests.
- `references/methods.md`: method and implementation notes.
- `references/papers.md`: paper citations and evidence notes.
- `examples/demo_input/`: lightweight demo inputs or placeholders.
- `examples/expected_output/`: expected output shape.
- `knowledge/guardrails.md`: safety and interpretation boundaries.
- `knowledge/troubleshooting.md`: failure modes and recovery.
- `agents/openai.yaml`: Codex skill metadata for routing.

Every run should produce a result directory containing:

- `README.md`
- `report.md`
- `result.json`
- `tables/`
- `figures/`
- `figure_data/`
- `reproducibility/`
- `logs/`

## Local Commands

Collect repository evidence:

```powershell
node scripts/collect-repo-evidence.js `
  --github-url <official-github-url> `
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
  --spec contract.json `
  --out-dir generated-paper-workflows
```

## Validation

Run the bundled generator tests:

```powershell
python -m unittest discover -s tests
```

Check JavaScript syntax:

```powershell
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
├── SKILL.md
├── agents/
├── examples/
├── references/
├── scripts/
└── tests/
```

## License

No license file is currently included. Add one before redistributing or packaging this repository for public reuse.
