#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function yamlQuote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function yamlScalar(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const text = String(value);
  if (/^[A-Za-z0-9_./:-]+$/.test(text)) {
    return text;
  }
  return yamlQuote(text);
}

function toYaml(value, indent = 0) {
  const space = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    return value.map((item) => {
      if (item && typeof item === "object") {
        return `${space}-\n${toYaml(item, indent + 2)}`;
      }
      return `${space}- ${yamlScalar(item)}`;
    }).join("\n");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    if (entries.length === 0) {
      return "{}";
    }
    return entries.map(([key, item]) => {
      if (Array.isArray(item) && item.length === 0) {
        return `${space}${key}: []`;
      }
      if (item && typeof item === "object" && !Array.isArray(item) && Object.keys(item).length === 0) {
        return `${space}${key}: {}`;
      }
      if (Array.isArray(item) || (item && typeof item === "object")) {
        return `${space}${key}:\n${toYaml(item, indent + 2)}`;
      }
      return `${space}${key}: ${yamlScalar(item)}`;
    }).join("\n");
  }
  return `${space}${yamlScalar(value)}`;
}

function metadataFlow(value) {
  return JSON.stringify(value);
}

function pythonModuleName(value) {
  return String(value)
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^(\d)/, "_$1");
}

function pythonStringLiteral(value) {
  return JSON.stringify(String(value));
}

function english(value) {
  if (value && typeof value === "object") {
    return value.en || value.titleEn || value.detailsEn || value.noteEn || value.conditionEn || value.recoveryEn || value.zh || "";
  }
  return value === undefined || value === null ? "" : String(value);
}

function renderTextPair(item) {
  return english(item);
}

function renderBulletList(items, mapper = renderTextPair) {
  return items.map((item) => `- ${mapper(item)}`).join("\n");
}

function renderNamedPairItems(items) {
  return items.map((item) => `- \`${item.name}\`: ${english(item)}`).join("\n");
}

