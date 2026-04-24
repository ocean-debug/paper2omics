# Execution Contract Schema

Use this file before generating any child skill.

## Goal

The child skill is an execution contract, not a method summary.

It must be:

- routable
- executable through a real wrapper
- validated with built-in QC
- reproducible with recorded environment and commands
- report-producing with a fixed result bundle

## Required Top-Level Spec Blocks

Every child-skill spec must include:

- `skillName`
- `displayName`
- `paperTitle`
- `paperUrl`
- `githubUrl`
- `metadata`
- `routing`
- `inputContract`
- `parameterPolicy`
- `executionContract`
- `qcContract`
- `outputBundle`
- `reproducibilityContract`
- `testContract`
- `references`
- `failureModes`
- `citations`

## Metadata Contract

Top-level `SKILL.md` frontmatter remains validator-compatible:

```yaml
---
name: example-skill
description: "One-line skill description."
metadata:
  version: "0.1.0"
  author: "Your name"
  domain: "single-cell"
  analysis_type: "virtual-knockout"
  primary_tool: "scTenifoldKnk"
  tool_runtime: "r"
  dependencies:
    - "R"
    - "scTenifoldKnk"
  trigger_keywords:
    - "single-cell knockout"
  allowed_extra_flags:
    - "--input"
  legacy_aliases: []
  param_hints:
    knockout_gene:
      required: true
      tip: "Gene symbol present after filtering"
---
```

Do not place custom metadata fields at the top level outside `metadata`.

## Routing Contract

The child skill must define:

- `why_this_exists`
- `when_to_use`
- `when_not_to_use`
- `route_elsewhere`

Write routing before method details.

## Input Contract

The child skill must describe both file format and object state.

Required sub-blocks:

- `formats`
- `required_manifest_fields`
- `file_fields`
- `state_requirements`

Examples of valid state requirements:

- `adata.X must be normalized`
- `layers["counts"] must exist`
- `obsm["spatial"] must exist`
- `reference genome must be hg38`
- `bulk matrix must contain raw counts, not TPM`

## Parameter Policy Contract

Parameters must be split into:

- `required_user_decisions`
- `user_required`
- `auto_detected`
- `literature_defaults`
- `wrapper_defaults`
- `decision_rules`

Each default must carry rationale.

## Execution Contract

The generated wrapper must expose:

- `plan`
- `run`
- `validate-output`
- `report`

Execution contract must include:

- `runtime_targets`
- `workflow_steps`
- `command_templates`
- `required_outputs`
- `supports_native_run`

## QC Contract

QC must encode explicit status rules, not only plots.

Required sub-blocks:

- `rules`
- `validation_scenarios`
- `interpretation_boundary`

Every rule should define what is:

- `pass`
- `warn`
- `fail`

## Output Bundle Contract

Every run must create:

- `README.md`
- `report.md`
- `result.json`
- `tables/`
- `figures/`
- `figure_data/`
- `reproducibility/`
- `logs/`

`result.json` must include at least:

- `status`
- `skill_name`
- `paper_title`
- `runtime_probe`
- `input_validation`
- `parameter_resolution`
- `qc_summary`
- `artifacts`
- `caveats`
- `citations_used`

## Reproducibility Contract

The child skill must record:

- input manifest summary
- resolved parameters
- runtime probe results
- executed or planned commands
- package installation history
- timestamps

## Test Contract

Every generated child skill must include tests for:

- input validation
- parameter resolution
- result-bundle creation
- missing-runtime blocked status
- report regeneration

## Generated Directory Layout

The scaffolded child skill must contain:

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
