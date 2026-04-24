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

function renderTextPair(item) {
  return `${item.zh} / ${item.en}`;
}

function renderBulletList(items, mapper = renderTextPair) {
  return items.map((item) => `- ${mapper(item)}`).join("\n");
}

function renderNamedPairItems(items) {
  return items.map((item) => `- \`${item.name}\`: ${item.zh} / ${item.en}`).join("\n");
}

function renderParameterSection(title, items, formatter) {
  if (!items || items.length === 0) {
    return `### ${title}\n\n- None / 无`;
  }

  return `### ${title}\n\n${items.map((item) => formatter(item)).join("\n")}`;
}

function renderWorkflow(steps) {
  return steps.map((step, index) => {
    const evidence = (step.evidence || []).length > 0
      ? step.evidence.join("; ")
      : "未在论文或代码中确认 / Not confirmed in paper or code";
    const layer = step.layer ? `- Layer / 层级: ${step.layer}` : null;
    return [
      `### ${index + 1}. ${step.titleEn} / ${step.titleZh}`,
      "",
      `- ${step.detailsZh}`,
      `- ${step.detailsEn}`,
      layer,
      `- Evidence / 证据: ${evidence}`
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

function renderQcRules(rules) {
  return rules.map((rule) => [
    `### ${rule.metric}`,
    "",
    `- ${rule.zh}`,
    `- ${rule.en}`,
    `- Pass / 通过: ${rule.passZh} / ${rule.passEn}`,
    `- Warn / 警告: ${rule.warnZh} / ${rule.warnEn}`,
    `- Fail / 失败: ${rule.failZh} / ${rule.failEn}`
  ].join("\n")).join("\n\n");
}

function renderFailureModes(items) {
  return items.map((item) => [
    `### ${item.conditionEn} / ${item.conditionZh}`,
    "",
    `- Recovery / 恢复: ${item.recoveryZh} / ${item.recoveryEn}`
  ].join("\n")).join("\n\n");
}

function renderReferenceSections(sections) {
  return sections.map((section) => {
    const items = (section.items || []).map((item) => [
      `- [${item.label}](${item.url})`,
      `  ${item.noteZh} / ${item.noteEn}`
    ].join("\n")).join("\n");

    return `## ${section.title}\n\n${items}`;
  }).join("\n\n");
}

function renderCitations(citations) {
  return citations.map((citation) => {
    const note = citation.noteZh || citation.noteEn
      ? `: ${citation.noteZh || ""}${citation.noteZh && citation.noteEn ? " / " : ""}${citation.noteEn || ""}`
      : "";
    return `- [${citation.label}](${citation.url})${note}`;
  }).join("\n");
}

function renderGuardrails(spec) {
  const lines = [];

  for (const item of spec.routing.when_not_to_use) {
    lines.push(`- Do not use for: ${item.en} / ${item.zh}`);
  }

  lines.push("- Do not silently infer missing biological state. / 不要静默推断缺失的生物学状态。");
  lines.push("- Do not silently switch methods or runtimes. / 不要静默切换方法或运行时。");
  lines.push("- Do not treat warning-level QC as clean success. / 不要把警告级质控当成完全通过。");

  return `# Guardrails / 约束\n\n${lines.join("\n")}\n`;
}

function renderTroubleshooting(spec) {
  const lines = spec.failureModes.map((item) => [
    `## ${item.conditionEn} / ${item.conditionZh}`,
    "",
    `- ${item.recoveryZh}`,
    `- ${item.recoveryEn}`
  ].join("\n"));

  return `# Troubleshooting / 故障排查\n\n${lines.join("\n\n")}\n`;
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
  const dependencies = spec.metadata.dependencies.map((item) => `- ${item}`).join("\n");
  const citations = renderCitations(spec.citations);
  const resultFields = spec.outputBundle.result_fields.map((field) => `- \`${field}\``).join("\n");
  const requiredPaths = spec.outputBundle.required_paths.map((item) => `- \`${item}\``).join("\n");

  return `---
name: ${skillName}
description: ${yamlQuote(description)}
metadata: ${metadata}
---

# ${spec.displayName}

## Why This Exists

- ${spec.routing.why_this_exists.zh}
- ${spec.routing.why_this_exists.en}

## When to Use

${renderBulletList(spec.routing.when_to_use)}

## When Not to Use

${renderBulletList(spec.routing.when_not_to_use)}

## Route Elsewhere

${renderBulletList(spec.routing.route_elsewhere)}

## Input Formats

${spec.inputContract.formats.map((item) => `- \`${item.name}\`: ${item.zh} / ${item.en}`).join("\n")}

## Data / State Requirements

### Required manifest fields

${spec.inputContract.required_manifest_fields.map((item) => `- \`${item}\``).join("\n")}

### File-backed fields

${spec.inputContract.file_fields.map((item) => `- \`${item.path}\`: ${item.zh} / ${item.en}`).join("\n")}

### State requirements

${spec.inputContract.state_requirements.map((item) => {
    const expectation = item.equals
      ? `Expected / 期望: \`${item.equals}\``
      : item.one_of
        ? `Expected / 期望: one of ${item.one_of.map((value) => `\`${value}\``).join(", ")}`
        : "Expected / 期望: present";
    return `- \`${item.path}\`: ${item.zh} / ${item.en}. ${expectation}`;
  }).join("\n")}

## Required User Decisions

${renderBulletList(spec.parameterPolicy.required_user_decisions)}

## Default Parameter Rules

${renderParameterSection("User Required / 用户必须提供", spec.parameterPolicy.user_required, (item) =>
    `- \`${item.name}\`: ${item.description.zh} / ${item.description.en}. Sources / 来源: ${(item.sources || []).join(", ")}`
  )}

${renderParameterSection("Auto Detected / 自动探测", spec.parameterPolicy.auto_detected, (item) =>
    `- \`${item.name}\`: ${item.description.zh} / ${item.description.en}. Sources / 来源: ${(item.sources || []).join(", ")}${item.fallback_value !== undefined ? `. Fallback / 回退: \`${item.fallback_value}\`` : ""}`
  )}

${renderParameterSection("Literature Defaults / 文献默认值", spec.parameterPolicy.literature_defaults, (item) =>
    `- \`${item.name}\` = \`${item.value}\`: ${item.rationale.zh} / ${item.rationale.en}`
  )}