function renderParameterSection(title, items, formatter) {
  if (!items || items.length === 0) {
    return `### ${title}\n\n- None`;
  }

  return `### ${title}\n\n${items.map((item) => formatter(item)).join("\n")}`;
}
function renderWorkflow(steps) {
  return steps.map((step, index) => {
    const evidence = (step.evidence || []).length > 0
      ? step.evidence.join("; ")
      : "Not confirmed in paper or code";
    const layer = step.layer ? `- Layer: ${step.layer}` : null;
    const evidenceId = step.evidence_id ? `- Evidence ID: \`${step.evidence_id}\`` : null;
    return [
      `### ${index + 1}. ${step.titleEn}`,
      "",
      `- ${step.detailsEn}`,
      layer,
      evidenceId,
      `- Evidence: ${evidence}`
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}
function renderQcRules(rules) {
  return rules.map((rule) => [
    `### ${rule.metric}`,
    "",
    `- ${rule.en}`,
    `- Pass: ${rule.passEn}`,
    `- Warn: ${rule.warnEn}`,
    `- Fail: ${rule.failEn}`
  ].join("\n")).join("\n\n");
}
function renderFailureModes(items) {
  return items.map((item) => [
    `### ${item.conditionEn}`,
    "",
    `- Recovery: ${item.recoveryEn}`
  ].join("\n")).join("\n\n");
}
function renderReferenceSections(sections) {
  return sections.map((section) => {
    const items = (section.items || []).map((item) => [
      `- [${item.label}](${item.url})`,
      `  ${item.noteEn}`
    ].join("\n")).join("\n");

    return `## ${section.title}\n\n${items}`;
  }).join("\n\n");
}

function renderCitations(citations) {
  return citations.map((citation) => {
    const note = citation.noteEn ? `: ${citation.noteEn}` : "";
    return `- [${citation.label}](${citation.url})${note}`;
  }).join("\n");
}
function renderGuardrails(spec) {
  const lines = [];

  for (const item of spec.routing.when_not_to_use) {
    lines.push(`- Do not use for: ${item.en}`);
  }

  lines.push("- Do not silently infer missing biological state.");
  lines.push("- Do not silently switch methods or runtimes.");
  lines.push("- Do not treat warning-level QC as clean success.");

  return `# Guardrails\n\n${lines.join("\n")}\n`;
}
function renderTroubleshooting(spec) {
  const lines = spec.failureModes.map((item) => [
    `## ${item.conditionEn}`,
    "",
    `- ${item.recoveryEn}`
  ].join("\n"));

  return `# Troubleshooting\n\n${lines.join("\n\n")}\n`;
}
function buildDescription(spec, skillName) {
  const firstUseCase = spec.routing.when_to_use[0];
  return [
    `Execution-contract child skill for ${spec.displayName}.`,
    `Use when Codex needs to route, validate, plan, run, and report this omics workflow through $${skillName}.`,
    firstUseCase ? `Primary route: ${firstUseCase.en}.` : ""
  ].filter(Boolean).join(" ");
}

function buildSkillMarkdown(spec, skillName) {
  const description = buildDescription(spec, skillName);
  const metadata = metadataFlow(spec.metadata);
  const dependencies = spec.metadata.dependencies.map((item) => '- ' + item).join("\n");
  const citations = renderCitations(spec.citations);
  const resultFields = spec.outputBundle.result_fields.map((field) => '- `' + field + '`').join("\n");
  const requiredPaths = spec.outputBundle.required_paths.map((item) => '- `' + item + '`').join("\n");
  const parameterSchema = buildParameterSchemaObject(spec);
  const schemaParametersByGroup = (group) => Object.entries(parameterSchema.workflow_params)
    .filter(([, item]) => item.resolution_group === group)
    .map(([name, item]) => ({ name, ...item }));
  const renderSchemaParameter = (item) => [
    '- `' + item.name + '`',
    'type: `' + item.type + '`',
    'required: `' + item.required + '`',
    'default: `' + (item.default === null ? 'null' : item.default) + '`',
    'Evidence ID: `' + item.evidence_id + '`'
  ].join('; ');
  const lines = [];

  lines.push('---');
  lines.push('name: ' + skillName);
  lines.push('description: ' + yamlQuote(description));
  lines.push('metadata: ' + metadata);
  lines.push('---');
  lines.push('');
  lines.push('# ' + spec.displayName);
  lines.push('', '## Why This Exists', '', '- ' + spec.routing.why_this_exists.en);
  lines.push('', '## When to Use', '', renderBulletList(spec.routing.when_to_use));
  lines.push('', '## When Not to Use', '', renderBulletList(spec.routing.when_not_to_use));
  lines.push('', '## Route Elsewhere', '', renderBulletList(spec.routing.route_elsewhere));
  lines.push('', '## Invocation Preflight', '', [
    '- Report required inputs, key parameters, key defaults, and dependency preflight results before analysis.',
    '- Run `plan` or `run` so the wrapper checks required runtimes plus Python/R packages in the active environment.',
    '- If dependencies are missing, show the user environment-switch, current-environment install, and new-environment install options.',
    '- Do not install dependencies until the user explicitly confirms an install option.',
    '- After the user changes environments, rerun dependency preflight before execution.'
  ].join("\n"));
  lines.push('', '## Input Formats', '', spec.inputContract.formats.map((item) => '- `' + item.name + '`: ' + item.en).join("\n"));
  lines.push('', '## Data / State Requirements', '', '### Required Manifest Fields', '', spec.inputContract.required_manifest_fields.map((item) => '- `' + item + '`').join("\n"));
  lines.push('', '### File-Backed Fields', '', spec.inputContract.file_fields.map((item) => '- `' + item.path + '`: ' + item.en).join("\n"));
  lines.push('', '### State Requirements', '', spec.inputContract.state_requirements.map((item) => {
    const expectation = item.equals
      ? 'Expected: `' + item.equals + '`'
      : item.one_of
        ? 'Expected: one of ' + item.one_of.map((value) => '`' + value + '`').join(', ')
        : 'Expected: present';
    return '- `' + item.path + '`: ' + item.en + '. ' + expectation;
  }).join("\n"));
  lines.push('', '## Required User Decisions', '', renderBulletList(spec.parameterPolicy.required_user_decisions));
  lines.push('', '## Default Parameter Rules', '');
  lines.push(renderParameterSection('User Required', schemaParametersByGroup('user_required'), renderSchemaParameter));
  lines.push('', renderParameterSection('Auto Detected', schemaParametersByGroup('auto_detected'), renderSchemaParameter));
  lines.push('', renderParameterSection('Literature Defaults', schemaParametersByGroup('literature_defaults'), renderSchemaParameter));
  lines.push('', renderParameterSection('Wrapper Defaults', schemaParametersByGroup('wrapper_defaults'), renderSchemaParameter));
  lines.push('', '### Decision Rules', '', spec.parameterPolicy.decision_rules.map((item) => '- ' + item.titleEn + ': ' + item.detailsEn).join("\n"));
  lines.push('', '## Workflow', '', renderWorkflow(spec.executionContract.workflow_steps));
  lines.push('', '## QC / Validation Rules', '', renderQcRules(spec.qcContract.rules));
  lines.push('', '### Validation Scenarios', '', renderBulletList(spec.qcContract.validation_scenarios));
  lines.push('', '### Interpretation Boundary', '', spec.qcContract.interpretation_boundary.map((item) => '- `' + item.status + '`: ' + item.en).join("\n"));
  lines.push('', '## Output Contract', '', '### Required Result Paths', '', requiredPaths);
  lines.push('', '### Required `result.json` Fields', '', resultFields);
  lines.push('', '### Bundle Notes', '', renderBulletList(spec.outputBundle.bundle_notes));
  lines.push('', '## Failure Modes and Recovery', '', renderFailureModes(spec.failureModes));
  lines.push('', '## Reproducibility Contract', '', '### Capture Items', '', renderBulletList(spec.reproducibilityContract.capture_items));
  lines.push('', '### Install Policy', '', renderBulletList(spec.reproducibilityContract.install_policy));
  lines.push('', '## Dependencies', '', dependencies);
  lines.push('', '## Citations', '', citations);
  return lines.join("\n") + "\n";
}
function buildOpenAiYaml(spec, skillName) {
  const prompt = `Use $${skillName} to route, validate, plan, and report this omics execution contract.`;

  return [
    "interface:",
    `  display_name: ${yamlQuote(spec.displayName)}`,
    `  short_description: ${yamlQuote("Execution-contract omics workflow skill.")}`,
    `  default_prompt: ${yamlQuote(prompt)}`,
    "",
    "policy:",
    "  allow_implicit_invocation: true",
    ""
  ].join("\n");
}

function buildMethodsReference(spec) {
  return `# Methods

## Contract Summary

- ${spec.routing.why_this_exists.en}

## Workflow Evidence

${renderWorkflow(spec.executionContract.workflow_steps)}

## Method References

${renderReferenceSections(spec.references.methods)}
`;
}
function buildPapersReference(spec) {
  const citations = renderCitations(spec.citations);
  return `# Papers and Sources

## Primary Paper

- [${spec.paperTitle}](${spec.paperUrl})
- Repository: [${spec.githubUrl}](${spec.githubUrl})

## Source Sections

${renderReferenceSections(spec.references.papers)}

## Citations

${citations}
`;
}
function buildExpectedResult(spec, skillName) {
  return {
    status: spec.testContract.expected_status,
    skill_name: skillName,
    paper_title: spec.paperTitle,
    runtime_probe: {
      status: "warn",
      targets: {}
    },
    input_validation: {
      status: "pass",
      checks: []
    },
    parameter_resolution: {
      status: "pass",
      records: []
    },
    qc_summary: {
      status: "warn",
      rules: []
    },
    artifacts: spec.outputBundle.required_paths,
    caveats: spec.failureModes.map((item) => item.conditionEn),
    citations_used: spec.citations.map((item) => item.label)
  };
}
function buildExpectedReport(spec) {
  return `# ${spec.displayName} Report

## Status

- ${spec.testContract.expected_status}

## Paper

- ${spec.paperTitle}

## Bundle

${spec.outputBundle.required_paths.map((item) => `- ${item}`).join("\n")}
`;
}
function buildDemoManifest(spec) {
  return JSON.stringify(spec.testContract.demo_input_manifest, null, 2);
}

function buildExpectedResultJson(spec, skillName) {
  return `${JSON.stringify(buildExpectedResult(spec, skillName), null, 2)}\n`;
}

function buildAlgorithmClassificationYaml(spec) {
  const payload = spec.algorithmClassification || {
    algorithm: {
      name: spec.metadata.primary_tool,
      repository: spec.githubUrl
    },
    classification: {
      primary_modality: spec.metadata.domain,
      primary_task: spec.metadata.analysis_type
    },
    implementation: {
      main_language: spec.metadata.tool_runtime,
      preferred_language: spec.metadata.tool_runtime
    }
  };
  return `${toYaml(payload)}\n`;
}

function buildSkillYaml(spec, skillName) {
  const classification = spec.algorithmClassification || {};
  return `${toYaml({
    name: skillName,
    type: "workflow_skill",
    algorithm: classification.algorithm || {
      name: spec.metadata.primary_tool,
      repository: spec.githubUrl
    },
    classification: classification.classification || {
      primary_modality: spec.metadata.domain,
      primary_task: spec.metadata.analysis_type
    },
    implementation: classification.implementation || {
      preferred_language: spec.metadata.tool_runtime
    },
    required_inputs: classification.required_inputs || spec.inputContract.required_manifest_fields,
    optional_inputs: classification.optional_inputs || [],
    workflow_steps: spec.executionContract.workflow_steps.map((step) => step.titleEn || step.id || step.name)
  })}\n`;
}

function buildWorkflowYaml(spec) {
  const edgeItems = spec.executionContract.dag_edges || spec.executionContract.workflow_steps.slice(1).map((step, index) => ({
    source: spec.executionContract.workflow_steps[index].id || spec.executionContract.workflow_steps[index].name || slugify(spec.executionContract.workflow_steps[index].titleEn),
    target: step.id || step.name || slugify(step.titleEn),
    inference: "manual_fallback_rule",
    evidence: []
  }));
  return `${toYaml({
    workflow_name: spec.skillName,
    mining_priority: spec.executionContract.workflow_mining_priority || [],
    required_inputs: (spec.algorithmClassification || {}).required_inputs || spec.inputContract.required_manifest_fields,
    optional_inputs: (spec.algorithmClassification || {}).optional_inputs || [],
    steps: spec.executionContract.workflow_steps.map((step) => ({
      id: step.id || step.name || slugify(step.titleEn),
      name: step.titleEn || step.name || step.id,
      script: step.script || null,
      input: step.input || [],
      output: step.output || [],
      evidence_id: step.evidence_id || null,
      evidence: step.evidence || [],
      evidence_sources: step.evidence_sources || [],
      evidence_priority_class: step.evidence_priority_class || null
    })),
    edges: edgeItems,
    final_outputs: spec.executionContract.required_outputs
  })}\n`;
}

function kebabFlag(name) {
  return `--${String(name).replace(/_/g, "-")}`;
}

function sourcePaths(item, prefix) {
  return (item.sources || [])
    .filter((source) => String(source).startsWith(prefix))
    .map((source) => String(source).slice(prefix.length));
}

function stateRuleForParameter(spec, parameterName) {
  return (spec.inputContract.state_requirements || []).find((rule) => {
    const lastPart = String(rule.path || "").split(".").pop();
    return lastPart === parameterName;
  });
}

function inferParameterType(item) {
  const value = Object.prototype.hasOwnProperty.call(item, "value")
    ? item.value
    : item.fallback_value;
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "float";
  }
  return "string";
}

function parameterDefault(item, category) {
  if (Object.prototype.hasOwnProperty.call(item, "value")) {
    return item.value;
  }
  if (Object.prototype.hasOwnProperty.call(item, "fallback_value")) {
    return item.fallback_value;
  }
  return category === "user_required" ? null : "auto";
}

function parameterSpecFromPolicyItem(spec, item, category) {
  const stateRule = stateRuleForParameter(spec, item.name);
  return {
    cli_flag: kebabFlag(item.name),
    type: inferParameterType(item),
    required: category === "user_required",
    default: parameterDefault(item, category),
    description: english(item.description || item.rationale || item.name),
    level: category === "wrapper_defaults" ? "developer" : "basic",
    choices: stateRule?.one_of || [],
    validation: stateRule?.one_of ? { choices: stateRule.one_of } : {},
    auto_detect: category === "auto_detect" ? {
      source: (item.sources || []).join(", "),
      rule: english(item.rationale || "Resolve from runtime, manifest, or fallback.")
    } : {},
    config_paths: sourcePaths(item, "config."),
    manifest_paths: sourcePaths(item, "manifest."),
    runtime_paths: sourcePaths(item, "runtime."),
    resolution_group: category,
    evidence_id: item.evidence_id,
    evidence_priority_class: item.evidence_priority_class,
    evidence_sources: item.evidence_sources || []
  };
}

function workflowParameterEntries(spec) {
  const groups = [
    ["user_required", spec.parameterPolicy.user_required || []],
    ["auto_detected", spec.parameterPolicy.auto_detected || []],
    ["literature_defaults", spec.parameterPolicy.literature_defaults || []],
    ["wrapper_defaults", spec.parameterPolicy.wrapper_defaults || []]
  ];
  const entries = [];
  for (const [category, items] of groups) {
    for (const item of items) {
      entries.push([item.name, parameterSpecFromPolicyItem(spec, item, category)]);
    }
  }
  return entries;
}

function buildParameterSchemaObject(spec) {
  const methodName = spec.metadata.analysis_type || "default";
  const workflowParams = Object.fromEntries(workflowParameterEntries(spec));
  return {
    schema_version: "0.2.0",
    skill: {
      name: spec.skillName,
      version: spec.metadata.version || "0.1.0",
      category: spec.metadata.domain || "omics",
      task_type: methodName,
      description: spec.displayName
    },
    parameter_groups: [
      { name: "global_params", description: "Parameters shared by all commands." },
      { name: "workflow_params", description: "Paper workflow parameters derived from evidence." },
      { name: "execution_params", description: "Parameters controlling runtime behavior." },
      { name: "output_params", description: "Parameters controlling generated files." },
      { name: "qc_params", description: "Parameters controlling quality checks." }
    ],
    global_params: {
      input: {
        cli_flag: "--input",
        type: "path",
        required: true,
        default: null,
        description: "Input manifest file or directory containing input_manifest.json.",
        level: "basic",
        validation: { exists: true }
      },
      out: {
        cli_flag: "--out",
        type: "path",
        required: false,
        default: null,
        description: "Output directory for plan or run artifacts.",
        level: "basic",
        validation: { create_if_missing: true }
      },
      config: {
        cli_flag: "--config",
        type: "path",
        required: false,
        default: null,
        description: "Optional user override config.",
        level: "basic",
        validation: { exists: true }
      },
      method: {
        cli_flag: "--method",
        type: "enum",
        required: false,
        default: methodName,
        description: "Workflow method to execute.",
        level: "basic",
        choices: [methodName]
      }
    },
    workflow_params: workflowParams,
    execution_params: {
      dry_run: {
        cli_flag: "--dry-run",
        type: "boolean",
        required: false,
        default: false,
        description: "Validate and materialize the result bundle without native execution.",
        level: "basic",
        config_paths: ["runtime.dry_run"]
      },
      resume: {
        cli_flag: "--resume",
        type: "boolean",
        required: false,
        default: false,
        description: "Resume a previous output directory when supported.",
        level: "intermediate",
        config_paths: ["runtime.resume"]
      }
    },
    output_params: {
      result_bundle: {
        cli_flag: "--result-bundle",
        type: "path",
        required: false,
        default: "results",
        description: "Default result bundle directory name used by generated configs.",
        level: "basic",
        config_paths: ["outputs.result_bundle"],
        validation: { create_if_missing: true }
      }
    },
    qc_params: {},
    methods: {
      [methodName]: {
        description: spec.displayName,
        backend: spec.metadata.tool_runtime || "cli",
        enabled: true,
        priority: Object.keys(workflowParams),
        requires: {
          input_state: (spec.inputContract.state_requirements || []).map((rule) => rule.path)
        },
        params: {}
      }
    },
    conditional_rules: [
      {
        name: "required_workflow_parameters",
        description: "Required workflow parameters must resolve before execution.",
        rule: {
          required: Object.entries(workflowParams)
            .filter(([, item]) => item.required)
            .map(([name]) => name)
        },
        severity: "error"
      }
    ],
    parameter_resolution: {
      priority: ["user_cli", "user_config", "method_defaults", "global_defaults", "auto_detect", "error"]
    },
    export: {
      write_effective_parameters: true,
      effective_parameters_file: "effective_parameters.json",
      write_parameter_warnings: true,
      parameter_warnings_file: "parameter_warnings.json"
    }
  };
}

function buildParameterSchemaYaml(spec) {
  return `${toYaml(buildParameterSchemaObject(spec))}\n`;
}

function buildConfigSchemaYaml(spec) {
  const parameterSchema = buildParameterSchemaObject(spec);
  const requiredFields = new Set(spec.inputContract.required_manifest_fields || []);
  return `${toYaml({
    inputs: Object.fromEntries((spec.inputContract.file_fields || []).map((field) => [
      field.path.replace(/^inputs\./, "").replace(/\./g, "_"),
      {
        type: "file",
        required: Boolean(field.required),
        source_path: field.path
      }
    ])),
    required_manifest_fields: [...requiredFields],
    parameters: Object.fromEntries(Object.entries(parameterSchema.workflow_params).map(([name, item]) => [
      name,
      {
        type: item.type,
        required: item.required,
        default: item.default === null ? "auto" : item.default
      }
    ]))
  })}\n`;
}

function buildDefaultConfigYaml(spec) {
  const schema = buildParameterSchemaObject(spec);
  const analysis = {
    mode: spec.metadata.analysis_type
  };
  for (const [name, item] of Object.entries(schema.workflow_params)) {
    const analysisPath = (item.config_paths || []).find((configPath) => configPath.startsWith("analysis."));
    if (analysisPath) {
      analysis[analysisPath.slice("analysis.".length)] = item.default;
    } else if (item.required) {
      analysis[name] = item.default;
    }
  }
  return `${toYaml({
    analysis,
    runtime: {
      dry_run: schema.execution_params.dry_run.default,
      resume: schema.execution_params.resume.default
    },
    outputs: {
      result_bundle: schema.output_params.result_bundle.default
    }
  })}\n`;
}

function buildDemoConfigYaml(spec) {
  return `${toYaml(spec.testContract.demo_input_manifest)}\n`;
}

function buildReportTemplate(spec) {
  const perturbation = spec.algorithmClassification?.classification?.perturbation;
  const extraSections = perturbation?.target_type?.value === "transcription_factor"
    ? ["GRN construction", "Perturbation setup", "Transition vector", "Visualization", "Biological interpretation"]
    : ["WT network", "KO network", "Differential regulation", "Top perturbed genes", "Pathway enrichment"];
  return [
    `# ${spec.displayName} Report Template`,
    "",
    "## Input summary",
    "",
    ...extraSections.flatMap((section) => [`## ${section}`, ""]),
    "## QC summary",
    "",
    "## Limitations",
    "",
    "## Reproducibility",
    ""
  ].join("\n");
}

function renderEvidenceList(items) {
  const values = (items || []).filter(Boolean);
  if (values.length === 0) {
    return "- Not confirmed in paper or code";
  }
  return values.map((item) => `- ${item}`).join("\n");
}

function renderSourceList(items) {
  const values = (items || []).filter(Boolean);
  if (values.length === 0) {
    return "    - Not confirmed in paper or code";
  }
  return values.map((item) => {
    if (item && typeof item === "object") {
      const category = item.category ? `${item.category}: ` : "";
      const evidenceId = item.evidence_id ? `[${item.evidence_id}] ` : "";
      const source = item.source || item.path || JSON.stringify(item);
      const url = item.url ? ` (${item.url})` : "";
      return `    - ${evidenceId}${category}${source}${url}`;
    }
    return `    - ${item}`;
  }).join("\n");
}

function sourcePriorityForSources(sources, priorityOrder, fallback = "manual_fallback_rule") {
  const categories = (sources || [])
    .map((item) => (item && typeof item === "object" ? item.category : null))
    .filter(Boolean);
  const values = (sources || []).map((item) => {
    if (item && typeof item === "object") {
      return `${item.category || ""} ${item.source || item.path || ""}`.toLowerCase();
    }
    return String(item).toLowerCase();
  });
  for (const priority of priorityOrder || []) {
    const normalized = String(priority).toLowerCase();
    if (categories.includes(priority) || values.some((item) => item.includes(normalized) || normalized.includes(item))) {
      return priority;
    }
  }
  if (values.some((item) => /notebook|example|demo|vignette|tutorial|manuscript/.test(item))) {
    return priorityOrder?.includes("running_example_notebook_demo_script")
      ? "running_example_notebook_demo_script"
      : "official_docs_tutorial";
  }
  if (values.some((item) => /function_signature|signature|api_function/.test(item))) {
    return "function_signature";
  }
  if (values.some((item) => /source|api|entrypoint|dependency/.test(item))) {
    return "source_code_api";
  }
  if (values.some((item) => /readme/.test(item))) {
    return "readme";
  }
  if (values.some((item) => /paper|method/.test(item))) {
    return "paper_methods";
  }
  return fallback;
}

function traceStatus(sources) {
  const values = (sources || []).filter(Boolean);
  if (values.length === 0) {
    return "unconfirmed";
  }
  if (values.some((item) => {
    if (item && typeof item === "object") {
      return item.category === "manual_fallback_rule";
    }
    return String(item).includes("manual_fallback_rule");
  })) {
    return "fallback";
  }
  return "confirmed";
}

function firstEvidenceId(sources) {
  const found = (sources || []).find((item) => item && typeof item === "object" && item.evidence_id);
  return found ? found.evidence_id : null;
}

function renderTraceBlock({ claim, value, priority, status, sources, rationale, evidenceId }) {
  const lines = [
    `- Claim: ${claim}`,
    `  - Evidence ID: ${evidenceId || firstEvidenceId(sources) || "unassigned"}`,
    `  - Value: ${value === undefined || value === null || value === "" ? "`unknown`" : `\`${value}\``}`,
    `  - Status: ${status || traceStatus(sources)}`,
    `  - Priority: ${priority || "manual_fallback_rule"}`,
    "  - Sources:",
    renderSourceList(sources)
  ];
  if (rationale) {
    lines.push(`  - Rationale: ${rationale}`);
  }
  return lines.join("\n");
}

function buildEvidenceReport(spec) {
  const classification = spec.algorithmClassification || {};
  const classBlock = classification.classification || {};
  const implementation = classification.implementation || {};
  const perturbation = classBlock.perturbation || {};
  const edges = spec.executionContract.dag_edges || [];
  const workflowPriority = spec.executionContract.workflow_mining_priority || [];
  const parameterPriority = spec.parameterPolicy.evidence_priority || [];
  const classificationSources = classBlock.evidence || [];
  const implementationSources = implementation.evidence || [];
  const openCategoryBlocks = (classBlock.open_categories || []).map((item) => renderTraceBlock({
    claim: `classification.open_category.${item.axis || "task"}`,
    value: item.label || "unknown",
    priority: item.source_priority || sourcePriorityForSources(item.evidence_sources || item.evidence, workflowPriority, "paper_methods"),
    sources: item.evidence_sources || item.evidence,
    evidenceId: item.evidence_id,
    rationale: item.confidence !== undefined ? `Confidence: ${item.confidence}` : undefined
  })).join("\n\n") || "- None";
  const classificationNotes = (classBlock.classification_notes || []).length > 0
    ? classBlock.classification_notes.map((item) => `- ${item}`).join("\n")
    : "- None";

  const parameterSections = [
    ["User required", spec.parameterPolicy.user_required],
    ["Auto detected", spec.parameterPolicy.auto_detected],
    ["Literature defaults", spec.parameterPolicy.literature_defaults],
    ["Wrapper defaults", spec.parameterPolicy.wrapper_defaults]
  ].map(([title, items]) => [
    `### ${title}`,
    "",
    (items || []).map((item) => renderTraceBlock({
      claim: `parameter.${item.name}`,
      value: item.value || item.fallback_value || item.description?.en || item.description?.zh || "user_supplied",
      priority: item.evidence_priority_class || sourcePriorityForSources(item.evidence_sources || item.sources || [title], parameterPriority, title === "Literature defaults" ? "paper_methods" : "manual_fallback_rule"),
      sources: item.evidence_sources || item.sources || [title],
      rationale: item.rationale?.en || item.rationale?.zh
    })).join("\n") || "- None"
  ].join("\n")).join("\n\n");

  const classificationBlocks = [
    renderTraceBlock({
      claim: "classification.primary_modality",
      value: classBlock.primary_modality || "unknown",
      priority: sourcePriorityForSources(classificationSources, workflowPriority, "paper_methods"),
      sources: classificationSources
    }),
    renderTraceBlock({
      claim: "classification.primary_task",
      value: classBlock.primary_task || "unknown",
      priority: sourcePriorityForSources(classificationSources, workflowPriority, "paper_methods"),
      sources: classificationSources
    }),
    renderTraceBlock({
      claim: "classification.secondary_tasks",
      value: (classBlock.secondary_tasks || []).join(", ") || "none",
      priority: sourcePriorityForSources(classificationSources, workflowPriority, "paper_methods"),
      sources: classificationSources
    }),
    renderTraceBlock({
      claim: "classification.classification_basis",
      value: classBlock.classification_basis || "legacy_rule",
      priority: sourcePriorityForSources(classificationSources, workflowPriority, "paper_methods"),
      sources: classificationSources
    }),
    renderTraceBlock({
      claim: "implementation.languages",
      value: (implementation.languages || implementation.available_languages || []).join(", ") || "unknown",
      priority: sourcePriorityForSources(implementationSources, workflowPriority, "source_code_api"),
      sources: implementationSources
    }),
    renderTraceBlock({
      claim: "implementation.execution_modes",
      value: (implementation.execution_modes || []).join(", ") || "unknown",
      priority: sourcePriorityForSources(implementationSources, workflowPriority, "source_code_api"),
      sources: implementationSources
    }),
    renderTraceBlock({
      claim: "implementation.workflow_engines",
      value: (implementation.workflow_engines || []).join(", ") || "none",
      priority: sourcePriorityForSources(implementationSources, workflowPriority, "source_code_api"),
      sources: implementationSources
    })
  ].join("\n\n");

  return `# Evidence Report

This report records the traceability of generated classifications, parameters, workflow steps, and DAG edges. Each item uses the same fields: Claim, Evidence ID, Value, Status, Priority, and Sources.

## Evidence Priority

### Workflow mining

${renderEvidenceList(spec.executionContract.workflow_mining_priority)}

### Parameter extraction

${renderEvidenceList(spec.parameterPolicy.evidence_priority)}

## Classification Evidence

${classificationBlocks}

### Classification Notes

${classificationNotes}

## Open Classification Categories

${openCategoryBlocks}

### Perturbation Facets

${Object.entries(perturbation).map(([key, item]) => renderTraceBlock({
    claim: `perturbation.${key}`,
    value: item.value,
    priority: sourcePriorityForSources(item.evidence_sources || item.evidence, workflowPriority, "paper_methods"),
    sources: item.evidence_sources || item.evidence,
    evidenceId: item.evidence_id
  })).join("\n\n") || "- Not a perturbation workflow"}

## Parameter Evidence

${parameterSections}

## Workflow Step Evidence

${spec.executionContract.workflow_steps.map((step) => [
    `### ${step.id || step.name || step.titleEn}`,
    "",
    renderTraceBlock({
      claim: `workflow_step.${step.id || step.name || step.titleEn}`,
      value: step.titleEn || step.name,
      priority: step.evidence_priority_class || sourcePriorityForSources(step.evidence_sources || step.evidence, workflowPriority),
      sources: step.evidence_sources || step.evidence,
      evidenceId: step.evidence_id,
      rationale: step.description?.en || step.description?.zh || step.description
    })
  ].join("\n")).join("\n\n")}

