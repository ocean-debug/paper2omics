---
name: paper2omics
description: Generate English execution-contract omics skills from papers and official repositories. Use when Codex receives an omics paper title, local PDF, article URL, or GitHub repository and must produce an English workflow summary plus a routable, executable when supported, validated, reproducible, and report-producing child skill instead of a narrative method summary.
---

# paper2omics

Use this skill to turn one omics paper plus its official repository into two outputs:

1. An English workflow summary for the current conversation.
2. A paper-specific execution-contract child skill under `generated-paper-workflows/<domain>/<skill-name>`.

The generated child skill must be an execution contract, not a prose-only method guide.

## When To Use

Use this skill when all of the following are true:

- The user has a paper source such as `paper_title`, `article_url`, `article_file`, or `pdf_path`.
- The user has the official `github_url`, or wants the workflow grounded in the official repository.
- The user wants a reusable skill, structured contract, or repeatable workflow, not only a one-off paper summary.
- The task is to synthesize paper evidence and repository evidence into a child skill spec or child skill bundle.

## When Not To Use

Do not use this skill when:

- The user only wants a quick paper summary, critique, or literature explanation.
- The user already has a generated child skill and only wants to run it, validate results, or interpret outputs.
- The task is only execution or environment setup with no need to generate or revise a paper-specific skill.
- There is no credible paper source and no official repository to anchor the contract.

## Classification And Mining Rules

- Represent perturbation workflows with four facets:
  - `target_type`
  - `action`
  - `modeling_mechanism`
  - `output_interpretation`
- Keep implementation language, execution mode, and workflow engine separate.
  - Languages are implementation languages such as Python, R, MATLAB, JavaScript, or shell.
  - Execution modes include `python_api`, `r_api`, `cli`, `notebook`, and `wrapper_only`.
  - Workflow engines include Snakemake, Nextflow, and CWL.
- Mine workflow evidence in this order:
  1. running example, notebook, or demo script
  2. official docs/tutorial
  3. source code/API
  4. README
  5. paper Methods
  6. paper abstract
- Infer DAG edges with explicit evidence when possible:
  - notebook/script execution order
  - variable flow
  - file flow
  - function call graph
  - semantic dependency
  - manual fallback rule
- Extract parameters primarily from running examples and function signatures; paper parameters are supporting evidence.
- Every classification, parameter, workflow step, and DAG edge must carry an `evidence_id` and source trace in `evidence_report.md`.

## Builder Decision Order

1. Resolve whether this is a new child skill or an update to an existing generated child skill.
2. Prefer `scripts/paper2omics-skill.js build` for new child skills when all required inputs are available.
3. Collect repository evidence with `scripts/collect-repo-evidence.js`.
4. Collect paper evidence with `scripts/collect-paper-evidence.js`.
5. Separate evidence into paper method, repository operationalization, and reproduction branches.
6. Build the contract spec with `scripts/build-contract-spec.js`.
7. Scaffold or refresh the child skill with `scripts/scaffold-paper-skill.js`.
8. Validate with `scripts/paper2omics-skill.js validate`, bundled generator tests, and generated child skill tests.

## Common Commands

```powershell
node scripts/paper2omics-skill.js build `
  --paper-title "<paper title>" `
  --github-url <official-github-url> `
  --out-root generated-paper-workflows

node scripts/paper2omics-skill.js validate `
  --skill-dir generated-paper-workflows/<domain>/<skill-name>

node scripts/paper2omics-skill.js diff `
  --old-contract generated-paper-workflows/<domain>/<skill-name>/contract.json `
  --new-contract <updated-contract.json>
```

## Summary Output

Always produce an English summary that covers:

- paper and repository sources used
- inferred modality and task
- perturbation facets when applicable
- languages, execution modes, and workflow engines
- example-first workflow evidence
- user-required parameters and source-derived defaults
- DAG edge evidence and fallback edges
- whether native execution is supported or blocked
- generated files and validation status

## Generated Child Skill Requirements

The generated child skill must include `SKILL.md`, `algorithm_classification.yaml`,
`skill.yaml`, `workflow.yaml`, `config_schema.yaml`, `configs/default.yaml`,
`configs/demo.yaml`, `evidence_report.md`, step scripts, an orchestrator,
tests, references, report templates, examples, guardrails, troubleshooting, and
`agents/openai.yaml`.

The dry-run result bundle must include parameter, QC, workflow, reproducibility,
and log artifacts. Missing or unsupported claims must be marked as
`Not confirmed in paper or code`.

## Guardrails

- Do not invent missing biological state.
- Do not silently switch methods, runtime, species, or modality.
- Do not treat manuscript reproduction examples as core workflow requirements unless the user explicitly selects reproduction mode.
- Do not mark a result as biologically reliable from dry-run evidence alone.
- Do not generate a child skill without traceable sources for the major contract claims.
