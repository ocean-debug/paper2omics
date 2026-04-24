#!/usr/bin/env node

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 20 * 1024 * 1024;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
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

function scriptPath(name) {
  return path.join(__dirname, name);
}

async function pathExists(target) {
  return Boolean(await fs.stat(target).catch(() => null));
}

async function runNodeScript(scriptName, args) {
  return execFileAsync(process.execPath, [scriptPath(scriptName), ...args], {
    maxBuffer: MAX_BUFFER,
    env: process.env
  });
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function getNested(data, dottedPath) {
  return dottedPath.split(".").reduce((current, part) => {
    if (current && Object.prototype.hasOwnProperty.call(current, part)) {
      return current[part];
    }
    return undefined;
  }, data);
}

function summarizeValue(value) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value ?? "");
}

function contractDiff(oldSpec, newSpec) {
  const paths = [
    "skillName",
    "metadata.domain",
    "metadata.analysis_type",
    "metadata.tool_runtime",
    "algorithmClassification.classification.primary_task",
    "algorithmClassification.implementation.languages",
    "algorithmClassification.implementation.execution_modes",
    "algorithmClassification.implementation.workflow_engines",
    "executionContract.supports_native_run",
    "executionContract.native_run_status.status"
  ];
  const changes = [];
  for (const dottedPath of paths) {
    const before = getNested(oldSpec, dottedPath);
    const after = getNested(newSpec, dottedPath);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes.push({
        path: dottedPath,
        before,
        after
      });
    }
  }

  const oldSteps = (oldSpec.executionContract?.workflow_steps || []).map((step) => step.id || step.name);
  const newSteps = (newSpec.executionContract?.workflow_steps || []).map((step) => step.id || step.name);
  const addedSteps = newSteps.filter((step) => !oldSteps.includes(step));
  const removedSteps = oldSteps.filter((step) => !newSteps.includes(step));
  if (addedSteps.length > 0 || removedSteps.length > 0) {
    changes.push({
      path: "executionContract.workflow_steps",
      before: oldSteps,
      after: newSteps,
      added: addedSteps,
      removed: removedSteps
    });
  }

  return changes;
}

function validateContractSchema(spec) {
  const requiredPaths = [
    "schema_version",
    "skillName",
    "algorithmClassification.classification.primary_task",
    "algorithmClassification.implementation.execution_modes",
    "parameterPolicy.evidence_priority",
    "executionContract.workflow_steps",
    "executionContract.dag_edges",
    "executionContract.runtime_adapters",
    "evidenceSchema.required_fields"
  ];
  const missing = requiredPaths.filter((dottedPath) => {
    const value = getNested(spec, dottedPath);
    return value === undefined || value === null || (Array.isArray(value) && value.length === 0);
  });
  const traceableItems = [
    ...(spec.parameterPolicy?.user_required || []),
    ...(spec.parameterPolicy?.auto_detected || []),
    ...(spec.parameterPolicy?.literature_defaults || []),
    ...(spec.parameterPolicy?.wrapper_defaults || []),
    ...(spec.executionContract?.workflow_steps || []),
    ...(spec.executionContract?.dag_edges || [])
  ];
  const missingEvidenceIds = traceableItems.filter((item) => !item.evidence_id);
  return { missing, missingEvidenceIds };
}

async function build(args) {
  const workDir = args["work-dir"]
    ? path.resolve(args["work-dir"])
    : await fs.mkdtemp(path.join(os.tmpdir(), "paper2omics-"));
  await fs.mkdir(workDir, { recursive: true });

  const repoEvidenceFile = args["evidence-file"]
    ? path.resolve(args["evidence-file"])
    : path.join(workDir, "repo-evidence.json");
  const paperEvidenceFile = args["paper-evidence-file"]
    ? path.resolve(args["paper-evidence-file"])
    : path.join(workDir, "paper-evidence.json");
  const contractFile = args["contract-file"]
    ? path.resolve(args["contract-file"])
    : path.join(workDir, "contract.json");
  const outRoot = path.resolve(args["out-root"] || "generated-paper-workflows");

  if (!args["evidence-file"]) {
    if (!args["github-url"]) {
      fail("build requires --github-url unless --evidence-file is provided.");
    }
    const collectRepoArgs = ["--github-url", args["github-url"], "--out", repoEvidenceFile];
    if (args["local-path"]) {
      collectRepoArgs.push("--local-path", args["local-path"]);
    }
    if (args["token-env"]) {
      collectRepoArgs.push("--token-env", args["token-env"]);
    }
    if (args["max-files"]) {
      collectRepoArgs.push("--max-files", args["max-files"]);
    }
    if (args["max-preview-chars"]) {
      collectRepoArgs.push("--max-preview-chars", args["max-preview-chars"]);
    }
    await runNodeScript("collect-repo-evidence.js", collectRepoArgs);
  }

  if (!args["paper-evidence-file"]) {
    const hasPaperSource = args["paper-title"] || args["article-url"] || args["article-file"] || args["pdf-path"];
    if (!hasPaperSource) {
      fail("build requires one paper source: --paper-title, --article-url, --article-file, --pdf-path, or --paper-evidence-file.");
    }
    const collectPaperArgs = ["--out", paperEvidenceFile];
    for (const key of ["paper-title", "paper-url", "article-url", "article-file", "pdf-path", "max-text-chars", "snippet-chars"]) {
      if (args[key]) {
        collectPaperArgs.push(`--${key}`, args[key]);
      }
    }
    await runNodeScript("collect-paper-evidence.js", collectPaperArgs);
  }

  const buildArgs = [
    "--evidence-file",
    repoEvidenceFile,
    "--paper-evidence-file",
    paperEvidenceFile,
    "--out",
    contractFile
  ];
  for (const key of ["paper-title", "paper-url", "github-url", "domain", "analysis-type", "tool-runtime", "primary-tool", "skill-name", "display-name", "preferred-language", "version", "author"]) {
    if (args[key]) {
      buildArgs.push(`--${key}`, args[key]);
    }
  }
  await runNodeScript("build-contract-spec.js", buildArgs);

  const scaffoldArgs = ["--spec-file", contractFile, "--out-root", outRoot];
  if (args.force) {
    scaffoldArgs.push("--force");
  }
  const scaffold = await runNodeScript("scaffold-paper-skill.js", scaffoldArgs);
  const skillDir = scaffold.stdout.trim();
  process.stdout.write(`${skillDir}\n`);
}