## DAG Edge Evidence

${edges.map((edge) => [
    `### ${edge.source} -> ${edge.target}`,
    "",
    renderTraceBlock({
      claim: `dag_edge.${edge.source}->${edge.target}`,
      value: edge.inference,
      priority: edge.evidence_priority_class || edge.evidence_priority?.[0] || sourcePriorityForSources(edge.evidence_sources || edge.evidence, edge.evidence_priority || workflowPriority),
      sources: edge.evidence_sources || edge.evidence,
      evidenceId: edge.evidence_id,
      rationale: edge.detail
    })
  ].join("\n")).join("\n\n") || "- No DAG edges generated"}
`;
}

function buildStepScript(step, spec) {
  const stepId = step.id || step.name || slugify(step.titleEn);
  return `#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path


def load_config(path: str | None) -> dict:
    if not path:
        return {}
    config_path = Path(path)
    if not config_path.exists():
        raise FileNotFoundError(f"Config file does not exist: {config_path}")
    if config_path.suffix.lower() == ".json":
        return json.loads(config_path.read_text(encoding="utf-8"))
    return {"path": str(config_path)}


def main() -> None:
    parser = argparse.ArgumentParser(description="${step.titleEn || stepId}")
    parser.add_argument("--config")
    parser.add_argument("--input", action="append", default=[])
    parser.add_argument("--out", default="outputs")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    load_config(args.config)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    for input_path in args.input:
        if not Path(input_path).exists():
            raise FileNotFoundError(f"Input path does not exist: {input_path}")
    logging.info("Prepared scaffold step ${stepId} for ${spec.skillName}")
    logging.info("Scaffold placeholder completed; replace this step with the source-backed method implementation when enabling native execution.")


