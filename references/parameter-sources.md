# Parameter Sources

Use this file when encoding parameter decisions.

## Required Categories

Every parameter must belong to one of these categories:

- `user_required`
- `auto_detected`
- `literature_defaults`
- `wrapper_defaults`

## User Required

Use for decisions that must come from the user or from an explicit input manifest.

Examples:

- experimental contrast
- target knockout gene
- species when not inferable from the repository or input
- design formula when multiple valid choices exist

## Auto Detected

Use for values that can be derived from:

- input manifest fields
- runtime probe results
- repository structure
- file presence

Do not mark a value as auto-detected if the wrapper is only guessing.

## Literature Defaults

Use for defaults directly supported by:

- the paper
- official documentation
- main implementation source

Each value must include a rationale.

## Wrapper Defaults

Use for engineering defaults introduced by the generated wrapper.

Examples:

- default report path
- result bundle version
- dry-run behavior
- reproducibility log location

These defaults must be clearly separated from method defaults.

## Decision Rules

When a parameter depends on context, encode the decision explicitly.

Examples:

- if WT-only input is provided, run the core virtual knockout path
- if real WT and KO matrices are provided, enable reproduction-only validation branches
- if R is absent, block native execution and emit a structured runtime-missing result