${renderParameterSection("Wrapper Defaults / Wrapper 默认值", spec.parameterPolicy.wrapper_defaults, (item) =>
    `- \`${item.name}\` = \`${item.value}\`: ${item.rationale.zh} / ${item.rationale.en}`
  )}

### Decision Rules / 决策规则

${spec.parameterPolicy.decision_rules.map((item) => `- ${item.titleZh} / ${item.titleEn}: ${item.detailsZh} / ${item.detailsEn}`).join("\n")}

## Workflow

${renderWorkflow(spec.executionContract.workflow_steps)}

## QC / Validation Rules

${renderQcRules(spec.qcContract.rules)}

### Validation scenarios / 验证场景

${renderBulletList(spec.qcContract.validation_scenarios)}

### Interpretation boundary / 解释边界

${spec.qcContract.interpretation_boundary.map((item) => `- \`${item.status}\`: ${item.zh} / ${item.en}`).join("\n")}

## Output Contract

### Required result paths / 必需结果路径

${requiredPaths}

### Required \`result.json\` fields

${resultFields}

### Bundle notes / 结果包说明

${renderBulletList(spec.outputBundle.bundle_notes)}

## Failure Modes and Recovery

${renderFailureModes(spec.failureModes)}

## Reproducibility Contract

### Capture items / 记录项

${renderBulletList(spec.reproducibilityContract.capture_items)}

### Install policy / 安装策略