if __name__ == "__main__":
    main()
`;
}

function buildDemoFiles(spec) {
  return spec.testContract.demo_files || {};
}

function buildReadmeArtifact(spec, skillName) {
  return `# ${spec.displayName} Result Bundle

- Skill: ${skillName}
- Paper: ${spec.paperTitle}
- Result status: ${spec.testContract.expected_status}
`;
}
function buildPythonOrchestrator(spec, skillName) {
  const specJson = JSON.stringify(spec, null, 2);
  const parameterSchemaJson = JSON.stringify(buildParameterSchemaObject(spec), null, 2);
  const readmeLiteral = pythonStringLiteral(buildReadmeArtifact(spec, skillName));
  return `#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import yaml  # type: ignore
except ImportError:
    yaml = None

SPEC = json.loads(r'''${specJson}''')
PARAMETER_SCHEMA = json.loads(r'''${parameterSchemaJson}''')
FORCED_MISSING = {
    item.strip()
    for item in os.environ.get("CODEX_FORCE_MISSING_EXECUTABLES", "").split(",")
    if item.strip()
}
FORCED_MISSING_PACKAGES = {
    item.strip().lower()
    for item in os.environ.get("CODEX_FORCE_MISSING_PACKAGES", "").split(",")
    if item.strip()
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_dump(data) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2)


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json_dump(data) + "\\n", encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def get_nested(data, dotted_path, default=None):
    current = data
    for part in dotted_path.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
            continue
        return default
    return current


def resolve_source(source: str, config, manifest, runtime):
    if source.startswith("config."):
        return get_nested(config, source[len("config."):])
    if source.startswith("manifest."):
        return get_nested(manifest, source[len("manifest."):])
    if source.startswith("runtime."):
        return get_nested(runtime, source[len("runtime."):])
    return None


def load_mapping_file(path: Path):
    suffix = path.suffix.lower()
    raw = path.read_text(encoding="utf-8")
    if suffix == ".json":
        return json.loads(raw)
    if suffix in {".yaml", ".yml"}:
        if yaml is None:
            raise RuntimeError("PyYAML is required to read YAML inputs.")
        return yaml.safe_load(raw)
    raise RuntimeError(f"Unsupported mapping file extension: {path.suffix}")


def load_input_manifest(input_arg: str):
    input_path = Path(input_arg)
    if not input_path.exists():
        raise FileNotFoundError(f"Input path does not exist: {input_path}")

    if input_path.is_dir():
        for candidate in ("input_manifest.json", "input_manifest.yaml", "input_manifest.yml"):
            manifest_path = input_path / candidate
            if manifest_path.exists():
                return load_mapping_file(manifest_path), manifest_path, manifest_path.parent
        raise FileNotFoundError(f"No input manifest found inside directory: {input_path}")

    manifest = load_mapping_file(input_path)
    return manifest, input_path, input_path.parent


def load_config(config_arg: str | None):
    if not config_arg:
        return {}
    return load_mapping_file(Path(config_arg))


class ParameterError(ValueError):
    pass


PARAMETER_SECTIONS = (
    "global_params",
    "workflow_params",
    "execution_params",
    "output_params",
    "qc_params",
)


def collect_parameter_specs():
    specs = {}
    groups = {}
    for section in PARAMETER_SECTIONS:
        for name, spec in (PARAMETER_SCHEMA.get(section) or {}).items():
            specs[name] = spec
            groups[name] = section
    return specs, groups


def parse_bool_value(name: str, value):
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    raise ParameterError(
        f"Invalid parameter: {name}={value}. Reason: expected a boolean value. "
        "Suggested fix: use true or false."
    )


def coerce_parameter_value(name: str, value, spec):
    if value in (None, ""):
        return None
    parameter_type = spec.get("type", "string")
    try:
        if parameter_type == "boolean":
            return parse_bool_value(name, value)
        if parameter_type == "integer":
            return int(value)
        if parameter_type == "float":
            return float(value)
        if parameter_type.startswith("list["):
            return value if isinstance(value, list) else [item.strip() for item in str(value).split(",") if item.strip()]
        if parameter_type == "dict":
            if isinstance(value, dict):
                return value
            return json.loads(value)
        return str(value) if parameter_type in {"string", "path", "enum"} else value
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ParameterError(
            f"Invalid parameter: {name}={value}. Reason: expected type {parameter_type}. "
            f"Suggested fix: provide a valid {parameter_type} value."
        ) from exc


def validate_one_parameter(name: str, value, spec):
    if spec.get("required") and value in (None, "", []):
        raise ParameterError(
            f"Invalid parameter: {name}={value}. Reason: required parameter is missing. "
            f"Suggested fix: pass {spec.get('cli_flag', '--' + name.replace('_', '-'))} or provide it in config/input manifest."
        )
    if value in (None, "", []):
        return
    choices = spec.get("choices") or spec.get("validation", {}).get("choices") or []
    if choices and value not in choices:
        raise ParameterError(
            f"Invalid parameter: {name}={value}. Reason: expected one of {choices}. "
            f"Suggested fix: use one of {choices}."
        )
    validation = spec.get("validation") or {}
    if "min" in validation and value < validation["min"]:
        raise ParameterError(
            f"Invalid parameter: {name}={value}. Reason: value is below minimum {validation['min']}."
        )
    if "max" in validation and value > validation["max"]:
        raise ParameterError(
            f"Invalid parameter: {name}={value}. Reason: value is above maximum {validation['max']}."
        )


def resolve_from_paths(paths, data):
    for path in paths or []:
        value = get_nested(data, path)
        if value not in (None, "", []):
            return value, path
    return None, None


def resolve_effective_parameters(args, manifest, config, runtime):
    specs, groups = collect_parameter_specs()
    effective = {}
    parameter_sources = {}
    auto_detected = {}
    warnings = []
    records = []

    cli_values = {
        name: getattr(args, name, None)
        for name in specs
        if hasattr(args, name)
    }
    cli_values.update({
        "input": getattr(args, "input", None),
        "out": getattr(args, "out", None),
        "config": getattr(args, "config", None),
        "dry_run": getattr(args, "dry_run", None),
        "resume": getattr(args, "resume", None),
    })

    for name, spec in specs.items():
        value = None
        source = None
        raw_cli = cli_values.get(name)
        if raw_cli not in (None, "", []):
            value = raw_cli
            source = "user_cli"
        if source is None:
            value, config_path = resolve_from_paths(spec.get("config_paths"), config)
            if config_path:
                source = "user_config"
        if source is None and name in config and config[name] not in (None, "", []):
            value = config[name]
            source = "user_config"
        if source is None and spec.get("default") not in (None, "auto"):
            value = spec.get("default")
            source = "method_defaults" if groups.get(name) == "workflow_params" else "global_defaults"
        if source is None:
            value, runtime_path = resolve_from_paths(spec.get("runtime_paths"), runtime)
            if runtime_path:
                source = "auto_detect"
        if source is None:
            value, manifest_path = resolve_from_paths(spec.get("manifest_paths"), manifest)
            if manifest_path:
                source = "auto_detect"
        if source is None and spec.get("default") == "auto":
            value = "auto"
            source = "auto_detect"

        coerced = coerce_parameter_value(name, value, spec)
        validate_one_parameter(name, coerced, spec)
        effective[name] = coerced
        parameter_sources[name] = source or "error"
        if parameter_sources[name] == "auto_detect":
            auto_detected[name] = {
                "selected": coerced,
                "source": (spec.get("manifest_paths") or spec.get("runtime_paths") or ["auto"])[0],
                "rule": (spec.get("auto_detect") or {}).get("rule", "Resolved from schema-backed auto-detection.")
            }

        if groups.get(name) == "workflow_params":
            records.append({
                "category": spec.get("resolution_group", "workflow_params"),
                "name": name,
                "value": coerced,
                "status": "pass" if coerced not in (None, "", []) else "warn",
                "resolution_source": parameter_sources[name],
                "evidence_priority_class": spec.get("evidence_priority_class"),
                "evidence_sources": spec.get("evidence_sources", []),
                "rationale": {
                    "en": spec.get("description", ""),
                    "zh": spec.get("description", "")
                }
            })

    legacy_status = "pass"
    if any(record["status"] == "fail" for record in records):
        legacy_status = "fail"
    elif any(record["status"] == "warn" for record in records):
        legacy_status = "warn"

    return {
        "skill": PARAMETER_SCHEMA["skill"],
        "parameter_resolution_priority": PARAMETER_SCHEMA["parameter_resolution"]["priority"],
        "effective_parameters": effective,
        "parameter_sources": parameter_sources,
        "auto_detected": auto_detected,
        "warnings": warnings,
        "legacy_parameter_resolution": {
            "status": legacy_status,
            "records": records
        }
    }


def runtime_probe():
    targets = {}
    overall = "pass"

    for target in SPEC["executionContract"]["runtime_targets"]:
        name = target["name"]
        executable = target.get("executable", name)
        available = executable not in FORCED_MISSING and name not in FORCED_MISSING
        if available and name.lower() == "python":
            found = sys.executable
        else:
            found = shutil.which(executable) if available else None
        target_status = "pass" if found else ("fail" if target.get("required", False) else "warn")
        if target_status == "fail":
            overall = "fail"
        elif target_status == "warn" and overall == "pass":
            overall = "warn"

        targets[name] = {
            "required": bool(target.get("required", False)),
            "executable": executable,
            "available": found is not None,
            "path": found,
            "status": target_status
        }

    return {
        "status": overall,
        "targets": targets
    }


def dependency_base_name(name: str):
    normalized = str(name).strip()
    base = normalized.split("==")[0].split(">=")[0].split("<=")[0].split("~=")[0].split("!=")[0].split(">")[0].split("<")[0].split("=")[0]
    return base.strip()


def python_requirement_base_name(name: str):
    base = dependency_base_name(str(name).split(";", 1)[0])
    return base.split("[", 1)[0].strip()


