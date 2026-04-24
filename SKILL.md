---
name: paper2omics
description: Generate execution-contract omics skills from papers and official repositories. Use when Codex receives an omics paper title, local PDF, article URL, or GitHub repository and must produce a bilingual workflow summary plus a routable, executable, validated, reproducible, and report-producing child skill instead of a narrative method summary.
---

# paper2omics

Use this skill to turn one omics paper plus its official repository into two outputs:

1. A bilingual workflow summary for the current conversation.
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

## Route Elsewhere

- If the user already has the paper-specific child skill and wants to execute or troubleshoot it, route to that child skill rather than regenerating the builder output.
- If the task is only runtime execution or environment setup, use the generated child skill or the user's chosen execution workflow.
- If the user only wants paper understanding, answer directly instead of invoking this builder.

## Inputs

### User-Level Input Contract

Provide:

- One paper source:
  - `paper_title`
  - `article_url`
  - `article_file`
  - `pdf_path`
  - or a precomputed `paper_evidence_file`
- One repository source:
  - `github_url`
  - or a precomputed `repo_evidence_file`
- Optional:
  - `focus`: such as `preprocessing`, `benchmarking`, `reproduction`, or `reporting`
  - `goal`: such as `method-understanding`, `first-run`, `paper-reproduction`, or `skill-generation`

Prefer local PDF or article text over title-only mode when available.

### Script Flag Mapping

When calling bundled scripts, map the user-level fields to CLI flags explicitly:

- `paper_title` -> `--paper-title`
- `article_url` -> `--article-url`
- `article_file` -> `--article-file`
- `pdf_path` -> `--pdf-path`
- `paper_evidence_file` -> `--paper-evidence-file`
- `github_url` -> `--github-url`
- `repo_evidence_file` -> `--evidence-file`

Do not silently mix snake_case field names and CLI flag names.

## Minimal Question Set

If required inputs are missing, ask only for the smallest missing piece.

- Missing paper source:
  ask for one of `paper_title`, `article_url`, `article_file`, or `pdf_path`
- Missing repository source:
  ask for the official `github_url`
- Missing execution intent:
  ask whether the user wants `summary_only`, `generate_child_skill`, or `update_existing_child_skill`

Do not ask broad planning questions when the only blocker is a missing URL or file path.

## Stop Conditions

Stop and report the blocker instead of generating a weak contract when:

- no credible paper source can be obtained
- no official repository can be identified
- paper evidence is too thin to support method claims and the user has not accepted a repo-biased draft
- the user actually wants execution or interpretation of an existing child skill rather than regeneration

## Builder Decision Order

1. Resolve whether this is a new child skill or an update to an existing generated child skill.
2. Collect repository evidence.
   - Prefer `scripts/collect-repo-evidence.js` for README, dependencies, entrypoints, and examples.
3. Collect paper evidence.
   - Prefer `scripts/collect-paper-evidence.js` for article pages, local HTML, or local PDFs.
4. Separate the evidence into three layers:
   - `paper method`
   - `repository operationalization`
   - `manuscript or reproduction branches`
5. Build the contract spec with `scripts/build-contract-spec.js`.
6. Scaffold or refresh the child skill with `scripts/scaffold-paper-skill.js`.
7. Validate locally with the bundled generator tests and generated child skill tests.

## Common Command Patterns

Use explicit command patterns instead of narrating the workflow abstractly.

### New Child Skill From Article File Plus Repo Evidence

```powershell
node scripts/build-contract-spec.js `
  --article-file <paper.html> `
  --paper-url <doi-or-article-url> `
  --github-url <repo-url> `
  --evidence-file <repo-evidence.json> `
  --out <contract.json>

node scripts/scaffold-paper-skill.js `
  --spec-file <contract.json> `
  --out-root generated-paper-workflows
```

### New Child Skill From Local PDF

```powershell
node scripts/build-contract-spec.js `
  --pdf-path <paper.pdf> `
  --paper-url <doi-or-article-url> `
  --github-url <repo-url> `
  --out <contract.json>
```

Use this path when no article HTML is available but the PDF or local text source is available.

### Targeted Update For An Existing Child Skill

```powershell
node scripts/build-contract-spec.js `
  --article-file <paper.html> `
  --paper-url <doi-or-article-url> `
  --github-url <repo-url> `
  --evidence-file <repo-evidence.json> `
  --out <updated-contract.json>

node scripts/scaffold-paper-skill.js `
  --spec-file <updated-contract.json> `
  --out-root generated-paper-workflows `
  --force