${renderBulletList(spec.reproducibilityContract.install_policy)}

## Dependencies

${dependencies}

## Citations

${citations}
`;
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
  return `# Methods / 方法学参考

## Contract Summary / 合同摘要

- ${spec.routing.why_this_exists.zh}
- ${spec.routing.why_this_exists.en}

## Workflow Evidence / 流程证据

${renderWorkflow(spec.executionContract.workflow_steps)}

## Method References / 方法依据

${renderReferenceSections(spec.references.methods)}
`;
}

function buildPapersReference(spec) {
  const citations = renderCitations(spec.citations);
  return `# Papers and Sources / 论文与来源

## Primary paper / 主论文

- [${spec.paperTitle}](${spec.paperUrl})
- Repository / 仓库: [${spec.githubUrl}](${spec.githubUrl})

## Source Sections / 来源分组

${renderReferenceSections(spec.references.papers)}

## Citations / 引用

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
    caveats: spec.failureModes.map((item) => ({
      zh: item.conditionZh,
      en: item.conditionEn
    })),
    citations_used: spec.citations.map((item) => item.label)
  };
}

function buildExpectedReport(spec) {
  return `# ${spec.displayName} Report

## Status / 状态

- ${spec.testContract.expected_status}

## Paper / 论文

- ${spec.paperTitle}

## Bundle / 结果包

${spec.outputBundle.required_paths.map((item) => `- ${item}`).join("\n")}
`;
}

function buildDemoManifest(spec) {
  return JSON.stringify(spec.testContract.demo_input_manifest, null, 2);
}

function buildExpectedResultJson(spec, skillName) {
  return `${JSON.stringify(buildExpectedResult(spec, skillName), null, 2)}\n`;
}

function buildDemoFiles(spec) {
  return spec.testContract.demo_files || {};
}

function buildReadmeArtifact(spec, skillName) {
  return `# ${spec.displayName} Result Bundle

- Skill / 技能: ${skillName}
- Paper / 论文: ${spec.paperTitle}
- Result status / 结果状态: ${spec.testContract.expected_status}
`;
}