def is_runtime_dependency(name: str):
    compact = "".join(str(name).strip().lower().split())
    base = dependency_base_name(compact).lower()
    if base in {"python", "python3"}:
        return compact == base or compact.startswith((base + "=", base + ">", base + "<", base + "~", base + "!"))
    return base == "r" and compact == "r"


def package_import_candidates(name: str):
    base = python_requirement_base_name(name)
    if not base or base.lower() in {"python", "r"}:
        return []
    values = [base, base.lower(), base.replace("-", "_"), base.lower().replace("-", "_")]
    aliases = {
        "scikit-learn": "sklearn",
        "pillow": "PIL",
        "pyyaml": "yaml"
    }
    if base.lower() in aliases:
        values.append(aliases[base.lower()])
    deduped = []
    for value in values:
        if value and value not in deduped:
            deduped.append(value)
    return deduped


def cli_executable_candidates(name: str):
    base = dependency_base_name(name)
    if not base or base.lower() in {"python", "r"}:
        return []
    values = [base, base.lower(), base.replace("_", "-"), base.lower().replace("_", "-")]
    deduped = []
    for value in values:
        if value and value not in deduped:
            deduped.append(value)
    return deduped


def dependency_package_specs():
    runtime = str(SPEC.get("metadata", {}).get("tool_runtime", "python")).lower()
    specs = []
    for dependency in SPEC.get("metadata", {}).get("dependencies", []):
        name = str(dependency)
        if is_runtime_dependency(name):
            continue
        if runtime == "r":
            language = "r"
        elif runtime == "cli":
            language = "cli"
        else:
            language = "python"
        specs.append({
            "name": name,
            "language": language,
            "required": True,
            "import_candidates": package_import_candidates(name),
            "executable_candidates": cli_executable_candidates(name)
        })
    return specs


def probe_python_package(spec):
    name = spec["name"]
    package_name = python_requirement_base_name(name)
    if name.lower() in FORCED_MISSING_PACKAGES:
        return {
            "name": name,
            "package_name": package_name,
            "language": "python",
            "required": spec.get("required", True),
            "available": False,
            "status": "fail",
            "checked_candidates": spec.get("import_candidates", []),
            "reason": "Forced missing by CODEX_FORCE_MISSING_PACKAGES."
        }
    for candidate in spec.get("import_candidates", []):
        if candidate.lower() in FORCED_MISSING_PACKAGES:
            continue
        if importlib.util.find_spec(candidate) is not None:
            return {
                "name": name,
                "package_name": package_name,
                "language": "python",
                "required": spec.get("required", True),
                "available": True,
                "status": "pass",
                "import_name": candidate,
                "checked_candidates": spec.get("import_candidates", [])
            }
    return {
        "name": name,
        "package_name": package_name,
        "language": "python",
        "required": spec.get("required", True),
        "available": False,
        "status": "fail" if spec.get("required", True) else "warn",
        "checked_candidates": spec.get("import_candidates", [])
    }


def probe_cli_dependency(spec):
    name = spec["name"]
    if name.lower() in FORCED_MISSING_PACKAGES:
        return {
            "name": name,
            "language": "cli",
            "required": spec.get("required", True),
            "available": False,
            "status": "fail",
            "checked_candidates": spec.get("executable_candidates", []),
            "reason": "Forced missing by CODEX_FORCE_MISSING_PACKAGES."
        }
    for candidate in spec.get("executable_candidates", []):
        if candidate.lower() in FORCED_MISSING_PACKAGES:
            continue
        executable_path = shutil.which(candidate)
        if executable_path:
            return {
                "name": name,
                "language": "cli",
                "required": spec.get("required", True),
                "available": True,
                "status": "pass",
                "executable": candidate,
                "executable_path": executable_path,
                "checked_candidates": spec.get("executable_candidates", [])
            }
    return {
        "name": name,
        "language": "cli",
        "required": spec.get("required", True),
        "available": False,
        "status": "fail" if spec.get("required", True) else "warn",
        "checked_candidates": spec.get("executable_candidates", [])
    }


def probe_r_package(spec, runtime):
    name = spec["name"]
    package_name = dependency_base_name(name)
    rscript = runtime.get("targets", {}).get("Rscript") or runtime.get("targets", {}).get("R")
    executable = (rscript or {}).get("path") or shutil.which((rscript or {}).get("executable") or "Rscript")
    if not executable:
        return {
            "name": name,
            "package_name": package_name,
            "language": "r",
            "required": spec.get("required", True),
            "available": None,
            "status": "skipped",
            "reason": "Rscript is unavailable; package check will be retried after runtime is available."
        }
    if name.lower() in FORCED_MISSING_PACKAGES:
        return {
            "name": name,
            "package_name": package_name,
            "language": "r",
            "required": spec.get("required", True),
            "available": False,
            "status": "fail",
            "reason": "Forced missing by CODEX_FORCE_MISSING_PACKAGES."
        }
    env = os.environ.copy()
    env["PAPER2OMICS_R_PACKAGE_NAME"] = package_name
    completed = subprocess.run(
        [executable, "-e", "pkg <- Sys.getenv('PAPER2OMICS_R_PACKAGE_NAME'); quit(status = ifelse(requireNamespace(pkg, quietly = TRUE), 0, 1))"],
        capture_output=True,
        text=True,
        env=env
    )
    return {
        "name": name,
        "package_name": package_name,
        "language": "r",
        "required": spec.get("required", True),
        "available": completed.returncode == 0,
        "status": "pass" if completed.returncode == 0 else ("fail" if spec.get("required", True) else "warn"),
        "stderr": completed.stderr[-500:] if completed.stderr else ""
    }


def package_probe(runtime):
    records = []
    statuses = []
    for spec in dependency_package_specs():
        if spec["language"] == "python":
            record = probe_python_package(spec)
        elif spec["language"] == "cli":
            record = probe_cli_dependency(spec)
        elif spec["language"] == "r":
            record = probe_r_package(spec, runtime)
        else:
            record = {
                "name": spec["name"],
                "language": spec["language"],
                "required": spec.get("required", True),
                "available": None,
                "status": "skipped",
                "reason": "Unsupported package language for automatic probing."
            }
        records.append(record)
        statuses.append(record["status"])

    overall = "pass"
    if "fail" in statuses:
        overall = "fail"
    elif "warn" in statuses:
        overall = "warn"
    elif "skipped" in statuses:
        overall = "skipped"
    return {
        "status": overall,
        "packages": records
    }


def key_parameter_records(effective_parameters):
    records = []
    for record in effective_parameters["legacy_parameter_resolution"]["records"]:
        if record["category"] in {"user_required", "auto_detected"}:
            records.append(record)
    return records


def default_parameter_records(effective_parameters):
    records = []
    for record in effective_parameters["legacy_parameter_resolution"]["records"]:
        if record["category"] in {"literature_defaults", "wrapper_defaults"}:
            records.append(record)
    return records


def install_guidance(missing_dependencies):
    sources = SPEC.get("reproducibilityContract", {}).get("install_guidance_sources") or []
    commands = [
        {
            "source_path": item.get("source_path"),
            "source_priority": item.get("source_priority"),
            "command_or_line": item.get("command_or_line")
        }
        for item in sources
        if item.get("command_or_line")
    ]
    missing = ", ".join(missing_dependencies) if missing_dependencies else "the missing dependencies"
    return {
        "requires_user_confirmation": True,
        "message": "Do not install automatically. Ask the user to confirm one option, then rerun preflight after any environment change.",
        "options": [
            {
                "name": "change_environment",
                "description": f"Switch to an environment that already contains {missing}, then rerun plan or run."
            },
            {
                "name": "install_current_environment",
                "description": "Install in the current active environment only after explicit user confirmation.",
                "preferred_commands": commands
            },
            {
                "name": "create_new_environment",
                "description": "Create a clean environment, install dependencies using tutorial or dependency-file guidance, then rerun preflight.",
                "preferred_commands": commands
            }
        ]
    }


def build_preflight(runtime, effective_parameters):
    packages = package_probe(runtime)
    missing_dependencies = [
        item["name"]
        for item in packages["packages"]
        if item["status"] == "fail" and item.get("required", True)
    ]
    return {
        "required_inputs": SPEC.get("algorithmClassification", {}).get("required_inputs", []),
        "key_parameters": key_parameter_records(effective_parameters),
        "default_parameters": default_parameter_records(effective_parameters),
        "runtime_probe": runtime,
        "package_probe": packages,
        "missing_dependencies": missing_dependencies,
        "install_guidance": install_guidance(missing_dependencies)
    }


def resolve_data_path(base_dir: Path, value):
    if value is None:
        return None
    candidate = Path(str(value))
    if candidate.is_absolute():
        return candidate
    return base_dir / candidate


def validate_input_contract(manifest, base_dir: Path):
    checks = []
    statuses = []

    for field in SPEC["inputContract"]["required_manifest_fields"]:
        actual = get_nested(manifest, field)
        status = "pass" if actual not in (None, "", []) else "fail"
        statuses.append(status)
        checks.append({
            "type": "required_manifest_field",
            "path": field,
            "status": status,
            "actual": actual
        })

    for field in SPEC["inputContract"]["file_fields"]:
        actual = get_nested(manifest, field["path"])
        resolved = resolve_data_path(base_dir, actual) if actual else None
        exists = resolved.exists() if resolved else False
        required = bool(field.get("required", True))
        status = "pass" if exists else ("fail" if required else "warn")
        statuses.append(status)
        checks.append({
            "type": "file_field",
            "path": field["path"],
            "status": status,
            "resolved_path": str(resolved) if resolved else None,
            "exists": exists,
            "description": field["en"]
        })

    for rule in SPEC["inputContract"]["state_requirements"]:
        actual = get_nested(manifest, rule["path"])
        if "equals" in rule:
            passed = actual == rule["equals"]
        elif "one_of" in rule:
            passed = actual in rule["one_of"]
        else:
            passed = actual is not None

        required = bool(rule.get("required", True))
        status = "pass" if passed else ("fail" if required else "warn")
        statuses.append(status)
        checks.append({
            "type": "state_requirement",
            "path": rule["path"],
            "status": status,
            "actual": actual,
            "rule": rule["en"]
        })

    overall = "pass"
    if "fail" in statuses:
        overall = "fail"
    elif "warn" in statuses:
        overall = "warn"

    return {
        "status": overall,
        "checks": checks
    }