```

Use `--force` only after confirming that the existing child skill should be refreshed rather than merely inspected or executed.

Before `--force`, write the refreshed spec to a temporary path and compare it against the current child skill contract surface.

### Local Validation After Scaffolding

```powershell
python -m unittest discover -s tests -p "test_*.py" -v
python <path-to-quick_validate.py> <generated-child-skill-dir>
```

## New Versus Existing Child Skill

Before scaffolding, check whether the target child skill already exists under `generated-paper-workflows/<domain>/<skill-name>`.

- If it does not exist, scaffold a new child skill.
- If it exists, update only when the new paper or repository evidence materially changes routing, input contracts, QC rules, parameter rules, or output bundle requirements.
- Do not overwrite an existing child skill blindly when the user only wants to inspect or execute it.

### Refresh Checklist For Existing Child Skills

Treat an update as justified only when at least one of these contract surfaces changes materially:

- `routing`
- `inputContract`
- `parameterPolicy`
- `executionContract`
- `qcContract`
- `outputBundle`
- `references`

Use this order:

1. Build a refreshed spec to a temporary path such as `<updated-contract.json>`.
2. Compare the refreshed contract against the existing child skill's current contract surface.
3. Summarize what changed:
   - `new requirement`
   - `changed requirement`
   - `removed requirement`
   - `evidence-only refresh`
4. Only run `scaffold-paper-skill.js --force` when the changes affect how the child skill should route, validate, execute, or report.
5. If the differences are only descriptive and do not alter the execution contract, report the findings instead of overwriting the child skill.

## Output Contract

### Current Conversation Output

Always produce a bilingual summary that covers:

- `Paper / 论文`
- `Omics Modality / 组学类型`
- `Biological Question / 生物学问题`
- `Required Inputs / 所需输入`
- `Environment and Dependencies / 环境与依赖`
- `Step-by-step Workflow / 分步流程`
- `Key Parameters / 关键参数`
- `Outputs / 输出结果`
- `Validation and Case Study / 验证与案例`
- `Caveats / 注意事项`
- `Evidence Map / 证据映射`

### Generated Child Skill Output

The child skill must include at least:

- `SKILL.md`
- `<skill_name>.py`
- `tests/test_<skill_name>.py`
- `references/methods.md`
- `references/papers.md`
- `examples/demo_input/`
- `examples/expected_output/`
- `knowledge/guardrails.md`
- `knowledge/troubleshooting.md`
- `agents/openai.yaml`

## Non-Negotiable Rules

- Write routing boundaries before method details.
- Keep top-level frontmatter validator-compatible: only `name` and `description` belong at top level.
- Write data contracts at object-state level, not only file-extension level.
- Separate parameter sources into `user_required`, `auto_detected`, `literature_defaults`, and `wrapper_defaults`, each with rationale.
- Keep reasoning and execution separate. The generated child skill owns execution in a wrapper, not in prompt prose.
- Treat QC and validation as built-in workflow phases.
- Standardize result bundles and reproducibility outputs.
- Mark unsupported claims as `未在论文或代码中确认 / Not confirmed in paper or code`.
- Never promote manuscript-only validation branches into the minimum executable workflow unless the repository makes them mandatory.

## Validation Path

### Local Validation

Run local checks first:

- `build-contract-spec.js` against real or fixture evidence
- `scaffold-paper-skill.js` against a concrete contract spec
- `python -m unittest discover` for generator tests
- official `quick_validate.py` against generated `SKILL.md`

## Failure Recovery

- If paper evidence and repository evidence disagree, prefer the paper for scientific claims and the repository for runtime and entrypoint details.
- If a required paper source is missing, do not invent a method contract from the repository alone unless the user explicitly accepts a repo-biased draft.
- If a runtime is missing locally, do not downgrade validation quality silently; report the blocked runtime and the command that must be rerun in a suitable environment.
- If a generated child skill already exists and evidence changes are minor, prefer targeted updates over full regeneration.

## When To Read References

- Read `references/omics-taxonomy.md` when classifying modality or normalizing workflow vocabulary.
- Read `references/source-priority.md` when paper, README, and code diverge.
- Read `references/output-contract.md` before drafting or validating a child-skill spec.
- Read `references/parameter-sources.md` when mapping parameter origins and defaults.
- Read `references/qc-rubrics.md` when encoding pass, warn, and fail QC rules.