function buildPythonOrchestrator(spec, skillName) {
  const specJson = JSON.stringify(spec, null, 2);
  const readmeLiteral = pythonStringLiteral(buildReadmeArtifact(spec, skillName));
  return `#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
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
FORCED_MISSING = {
    item.strip()
    for item in os.environ.get("CODEX_FORCE_MISSING_EXECUTABLES", "").split(",")
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
            "description": {
                "zh": field["zh"],
                "en": field["en"]
            }
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
            "rule": {
                "zh": rule["zh"],
                "en": rule["en"]
            }
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

    def append_record(category, name, value, status, source, rationale):
        statuses.append(status)
        records.append({
            "category": category,
            "name": name,
            "value": value,
            "status": status,
            "source": source,
            "rationale": rationale
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
        append_record("user_required", entry["name"], value, status, source, entry["rationale"])

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
        append_record("auto_detected", entry["name"], value, status, source, entry["rationale"])

    for entry in SPEC["parameterPolicy"]["literature_defaults"]:
        config_value = get_nested(config, entry.get("config_path", f'parameters.{entry["name"]}'))
        value = entry["value"] if config_value in (None, "", []) else config_value
        source = "literature_default" if config_value in (None, "", []) else entry.get("config_path", f'parameters.{entry["name"]}')
        append_record("literature_defaults", entry["name"], value, "pass", source, entry["rationale"])

    for entry in SPEC["parameterPolicy"]["wrapper_defaults"]:
        config_value = get_nested(config, entry.get("config_path", f'parameters.{entry["name"]}'))
        value = entry["value"] if config_value in (None, "", []) else config_value
        source = "wrapper_default" if config_value in (None, "", []) else entry.get("config_path", f'parameters.{entry["name"]}')
        append_record("wrapper_defaults", entry["name"], value, "pass", source, entry["rationale"])

    overall = "pass"
    if "fail" in statuses:
        overall = "fail"
    elif "warn" in statuses:
        overall = "warn"

    return {
        "status": overall,
        "records": records
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
        note_zh = rule["warnZh"] if dry_run else rule["passZh"]
        note_en = rule["warnEn"] if dry_run else rule["passEn"]

        if input_validation["status"] == "fail":
            status = "fail"
            note_zh = rule["failZh"]
            note_en = rule["failEn"]
        elif runtime["status"] == "fail" and rule.get("requires_runtime", False):
            status = "fail"
            note_zh = rule["failZh"]
            note_en = rule["failEn"]

        statuses.append(status)
        evaluated.append({
            "metric": rule["metric"],
            "status": status,
            "zh": note_zh,
            "en": note_en
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
        "## Status / 状态",
        "",
        f"- {result['status']}",
        "",
        "## Paper / 论文",
        "",
        f"- {SPEC['paperTitle']}",
        f"- {SPEC['paperUrl']}",
        f"- {SPEC['githubUrl']}",
        "",
        "## Runtime Probe / 运行时探测",
        "",
        f"- {result['runtime_probe']['status']}",
        "",
        "## Input Validation / 输入验证",
        "",
        f"- {result['input_validation']['status']}",
        "",
        "## Parameter Resolution / 参数解析",
        ""
    ]

    for record in result["parameter_resolution"]["records"]:
        lines.append(f"- {record['name']}: {record['status']} ({record['source']})")

    lines.extend([
        "",
        "## QC Summary / 质控摘要",
        "",
        f"- {result['qc_summary']['status']}",
        "",
        "## Artifacts / 产物",
        ""
    ])

    for artifact in result["artifacts"]:
        lines.append(f"- {artifact}")

    lines.extend([
        "",
        "## Caveats / 注意事项",
        ""
    ])

    for caveat in result["caveats"]:
        lines.append(f"- {caveat['zh']} / {caveat['en']}")

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
    write_json(out_dir / "reproducibility" / "execution_plan.json", {
        "generated_at": now_iso(),
        "manifest_path": str(manifest_path),
        "commands": commands,
        "runtime_probe": result["runtime_probe"],
        "parameter_resolution": result["parameter_resolution"]
    })
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
    parameter_resolution = resolve_parameters(manifest, config, runtime)
    commands = render_command_templates(Path(args.out), manifest_path, parameter_resolution) if args.out else []
    payload = {
        "generated_at": now_iso(),
        "skill_name": SPEC["skillName"],
        "runtime_probe": runtime,
        "input_validation": input_validation,
        "parameter_resolution": parameter_resolution,
        "commands": commands
    }
    print(json_dump(payload))
    return 0


def command_run(args):
    manifest, manifest_path, base_dir = load_input_manifest(args.input)
    config = load_config(args.config)
    runtime = runtime_probe()
    input_validation = validate_input_contract(manifest, base_dir)
    parameter_resolution = resolve_parameters(manifest, config, runtime)
    out_dir = Path(args.out)
    commands = render_command_templates(out_dir, manifest_path, parameter_resolution)

    if input_validation["status"] == "fail" or parameter_resolution["status"] == "fail":
        status = "invalid_input_contract"
    elif args.dry_run:
        status = "dry_run_ready"
    elif runtime["status"] == "fail":
        status = "blocked_runtime_missing"
    elif not SPEC["executionContract"].get("supports_native_run", False):
        status = "native_execution_not_enabled"
    else:
        status = "running"

    qc_summary = evaluate_qc(input_validation, runtime, args.dry_run or status != "running")

    result = {
        "status": status,
        "skill_name": SPEC["skillName"],
        "paper_title": SPEC["paperTitle"],
        "runtime_probe": runtime,
        "input_validation": input_validation,
        "parameter_resolution": parameter_resolution,
        "qc_summary": qc_summary,
        "artifacts": SPEC["outputBundle"]["required_paths"],
        "caveats": [
            {"zh": item["conditionZh"], "en": item["conditionEn"]}
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
    return 0 if result["status"] not in {"invalid_input_contract", "blocked_runtime_missing", "native_execution_failed"} else 1


def command_validate_output(args):
    out_dir = Path(args.out)
    missing = []

    for relative in SPEC["outputBundle"]["required_paths"]:
        target = out_dir / relative
        if not target.exists():
            missing.append(relative)

    result_path = out_dir / "result.json"
    result = load_mapping_file(result_path) if result_path.exists() else {}
    payload = {
        "status": "pass" if not missing else "fail",
        "missing_paths": missing,
        "result_status": result.get("status")
    }
    print(json_dump(payload))
    return 0 if not missing else 1


def command_report(args):
    out_dir = Path(args.out)
    result = load_mapping_file(out_dir / "result.json")
    report = build_report(result)
    write_text(out_dir / "report.md", report)
    print(json_dump({"status": "pass", "report": str(out_dir / "report.md")}))
    return 0


def build_parser():
    parser = argparse.ArgumentParser(description=SPEC["displayName"])
    subparsers = parser.add_subparsers(dest="command", required=True)

    for name in ("plan", "run"):
        sub = subparsers.add_parser(name)
        sub.add_argument("--input", required=True)
        sub.add_argument("--out", required=(name == "run"))
        sub.add_argument("--config")
        sub.add_argument("--validate-only", action="store_true")
        sub.add_argument("--dry-run", action="store_true")
        sub.add_argument("--resume", action="store_true")
        sub.add_argument("--extra-flag", action="append", default=[])

    validate = subparsers.add_parser("validate-output")
    validate.add_argument("--out", required=True)

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

    def test_run_dry_run_creates_required_bundle(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            completed = self.run_cmd("run", "--input", str(DEMO_INPUT), "--out", tmp_dir, "--dry-run")
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            for relative in ${JSON.stringify(spec.outputBundle.required_paths)}:
                self.assertTrue((Path(tmp_dir) / relative).exists(), relative)

    def test_validate_output_detects_missing_artifact(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            completed = self.run_cmd("run", "--input", str(DEMO_INPUT), "--out", tmp_dir, "--dry-run")
            self.assertEqual(completed.returncode, 0, msg=completed.stderr)
            os.remove(Path(tmp_dir) / "report.md")
            validation = self.run_cmd("validate-output", "--out", tmp_dir)
            self.assertNotEqual(validation.returncode, 0)

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
            env["CODEX_FORCE_MISSING_EXECUTABLES"] = "Rscript"
            completed = self.run_cmd("run", "--input", str(DEMO_INPUT), "--out", tmp_dir, env=env)
            self.assertNotEqual(completed.returncode, 0)
            payload = json.loads(completed.stdout)
            self.assertEqual(payload["status"], "blocked_runtime_missing")


if __name__ == "__main__":
    unittest.main()
`;
}

function buildReadmeForExamples(spec) {
  return `# Demo Input / 示例输入

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

  await writeFile(path.join(targetDir, "SKILL.md"), buildSkillMarkdown(spec, skillName));
  await writeFile(path.join(targetDir, "agents", "openai.yaml"), buildOpenAiYaml(spec, skillName));
  await writeFile(path.join(targetDir, `${moduleName}.py`), buildPythonOrchestrator(spec, skillName));
  await writeFile(path.join(targetDir, "tests", `test_${moduleName}.py`), buildChildTest(spec, skillName));
  await writeFile(path.join(targetDir, "references", "methods.md"), buildMethodsReference(spec));
  await writeFile(path.join(targetDir, "references", "papers.md"), buildPapersReference(spec));
  await writeFile(path.join(targetDir, "knowledge", "guardrails.md"), renderGuardrails(spec));
  await writeFile(path.join(targetDir, "knowledge", "troubleshooting.md"), renderTroubleshooting(spec));
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