def resolve_parameters(manifest, config, runtime):
    records = []
    statuses = []

    def append_record(category, entry, value, status, source):
        statuses.append(status)
        records.append({
            "category": category,
            "name": entry["name"],
            "value": value,
            "status": status,
            "resolution_source": source,
            "evidence_priority_class": entry.get("evidence_priority_class"),
            "evidence_sources": entry.get("evidence_sources", []),
            "rationale": entry["rationale"]
        })

    for entry in SPEC["parameterPolicy"]["user_required"]:
        value = None
        source = None
        for candidate in entry.get("sources", []):
            value = resolve_source(candidate, config, manifest, runtime)
            if value not in (None, "", []):
                source = candidate
                break
        status = "pass" if value not in (None, "", []) else "fail"
        append_record("user_required", entry, value, status, source)

    for entry in SPEC["parameterPolicy"]["auto_detected"]:
        value = None
        source = None
        for candidate in entry.get("sources", []):
            value = resolve_source(candidate, config, manifest, runtime)
            if value not in (None, "", []):
                source = candidate
                break
        if value in (None, "", []):
            value = entry.get("fallback_value")
            source = "fallback_value" if "fallback_value" in entry else None
        status = "pass" if value not in (None, "", []) else "warn"
        append_record("auto_detected", entry, value, status, source)

    for entry in SPEC["parameterPolicy"]["literature_defaults"]:
        config_value = get_nested(config, entry.get("config_path", f'parameters.{entry["name"]}'))
        value = entry["value"] if config_value in (None, "", []) else config_value
        source = "literature_default" if config_value in (None, "", []) else entry.get("config_path", f'parameters.{entry["name"]}')
        append_record("literature_defaults", entry, value, "pass", source)

    for entry in SPEC["parameterPolicy"]["wrapper_defaults"]:
        config_value = get_nested(config, entry.get("config_path", f'parameters.{entry["name"]}'))
        value = entry["value"] if config_value in (None, "", []) else config_value
        source = "wrapper_default" if config_value in (None, "", []) else entry.get("config_path", f'parameters.{entry["name"]}')
        append_record("wrapper_defaults", entry, value, "pass", source)

    overall = "pass"
    if "fail" in statuses:
        overall = "fail"
    elif "warn" in statuses:
        overall = "warn"

    return {
        "status": overall,
        "records": records
    }


def workflow_summary():
    return {
        "mining_priority": SPEC["executionContract"].get("workflow_mining_priority", []),
        "steps": [
            {
                "id": step.get("id") or step.get("name") or step.get("titleEn"),
                "name": step.get("titleEn") or step.get("name"),
                "script": step.get("script"),
                "input": step.get("input", []),
                "output": step.get("output", []),
                "evidence_priority_class": step.get("evidence_priority_class"),
                "evidence_sources": step.get("evidence_sources", [])
            }
            for step in SPEC["executionContract"].get("workflow_steps", [])
        ],
        "dag_edges": SPEC["executionContract"].get("dag_edges", [])
    }


def evidence_summary(parameter_resolution):
    return {
        "classification": SPEC.get("algorithmClassification", {}),
        "parameter_resolution": [
            {
                "name": record["name"],
                "status": record["status"],
                "resolution_source": record["resolution_source"],
                "evidence_priority_class": record.get("evidence_priority_class"),
                "evidence_sources": record.get("evidence_sources", [])
            }
            for record in parameter_resolution["records"]
        ],
        "workflow_step_priorities": [
            {
                "id": step.get("id") or step.get("name"),
                "evidence_priority_class": step.get("evidence_priority_class")
            }
            for step in SPEC["executionContract"].get("workflow_steps", [])
        ],
        "dag_edge_priorities": [
            {
                "source": edge.get("source"),
                "target": edge.get("target"),
                "inference": edge.get("inference"),
                "evidence_priority_class": edge.get("evidence_priority_class")
            }
            for edge in SPEC["executionContract"].get("dag_edges", [])
        ]
    }


class SafeDict(dict):
    def __missing__(self, key):
        return "{" + key + "}"


def render_command_templates(out_dir: Path, manifest_path: Path, parameter_resolution):
    context = {
        "out_dir": str(out_dir),
        "manifest_path": str(manifest_path),
        "skill_name": SPEC["skillName"],
        "paper_title": SPEC["paperTitle"]
    }

    for record in parameter_resolution["records"]:
        if record["value"] not in (None, "", []):
            context[record["name"]] = record["value"]

    commands = []
    for template in SPEC["executionContract"].get("command_templates", []):
        commands.append(template.format_map(SafeDict(context)))

    return commands


def evaluate_qc(input_validation, runtime, dry_run):
    statuses = []
    evaluated = []

    for rule in SPEC["qcContract"]["rules"]:
        status = "warn" if dry_run else "pass"
        note_en = rule["warnEn"] if dry_run else rule["passEn"]

        if input_validation["status"] == "fail":
            status = "fail"
            note_en = rule["failEn"]
        elif runtime["status"] == "fail" and rule.get("requires_runtime", False):
            status = "fail"
            note_en = rule["failEn"]

        statuses.append(status)
        evaluated.append({
            "metric": rule["metric"],
            "status": status,
            "note": note_en
        })

    overall = "pass"
    if "fail" in statuses:
        overall = "fail"
    elif "warn" in statuses:
        overall = "warn"

    return {
        "status": overall,
        "rules": evaluated
    }


def build_report(result):
    lines = [
        f"# {SPEC['displayName']} Report",
        "",
        "## Status",
        "",
        f"- {result['status']}",
        "",
        "## Paper",
        "",
        f"- {SPEC['paperTitle']}",
        f"- {SPEC['paperUrl']}",
        f"- {SPEC['githubUrl']}",
        "",
        "## Runtime Probe",
        "",
        f"- {result['runtime_probe']['status']}",
        "",
        "## Input Validation",
        "",
        f"- {result['input_validation']['status']}",
        "",
        "## Parameter Resolution",
        ""
    ]

    for record in result["parameter_resolution"]["records"]:
        lines.append(
            f"- {record['name']}: {record['status']} "
            f"({record.get('resolution_source')}; evidence={record.get('evidence_priority_class')})"
        )

    lines.extend(["", "## Workflow Summary", ""])
    for step in result.get("workflow_summary", {}).get("steps", []):
        lines.append(f"- {step['id']}: {step.get('evidence_priority_class')}")

    lines.extend(["", "## QC Summary", "", f"- {result['qc_summary']['status']}", "", "## Artifacts", ""])
    for artifact in result["artifacts"]:
        lines.append(f"- {artifact}")

    lines.extend(["", "## Caveats", ""])
    for caveat in result["caveats"]:
        lines.append(f"- {caveat}")

    return "\\n".join(lines) + "\\n"