async function diff(args) {
  const oldContract = args["old-contract"];
  const newContract = args["new-contract"];
  if (!oldContract || !newContract) {
    fail("diff requires --old-contract <path> and --new-contract <path>.");
  }
  const oldSpec = await readJson(path.resolve(oldContract));
  const newSpec = await readJson(path.resolve(newContract));
  const changes = contractDiff(oldSpec, newSpec);
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ status: "pass", changes }, null, 2)}\n`);
    return;
  }
  if (changes.length === 0) {
    process.stdout.write("No contract-surface changes detected.\n");
    return;
  }
  for (const change of changes) {
    process.stdout.write(`- ${change.path}: ${summarizeValue(change.before)} -> ${summarizeValue(change.after)}\n`);
  }
}

async function schema(args) {
  const contract = args.contract || args["contract-file"] || args._[1];
  if (!contract) {
    fail("schema requires --contract <contract.json>.");
  }
  const spec = await readJson(path.resolve(contract));
  const result = validateContractSchema(spec);
  if (result.missing.length > 0 || result.missingEvidenceIds.length > 0) {
    fail(`Schema validation failed. Missing paths: ${result.missing.join(", ") || "none"}; missing evidence_id count: ${result.missingEvidenceIds.length}`);
  }
  process.stdout.write(`schema validated ${path.resolve(contract)}\n`);
}

async function requireFile(root, relativePath) {
  const target = path.join(root, ...relativePath.split(/[\\/]+/));
  if (!(await pathExists(target))) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
  const stat = await fs.stat(target);
  if (!stat.isFile()) {
    throw new Error(`Required path is not a file: ${relativePath}`);
  }
  return target;
}

async function validate(args) {
  const skillDir = path.resolve(args["skill-dir"] || args._[1] || "");
  if (!skillDir || skillDir === path.resolve("")) {
    fail("validate requires --skill-dir <generated-skill-dir>.");
  }
  const requiredFiles = [
    "SKILL.md",
    "algorithm_classification.yaml",
    "skill.yaml",
    "workflow.yaml",
    "config_schema.yaml",
    "configs/default.yaml",
    "configs/demo.yaml",
    "evidence_report.md"
  ];

  for (const relativePath of requiredFiles) {
    await requireFile(skillDir, relativePath);
  }

  const reportPath = await requireFile(skillDir, "evidence_report.md");
  const evidenceReport = await fs.readFile(reportPath, "utf8");
  const requiredReportMarkers = [
    "Each item uses the same fields: Claim, Evidence ID, Value, Status, Priority, and Sources.",
    "- Claim:",
    "  - Evidence ID:",
    "  - Value:",
    "  - Status:",
    "  - Priority:",
    "  - Sources:",
    "## Evidence Priority",
    "## Classification Evidence",
    "### Perturbation Facets",
    "target_type",
    "action",
    "modeling_mechanism",
    "output_interpretation",
    "## Parameter Evidence",
    "## Workflow Step Evidence",
    "## DAG Edge Evidence"
  ];
  for (const marker of requiredReportMarkers) {
    if (!evidenceReport.includes(marker)) {
      throw new Error(`evidence_report.md is missing marker: ${marker}`);
    }
  }

  const workflowYaml = await fs.readFile(await requireFile(skillDir, "workflow.yaml"), "utf8");
  for (const marker of ["mining_priority:", "evidence_sources:", "evidence_priority_class:", "evidence_id:", "edges:", "manual_fallback_rule"]) {
    if (!workflowYaml.includes(marker)) {
      throw new Error(`workflow.yaml is missing marker: ${marker}`);
    }
  }

  process.stdout.write(`validated ${skillDir}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || args.command;

  if (command === "build") {
    await build(args);
    return;
  }
  if (command === "validate") {
    await validate(args);
    return;
  }
  if (command === "diff") {
    await diff(args);
    return;
  }
  if (command === "schema") {
    await schema(args);
    return;
  }

  fail("Usage: paper2omics-skill.js <build|validate|diff|schema> [options]");
}

main().catch((error) => {
  fail(error.stack || error.message);
});
