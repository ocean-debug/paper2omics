# Source Priority

Use this file when paper text, README text, examples, and code do not fully agree.

## Priority Rules

Choose the evidence source based on the claim you are making.

### Method Intent

Use this priority:

1. Running example, notebook, or demo script
2. Official docs, tutorial, or vignette
3. Main source code or public API
4. README and package description files
5. Paper Methods
6. Paper abstract or official article summary

### Runtime And Environment

Use this priority:

1. Lockfiles and dependency manifests such as `requirements.txt`, `pyproject.toml`, `DESCRIPTION`, `renv.lock`, `environment.yml`
2. Installation instructions in the README
3. Import statements in example or manuscript scripts

Keep languages, execution modes, and workflow engines separate:

- Languages: Python, R, MATLAB, JavaScript, shell, and other implementation languages.
- Execution modes: `python_api`, `r_api`, `cli`, `notebook`, or `wrapper_only`.
- Workflow engines: `snakemake`, `nextflow`, `cwl`, or other workflow runners.

Do not classify Snakemake, Nextflow, or CWL as programming languages.

### Reproduction Details

Use this priority:

1. Official manuscript scripts
2. Official example or tutorial scripts
3. README walkthroughs
4. Inference from the main code

## Conflict Handling

When sources disagree:

- State both claims if the conflict matters to execution.
- Prefer the higher-priority source for the final recommendation.
- Add an English uncertainty note:
  - `Not confirmed in paper or code`
  - `The paper and implementation differ`
  - `The README provides a simplified example`

## Evidence Map Style

For each important workflow step, record:

- what the step does
- where it is supported
- whether it belongs to the core method or a reproduction branch
- which DAG edge inference rule was used when the step depends on another step

Use labels like these:

- `paper`
- `article-page`
- `main-code`
- `manuscript`
- `example`
- `readme`
- `dependency-file`
- `notebook-script-execution-order`
- `variable-flow`
- `file-flow`
- `function-call-graph`
- `semantic-dependency`
- `manual-fallback-rule`

## Missing Information

If the paper or repository does not expose enough detail:

- Do not fill the gap with general domain knowledge unless the user explicitly asks for a best-effort inference.
- Say exactly which detail is missing.
- Suggest the next best official artifact to inspect, such as a manuscript script, vignette, or issue thread.

## Separation Rule

Keep these layers separate in the final summary and child skill:

- `core method`: the minimum pipeline implied by the paper plus main implementation
- `repo operationalization`: install and run instructions exposed by the repository
- `manuscript reproduction`: case-study-specific preprocessing, figure scripts, enrichment analyses, or benchmarks