def ensure_output_bundle(out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    for relative in SPEC["outputBundle"]["required_paths"]:
        target = out_dir / relative
        if target.suffix:
            target.parent.mkdir(parents=True, exist_ok=True)
        else:
            target.mkdir(parents=True, exist_ok=True)


def materialize_bundle(out_dir: Path, result, commands, manifest_path: Path):
    ensure_output_bundle(out_dir)

    write_text(out_dir / "README.md", ${readmeLiteral})
    write_json(out_dir / "result.json", result)
    write_text(out_dir / "report.md", build_report(result))
    write_json(out_dir / "effective_parameters.json", result["effective_parameters"])
    write_json(out_dir / "parameters" / "effective_parameters.json", result["effective_parameters"])
    write_json(out_dir / "parameters" / "resolved_parameters.json", result["parameter_resolution"])
    write_json(out_dir / "qc" / "input_validation.json", result["input_validation"])
    write_json(out_dir / "qc" / "runtime_probe.json", result["runtime_probe"])
    write_json(out_dir / "qc" / "qc_summary.json", result["qc_summary"])
    write_json(out_dir / "reproducibility" / "dependency_preflight.json", result["preflight"])
    write_json(out_dir / "workflow" / "steps.json", result["workflow_summary"]["steps"])
    write_json(out_dir / "workflow" / "dag_edges.json", result["workflow_summary"]["dag_edges"])
    write_json(out_dir / "reproducibility" / "execution_plan.json", {
        "generated_at": now_iso(),
        "manifest_path": str(manifest_path),
        "commands": commands,
        "runtime_probe": result["runtime_probe"],
        "effective_parameters": result["effective_parameters"],
        "parameter_resolution": result["parameter_resolution"],
        "workflow_summary": result["workflow_summary"]
    })
    write_json(out_dir / "reproducibility" / "plan.json", {
        "generated_at": now_iso(),
        "skill_name": result["skill_name"],
        "manifest_path": str(manifest_path),
        "runtime_probe": result["runtime_probe"],
        "input_validation": result["input_validation"],
        "effective_parameters": result["effective_parameters"],
        "parameter_resolution": result["parameter_resolution"],
        "workflow_summary": result["workflow_summary"],
        "evidence_summary": result["evidence_summary"],
        "commands": commands
    })
    write_json(out_dir / "reproducibility" / "evidence_summary.json", result["evidence_summary"])
    write_text(out_dir / "logs" / "command.log", "\\n".join(commands) + ("\\n" if commands else ""))


def run_native_commands(commands, out_dir: Path):
    if not commands:
        return []

    results = []
    for command in commands:
        completed = subprocess.run(
            command,
            shell=True,
            cwd=out_dir,
            capture_output=True,
            text=True
        )
        results.append({
            "command": command,
            "returncode": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr
        })
        if completed.returncode != 0:
            break
    return results


def command_plan(args):
    manifest, manifest_path, base_dir = load_input_manifest(args.input)
    config = load_config(args.config)
    runtime = runtime_probe()
    input_validation = validate_input_contract(manifest, base_dir)
    effective_parameters = resolve_effective_parameters(args, manifest, config, runtime)
    preflight = build_preflight(runtime, effective_parameters)
    parameter_resolution = effective_parameters["legacy_parameter_resolution"]
    workflow = workflow_summary()
    evidence = evidence_summary(parameter_resolution)
    commands = render_command_templates(Path(args.out), manifest_path, parameter_resolution) if args.out else []
    payload = {
        "generated_at": now_iso(),
        "skill_name": SPEC["skillName"],
        "runtime_probe": runtime,
        "preflight": preflight,
        "input_validation": input_validation,
        "effective_parameters": effective_parameters,
        "parameter_resolution": parameter_resolution,
        "workflow_summary": workflow,
        "evidence_summary": evidence,
        "commands": commands
    }
    if args.out:
        out_dir = Path(args.out)
        ensure_output_bundle(out_dir)
        write_json(out_dir / "reproducibility" / "plan.json", payload)
        write_json(out_dir / "workflow" / "steps.json", workflow["steps"])
        write_json(out_dir / "workflow" / "dag_edges.json", workflow["dag_edges"])
        write_json(out_dir / "effective_parameters.json", effective_parameters)
        write_json(out_dir / "parameters" / "effective_parameters.json", effective_parameters)
        write_json(out_dir / "parameters" / "resolved_parameters.json", parameter_resolution)
        write_json(out_dir / "reproducibility" / "evidence_summary.json", evidence)
        write_json(out_dir / "reproducibility" / "dependency_preflight.json", preflight)
    print(json_dump(payload))
    return 0


def command_run(args):
    manifest, manifest_path, base_dir = load_input_manifest(args.input)
    config = load_config(args.config)
    runtime = runtime_probe()
    input_validation = validate_input_contract(manifest, base_dir)
    effective_parameters = resolve_effective_parameters(args, manifest, config, runtime)
    preflight = build_preflight(runtime, effective_parameters)
    parameter_resolution = effective_parameters["legacy_parameter_resolution"]
    workflow = workflow_summary()
    evidence = evidence_summary(parameter_resolution)
    out_dir = Path(args.out)
    commands = render_command_templates(out_dir, manifest_path, parameter_resolution)
    dry_run = bool(effective_parameters["effective_parameters"].get("dry_run"))

    if input_validation["status"] == "fail" or parameter_resolution["status"] == "fail":
        status = "invalid_input_contract"
    elif dry_run:
        status = "dry_run_ready"
    elif runtime["status"] == "fail":
        status = "blocked_runtime_missing"
    elif preflight["package_probe"]["status"] == "fail":
        status = "blocked_dependencies_missing"
    elif not SPEC["executionContract"].get("supports_native_run", False):
        status = "native_execution_not_enabled"
    else:
        status = "running"

    qc_summary = evaluate_qc(input_validation, runtime, dry_run or status != "running")

    result = {
        "status": status,
        "skill_name": SPEC["skillName"],
        "paper_title": SPEC["paperTitle"],
        "runtime_probe": runtime,
        "preflight": preflight,
        "input_validation": input_validation,
        "effective_parameters": effective_parameters,
        "parameter_resolution": parameter_resolution,
        "workflow_summary": workflow,
        "evidence_summary": evidence,
        "qc_summary": qc_summary,
        "artifacts": SPEC["outputBundle"]["required_paths"],
        "caveats": [
            item["conditionEn"]
            for item in SPEC["failureModes"]
        ],
        "citations_used": [item["label"] for item in SPEC["citations"]],
        "generated_at": now_iso()
    }

    native_results = []
    if status == "running":
        native_results = run_native_commands(commands, out_dir)
        failed = next((item for item in native_results if item["returncode"] != 0), None)
        result["native_execution"] = native_results
        result["status"] = "native_execution_failed" if failed else "completed"

    materialize_bundle(out_dir, result, commands, manifest_path)
    print(json_dump(result))
    return 0 if result["status"] not in {"invalid_input_contract", "blocked_runtime_missing", "blocked_dependencies_missing", "native_execution_failed"} else 1


def command_validate_output(args):
    out_dir = Path(args.out)
    missing = []

    for relative in SPEC["outputBundle"]["required_paths"]:
        target = out_dir / relative
        if not target.exists():
            missing.append(relative)

    result_path = out_dir / "result.json"
    result = load_mapping_file(result_path) if result_path.exists() else {}
    missing_fields = [
        field for field in SPEC["outputBundle"].get("result_fields", [])
        if field not in result
    ]
    strict_errors = []
    if args.strict:
        for relative in [
            "effective_parameters.json",
            "parameters/effective_parameters.json",
            "parameters/resolved_parameters.json",
            "qc/input_validation.json",
            "qc/runtime_probe.json",
            "qc/qc_summary.json",
            "workflow/steps.json",
            "workflow/dag_edges.json",
            "reproducibility/execution_plan.json",
            "reproducibility/dependency_preflight.json",
            "reproducibility/evidence_summary.json"
        ]:
            target = out_dir / relative
            if not target.exists():
                strict_errors.append(f"missing strict artifact: {relative}")
                continue
            try:
                load_mapping_file(target)
            except Exception as exc:
                strict_errors.append(f"invalid json artifact {relative}: {exc}")

        if result:
            if not result.get("workflow_summary", {}).get("steps"):
                strict_errors.append("result.workflow_summary.steps is empty")
            if not result.get("workflow_summary", {}).get("dag_edges"):
                strict_errors.append("result.workflow_summary.dag_edges is empty")
            if not result.get("evidence_summary", {}).get("dag_edge_priorities"):
                strict_errors.append("result.evidence_summary.dag_edge_priorities is empty")
            if result.get("parameter_resolution", {}).get("status") not in {"pass", "warn"}:
                strict_errors.append("result.parameter_resolution.status is not pass or warn")
    payload = {
        "status": "pass" if not missing and not missing_fields and not strict_errors else "fail",
        "missing_paths": missing,
        "missing_result_fields": missing_fields,
        "strict_errors": strict_errors,
        "result_status": result.get("status")
    }
    print(json_dump(payload))
    return 0 if not missing and not missing_fields and not strict_errors else 1


def command_report(args):
    out_dir = Path(args.out)
    result = load_mapping_file(out_dir / "result.json")
    report = build_report(result)
    write_text(out_dir / "report.md", report)
    print(json_dump({"status": "pass", "report": str(out_dir / "report.md")}))
    return 0


def add_parameter_argument(parser, name: str, spec):
    flag = spec.get("cli_flag", "--" + name.replace("_", "-"))
    parameter_type = spec.get("type", "string")
    help_text = spec.get("description", "")
    if parameter_type == "boolean":
        parser.add_argument(flag, dest=name, nargs="?", const=True, default=None, help=help_text)
    elif parameter_type == "integer":
        parser.add_argument(flag, dest=name, type=int, default=None, help=help_text)
    elif parameter_type == "float":
        parser.add_argument(flag, dest=name, type=float, default=None, help=help_text)
    elif parameter_type.startswith("list["):
        parser.add_argument(flag, dest=name, nargs="+", default=None, help=help_text)
    else:
        parser.add_argument(flag, dest=name, default=None, help=help_text)


def add_schema_parameter_arguments(parser):
    specs, _groups = collect_parameter_specs()
    skip = {"input", "out", "config", "dry_run", "resume"}
    for name, spec in specs.items():
        if name in skip:
            continue
        add_parameter_argument(parser, name, spec)


def build_parser():
    parser = argparse.ArgumentParser(description=SPEC["displayName"])
    subparsers = parser.add_subparsers(dest="command", required=True)

    for name in ("plan", "run"):
        sub = subparsers.add_parser(name)
        sub.add_argument("--input", required=True)
        sub.add_argument("--out", required=(name == "run"))
        sub.add_argument("--config")
        sub.add_argument("--validate-only", action="store_true")
        sub.add_argument("--dry-run", action="store_true", default=None)
        sub.add_argument("--resume", action="store_true", default=None)
        sub.add_argument("--extra-flag", action="append", default=[])
        add_schema_parameter_arguments(sub)

    validate = subparsers.add_parser("validate-output")
    validate.add_argument("--out", required=True)
    validate.add_argument("--strict", action="store_true")

    report = subparsers.add_parser("report")
    report.add_argument("--out", required=True)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    try:
        if args.command == "plan":
            return command_plan(args)
        if args.command == "run":
            return command_run(args)
        if args.command == "validate-output":
            return command_validate_output(args)
        if args.command == "report":
            return command_report(args)
        parser.error("Unsupported command")
    except Exception as exc:  # pragma: no cover
        sys.stderr.write(json_dump({
            "status": "error",
            "message": str(exc)
        }) + "\\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
`;
}

function buildChildTest(spec, skillName) {
  const moduleName = pythonModuleName(skillName);
  const wrapperName = `${moduleName}.py`;
  const schema = buildParameterSchemaObject(spec);
  const firstUserParam = Object.entries(schema.workflow_params).find(([, item]) => item.required && !(item.choices || []).length)
    || Object.entries(schema.workflow_params)[0]
    || [null, null];
  const choiceParam = Object.entries(schema.workflow_params).find(([, item]) => (item.choices || []).length > 0)
    || firstUserParam;
  const forcedMissingRuntime = (spec.executionContract.runtime_targets || [])
    .find((target) => target.required && target.name !== "python")?.executable
    || (spec.executionContract.runtime_targets || []).find((target) => target.required)?.name
    || "python";
  return `import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "${wrapperName}"
DEMO_INPUT = ROOT / "examples" / "demo_input" / "input_manifest.json"
USER_PARAM_NAME = ${JSON.stringify(firstUserParam[0])}
USER_PARAM_FLAG = ${JSON.stringify(firstUserParam[1]?.cli_flag || null)}
CHOICE_PARAM_NAME = ${JSON.stringify(choiceParam[0])}
CHOICE_PARAM_FLAG = ${JSON.stringify(choiceParam[1]?.cli_flag || null)}


class ${moduleName}ContractTests(unittest.TestCase):
    maxDiff = None

    def run_cmd(self, *args, env=None):
        command = [sys.executable, str(WRAPPER), *args]
        completed = subprocess.run(command, capture_output=True, text=True, env=env)
        return completed

    def test_plan_accepts_demo_manifest(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            completed = self.run_cmd("plan", "--input", str(DEMO_INPUT), "--out", tmp_dir)
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            payload = json.loads(completed.stdout)
            self.assertIn(payload["input_validation"]["status"], {"pass", "warn"})
            self.assertTrue(payload["workflow_summary"]["steps"])
            self.assertTrue((Path(tmp_dir) / "reproducibility" / "plan.json").exists())
            self.assertTrue((Path(tmp_dir) / "workflow" / "steps.json").exists())

    def test_run_dry_run_creates_required_bundle(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            completed = self.run_cmd("run", "--input", str(DEMO_INPUT), "--out", tmp_dir, "--dry-run")
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            payload = json.loads(completed.stdout)
            self.assertIn("workflow_summary", payload)
            self.assertIn("evidence_summary", payload)
            self.assertTrue(payload["workflow_summary"]["steps"])
            self.assertTrue(payload["workflow_summary"]["dag_edges"])
            for relative in ${JSON.stringify(spec.outputBundle.required_paths)}:
                self.assertTrue((Path(tmp_dir) / relative).exists(), relative)
            resolved = json.loads((Path(tmp_dir) / "parameters" / "resolved_parameters.json").read_text(encoding="utf-8"))
            effective = json.loads((Path(tmp_dir) / "effective_parameters.json").read_text(encoding="utf-8"))
            nested_effective = json.loads((Path(tmp_dir) / "parameters" / "effective_parameters.json").read_text(encoding="utf-8"))
            evidence = json.loads((Path(tmp_dir) / "reproducibility" / "evidence_summary.json").read_text(encoding="utf-8"))
            workflow_steps = json.loads((Path(tmp_dir) / "workflow" / "steps.json").read_text(encoding="utf-8"))
            self.assertEqual(resolved["status"], payload["parameter_resolution"]["status"])
            self.assertEqual(effective["effective_parameters"], payload["effective_parameters"]["effective_parameters"])
            self.assertEqual(nested_effective["parameter_sources"], payload["effective_parameters"]["parameter_sources"])
            self.assertTrue(evidence["workflow_step_priorities"])
            self.assertEqual(workflow_steps[0]["id"], payload["workflow_summary"]["steps"][0]["id"])
            validation = self.run_cmd("validate-output", "--out", tmp_dir, "--strict")
            self.assertEqual(validation.returncode, 0, msg=validation.stderr)
            validation_payload = json.loads(validation.stdout)
            self.assertEqual(validation_payload["status"], "pass")
            self.assertEqual(validation_payload["strict_errors"], [])

    def test_schema_cli_overrides_manifest_and_config(self):
        if not USER_PARAM_NAME or not USER_PARAM_FLAG:
            self.skipTest("Generated skill has no workflow parameter to override.")
        with tempfile.TemporaryDirectory() as tmp_dir:
            config_path = Path(tmp_dir) / "override.json"
            config_path.write_text(json.dumps({"analysis": {USER_PARAM_NAME: "MYC"}}), encoding="utf-8")
            completed = self.run_cmd(
                "plan",
                "--input",
                str(DEMO_INPUT),
                "--out",
                tmp_dir,
                "--config",
                str(config_path),
                USER_PARAM_FLAG,
                "TP53"
            )
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            payload = json.loads(completed.stdout)
            effective = payload["effective_parameters"]
            self.assertEqual(effective["effective_parameters"][USER_PARAM_NAME], "TP53")
            self.assertEqual(effective["parameter_sources"][USER_PARAM_NAME], "user_cli")

    def test_schema_config_overrides_manifest(self):
        if not USER_PARAM_NAME:
            self.skipTest("Generated skill has no workflow parameter to override.")
        with tempfile.TemporaryDirectory() as tmp_dir:
            config_path = Path(tmp_dir) / "override.json"
            config_path.write_text(json.dumps({"analysis": {USER_PARAM_NAME: "MYC"}}), encoding="utf-8")
            completed = self.run_cmd("plan", "--input", str(DEMO_INPUT), "--out", tmp_dir, "--config", str(config_path))
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            payload = json.loads(completed.stdout)
            effective = payload["effective_parameters"]
            self.assertEqual(effective["effective_parameters"][USER_PARAM_NAME], "MYC")
            self.assertEqual(effective["parameter_sources"][USER_PARAM_NAME], "user_config")

    def test_schema_invalid_choice_fails_with_parameter_message(self):
        if not CHOICE_PARAM_NAME or not CHOICE_PARAM_FLAG:
            self.skipTest("Generated skill has no choice-backed parameter.")
        with tempfile.TemporaryDirectory() as tmp_dir:
            completed = self.run_cmd("plan", "--input", str(DEMO_INPUT), "--out", tmp_dir, CHOICE_PARAM_FLAG, "invalid_mode")
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("Invalid parameter", completed.stderr)
            self.assertIn(CHOICE_PARAM_NAME, completed.stderr)

    def test_validate_output_detects_missing_artifact(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            completed = self.run_cmd("run", "--input", str(DEMO_INPUT), "--out", tmp_dir, "--dry-run")
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            os.remove(Path(tmp_dir) / "report.md")
            validation = self.run_cmd("validate-output", "--out", tmp_dir)
            self.assertNotEqual(validation.returncode, 0)
            payload = json.loads(validation.stdout)
            self.assertIn("report.md", payload["missing_paths"])

    def test_validate_output_strict_detects_invalid_json_artifact(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            completed = self.run_cmd("run", "--input", str(DEMO_INPUT), "--out", tmp_dir, "--dry-run")
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            (Path(tmp_dir) / "workflow" / "steps.json").write_text("not-json", encoding="utf-8")
            validation = self.run_cmd("validate-output", "--out", tmp_dir, "--strict")
            self.assertNotEqual(validation.returncode, 0)
            payload = json.loads(validation.stdout)
            self.assertTrue(payload["strict_errors"])

    def test_report_rebuilds_markdown(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            completed = self.run_cmd("run", "--input", str(DEMO_INPUT), "--out", tmp_dir, "--dry-run")
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            os.remove(Path(tmp_dir) / "report.md")
            report = self.run_cmd("report", "--out", tmp_dir)
            self.assertEqual(report.returncode, 0, msg=report.stderr)
            self.assertTrue((Path(tmp_dir) / "report.md").exists())

    def test_missing_runtime_returns_structured_status(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            env = os.environ.copy()
            env["CODEX_FORCE_MISSING_EXECUTABLES"] = ${JSON.stringify(forcedMissingRuntime)}
            completed = self.run_cmd("run", "--input", str(DEMO_INPUT), "--out", tmp_dir, env=env)
            self.assertNotEqual(completed.returncode, 0)
            payload = json.loads(completed.stdout)
            self.assertEqual(payload["status"], "blocked_runtime_missing")


if __name__ == "__main__":
    unittest.main()
`;
}

function buildReadmeForExamples(spec) {
  return `# Demo Input

- ${spec.paperTitle}
- This manifest is intentionally lightweight and validates contract structure rather than full scientific execution.
`;
}

async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readSpec(args) {
  if (args["spec-json"]) {
    return JSON.parse(args["spec-json"].replace(/^\uFEFF/, ""));
  }

  if (args["spec-file"]) {
    const raw = await fs.readFile(args["spec-file"], "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  }

  fail("Provide either --spec-file or --spec-json.");
}

function requirePath(object, dottedPath) {
  const value = dottedPath.split(".").reduce((current, part) => (
    current && Object.prototype.hasOwnProperty.call(current, part) ? current[part] : undefined
  ), object);
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
    fail(`Missing required spec field: ${dottedPath}`);
  }
}

function validateSpec(spec) {
  [
    "skillName",
    "displayName",
    "paperTitle",
    "paperUrl",
    "githubUrl",
    "metadata.domain",
    "metadata.analysis_type",
    "metadata.primary_tool",
    "metadata.tool_runtime",
    "metadata.dependencies",
    "metadata.trigger_keywords",
    "metadata.allowed_extra_flags",
    "metadata.legacy_aliases",
    "metadata.param_hints",
    "routing.why_this_exists",
    "routing.when_to_use",
    "routing.when_not_to_use",
    "routing.route_elsewhere",
    "inputContract.formats",
    "inputContract.required_manifest_fields",
    "inputContract.file_fields",
    "inputContract.state_requirements",
    "parameterPolicy.required_user_decisions",
    "parameterPolicy.user_required",
    "parameterPolicy.auto_detected",
    "parameterPolicy.literature_defaults",
    "parameterPolicy.wrapper_defaults",
    "parameterPolicy.decision_rules",
    "executionContract.runtime_targets",
    "executionContract.workflow_steps",
    "executionContract.required_outputs",
    "qcContract.rules",
    "qcContract.validation_scenarios",
    "qcContract.interpretation_boundary",
    "outputBundle.required_paths",
    "outputBundle.result_fields",
    "reproducibilityContract.capture_items",
    "reproducibilityContract.install_policy",
    "testContract.demo_input_manifest",
    "testContract.expected_status",
    "references.methods",
    "references.papers",
    "failureModes",
    "citations"
  ].forEach((item) => requirePath(spec, item));
}

async function writeFile(target, content) {
  await ensureDir(path.dirname(target));
  await fs.writeFile(target, content, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const spec = await readSpec(args);
  validateSpec(spec);

  const skillName = slugify(spec.skillName);
  if (!skillName) {
    fail("skillName produced an empty slug.");
  }

  const domain = slugify(spec.metadata.domain);
  if (!domain) {
    fail("metadata.domain produced an empty slug.");
  }
  const moduleName = pythonModuleName(skillName);

  const outRoot = args["out-root"] || path.resolve(process.cwd(), "generated-paper-workflows");
  const targetDir = path.join(outRoot, domain, skillName);
  if (await pathExists(targetDir)) {
    if (!args.force) {
      fail(`Target skill already exists: ${targetDir}. Re-run with --force to overwrite.`);
    }

    await fs.rm(targetDir, { recursive: true, force: true });
  }

  await ensureDir(path.join(targetDir, "agents"));
  await ensureDir(path.join(targetDir, "tests"));
  await ensureDir(path.join(targetDir, "references"));
  await ensureDir(path.join(targetDir, "examples", "demo_input"));
  await ensureDir(path.join(targetDir, "examples", "expected_output"));
  await ensureDir(path.join(targetDir, "knowledge"));
  await ensureDir(path.join(targetDir, "configs"));
  await ensureDir(path.join(targetDir, "config"));
  await ensureDir(path.join(targetDir, "schemas"));
  await ensureDir(path.join(targetDir, "scripts"));
  await ensureDir(path.join(targetDir, "reports"));

  await writeFile(path.join(targetDir, "SKILL.md"), buildSkillMarkdown(spec, skillName));
  await writeFile(path.join(targetDir, "algorithm_classification.yaml"), buildAlgorithmClassificationYaml(spec));
  await writeFile(path.join(targetDir, "skill.yaml"), buildSkillYaml(spec, skillName));
  await writeFile(path.join(targetDir, "workflow.yaml"), buildWorkflowYaml(spec));
  await writeFile(path.join(targetDir, "schemas", "parameter_schema.yaml"), buildParameterSchemaYaml(spec));
  await writeFile(path.join(targetDir, "config_schema.yaml"), buildConfigSchemaYaml(spec));
  await writeFile(path.join(targetDir, "config", "default.yaml"), buildDefaultConfigYaml(spec));
  await writeFile(path.join(targetDir, "configs", "default.yaml"), buildDefaultConfigYaml(spec));
  await writeFile(path.join(targetDir, "configs", "demo.yaml"), buildDemoConfigYaml(spec));
  await writeFile(path.join(targetDir, "agents", "openai.yaml"), buildOpenAiYaml(spec, skillName));
  await writeFile(path.join(targetDir, `${moduleName}.py`), buildPythonOrchestrator(spec, skillName));
  await writeFile(path.join(targetDir, "tests", `test_${moduleName}.py`), buildChildTest(spec, skillName));
  await writeFile(path.join(targetDir, "references", "methods.md"), buildMethodsReference(spec));
  await writeFile(path.join(targetDir, "references", "papers.md"), buildPapersReference(spec));
  await writeFile(path.join(targetDir, "evidence_report.md"), buildEvidenceReport(spec));
  await writeFile(path.join(targetDir, "knowledge", "guardrails.md"), renderGuardrails(spec));
  await writeFile(path.join(targetDir, "knowledge", "troubleshooting.md"), renderTroubleshooting(spec));
  await writeFile(path.join(targetDir, "reports", "report_template.md"), buildReportTemplate(spec));
  for (const step of spec.executionContract.workflow_steps) {
    if (step.script) {
      await writeFile(path.join(targetDir, ...step.script.split(/[\\/]+/)), buildStepScript(step, spec));
    }
  }
  await writeFile(path.join(targetDir, "examples", "demo_input", "README.md"), buildReadmeForExamples(spec));
  await writeFile(path.join(targetDir, "examples", "demo_input", "input_manifest.json"), buildDemoManifest(spec));
  for (const [relativePath, content] of Object.entries(buildDemoFiles(spec))) {
    await writeFile(
      path.join(targetDir, "examples", "demo_input", ...relativePath.split(/[\\/]+/)),
      String(content)
    );
  }
  await writeFile(path.join(targetDir, "examples", "expected_output", "README.md"), buildReadmeArtifact(spec, skillName));
  await writeFile(path.join(targetDir, "examples", "expected_output", "report.md"), buildExpectedReport(spec));
  await writeFile(path.join(targetDir, "examples", "expected_output", "result.json"), buildExpectedResultJson(spec, skillName));

  process.stdout.write(`${targetDir}\n`);
}

main().catch((error) => {
  fail(error.stack || error.message);
});
