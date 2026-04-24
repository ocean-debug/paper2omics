#!/usr/bin/env node

const fs = require("node:fs/promises");
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

function camelToKebab(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2");
}

function dedupe(items) {
  return [...new Set(items.filter(Boolean))];
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function pair(_zh, en) {
  return { zh: en, en };
}

function getBasename(filePath) {
  return path.posix.basename(filePath || "");
}

function joinPreviews(entries) {
  return ensureArray(entries)
    .map((entry) => `${entry.path || ""}\n${entry.preview || ""}`)
    .join("\n\n");
}

function collectTextCorpus(evidence) {
  const repo = evidence.repo || {};
  const sections = evidence.selections || {};
  return [
    repo.repo,
    repo.description,
    repo.homepage,
    joinPreviews(sections.readme),
    joinPreviews(sections.dependencies),
    joinPreviews(sections.entrypoints),
    joinPreviews(sections.examples),
    joinPreviews(sections.notebooks),
    joinPreviews(sections.docs),
    ...(evidence.installHints || []),
    ...(evidence.cliHints || [])
  ].filter(Boolean).join("\n\n");
}

function collectPaperTextCorpus(paperEvidence) {
  const paper = paperEvidence?.paper || {};
  const inferred = paperEvidence?.inferred || {};

  return [
    paper.requestedTitle,
    paper.resolvedTitle,
    paper.abstract,
    paper.fullTextPreview,
    ...ensureArray(paper.snippets).map((item) => item.text),
    ...ensureArray(inferred.keywords),
    ...ensureArray(inferred.analysisHints),
    ...ensureArray(inferred.modalityHints)
  ].filter(Boolean).join("\n\n");
}

function allEntryPaths(evidence) {
  const sections = evidence.selections || {};
  return dedupe([
    ...ensureArray(sections.readme).map((entry) => entry.path),
    ...ensureArray(sections.dependencies).map((entry) => entry.path),
    ...ensureArray(sections.entrypoints).map((entry) => entry.path),
    ...ensureArray(sections.examples).map((entry) => entry.path),
    ...ensureArray(sections.notebooks).map((entry) => entry.path),
    ...ensureArray(sections.docs).map((entry) => entry.path)
  ]);
}

function regexCount(text, expressions) {
  return expressions.reduce((count, expression) => {
    const matched = text.match(expression);
    return count + (matched ? matched.length : 0);
  }, 0);
}

function workflowMiningPriority() {
  return [
    "running_example_notebook_demo_script",
    "official_docs_tutorial",
    "source_code_api",
    "readme",
    "paper_methods",
    "paper_abstract"
  ];
}

function dagInferencePriority() {
  return [
    "notebook_script_execution_order",
    "variable_flow",
    "file_flow",
    "function_call_graph",
    "semantic_dependency",
    "manual_fallback_rule"
  ];
}

function stableSlug(value, fallback = "item") {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || fallback;
}

function stableEvidenceId(claim, source = "") {
  return `ev_${stableSlug(claim)}_${stableSlug(source, "source")}`.slice(0, 96);
}

function inferEvidenceSourceType(source, category) {
  const value = `${source || ""} ${category || ""}`.toLowerCase();
  if (value.includes("paper")) {
    return "paper";
  }
  if (value.includes("notebook") || value.endsWith(".ipynb")) {
    return "notebook";
  }
  if (value.includes("example") || value.includes("demo") || value.includes("manuscript")) {
    return "example";
  }
  if (value.includes("readme")) {
    return "readme";
  }
  if (value.includes("doc") || value.includes("tutorial") || value.includes("vignette")) {
    return "docs";
  }
  if (value.includes("function_signature")) {
    return "function_signature";
  }
  if (value.includes("manual_fallback")) {
    return "manual_fallback";
  }
  return "source_code";
}

function rankedPriority(labels, priorityOrder, fallback = "manual_fallback_rule") {
  const available = new Set(ensureArray(labels).filter(Boolean));
  return ensureArray(priorityOrder).find((item) => available.has(item)) || fallback;
}

function evidenceTraceItems(items, priorityMapper = evidencePriorityLabel, claimType = "source") {
  return dedupe(ensureArray(items).filter(Boolean).map((item) => (
    item && typeof item === "object" ? JSON.stringify(item) : String(item)
  ))).map((serialized, index) => {
    let raw = serialized;
    if (serialized.startsWith("{")) {
      try {
        raw = JSON.parse(serialized);
      } catch (error) {
        raw = serialized;
      }
    }
    const source = raw && typeof raw === "object"
      ? raw.source || raw.path || raw.url || JSON.stringify(raw)
      : raw;
    const category = raw && typeof raw === "object"
      ? raw.category || raw.priority_class || priorityMapper(source)
      : priorityMapper(source);
    return {
      evidence_id: raw && typeof raw === "object" && raw.evidence_id
        ? raw.evidence_id
        : stableEvidenceId(`${claimType}.${index}`, source),
      source,
      path: raw && typeof raw === "object" ? raw.path : undefined,
      url: raw && typeof raw === "object" ? raw.url : undefined,
      source_type: raw && typeof raw === "object" && raw.source_type
        ? raw.source_type
        : inferEvidenceSourceType(source, category),
      category,
      priority_class: category,
      claim_type: claimType,
      location: raw && typeof raw === "object" ? raw.location : undefined,
      snippet: raw && typeof raw === "object" ? raw.snippet : undefined
    };
  });
}

function bestEvidencePriority(items, priorityOrder = workflowMiningPriority()) {
  return rankedPriority(evidenceTraceItems(items).map((item) => item.category), priorityOrder);
}

function makeWorkflowStep({ id, title, description, layer = "core", evidence = [], input = [], output = [] }) {
  const evidenceSources = evidenceTraceItems(evidence);
  return {
    id,
    name: id,
    titleZh: title,
    titleEn: title,
    detailsZh: description,
    detailsEn: description,
    script: `scripts/${id}.py`,
    input,
    output,
    parameters: [],
    layer,
    evidence,
    evidence_sources: evidenceSources,
    evidence_priority_class: rankedPriority(
      evidenceSources.map((item) => item.category),
      workflowMiningPriority()
    ),
    confidence: evidence.length > 0 ? 0.85 : 0.6
  };
}

function evidencePaths(entries, limit = 8) {
  return ensureArray(entries).slice(0, limit).map((entry) => entry.path);
}

function workflowEvidenceBuckets(evidence) {
  const sections = evidence.selections || {};
  const examples = evidencePaths(sections.examples);
  const notebooks = evidencePaths(sections.notebooks);
  const docs = evidencePaths(sections.docs);
  const docsTutorial = docs.filter((item) => /doc|tutorial|vignette/i.test(item));
  const source = evidencePaths(sections.entrypoints);
  const readme = evidencePaths(sections.readme, 2);

  return {
    running_examples: dedupe([
      ...examples.filter((item) => /example|demo|manuscript|script|run|notebook/i.test(item)),
      ...notebooks
    ]),
    official_docs: dedupe(docsTutorial.length > 0 ? docsTutorial : docs),
    source_api: source,
    readme,
    paper_methods: [],
    paper_abstract: []
  };
}

function exampleFirstEvidence(evidence, limit = 4) {
  const buckets = workflowEvidenceBuckets(evidence);
  return dedupe([
    ...buckets.running_examples,
    ...buckets.official_docs,
    ...buckets.source_api,
    ...buckets.readme,
    ...buckets.paper_methods,
    ...buckets.paper_abstract
  ]).slice(0, limit);
}

function evidencePriorityLabel(filePath) {
  if (!filePath) {
    return "manual_fallback_rule";
  }
  if (/\.ipynb$|example|examples|demo|demos|manuscript/i.test(filePath)) {
    return "running_example_notebook_demo_script";
  }
  if (/doc|docs|tutorial|tutorials|vignette|vignettes/i.test(filePath)) {
    return "official_docs_tutorial";
  }
  if (/README/i.test(filePath)) {
    return "readme";
  }
  return "source_code_api";
}

function sectionPriorityLabel(sectionName, entry) {
  const text = `${entry?.path || ""}\n${entry?.preview || ""}`;
  if (/(\bfunction\s*\(|<-\s*function\b|def\s+\w+\s*\()/i.test(text)) {
    return "function_signature";
  }
  if (sectionName === "examples" || sectionName === "notebooks") {
    return "running_example_notebook_demo_script";
  }
  if (sectionName === "docs") {
    return "official_docs_tutorial";
  }
  if (sectionName === "entrypoints" || sectionName === "dependencies") {
    return "source_code_api";
  }
  if (sectionName === "readme") {
    return "readme";
  }
  return evidencePriorityLabel(entry?.path);
}

function parameterEvidencePriority() {
  return [
    "running_example_notebook_demo_script",
    "function_signature",
    "official_docs_tutorial",
    "source_code_api",
    "readme",
    "paper_methods",
    "paper_abstract"
  ];
}

function inferDomain(text, override) {
  if (override) {
    return override;
  }

  const scores = [
    {
      value: "single-cell",
      score: regexCount(text, [
        /single-cell/gi,
        /\bscrna\b/gi,
        /single cell/gi,
        /scRNA/gi,
        /Seurat/gi,
        /Scanpy/gi,
        /\bWT\b/g
      ])
    },
    {
      value: "spatial",
      score: regexCount(text, [/spatial/gi, /Visium/gi, /\bspot\b/gi, /slide/gi])
    },
    {
      value: "bulk-rna",
      score: regexCount(text, [/bulk RNA/gi, /DESeq2/gi, /edgeR/gi, /count matrix/gi])
    },
    {
      value: "atac-chip",
      score: regexCount(text, [/ATAC/gi, /ChIP/gi, /peak/gi, /FRiP/gi, /IDR/gi])
    },
    {
      value: "proteomics",
      score: regexCount(text, [/proteom/gi, /peptide/gi, /phospho/gi, /MaxQuant/gi])
    },
    {
      value: "multi-omics",
      score: regexCount(text, [/multi-omics/gi, /multiomics/gi, /cross-modal/gi, /joint model/gi])
    }
  ].sort((left, right) => right.score - left.score);

  if (scores[0] && scores[0].score > 0) {
    return scores[0].value;
  }

  return "omics";
}

function inferAnalysisType(text, override) {
  if (override) {
    return override;
  }

  if (/CellOracle|TF perturbation|transcription factor perturbation|cell identity transition|transition vector|in silico gene perturbation/gi.test(text)) {
    return "tf-perturbation";
  }
  if (/virtual knockout|in-silico knockout|knocks out a target gene|gene perturbation/gi.test(text)) {
    return "virtual-knockout";
  }
  if (/differential expression|differentially expressed|DESeq2|edgeR/gi.test(text)) {
    return "differential-expression";
  }
  if (/gene regulatory network|scGRN|network inference/gi.test(text)) {
    return "gene-regulatory-network";
  }
  if (/peak calling|peak caller|FRiP|IDR/gi.test(text)) {
    return "peak-calling";
  }
  if (/integration|batch correction|Harmony|latent space/gi.test(text)) {
    return "integration";
  }

  return "omics-analysis";
}

function inferRuntime(evidence, text, override) {
  if (override) {
    return override;
  }

  const paths = allEntryPaths(evidence);
  const hasR = paths.some((entry) => entry.endsWith(".R") || entry === "DESCRIPTION" || entry === "NAMESPACE")
    || /Authors@R|library\(|importFrom\(/.test(text);
  const hasPython = paths.some((entry) => entry.endsWith(".py") || entry === "requirements.txt" || entry === "pyproject.toml")
    || /import\s+[A-Za-z0-9_]+|python/i.test(text);

  if (hasR) {
    return "r";
  }
  if (hasPython) {
    return "python";
  }
  return "cli";
}

function extractDescriptionPackage(evidence) {
  const dependencyEntry = ensureArray(evidence.selections?.dependencies)
    .find((entry) => entry.path === "DESCRIPTION");
  if (!dependencyEntry || !dependencyEntry.preview) {
    return null;
  }

  const matched = dependencyEntry.preview.match(/^Package:\s*(.+)$/mi);
  return matched ? matched[1].trim() : null;
}

function inferPrimaryTool(evidence, paperTitle, override) {
  if (override) {
    return override;
  }

  const fromDescription = extractDescriptionPackage(evidence);
  if (fromDescription) {
    return fromDescription;
  }

  const repoName = evidence.repo?.repo;
  if (repoName) {
    return repoName;
  }

  return paperTitle.split(":")[0].trim();
}

function inferSkillName(primaryTool, override) {
  if (override) {
    return override;
  }

  return slugify(camelToKebab(primaryTool));
}

function inferDisplayName(primaryTool, override) {
  if (override) {
    return override;
  }

  return `${primaryTool} Execution Contract`;
}

function inferLegacyAliases(primaryTool, skillName) {
  return dedupe([
    slugify(primaryTool),
    skillName,
    skillName.replace(/-/g, "_")
  ]).slice(0, 5);
}

function extractPackageCandidates(text) {
  const matches = [];
  const importFromRegex = /importFrom\(([^,\s]+)/g;
  const libraryRegex = /library\(([^)\s]+)/g;
  let matched;

  while ((matched = importFromRegex.exec(text)) !== null) {
    matches.push(matched[1]);
  }
  while ((matched = libraryRegex.exec(text)) !== null) {
    matches.push(matched[1]);
  }

  const priority = [
    "scTenifoldNet",
    "Matrix",
    "Seurat",
    "harmony",
    "scanpy",
    "anndata",
    "DESeq2",
    "edgeR"
  ];

  const unique = dedupe(matches).filter((item) => ![
    "utils",
    "methods",
    "stats",
    "graphics",
    "grDevices",
    "pbapply",
    "cli"
  ].includes(item));

  unique.sort((left, right) => {
    const leftIndex = priority.indexOf(left);
    const rightIndex = priority.indexOf(right);
    if (leftIndex === -1 && rightIndex === -1) {
      return left.localeCompare(right);
    }
    if (leftIndex === -1) {
      return 1;
    }
    if (rightIndex === -1) {
      return -1;
    }
    return leftIndex - rightIndex;
  });

  return unique;
}

function inferDependencies(runtime, primaryTool, text) {
  const dependencies = ["python>=3.10"];
  if (runtime === "r") {
    dependencies.push("R");
  }
  dependencies.push(primaryTool);

  const packageCandidates = extractPackageCandidates(text);
  for (const item of packageCandidates.slice(0, 3)) {
    if (!dependencies.includes(item)) {
      dependencies.push(item);
    }
  }

  return dependencies;
}

function inferTriggerKeywords(primaryTool, domain, analysisType, text) {
  const keywords = [primaryTool];

  if (analysisType === "tf-perturbation") {
    keywords.push("TF perturbation", "GRN inference", "cell identity transition");
  }
  if (analysisType === "virtual-knockout") {
    keywords.push("virtual knockout", "in-silico knockout");
  }
  if (domain === "single-cell") {
    keywords.push("single-cell", "scRNA-seq");
  }
  if (/gene regulatory network|scGRN/gi.test(text)) {
    keywords.push("gene regulatory network");
  }
  if (analysisType === "differential-expression") {
    keywords.push("differential expression");
  }

  return dedupe(keywords).slice(0, 6);
}

function inferParamHints(domain, analysisType) {
  const hints = {
    input_orientation: {
      required: true,
      tip: domain === "single-cell" ? "genes_by_cells" : "see input contract"
    }
  };

  if (analysisType === "virtual-knockout") {
    hints.knockout_gene = {
      required: true,
      tip: "Gene symbol that remains present after filtering."
    };
    hints.analysis_mode = {
      required: true,
      tip: "core_wt_only"
    };
  }

  if (analysisType === "tf-perturbation") {
    hints.perturbation_targets = {
      required: true,
      tip: "Transcription-factor symbols to perturb."
    };
    hints.base_grn_source = {
      required: false,
      tip: "Use provided base GRN, infer from scATAC peaks, or choose a species-specific default."
    };
  }

  if (analysisType === "differential-expression") {
    hints.design = {
      required: true,
      tip: "~ condition + batch"
    };
    hints.contrast = {
      required: true,
      tip: "condition treated control"
    };
  }

  return hints;
}

function inferDomainLabels(domain) {
  switch (domain) {
    case "single-cell":
      return pair("single-cell omics", "single-cell omics");
    case "bulk-rna":
      return pair("bulk transcriptomics", "bulk transcriptomics");
    case "spatial":
      return pair("spatial transcriptomics", "spatial transcriptomics");
    case "atac-chip":
      return pair("epigenomics", "epigenomics");
    case "proteomics":
      return pair("proteomics", "proteomics");
    case "multi-omics":
      return pair("multi-omics", "multi-omics");
    default:
      return pair("omics analysis", "omics analysis");
  }
}

function inferAnalysisLabels(analysisType) {
  switch (analysisType) {
    case "tf-perturbation":
      return pair("in silico TF perturbation", "in silico TF perturbation");
    case "virtual-knockout":
      return pair("virtual knockout", "virtual knockout");
    case "differential-expression":
      return pair("differential expression", "differential expression");
    case "gene-regulatory-network":
      return pair("gene regulatory network analysis", "gene regulatory network analysis");
    case "peak-calling":
      return pair("peak calling", "peak calling");
    case "integration":
      return pair("integration analysis", "integration analysis");
    default:
      return pair("method execution", "method execution");
  }
}

function inferPrimaryModality(domain) {
  switch (domain) {
    case "single-cell":
      return "single_cell_transcriptomics";
    case "spatial":
      return "spatial_transcriptomics";
    case "bulk-rna":
      return "bulk_rnaseq";
    case "atac-chip":
      return "single_cell_epigenomics";
    case "proteomics":
      return "proteomics";
    case "multi-omics":
      return "multiomics";
    default:
      return "omics";
  }
}

function inferSecondaryModalities(domain, analysisType, text) {
  const modalities = [];
  if (analysisType === "tf-perturbation" && /scATAC|ATAC|peak|motif|base[_ -]?GRN/gi.test(text)) {
    modalities.push("single_cell_epigenomics");
  }
  if (analysisType === "tf-perturbation" && /multi-omics|multiomics|scATAC|ATAC|motif/gi.test(text)) {
    modalities.push("multiomics");
  }
  if (domain === "multi-omics") {
    modalities.push("single_cell_transcriptomics");
  }
  return dedupe(modalities).filter((item) => item !== inferPrimaryModality(domain));
}

function inferTaskFamily(analysisType) {
  if (analysisType === "tf-perturbation" || analysisType === "virtual-knockout" || analysisType === "gene-regulatory-network") {
    return ["regulatory_network", "perturbation"];
  }
  if (analysisType === "differential-expression") {
    return ["differential_expression"];
  }
  if (analysisType === "integration") {
    return ["integration"];
  }
  return ["omics_analysis"];
}

function inferPrimaryTask(analysisType) {
  switch (analysisType) {
    case "tf-perturbation":
    case "virtual-knockout":
      return "perturbation_analysis";
    case "gene-regulatory-network":
      return "GRN_inference";
    case "differential-expression":
      return "differential_expression";
    default:
      return analysisType.replace(/-/g, "_");
  }
}

function inferSecondaryTasks(analysisType) {
  if (analysisType === "tf-perturbation") {
    return ["in_silico_TF_perturbation", "cell_identity_transition", "GRN_inference"];
  }
  if (analysisType === "virtual-knockout") {
    return ["virtual_gene_knockout", "gene_function_prediction", "perturbed_gene_ranking"];
  }
  return [];
}

function inferPerturbationFacets(analysisType, primaryTool, text) {
  if (analysisType === "tf-perturbation") {
    return {
      target_type: {
        value: "transcription_factor",
        evidence: ["CellOracle", "TF perturbation", "transcription factor perturbation"].filter((item) => text.includes(item) || item === primaryTool)
      },
      action: {
        value: "in_silico_knockout_or_shift",
        evidence: ["in silico gene perturbation", "simulate_shift", "perturbation vector"].filter((item) => new RegExp(item, "i").test(text))
      },
      modeling_mechanism: {
        value: "predictive_GRN_model",
        evidence: ["gene regulatory network", "base GRN", "cell-state-specific GRN"].filter((item) => new RegExp(item, "i").test(text))
      },
      output_interpretation: {
        value: "cell_identity_transition",
        evidence: ["transition vector", "cell identity transition", "perturbation vector"].filter((item) => new RegExp(item, "i").test(text))
      }
    };
  }

  if (analysisType === "virtual-knockout") {
    return {
      target_type: {
        value: "gene",
        evidence: ["knockout_gene", "target gene", "gKO"].filter((item) => new RegExp(item, "i").test(text))
      },
      action: {
        value: "virtual_knockout",
        evidence: ["virtual knockout", "in-silico knockout", "knocks out a target gene"].filter((item) => new RegExp(item, "i").test(text))
      },
      modeling_mechanism: {
        value: "scGRN_edge_removal_and_manifold_alignment",
        evidence: ["scGRN", "outdegree edges", "manifold alignment", "tensor decomposition"].filter((item) => new RegExp(item, "i").test(text))
      },
      output_interpretation: {
        value: "differential_regulation_and_gene_function_prediction",
        evidence: ["differential regulation", "gene function", "perturbed gene"].filter((item) => new RegExp(item, "i").test(text))
      }
    };
  }

  return null;
}

function inferAvailableLanguages(runtime, text) {
  const languages = [];
  if (/python|\.py|pyproject|setup.py|requirements/gi.test(text) || runtime === "python") {
    languages.push("python");
  }
  if (/\bR\b|Rscript|DESCRIPTION|NAMESPACE|\.R\b|library\(/g.test(text) || runtime === "r") {
    languages.push("r");
  }
  if (/matlab|\.m\b/gi.test(text)) {
    languages.push("matlab");
  }
  if (languages.length === 0) {
    languages.push(runtime);
  }
  return dedupe(languages);
}

function inferExecutionModes(runtime, text) {
  const modes = [];
  if (runtime === "python" || /python_api|import\s+[A-Za-z0-9_]+|setup.py|pyproject/gi.test(text)) {
    modes.push("python_api");
  }
  if (runtime === "r" || /Rscript|library\(|DESCRIPTION|NAMESPACE/gi.test(text)) {
    modes.push("r_api");
  }
  if (/\.ipynb|notebook|jupyter/gi.test(text)) {
    modes.push("notebook");
  }
  if (/command line|--help|usage:|cli|console_scripts/gi.test(text)) {
    modes.push("cli");
  }
  if (modes.length === 0) {
    modes.push("wrapper_only");
  }
  return dedupe(modes);
}

function inferWorkflowEngines(text) {
  const engines = [];
  if (/Snakefile|snakemake/gi.test(text)) {
    engines.push("snakemake");
  }
  if (/nextflow\.config|nextflow/gi.test(text)) {
    engines.push("nextflow");
  }
  if (/\bCWL\b|\.cwl\b|Common Workflow Language/gi.test(text)) {
    engines.push("cwl");
  }
  return engines;
}

function inferPreferredLanguage(runtime, text, override) {
  if (override) {
    return override;
  }
  if (/python|\.py|pyproject|setup.py|requirements/gi.test(text)) {
    return "python";
  }
  if (runtime === "r") {
    return "r";
  }
  return runtime;
}

function inferPackageType(runtime, availableLanguages) {
  if (availableLanguages.includes("python") && availableLanguages.includes("r")) {
    return "multi_language_package";
  }
  if (runtime === "r" || availableLanguages.includes("r")) {
    return "r_package";
  }
  if (runtime === "python" || availableLanguages.includes("python")) {
    return "python_package";
  }
  return "repository_workflow";
}

function inferRequiredInputs(analysisType) {
  if (analysisType === "tf-perturbation") {
    return ["scRNA_seq_object", "cell_annotation", "perturbation_tf_list"];
  }
  if (analysisType === "virtual-knockout") {
    return ["wt_expression_matrix", "knockout_gene"];
  }
  return ["primary_input"];
}

function inferOptionalInputs(analysisType) {
  if (analysisType === "tf-perturbation") {
    return ["base_grn", "scATAC_peaks", "pseudotime"];
  }
  if (analysisType === "virtual-knockout") {
    return ["cell_metadata", "gene_filtering_params", "enrichment_database"];
  }
  return ["metadata"];
}

function inferAlgorithmClassification(domain, analysisType, runtime, primaryTool, githubUrl, text, preferredLanguageOverride) {
  const availableLanguages = inferAvailableLanguages(runtime, text);
  const preferredLanguage = inferPreferredLanguage(runtime, text, preferredLanguageOverride);
  const executionModes = inferExecutionModes(runtime, text);
  const workflowEngines = inferWorkflowEngines(text);
  return {
    algorithm: {
      name: primaryTool,
      repository: githubUrl
    },
    classification: {
      primary_modality: inferPrimaryModality(domain),
      secondary_modalities: inferSecondaryModalities(domain, analysisType, text),
      task_family: inferTaskFamily(analysisType),
      primary_task: inferPrimaryTask(analysisType),
      secondary_tasks: inferSecondaryTasks(analysisType),
      perturbation: inferPerturbationFacets(analysisType, primaryTool, text),
      confidence: 0.85,
      evidence: ["paper_evidence", "repository_evidence"]
    },
    implementation: {
      languages: availableLanguages,
      main_language: runtime === "r" ? "r" : runtime,
      available_languages: availableLanguages,
      preferred_language: preferredLanguage,
      fallback_language: preferredLanguage === "python" && availableLanguages.includes("r") ? "r" : null,
      package_type: inferPackageType(runtime, availableLanguages),
      execution_modes: executionModes,
      workflow_engines: workflowEngines,
      confidence: 0.8,
      evidence: ["dependency_files", "entrypoints", "readme"]
    },
    required_inputs: inferRequiredInputs(analysisType),
    optional_inputs: inferOptionalInputs(analysisType)
  };
}

function inferRouting(primaryTool, domain, analysisType, hasExamples) {
  const domainLabel = inferDomainLabels(domain);
  const analysisLabel = inferAnalysisLabels(analysisType);

  if (domain === "single-cell" && analysisType === "virtual-knockout") {
    return {
      why_this_exists: pair(`This skill turns ${primaryTool} into a routable, validated, and report-producing execution contract for virtual knockout on WT single-cell expression matrices.`, `This skill turns ${primaryTool} into a routable, validated, and report-producing execution contract for virtual knockout on WT single-cell expression matrices.`),
      when_to_use: [
        pair("Use when the task starts from a WT scRNA-seq matrix and needs virtual knockout plus perturbation or differential-regulation outputs.", "Use when the task starts from a WT scRNA-seq matrix and needs virtual knockout plus perturbation or differential-regulation outputs."),
        pair(
          hasExamples
            ? "Use when the user needs the core WT-only workflow clearly separated from manuscript-style reproduction branches."
            : "Use when the user needs the core method separated from the wrapper-level execution contract.",
          hasExamples
            ? "Use when the user needs the core WT-only workflow clearly separated from manuscript-style reproduction branches."
            : "Use when the user needs the core method separated from the wrapper-level execution contract."
        )
      ],
      when_not_to_use: [
        pair("Do not use for real CRISPR KO experimental design, generic differential expression, or multi-sample integration.", "Do not use for real CRISPR KO experimental design, generic differential expression, or multi-sample integration."),
        pair("Do not use when no WT input matrix is available.", "Do not use when no WT input matrix is available.")
      ],
      route_elsewhere: [
        pair("If the task is still upstream FASTQ-to-matrix processing, route to an alignment or quantification skill.", "If the task is still upstream FASTQ-to-matrix processing, route to an alignment or quantification skill."),
        pair("If the task is bulk RNA-seq differential expression, route to a bulk differential-expression skill.", "If the task is bulk RNA-seq differential expression, route to a bulk differential-expression skill.")
      ]
    };
  }

  return {
    why_this_exists: pair(`This skill turns ${primaryTool} into a routable, validated, and report-producing execution contract for ${domainLabel.en} ${analysisLabel.en}.`, `This skill turns ${primaryTool} into a routable, validated, and report-producing execution contract for ${domainLabel.en} ${analysisLabel.en}.`),
    when_to_use: [
      pair(`Use when the task needs ${analysisLabel.en} grounded in the official paper and repository, with traceable and reproducible outputs.`, `Use when the task needs ${analysisLabel.en} grounded in the official paper and repository, with traceable and reproducible outputs.`)
    ],
    when_not_to_use: [
      pair("Do not use for input data that does not match this omics modality.", "Do not use for input data that does not match this omics modality.")
    ],
    route_elsewhere: [
      pair("If the task is still in raw-data preprocessing, route to an upstream preprocessing or quantification skill.", "If the task is still in raw-data preprocessing, route to an upstream preprocessing or quantification skill.")
    ]
  };
}

function inferInputContract(domain, analysisType, geneName) {
  if (domain === "single-cell" && analysisType === "tf-perturbation") {
    return {
      formats: [
        {
          name: "input_manifest.json",
          zh: "JSON manifest declaring the single-cell object, annotation, and TF perturbation targets.",
          en: "JSON manifest declaring the single-cell object, annotation, and TF perturbation targets."
        },
        {
          name: "h5ad_or_loom",
          zh: "AnnData or loom-style single-cell expression object.",
          en: "AnnData or loom-style single-cell expression object."
        }
      ],
      required_manifest_fields: [
        "inputs.scrna_object.path",
        "inputs.cell_annotation",
        "inputs.perturbation_tf_list",
        "inputs.analysis_mode"
      ],
      file_fields: [
        {
          path: "inputs.scrna_object.path",
          required: true,
          zh: "The scRNA-seq object path must exist.",
          en: "The scRNA-seq object path must exist."
        }
      ],
      state_requirements: [
        {
          path: "inputs.scrna_object.has_gene_names",
          required: true,
          equals: true,
          zh: "Gene names must be available so TF targets can be checked.",
          en: "Gene names must be available so TF targets can be checked."
        },
        {
          path: "inputs.cell_annotation",
          required: true,
          zh: "Cell type or cluster annotation must be present for group-specific GRN inference.",
          en: "Cell type or cluster annotation must be present for group-specific GRN inference."
        },
        {
          path: "inputs.analysis_mode",
          required: true,
          one_of: ["core_tf_perturbation", "paper_reproduction"],
          zh: "The manifest must distinguish the core TF perturbation workflow from paper reproduction.",
          en: "The manifest must distinguish the core TF perturbation workflow from paper reproduction."
        }
      ],
      demo_input_manifest: {
        inputs: {
          scrna_object: {
            path: "demo_scrna_summary.json",
            has_gene_names: true
          },
          cell_annotation: "cell_type",
          perturbation_tf_list: [geneName],
          analysis_mode: "core_tf_perturbation"
        }
      },
      demo_files: {
        "demo_scrna_summary.json": JSON.stringify({
          cells: 12,
          genes: [geneName, "GENE_B", "GENE_C"],
          obs_columns: ["cell_type"],
          obsm_keys: ["X_umap"]
        }, null, 2) + "\n"
      }
    };
  }

  if (domain === "single-cell" && analysisType === "virtual-knockout") {
    return {
      formats: [
        {
          name: "input_manifest.json",
          zh: "The preferred input is a JSON manifest that declares matrix paths and object state.",
          en: "The preferred input is a JSON manifest that declares matrix paths and object state."
        },
        {
          name: "matrix_market_or_csv",
          zh: "Expression matrices may be Matrix Market or CSV, but the manifest must state orientation and whether they are raw counts.",
          en: "Expression matrices may be Matrix Market or CSV, but the manifest must state orientation and whether they are raw counts."
        }
      ],
      required_manifest_fields: [
        "inputs.wt_matrix.path",
        "inputs.wt_matrix.orientation",
        "inputs.wt_matrix.normalization",
        "inputs.knockout_gene",
        "inputs.analysis_mode"
      ],
      file_fields: [
        {
          path: "inputs.wt_matrix.path",
          required: true,
          zh: "The WT expression matrix path must exist.",
          en: "The WT expression matrix path must exist."
        }
      ],
      state_requirements: [
        {
          path: "inputs.wt_matrix.orientation",
          required: true,
          equals: "genes_by_cells",
          zh: "The WT matrix must be organized as genes in rows and cells in columns.",
          en: "The WT matrix must be organized as genes in rows and cells in columns."
        },
        {
          path: "inputs.wt_matrix.normalization",
          required: true,
          one_of: ["raw_counts", "unnormalized_counts"],
          zh: "Core input should remain raw or otherwise unnormalized so method-level preflight assumptions are not silently bypassed.",
          en: "Core input should remain raw or otherwise unnormalized so method-level preflight assumptions are not silently bypassed."
        },
        {
          path: "inputs.wt_matrix.has_gene_names",
          required: true,
          equals: true,
          zh: "The matrix must retain gene names so the wrapper can verify that the knockout gene exists.",
          en: "The matrix must retain gene names so the wrapper can verify that the knockout gene exists."
        },
        {
          path: "inputs.analysis_mode",
          required: true,
          one_of: ["core_wt_only", "paper_reproduction"],
          zh: "The manifest must explicitly declare whether this is the core WT-only path or the paper-reproduction path.",
          en: "The manifest must explicitly declare whether this is the core WT-only path or the paper-reproduction path."
        }
      ],
      demo_input_manifest: {
        inputs: {
          wt_matrix: {
            path: "wt_counts.csv",
            orientation: "genes_by_cells",
            normalization: "raw_counts",
            has_gene_names: true
          },
          knockout_gene: geneName,
          analysis_mode: "core_wt_only"
        }
      },
      demo_files: {
        "wt_counts.csv": `gene,cell_1,cell_2\n${geneName},10,8\nGENE_B,5,4\nGENE_C,7,6\n`
      }
    };
  }

  return {
    formats: [
      {
        name: "input_manifest.json",
        zh: "The preferred input is a JSON manifest that declares file paths and object state.",
        en: "The preferred input is a JSON manifest that declares file paths and object state."
      }
    ],
    required_manifest_fields: [
      "inputs.primary_input.path",
      "inputs.analysis_mode"
    ],
    file_fields: [
      {
        path: "inputs.primary_input.path",
        required: true,
        zh: "The primary input file path must exist.",
        en: "The primary input file path must exist."
      }
    ],
    state_requirements: [
      {
        path: "inputs.analysis_mode",
        required: true,
        equals: "core",
        zh: "The analysis mode must be explicitly declared.",
        en: "The analysis mode must be explicitly declared."
      }
    ],
    demo_input_manifest: {
      inputs: {
        primary_input: {
          path: "demo_input.txt"
        },
        analysis_mode: "core"
      }
    },
    demo_files: {
      "demo_input.txt": "placeholder\n"
    }
  };
}

function evidenceEntriesBySection(evidence) {
  const sections = evidence?.selections || {};
  return [
    ["examples", sections.examples],
    ["notebooks", sections.notebooks],
    ["docs", sections.docs],
    ["entrypoints", sections.entrypoints],
    ["dependencies", sections.dependencies],
    ["readme", sections.readme]
  ].flatMap(([section, entries]) => ensureArray(entries).map((entry) => ({
    section,
    path: entry.path,
    preview: entry.preview || "",
    githubUrl: entry.githubUrl || ""
  })));
}

function parameterSearchPatterns(parameterName, analysisType, runtime) {
  const common = {
    knockout_gene: [/gKO\b/i, /knockout[_\s-]?gene/i, /target gene/i],
    analysis_mode: [/analysis[_\s-]?mode/i, /paper[_\s-]?reproduction/i, /core[_\s-]?wt/i],
    r_runtime_available: [/DESCRIPTION/i, /NAMESPACE/i, /Rscript/i],
    python_runtime_available: [/setup\.py/i, /requirements/i, /python/i],
    wt_input_normalization: [/normalization/i, /raw counts/i, /countMatrix/i],
    edge_weight_quantile: [/quantile\(abs\(X\)/i, /qFilter/i],
    direction_lambda: [/lambda\s*=/i, /strictDirection/i],
    perturbation_targets: [/perturbation/i, /simulate_shift/i, /transition vector/i, /\bTF\b/i],
    base_grn_source: [/base GRN/i, /motif/i, /scATAC/i, /network_construction/i],
    cell_grouping: [/cell annotation/i, /cell[_\s-]?type/i, /cluster/i, /AnnData/i],
    preferred_language: [runtime === "python" ? /setup\.py|requirements|python/i : /DESCRIPTION|NAMESPACE|R package/i],
    method_defaults: [/default/i, /README/i]
  };
  return common[parameterName] || [new RegExp(parameterName.replace(/_/g, "[-_\\s]?"), "i")];
}

function parameterEvidenceSources(evidence, item, groupName, analysisType, runtime) {
  const entries = evidenceEntriesBySection(evidence);
  const patterns = parameterSearchPatterns(item.name, analysisType, runtime);
  const matches = entries.filter((entry) => {
    const text = `${entry.path}\n${entry.preview}`;
    return patterns.some((pattern) => pattern.test(text));
  }).slice(0, 4);

  if (matches.length > 0) {
    return matches.map((entry) => ({
      source: entry.path,
      category: sectionPriorityLabel(entry.section, entry),
      url: entry.githubUrl || undefined
    }));
  }

  if (/literature/i.test(groupName)) {
    return [{
      source: "paper_methods",
      category: "paper_methods"
    }];
  }
  if (/wrapper/i.test(groupName)) {
    return [{
      source: "paper2omics wrapper contract",
      category: "manual_fallback_rule"
    }];
  }
  return ensureArray(item.sources).map((source) => ({
    source,
    category: "manual_fallback_rule"
  }));
}

function annotateParameterEvidence(policy, evidence, analysisType, runtime) {
  const groups = [
    ["user_required", "User required"],
    ["auto_detected", "Auto detected"],
    ["literature_defaults", "Literature defaults"],
    ["wrapper_defaults", "Wrapper defaults"]
  ];
  for (const [key, groupName] of groups) {
    policy[key] = ensureArray(policy[key]).map((item) => {
      const evidenceSources = parameterEvidenceSources(evidence, item, groupName, analysisType, runtime);
      return {
        ...item,
        evidence_sources: evidenceSources,
        evidence_priority_class: rankedPriority(
          evidenceSources.map((source) => source.category),
          parameterEvidencePriority(),
          /literature/i.test(groupName) ? "paper_methods" : "manual_fallback_rule"
        )
      };
    });
  }
  return policy;
}

function inferLiteratureDefaults(text, analysisType, evidence) {
  const defaults = [];

  const quantileMatch = text.match(/quantile\(abs\(X\),\s*([0-9.]+)\)/i);
  if (quantileMatch) {
    defaults.push({
      name: "edge_weight_quantile",
      value: quantileMatch[1],
      sources: ["source_code_api"],
      rationale: pair(`The source code uses quantile(abs(X), ${quantileMatch[1]}) to filter low-weight edges.`, `The source code uses quantile(abs(X), ${quantileMatch[1]}) to filter low-weight edges.`)
    });
  }

  const lambdaMatch = text.match(/lambda\s*=\s*([0-9.]+)/i);
  if (lambdaMatch) {
    defaults.push({
      name: "direction_lambda",
      value: lambdaMatch[1],
      sources: ["function_signature"],
      rationale: pair(`The directionality helper defaults to lambda = ${lambdaMatch[1]} in the source code.`, `The directionality helper defaults to lambda = ${lambdaMatch[1]} in the source code.`)
    });
  }

  if (defaults.length === 0 && analysisType === "virtual-knockout") {
    defaults.push({
      name: "method_defaults",
      value: "see_repository_defaults",
      rationale: pair("Method defaults are not fully confirmed in the truncated evidence and should be checked against the main implementation and official README.", "Method defaults are not fully confirmed in the truncated evidence and should be checked against the main implementation and official README.")
    });
  }

  return defaults;
}

function inferParameterPolicy(domain, analysisType, runtime, text, evidence = {}) {
  const literatureDefaults = inferLiteratureDefaults(text, analysisType, evidence);

  if (domain === "single-cell" && analysisType === "tf-perturbation") {
    return annotateParameterEvidence({
      evidence_priority: parameterEvidencePriority(),
      required_user_decisions: [
        pair("The user must provide or approve the transcription factors to perturb.", "The user must provide or approve the transcription factors to perturb."),
        pair("The user must identify the cell annotation column or grouping strategy.", "The user must identify the cell annotation column or grouping strategy.")
      ],
      user_required: [
        {
          name: "perturbation_targets",
          description: pair("TF symbols to perturb.", "TF symbols to perturb."),
          sources: [
            "config.analysis.perturbation_targets",
            "manifest.inputs.perturbation_tf_list"
          ],
          rationale: pair("The perturbation targets determine which simulated TF knockouts are run.", "The perturbation targets determine which simulated TF knockouts are run.")
        }
      ],
      auto_detected: [
        {
          name: "base_grn_source",
          description: pair("Choose provided base GRN, scATAC-derived GRN, or species-specific default.", "Choose provided base GRN, scATAC-derived GRN, or species-specific default."),
          sources: [
            "manifest.inputs.base_grn",
            "manifest.inputs.scATAC_peaks",
            "config.species"
          ],
          fallback_value: "species_default_or_user_required",
          rationale: pair("CellOracle needs a base GRN before cell-state-specific network modeling.", "CellOracle needs a base GRN before cell-state-specific network modeling.")
        },
        {
          name: "cell_grouping",
          description: pair("Use explicit cell annotation, existing clusters, or block for preprocessing.", "Use explicit cell annotation, existing clusters, or block for preprocessing."),
          sources: [
            "manifest.inputs.cell_annotation",
            "adata.obs"
          ],
          fallback_value: "require_annotation_or_clustering",
          rationale: pair("Group-specific network inference requires meaningful cell groups.", "Group-specific network inference requires meaningful cell groups.")
        }
      ],
      literature_defaults: literatureDefaults.length > 0 ? literatureDefaults : [
        {
          name: "preferred_language",
          value: "python",
          rationale: pair("The official CellOracle implementation is Python.", "The official CellOracle implementation is Python.")
        }
      ],
      wrapper_defaults: [
        {
          name: "result_bundle_version",
          value: "1.0",
          rationale: pair("Use the standard paper2omics result bundle.", "Use the standard paper2omics result bundle.")
        },
        {
          name: "dry_run_mode",
          value: "true",
          rationale: pair("Validate contracts and runtime before spending cluster resources.", "Validate contracts and runtime before spending cluster resources.")
        }
      ],
      decision_rules: [
        {
          titleZh: "Base GRN source selection",
          titleEn: "Base GRN source selection",
          detailsZh: "Use a user-provided base GRN first; otherwise build from scATAC peaks when present; otherwise require a species-specific default or user confirmation.",
          detailsEn: "Use a user-provided base GRN first; otherwise build from scATAC peaks when present; otherwise require a species-specific default or user confirmation."
        },
        {
          titleZh: "Large dataset runtime control",
          titleEn: "Large dataset runtime control",
          detailsZh: "If cell count is high, warn and prefer downsampling or cluster-wise execution for smoke tests.",
          detailsEn: "If cell count is high, warn and prefer downsampling or cluster-wise execution for smoke tests."
        }
      ]
    }, evidence, analysisType, runtime);
  }

  if (domain === "single-cell" && analysisType === "virtual-knockout") {
    return annotateParameterEvidence({
      evidence_priority: parameterEvidencePriority(),
      required_user_decisions: [
        pair("The knockout gene must be provided and confirmed to remain present after filtering.", "The knockout gene must be provided and confirmed to remain present after filtering."),
        pair("The user must confirm whether the run targets the core WT-only analysis or a paper-reproduction branch.", "The user must confirm whether the run targets the core WT-only analysis or a paper-reproduction branch.")
      ],
      user_required: [
        {
          name: "knockout_gene",
          description: pair("Target knockout gene.", "Target knockout gene."),
          sources: [
            "config.analysis.knockout_gene",
            "manifest.inputs.knockout_gene"
          ],
          rationale: pair("This determines which gene loses its outgoing edges and must not be guessed.", "This determines which gene loses its outgoing edges and must not be guessed.")
        },
        {
          name: "analysis_mode",
          description: pair("Core path versus paper-reproduction branch.", "Core path versus paper-reproduction branch."),
          sources: [
            "config.analysis.analysis_mode",
            "manifest.inputs.analysis_mode"
          ],
          rationale: pair("It determines whether real WT/KO manuscript branches may enter the execution plan.", "It determines whether real WT/KO manuscript branches may enter the execution plan.")
        }
      ],
      auto_detected: [
        {
          name: "r_runtime_available",
          description: pair("Whether Rscript is available.", "Whether Rscript is available."),
          sources: [
            "runtime.targets.Rscript.available"
          ],
          fallback_value: false,
          rationale: pair("Native execution depends on Rscript.", "Native execution depends on Rscript.")
        },
        {
          name: "wt_input_normalization",
          description: pair("Read the WT input matrix state from the manifest.", "Read the WT input matrix state from the manifest."),
          sources: [
            "manifest.inputs.wt_matrix.normalization"
          ],
          fallback_value: "unknown",
          rationale: pair("The wrapper must not silently assume whether the input is normalized.", "The wrapper must not silently assume whether the input is normalized.")
        }
      ],
      literature_defaults: literatureDefaults,
      wrapper_defaults: [
        {
          name: "result_bundle_version",
          value: "1.0",
          rationale: pair("A fixed result bundle keeps smoke tests, report regeneration, and reproducibility records consistent.", "A fixed result bundle keeps smoke tests, report regeneration, and reproducibility records consistent.")
        },
        {
          name: "dry_run_mode",
          value: "true",
          rationale: pair("Default to validating the contract and runtime before executing the full analysis.", "Default to validating the contract and runtime before executing the full analysis.")
        }
      ],
      decision_rules: [
        {
          titleZh: "Prefer the core WT-only path",
          titleEn: "Prefer the core WT-only path",
          detailsZh: "If only WT input is available, keep the workflow on the virtual-knockout core path and do not merge manuscript reproduction scripts into the minimum contract.",
          detailsEn: "If only WT input is available, keep the workflow on the virtual-knockout core path and do not merge manuscript reproduction scripts into the minimum contract."
        },
        {
          titleZh: "Block native execution when a required runtime is missing",
          titleEn: "Block native execution when a required runtime is missing",
          detailsZh: "If Rscript is unavailable, emit a structured blocked status instead of pretending the method already ran.",
          detailsEn: "If Rscript is unavailable, emit a structured blocked status instead of pretending the method already ran."
        }
      ]
    }, evidence, analysisType, runtime);
  }

  return annotateParameterEvidence({
    evidence_priority: parameterEvidencePriority(),
    required_user_decisions: [
      pair("The user must confirm that the input object already satisfies method prerequisites.", "The user must confirm that the input object already satisfies method prerequisites.")
    ],
    user_required: [],
    auto_detected: [
      {
        name: `${runtime}_runtime_available`,
        description: pair("Check whether the primary runtime is available.", "Check whether the primary runtime is available."),
        sources: [
          `runtime.targets.${runtime === "r" ? "Rscript" : "python"}.available`
        ],
        fallback_value: false,
        rationale: pair("Native execution depends on the primary runtime.", "Native execution depends on the primary runtime.")
      }
    ],
    literature_defaults: literatureDefaults,
    wrapper_defaults: [
      {
        name: "result_bundle_version",
        value: "1.0",
        rationale: pair("A fixed result bundle simplifies validation and reporting.", "A fixed result bundle simplifies validation and reporting.")
      }
    ],
    decision_rules: [
      {
        titleZh: "Evidence over assumptions",
        titleEn: "Evidence over assumptions",
        detailsZh: "If the paper or repository evidence is incomplete, mark the field as unconfirmed instead of silently filling it in.",
        detailsEn: "If the paper or repository evidence is incomplete, mark the field as unconfirmed instead of silently filling it in."
      }
    ]
  }, evidence, analysisType, runtime);
}

function classifyReferenceNote(item) {
  const base = getBasename(item.path).toLowerCase();
  if (base.includes("readme")) {
    return pair("Repository overview plus input and output guidance.", "Repository overview plus input and output guidance.");
  }
  if (base.includes("description") || base.includes("namespace")) {
    return pair("Dependency and exported-interface evidence.", "Dependency and exported-interface evidence.");
  }
  if (base.includes("qc")) {
    return pair("Quality-control implementation.", "Quality-control implementation.");
  }
  if (base.includes("regulation")) {
    return pair("Differential-regulation or statistical-scoring implementation.", "Differential-regulation or statistical-scoring implementation.");
  }
  if (base.includes("plot")) {
    return pair("Visualization or downstream result-display implementation.", "Visualization or downstream result-display implementation.");
  }
  if (item.path.includes("manuscript/") || item.path.includes("examples/")) {
    return pair("Reproduction example or manuscript-branch evidence.", "Reproduction example or manuscript-branch evidence.");
  }
  return pair("Main implementation file.", "Main implementation file.");
}

function buildReferenceItems(entries) {
  return ensureArray(entries).map((entry) => {
    const note = classifyReferenceNote(entry);
    return {
      label: entry.path,
      url: entry.githubUrl,
      noteZh: note.en,
      noteEn: note.en
    };
  });
}

function buildPaperReferenceItems(paperEvidence) {
  const paper = paperEvidence?.paper || {};
  const preferredUrl = paper.preferredCitationUrl || paper.paperUrl || paper.articleUrl || "";
  if (!preferredUrl) {
    return [];
  }

  return [
    {
      label: paper.resolvedTitle || paper.requestedTitle || "Paper source",
      url: preferredUrl,
      noteZh: paper.abstract
        ? `Paper abstract evidence: ${paper.abstract}`
        : "Paper-source evidence.",
      noteEn: paper.abstract
        ? `Paper abstract evidence: ${paper.abstract}`
        : "Paper-source evidence."
    }
  ];
}

function inferReferences(evidence, paperEvidence) {
  const sections = evidence.selections || {};
  const methodsItems = buildReferenceItems(ensureArray(sections.entrypoints).slice(0, 6));
  const paperItems = buildPaperReferenceItems(paperEvidence);
  const papersItems = buildReferenceItems([
    ...ensureArray(sections.readme).slice(0, 2),
    ...ensureArray(sections.examples).slice(0, 4),
    ...ensureArray(sections.notebooks).slice(0, 2),
    ...ensureArray(sections.docs).slice(0, 2),
    ...ensureArray(sections.dependencies).slice(0, 2)
  ]);

  const paperSections = [];
  if (paperItems.length > 0) {
    paperSections.push({
      title: "Paper evidence",
      items: paperItems
    });
  }
  paperSections.push({
    title: "Repository and reproduction evidence",
    items: papersItems
  });

  return {
    methods: [
      {
        title: "Core implementation",
        items: methodsItems
      }
    ],
    papers: paperSections
  };
}

function inferFunctionCallGraphEvidence(evidence) {
  const sections = evidence.selections || {};
  const metadataCalls = ensureArray(evidence.miningMetadata?.function_call_graph)
    .map((item) => item.source);
  return dedupe([
    ...metadataCalls,
    ...ensureArray(sections.notebooks).map((entry) => entry.path),
    ...ensureArray(sections.examples).map((entry) => entry.path),
    ...ensureArray(sections.entrypoints).map((entry) => entry.path)
  ]).slice(0, 8);
}

function sharedItems(left, right) {
  const rightSet = new Set(ensureArray(right));
  return ensureArray(left).filter((item) => rightSet.has(item));
}

function isImplementationPath(filePath) {
  return /\.(r|py|jl|m|sh)$/i.test(filePath || "")
    && !/readme|docs?|notebooks?|examples?|manuscript/i.test(filePath || "");
}

function structuredDagEvidence(evidence) {
  const metadata = evidence.miningMetadata || {};
  return {
    execution_order: ensureArray(metadata.execution_order),
    variable_flow: ensureArray(metadata.variable_flow),
    file_flow: ensureArray(metadata.file_flow),
    function_call_graph: ensureArray(metadata.function_call_graph)
  };
}

function inferDagEdgeReason(previous, current, hasExampleOrder, structuredSignals) {
  const previousOutputs = new Set(previous.output || []);
  const currentInputs = new Set(current.input || []);
  const shared = [...previousOutputs].filter((item) => currentInputs.has(item));
  if (shared.length > 0) {
    return {
      inference: "file_flow",
      detail: `Previous output feeds current input: ${shared.join(", ")}`
    };
  }

  const sharedVariables = sharedItems(previous.input, current.input);
  if (sharedVariables.length > 0 || structuredSignals.variable_flow.length > 0) {
    return {
      inference: "variable_flow",
      detail: sharedVariables.length > 0
        ? `Both steps operate on the same declared variable(s): ${sharedVariables.join(", ")}`
        : "Repository static analysis found variable assignments in notebooks or scripts."
    };
  }

  const sharedImplementation = sharedItems(previous.evidence, current.evidence)
    .filter((item) => isImplementationPath(item));
  if (sharedImplementation.length > 0 || structuredSignals.function_call_graph.length > 0) {
    return {
      inference: "function_call_graph",
      detail: sharedImplementation.length > 0
        ? `Shared implementation evidence supports this edge: ${sharedImplementation.slice(0, 3).join(", ")}`
        : "Repository static analysis found function-call evidence in notebooks or scripts."
    };
  }

  const previousText = `${previous.id} ${previous.titleEn} ${previous.detailsEn}`.toLowerCase();
  const currentText = `${current.id} ${current.titleEn} ${current.detailsEn}`.toLowerCase();
  if (/construct|build|prepare|validate/.test(previousText) && /run|calculate|rank|report|visualize/.test(currentText)) {
    return {
      inference: "semantic_dependency",
      detail: "The current step semantically depends on the previous prepared model, matrix, or validation state."
    };
  }

  if (hasExampleOrder) {
    return {
      inference: "notebook_script_execution_order",
      detail: "Example, notebook, or demo-script order supports this adjacent edge."
    };
  }

  return {
    inference: "manual_fallback_rule",
    detail: "No stronger variable/file/call evidence was available; use canonical adjacent workflow order."
  };
}

function inferDagEdges(workflowSteps, evidence) {
  const buckets = workflowEvidenceBuckets(evidence);
  const structuredSignals = structuredDagEvidence(evidence);
  const hasExampleOrder = buckets.running_examples.length > 0
    || buckets.official_docs.length > 0
    || structuredSignals.execution_order.length > 0;
  const callGraphEvidence = inferFunctionCallGraphEvidence(evidence);
  const edges = [];

  for (let index = 1; index < workflowSteps.length; index += 1) {
    const previous = workflowSteps[index - 1];
    const current = workflowSteps[index];
    const reason = inferDagEdgeReason(previous, current, hasExampleOrder, structuredSignals);
    edges.push({
      source: previous.id || previous.name || slugify(previous.titleEn),
      target: current.id || current.name || slugify(current.titleEn),
      inference: reason.inference,
      detail: reason.detail,
      structured_signals: {
        execution_order: structuredSignals.execution_order.slice(0, 4),
        variable_flow: structuredSignals.variable_flow.slice(0, 4),
        file_flow: structuredSignals.file_flow.slice(0, 4),
        function_call_graph: structuredSignals.function_call_graph.slice(0, 4)
      },
      evidence: dedupe([
        ...ensureArray(previous.evidence).slice(0, 2),
        ...ensureArray(current.evidence).slice(0, 2),
        ...callGraphEvidence.slice(0, 2)
      ]),
      evidence_sources: evidenceTraceItems(dedupe([
        ...ensureArray(previous.evidence).slice(0, 2),
        ...ensureArray(current.evidence).slice(0, 2),
        ...callGraphEvidence.slice(0, 2)
      ]), evidencePriorityLabel, `dag_edge.${previous.id || previous.name}->${current.id || current.name}`),
      evidence_priority_class: reason.inference,
      evidence_priority: dagInferencePriority()
    });
  }

  return edges;
}

function inferWorkflowSteps(evidence, domain, analysisType) {
  const buckets = workflowEvidenceBuckets(evidence);
  const readmePaths = buckets.readme.slice(0, 1);
  const entrypointPaths = buckets.source_api.slice(0, 4);
  const examplePaths = buckets.running_examples.slice(0, 4);
  const hasExamples = examplePaths.length > 0;

  if (domain === "single-cell" && analysisType === "tf-perturbation") {
    const evidenceBase = exampleFirstEvidence(evidence, 6);
    return [
      makeWorkflowStep({
        id: "00_validate_input",
        title: "validate_input",
        description: "Validate scRNA-seq object, cell annotation, perturbation TF list, and optional base GRN inputs.",
        evidence: evidenceBase.slice(0, 3),
        input: ["config", "scRNA_seq_object", "cell_annotation", "perturbation_tf_list"],
        output: ["qc/input_validation.json"]
      }),
      makeWorkflowStep({
        id: "01_prepare_input",
        title: "prepare_scRNA_object",
        description: "Prepare the single-cell object and grouping labels for CellOracle-style GRN modeling.",
        evidence: evidenceBase.slice(0, 3),
        input: ["scRNA_seq_object", "cell_annotation"],
        output: ["prepared/scrna_object_summary.json"]
      }),
      makeWorkflowStep({
        id: "02_prepare_base_grn",
        title: "prepare_or_load_base_GRN",
        description: "Load a user-provided base GRN, build one from scATAC/motif evidence, or select an appropriate species-specific default.",
        evidence: evidenceBase.slice(0, 3),
        input: ["base_grn", "scATAC_peaks", "species"],
        output: ["prepared/base_grn.csv"]
      }),
      makeWorkflowStep({
        id: "03_build_model",
        title: "build_predictive_GRN_model",
        description: "Build the Oracle object, run imputation, infer cell-state-specific GRNs, and fit predictive GRN models.",
        evidence: evidenceBase,
        input: ["prepared/scrna_object_summary.json", "prepared/base_grn.csv"],
        output: ["models/grn_model.json"]
      }),
      makeWorkflowStep({
        id: "04_run_perturbation",
        title: "run_TF_perturbation",
        description: "Run in silico TF perturbation for requested TF targets and calculate transition vectors.",
        evidence: evidenceBase,
        input: ["models/grn_model.json", "perturbation_tf_list"],
        output: ["results/perturbation_vectors.csv", "results/transition_vectors.csv"]
      }),
      makeWorkflowStep({
        id: "05_generate_report",
        title: "generate_report",
        description: "Generate figures, QC summary, biological interpretation notes, limitations, and reproducibility metadata.",
        layer: "wrapper",
        evidence: dedupe([...readmePaths, ...examplePaths]),
        input: ["results/perturbation_vectors.csv", "qc/input_validation.json"],
        output: ["reports/report_template.md", "result.json"]
      })
    ];
  }

  if (domain === "single-cell" && analysisType === "virtual-knockout") {
    const evidenceBase = exampleFirstEvidence(evidence, 6);
    return [
      makeWorkflowStep({
        id: "00_validate_input",
        title: "validate_input",
        description: "Validate WT matrix path, matrix orientation, raw-count state, and knockout gene.",
        evidence: evidenceBase.slice(0, 3),
        input: ["config", "wt_expression_matrix", "knockout_gene"],
        output: ["qc/input_validation.json"]
      }),
      makeWorkflowStep({
        id: "01_preprocess_expression_matrix",
        title: "preprocess_expression_matrix",
        description: "Filter genes and cells, confirm matrix orientation, and prepare the WT expression matrix.",
        evidence: evidenceBase,
        input: ["wt_expression_matrix"],
        output: ["prepared/wt_matrix.csv"]
      }),
      makeWorkflowStep({
        id: "02_construct_wt_scgrn",
        title: "construct_wt_scGRN",
        description: "Construct the wild-type single-cell gene regulatory network.",
        evidence: evidenceBase,
        input: ["prepared/wt_matrix.csv"],
        output: ["models/wt_scgrn.csv"]
      }),
      makeWorkflowStep({
        id: "03_simulate_gene_knockout",
        title: "simulate_gene_knockout",
        description: "Simulate knockout by perturbing target-gene regulatory edges.",
        evidence: evidenceBase,
        input: ["models/wt_scgrn.csv", "knockout_gene"],
        output: ["models/ko_scgrn.csv"]
      }),
      makeWorkflowStep({
        id: "04_run_manifold_alignment",
        title: "run_manifold_alignment",
        description: "Align WT and KO network manifolds.",
        evidence: evidenceBase,
        input: ["models/wt_scgrn.csv", "models/ko_scgrn.csv"],
        output: ["results/manifold_alignment.json"]
      }),
      makeWorkflowStep({
        id: "05_calculate_differential_regulation",
        title: "calculate_differential_regulation",
        description: "Calculate differential regulation between WT and KO networks.",
        evidence: evidenceBase,
        input: ["results/manifold_alignment.json"],
        output: ["results/differential_regulation.csv"]
      }),
      makeWorkflowStep({
        id: "06_rank_perturbed_genes",
        title: "rank_perturbed_genes",
        description: "Rank genes by perturbation or differential-regulation score.",
        evidence: evidenceBase,
        input: ["results/differential_regulation.csv"],
        output: ["results/perturbed_gene_ranking.csv"]
      }),
      makeWorkflowStep({
        id: "07_run_pathway_enrichment",
        title: "run_pathway_enrichment",
        description: "Run optional pathway or GO enrichment when organism and database support it.",
        evidence: dedupe([...readmePaths, ...examplePaths]),
        input: ["results/perturbed_gene_ranking.csv", "enrichment_database"],
        output: ["results/pathway_enrichment.csv"]
      }),
      makeWorkflowStep({
        id: "08_generate_report",
        title: "generate_report",
        description: "Generate QC summary, ranked outputs, interpretation caveats, and reproducibility metadata.",
        layer: "wrapper",
        evidence: dedupe([...readmePaths, ...examplePaths]),
        input: ["results/differential_regulation.csv", "results/perturbed_gene_ranking.csv"],
        output: ["reports/report_template.md", "result.json"]
      })
    ];

    return [
      {
        titleZh: "Route and validate the input manifest",
        titleEn: "Route and validate the input manifest",
        detailsZh: "First confirm that the task belongs to WT-only virtual knockout, then validate matrix orientation, count-state assumptions, and knockout-gene fields.",
        detailsEn: "First confirm that the task belongs to WT-only virtual knockout, then validate matrix orientation, count-state assumptions, and knockout-gene fields.",
        layer: "core",
        evidence: dedupe([...readmePaths, ...entrypointPaths.slice(0, 2)])
      },
      {
        titleZh: "Plan the core virtual-knockout path",
        titleEn: "Plan the core virtual-knockout path",
        detailsZh: "Use the implementation evidence to organize QC, network construction, directionality constraints, perturbation simulation, and differential-regulation scoring.",
        detailsEn: "Use the implementation evidence to organize QC, network construction, directionality constraints, perturbation simulation, and differential-regulation scoring.",
        layer: "core",
        evidence: entrypointPaths
      },
      {
        titleZh: "Explicitly isolate manuscript reproduction branches",
        titleEn: "Explicitly isolate manuscript reproduction branches",
        detailsZh: hasExamples
          ? "Only include manuscript or example branches when analysis mode explicitly allows reproduction."
          : "If official example or manuscript evidence is missing, do not invent reproduction branches.",
        detailsEn: hasExamples
          ? "Only allow manuscript or example branches into the plan when the analysis mode explicitly enables reproduction."
          : "If the repository lacks official examples or manuscript evidence, do not invent reproduction branches.",
        layer: "reproduction",
        evidence: examplePaths.length > 0 ? examplePaths : ["Not confirmed in paper or code"]
      },
      {
        titleZh: "Assemble the result contract and report",
        titleEn: "Assemble the result contract and report",
        detailsZh: "Whether or not the run is a dry-run, emit the standard bundle, parameter resolution, runtime probe, QC summary, and caveats.",
        detailsEn: "Whether or not the run is a dry-run, emit the standard bundle, parameter resolution, runtime probe, QC summary, and caveats.",
        layer: "wrapper",
        evidence: dedupe([...readmePaths, ...ensureArray(evidence.selections?.dependencies).slice(0, 1).map((entry) => entry.path)])
      }
    ];
  }

  return [
    {
      titleZh: "Validate the input contract",
      titleEn: "Validate the input contract",
      detailsZh: "First validate the manifest, data-object state, and required file paths.",
      detailsEn: "First validate the manifest, data-object state, and required file paths.",
      layer: "core",
      evidence: dedupe([...readmePaths, ...entrypointPaths.slice(0, 1)])
    },
    {
      titleZh: "Plan the core method steps",
      titleEn: "Plan the core method steps",
      detailsZh: "Use the main implementation files to map the core method order while preserving evidence references.",
      detailsEn: "Use the main implementation files to map the core method order while preserving evidence references.",
      layer: "core",
      evidence: entrypointPaths
    },
    {
      titleZh: "Assemble the result contract and report",
      titleEn: "Assemble the result contract and report",
      detailsZh: "Emit the standard result bundle, machine-readable result, and report.",
      detailsEn: "Emit the standard result bundle, machine-readable result, and report.",
      layer: "wrapper",
      evidence: readmePaths
    }
  ];
}

function inferRequiredOutputs(domain, analysisType) {
  if (domain === "single-cell" && analysisType === "tf-perturbation") {
    return [
      "qc_summary",
      "base_grn",
      "predictive_grn_model",
      "perturbation_vectors",
      "transition_vectors",
      "report"
    ];
  }

  if (domain === "single-cell" && analysisType === "virtual-knockout") {
    return [
      "qc_summary",
      "network_models",
      "perturbation_summary",
      "differential_regulation"
    ];
  }

  if (analysisType === "differential-expression") {
    return ["qc_summary", "normalized_counts", "model_fit", "differential_table"];
  }

  return ["qc_summary", "analysis_summary", "primary_result_table"];
}

function inferRuntimeAdapters(evidence, runtime, algorithmClassification) {
  const implementation = algorithmClassification?.implementation || {};
  const executionModes = implementation.execution_modes || [];
  const adapters = [];
  if (executionModes.includes("python_api")) {
    adapters.push({
      adapter_id: "python_api",
      runtime: "python",
      mode: "python_api",
      status: runtime === "python" ? "candidate" : "available_as_secondary",
      entrypoint_evidence: evidenceTraceItems(
        ensureArray(evidence.selections?.entrypoints).filter((entry) => /\.py$/i.test(entry.path)).map((entry) => entry.path),
        evidencePriorityLabel,
        "runtime_adapter.python_api"
      )
    });
  }
  if (executionModes.includes("r_api")) {
    adapters.push({
      adapter_id: "rscript",
      runtime: "r",
      mode: "r_api",
      status: runtime === "r" ? "candidate" : "available_as_secondary",
      entrypoint_evidence: evidenceTraceItems(
        ensureArray(evidence.selections?.entrypoints).filter((entry) => /\.r$/i.test(entry.path)).map((entry) => entry.path),
        evidencePriorityLabel,
        "runtime_adapter.r_api"
      )
    });
  }
  if (executionModes.includes("notebook")) {
    adapters.push({
      adapter_id: "notebook",
      runtime: "jupyter",
      mode: "notebook",
      status: "candidate",
      entrypoint_evidence: evidenceTraceItems(
        ensureArray(evidence.selections?.notebooks).map((entry) => entry.path),
        evidencePriorityLabel,
        "runtime_adapter.notebook"
      )
    });
  }
  if (adapters.length === 0) {
    adapters.push({
      adapter_id: "dry_run_only",
      runtime: "python",
      mode: "wrapper_only",
      status: "fallback",
      blocked_reason: "No Python API, R API, CLI, or notebook entrypoint was confirmed from repository evidence.",
      entrypoint_evidence: []
    });
  }
  return adapters;
}

function inferExecutionContract(evidence, domain, analysisType, runtime, primaryTool, algorithmClassification) {
  const runtimeTargets = [
    {
      name: "python",
      executable: "python",
      required: true,
      zh: "Python orchestrator runtime.",
      en: "Python orchestrator runtime."
    }
  ];

  if (runtime === "r") {
    runtimeTargets.push({
      name: "Rscript",
      executable: "Rscript",
      required: true,
      zh: `${primaryTool} native execution runtime.`,
      en: `${primaryTool} native execution runtime.`
    });
  }

  const workflowSteps = inferWorkflowSteps(evidence, domain, analysisType);
  const dagEdges = inferDagEdges(workflowSteps, evidence);

  const runtimeAdapters = inferRuntimeAdapters(evidence, runtime, algorithmClassification);
  return {
    runtime_targets: runtimeTargets,
    runtime_adapters: runtimeAdapters,
    workflow_mining_priority: workflowMiningPriority(),
    workflow_steps: workflowSteps,
    dag_edges: dagEdges,
    command_templates: [
      `echo Planning ${primaryTool}`,
      "echo Manifest: {manifest_path}",
      "echo Output directory: {out_dir}"
    ],
    required_outputs: inferRequiredOutputs(domain, analysisType),
    supports_native_run: false,
    native_run_status: {
      status: "blocked_until_adapter_is_implemented",
      reason: "The generated child skill keeps dry-run behavior until a source-backed adapter is explicitly implemented and tested."
    }
  };
}

function inferQcContract(domain, analysisType, runtime) {
  if (domain === "single-cell" && analysisType === "tf-perturbation") {
    return {
      rules: [
        {
          metric: "input_contract_integrity",
          zh: "Check required scRNA-seq object, annotation, and perturbation TF fields.",
          en: "Check required scRNA-seq object, annotation, and perturbation TF fields.",
          passZh: "All required manifest fields and files are available.",
          passEn: "All required manifest fields and files are available.",
          warnZh: "Optional base GRN or pseudotime inputs are absent; workflow will use fallback behavior.",
          warnEn: "Optional base GRN or pseudotime inputs are absent; workflow will use fallback behavior.",
          failZh: "Required input is missing or unreadable.",
          failEn: "Required input is missing or unreadable."
        },
        {
          metric: "tf_and_grn_readiness",
          zh: "Check TF targets in expression matrix and base GRN.",
          en: "Check TF targets in expression matrix and base GRN.",
          passZh: "TF targets are present and a base GRN source is available.",
          passEn: "TF targets are present and a base GRN source is available.",
          warnZh: "Some TF targets or base GRN support require user confirmation.",
          warnEn: "Some TF targets or base GRN support require user confirmation.",
          failZh: "No valid perturbation target or base GRN source is available.",
          failEn: "No valid perturbation target or base GRN source is available."
        },
        {
          metric: "transition_vector_output",
          zh: "Check perturbation and transition vector output shape.",
          en: "Check perturbation and transition vector output shape.",
          passZh: "Perturbation and transition-vector outputs are non-empty.",
          passEn: "Perturbation and transition-vector outputs are non-empty.",
          warnZh: "Outputs exist but may need biological caveats.",
          warnEn: "Outputs exist but may need biological caveats.",
          failZh: "Expected perturbation outputs were not generated.",
          failEn: "Expected perturbation outputs were not generated."
        }
      ],
      validation_scenarios: [
        pair("Dry-run validates CellOracle input contract.", "Dry-run validates CellOracle input contract."),
        pair("Missing TF target fails input validation.", "Missing TF target fails input validation.")
      ],
      interpretation_boundary: [
        {
          status: "pass",
          zh: "A pass supports normal interpretation with reported caveats.",
          en: "A pass supports normal interpretation with reported caveats."
        },
        {
          status: "warn",
          zh: "A warning requires explicit caveats in the report.",
          en: "A warning requires explicit caveats in the report."
        },
        {
          status: "fail",
          zh: "A failure must not be treated as a reliable biological result.",
          en: "A failure must not be treated as a reliable biological result."
        }
      ]
    };
  }

  if (domain === "single-cell" && analysisType === "virtual-knockout") {
    return {
      rules: [
        {
          metric: "input_contract_integrity",
          zh: "Check whether the WT matrix path, orientation, count state, and knockout gene satisfy the contract.",
          en: "Check whether the WT matrix path, orientation, count state, and knockout gene satisfy the contract.",
          passZh: "The input contract passes and execution planning may continue.",
          passEn: "The input contract passes and execution planning may continue.",
          warnZh: "The dry-run only completed preflight checks and has not produced method-level QC conclusions.",
          warnEn: "The dry-run only completed preflight checks and has not produced method-level QC conclusions.",
          failZh: "The input violates the contract and the output must not be treated as a reliable executed analysis.",
          failEn: "The input violates the contract and the output must not be treated as a reliable executed analysis."
        },
        {
          metric: "single_cell_preflight",
          zh: "Check that gene names are retained and that a normalized matrix is not misrepresented as raw counts.",
          en: "Check that gene names are retained and that a normalized matrix is not misrepresented as raw counts.",
          passZh: "The object state satisfies the prerequisites for a single-cell perturbation workflow.",
          passEn: "The object state satisfies the prerequisites for a single-cell perturbation workflow.",
          warnZh: "Part of the object state still depends on manifest declarations and should be verified before a full run.",
          warnEn: "Part of the object state still depends on manifest declarations and should be verified before a full run.",
          failZh: "The object state is inconsistent with the method requirements.",
          failEn: "The object state is inconsistent with the method requirements."
        },
        {
          metric: "runtime_readiness",
          requires_runtime: true,
          zh: "Check whether Python and Rscript are available.",
          en: "Check whether Python and Rscript are available.",
          passZh: "Required runtimes are ready.",
          passEn: "Required runtimes are ready.",
          warnZh: "The dry-run may continue, but native execution has not yet consumed the method runtime.",
          warnEn: "The dry-run may continue, but native execution has not yet consumed the method runtime.",
          failZh: "A required runtime is missing and the wrapper should return a blocked status.",
          failEn: "A required runtime is missing and the wrapper should return a blocked status."
        }
      ],
      validation_scenarios: [
        pair("Minimum smoke test: valid manifest, successful dry-run, and a complete result bundle.", "Minimum smoke test: valid manifest, successful dry-run, and a complete result bundle."),
        pair("Missing-runtime test: simulate a missing Rscript and return blocked_runtime_missing.", "Missing-runtime test: simulate a missing Rscript and return blocked_runtime_missing.")
      ],
      interpretation_boundary: [
        pair("A pass only means the contract and preflight checks succeeded; it does not mean the biological conclusion is already established.", "A pass only means the contract and preflight checks succeeded; it does not mean the biological conclusion is already established."),
        pair("A warning means the output may guide planning or reporting, but caveats must remain visible.", "A warning means the output may guide planning or reporting, but caveats must remain visible."),
        pair("A failure means the output must not be written up as a reliable conclusion.", "A failure means the output must not be written up as a reliable conclusion.")
      ].map((item, index) => ({
        status: ["pass", "warn", "fail"][index],
        zh: item.en,
        en: item.en
      }))
    };
  }

  return {
    rules: [
      {
        metric: "input_contract_integrity",
        zh: "Check whether input paths and object state satisfy the contract.",
        en: "Check whether input paths and object state satisfy the contract.",
        passZh: "The input contract passes.",
        passEn: "The input contract passes.",
        warnZh: "The dry-run only completed preflight checks.",
        warnEn: "The dry-run only completed preflight checks.",
        failZh: "The input violates the contract.",
        failEn: "The input violates the contract."
      },
      {
        metric: "runtime_readiness",
        requires_runtime: true,
        zh: `Check whether the ${runtime} runtime is available.`,
        en: `Check whether the ${runtime} runtime is available.`,
        passZh: "The runtime is ready.",
        passEn: "The runtime is ready.",
        warnZh: "The dry-run may continue, but native execution is not yet validated.",
        warnEn: "The dry-run may continue, but native execution is not yet validated.",
        failZh: "The runtime is missing and the wrapper should return a blocked status.",
        failEn: "The runtime is missing and the wrapper should return a blocked status."
      }
    ],
    validation_scenarios: [
      pair("Minimum smoke test: valid manifest and complete bundle.", "Minimum smoke test: valid manifest and complete bundle.")
    ],
    interpretation_boundary: [
      { status: "pass", ...pair("The contract and preflight checks passed.", "The contract and preflight checks passed.") },
      { status: "warn", ...pair("The result may be usable but must retain caveats.", "The result may be usable but must retain caveats.") },
      { status: "fail", ...pair("The result must not be treated as a reliable analysis output.", "The result must not be treated as a reliable analysis output.") }
    ]
  };
}

function inferOutputBundle() {
  return {
    required_paths: [
      "README.md",
      "report.md",
      "result.json",
      "tables",
      "figures",
      "figure_data",
      "parameters",
      "parameters/resolved_parameters.json",
      "qc",
      "qc/input_validation.json",
      "qc/runtime_probe.json",
      "qc/qc_summary.json",
      "workflow",
      "workflow/steps.json",
      "workflow/dag_edges.json",
      "reproducibility",
      "reproducibility/plan.json",
      "reproducibility/execution_plan.json",
      "reproducibility/evidence_summary.json",
      "logs"
    ],
    result_fields: [
      "status",
      "skill_name",
      "paper_title",
      "runtime_probe",
      "input_validation",
      "parameter_resolution",
      "workflow_summary",
      "evidence_summary",
      "qc_summary",
      "artifacts",
      "caveats",
      "citations_used"
    ],
    bundle_notes: [
      pair("Even a dry-run must emit the full directory structure and a machine-readable result.json.", "Even a dry-run must emit the full directory structure and a machine-readable result.json."),
      pair("Do not silently rewrite manuscript-reproduction artifacts as if they were core-method conclusions.", "Do not silently rewrite manuscript-reproduction artifacts as if they were core-method conclusions.")
    ]
  };
}

function inferReproducibilityContract() {
  return {
    capture_items: [
      pair("Input manifest path and key state fields.", "Input manifest path and key state fields."),
      pair("Parameter-resolution sources and default rationales.", "Parameter-resolution sources and default rationales."),
      pair("Runtime probe results, planned commands, and installation records.", "Runtime probe results, planned commands, and installation records.")
    ],
    install_policy: [
      pair("If the target runtime environment lacks dependencies, install them only inside that environment and record the commands under reproducibility.", "If the target runtime environment lacks dependencies, install them only inside that environment and record the commands under reproducibility.")
    ]
  };
}

function inferFailureModes(domain, analysisType, runtime) {
  const base = [
    {
      conditionZh: "The input object state is inconsistent with the contract",
      conditionEn: "The input object state is inconsistent with the contract",
      recoveryZh: "Require the user to correct the manifest and explicitly declare object state instead of letting the wrapper guess.",
      recoveryEn: "Require the user to correct the manifest and explicitly declare object state instead of letting the wrapper guess."
    },
    {
      conditionZh: `${runtime === "r" ? "Rscript" : "The primary runtime"} is missing`,
      conditionEn: `${runtime === "r" ? "Rscript" : "The primary runtime"} is missing`,
      recoveryZh: "Return blocked_runtime_missing and retry after installing the required runtime in the target environment.",
      recoveryEn: "Return blocked_runtime_missing and retry after installing the required runtime in the target environment."
    }
  ];

  if (domain === "single-cell" && analysisType === "virtual-knockout") {
    base.push({
      conditionZh: "The user treats manuscript reproduction branches as core-method input requirements",
      conditionEn: "The user treats manuscript reproduction branches as core-method input requirements",
      recoveryZh: "Label reproduction branches explicitly in the report and keep the WT-only path as the minimum execution contract.",
      recoveryEn: "Label reproduction branches explicitly in the report and keep the WT-only path as the minimum execution contract."
    });
  }

  return base;
}

function inferExampleGene(evidence) {
  const examplePaths = ensureArray(evidence.selections?.examples).map((entry) => entry.path);
  for (const entry of examplePaths) {
    const matched = entry.match(/manuscript\/([^/]+)/i);
    if (matched && /^[A-Za-z0-9_-]{2,20}$/.test(matched[1])) {
      return matched[1];
    }
  }
  return "GENE_A";
}

function inferCitations(paperTitle, paperUrl, githubUrl, paperEvidence) {
  const preferredPaperUrl = paperUrl
    || paperEvidence?.paper?.preferredCitationUrl
    || paperEvidence?.paper?.paperUrl
    || paperEvidence?.paper?.articleUrl
    || "";
  return [
    {
      label: `${paperTitle} paper`,
      url: preferredPaperUrl,
      noteZh: "Primary paper link.",
      noteEn: "Primary paper link."
    },
    {
      label: "Official repository",
      url: githubUrl,
      noteZh: "Official code repository.",
      noteEn: "Official code repository."
    }
  ];
}

function validatePaperEvidence(paperEvidence) {
  if (!paperEvidence) {
    return;
  }

  const required = [
    "paper.resolvedTitle",
    "paper.sourceType"
  ];

  for (const dottedPath of required) {
    const parts = dottedPath.split(".");
    let current = paperEvidence;
    for (const part of parts) {
      if (current && Object.prototype.hasOwnProperty.call(current, part)) {
        current = current[part];
      } else {
        fail(`Paper evidence is missing required path: ${dottedPath}`);
      }
    }
  }
}

function validateEvidence(evidence) {
  const required = [
    "repo.repo",
    "repo.githubUrl",
    "selections.readme",
    "selections.dependencies",
    "selections.entrypoints",
    "selections.examples"
  ];

  for (const dottedPath of required) {
    const parts = dottedPath.split(".");
    let current = evidence;
    for (const part of parts) {
      if (current && Object.prototype.hasOwnProperty.call(current, part)) {
        current = current[part];
      } else {
        fail(`Evidence file is missing required path: ${dottedPath}`);
      }
    }
  }
}

function ensureEvidenceSourceIds(sources, claimType) {
  return ensureArray(sources).map((source, index) => {
    if (source && typeof source === "object") {
      const normalizedSource = source.source || source.path || source.url || `source_${index}`;
      const category = source.category || source.priority_class || evidencePriorityLabel(normalizedSource);
      return {
        evidence_id: source.evidence_id || stableEvidenceId(`${claimType}.${index}`, normalizedSource),
        source: normalizedSource,
        path: source.path,
        url: source.url,
        source_type: source.source_type || inferEvidenceSourceType(normalizedSource, category),
        category,
        priority_class: category,
        claim_type: source.claim_type || claimType,
        location: source.location,
        snippet: source.snippet
      };
    }
    const normalizedSource = String(source || `source_${index}`);
    const category = evidencePriorityLabel(normalizedSource);
    return {
      evidence_id: stableEvidenceId(`${claimType}.${index}`, normalizedSource),
      source: normalizedSource,
      source_type: inferEvidenceSourceType(normalizedSource, category),
      category,
      priority_class: category,
      claim_type: claimType
    };
  });
}

function normalizeEnglishFields(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeEnglishFields(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const normalized = {};
  for (const [key, item] of Object.entries(value)) {
    normalized[key] = normalizeEnglishFields(item);
  }

  const mirrorPairs = [
    ["zh", "en"],
    ["titleZh", "titleEn"],
    ["detailsZh", "detailsEn"],
    ["noteZh", "noteEn"],
    ["conditionZh", "conditionEn"],
    ["recoveryZh", "recoveryEn"],
    ["passZh", "passEn"],
    ["warnZh", "warnEn"],
    ["failZh", "failEn"]
  ];
  for (const [target, source] of mirrorPairs) {
    if (Object.prototype.hasOwnProperty.call(normalized, source)) {
      normalized[target] = normalized[source];
    }
  }
  return normalized;
}

function annotateClaimEvidence(spec) {
  const classification = spec.algorithmClassification?.classification || {};
  const implementation = spec.algorithmClassification?.implementation || {};
  classification.evidence_sources = ensureEvidenceSourceIds(classification.evidence || [], "classification");
  classification.evidence_id = stableEvidenceId("classification.primary_task", classification.primary_task || spec.skillName);
  implementation.evidence_sources = ensureEvidenceSourceIds(implementation.evidence || [], "implementation");
  implementation.evidence_id = stableEvidenceId("implementation.languages", (implementation.languages || []).join("-"));

  for (const [facetName, facet] of Object.entries(classification.perturbation || {})) {
    facet.evidence_id = stableEvidenceId(`perturbation.${facetName}`, facet.value);
    facet.evidence_sources = ensureEvidenceSourceIds(facet.evidence || [], `perturbation.${facetName}`);
  }

  const parameterGroups = ["user_required", "auto_detected", "literature_defaults", "wrapper_defaults"];
  for (const group of parameterGroups) {
    spec.parameterPolicy[group] = ensureArray(spec.parameterPolicy[group]).map((item) => ({
      ...item,
      evidence_id: item.evidence_id || stableEvidenceId(`parameter.${item.name}`, item.name),
      evidence_sources: ensureEvidenceSourceIds(item.evidence_sources || item.sources || [group], `parameter.${item.name}`)
    }));
  }

  spec.executionContract.workflow_steps = ensureArray(spec.executionContract.workflow_steps).map((step) => ({
    ...step,
    evidence_id: step.evidence_id || stableEvidenceId(`workflow_step.${step.id || step.name}`, step.id || step.name),
    evidence_sources: ensureEvidenceSourceIds(step.evidence_sources || step.evidence || [], `workflow_step.${step.id || step.name}`)
  }));
  spec.executionContract.dag_edges = ensureArray(spec.executionContract.dag_edges).map((edge) => ({
    ...edge,
    evidence_id: edge.evidence_id || stableEvidenceId(`dag_edge.${edge.source}->${edge.target}`, `${edge.source}->${edge.target}`),
    evidence_sources: ensureEvidenceSourceIds(edge.evidence_sources || edge.evidence || [], `dag_edge.${edge.source}->${edge.target}`)
  }));

  spec.evidenceSchema = {
    version: "1.0",
    required_fields: ["evidence_id", "source", "source_type", "priority_class", "claim_type"],
    claim_types: ["classification", "perturbation", "parameter", "workflow_step", "dag_edge", "runtime_adapter"]
  };
  return spec;
}

function validateContractSpec(spec) {
  const requiredPaths = [
    ["skillName", spec.skillName],
    ["algorithmClassification.classification.primary_task", spec.algorithmClassification?.classification?.primary_task],
    ["algorithmClassification.implementation.execution_modes", spec.algorithmClassification?.implementation?.execution_modes],
    ["parameterPolicy.evidence_priority", spec.parameterPolicy?.evidence_priority],
    ["executionContract.workflow_steps", spec.executionContract?.workflow_steps],
    ["executionContract.dag_edges", spec.executionContract?.dag_edges],
    ["executionContract.runtime_adapters", spec.executionContract?.runtime_adapters],
    ["qcContract.rules", spec.qcContract?.rules],
    ["outputBundle.required_paths", spec.outputBundle?.required_paths]
  ];
  for (const [label, value] of requiredPaths) {
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
      fail(`Generated contract is missing required schema path: ${label}`);
    }
  }
  const missingIds = [
    ...ensureArray(spec.parameterPolicy.user_required),
    ...ensureArray(spec.parameterPolicy.auto_detected),
    ...ensureArray(spec.parameterPolicy.literature_defaults),
    ...ensureArray(spec.parameterPolicy.wrapper_defaults),
    ...ensureArray(spec.executionContract.workflow_steps),
    ...ensureArray(spec.executionContract.dag_edges)
  ].filter((item) => !item.evidence_id);
  if (missingIds.length > 0) {
    fail("Generated contract has traceable claims without evidence_id.");
  }
}

function finalizeSpec(rawSpec) {
  const spec = annotateClaimEvidence(normalizeEnglishFields(rawSpec));
  spec.schema_version = "paper2omics.contract.v1";
  validateContractSpec(spec);
  return spec;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function loadRepoEvidence(args) {
  if (args["evidence-file"]) {
    return readJson(args["evidence-file"]);
  }

  const githubUrl = args["github-url"];
  if (!githubUrl) {
    fail("Missing required argument: --github-url");
  }

  const collectScript = path.join(__dirname, "collect-repo-evidence.js");
  const collectArgs = [
    collectScript,
    "--github-url",
    githubUrl
  ];

  if (args["token-env"]) {
    collectArgs.push("--token-env", args["token-env"]);
  }
  if (args["max-files"]) {
    collectArgs.push("--max-files", args["max-files"]);
  }
  if (args["max-preview-chars"]) {
    collectArgs.push("--max-preview-chars", args["max-preview-chars"]);
  }

  const completed = await execFileAsync(process.execPath, collectArgs, {
    maxBuffer: MAX_BUFFER,
    env: process.env
  });
  return JSON.parse(completed.stdout);
}

async function loadPaperEvidence(args) {
  if (args["paper-evidence-file"]) {
    return readJson(args["paper-evidence-file"]);
  }

  const hasPaperSource = Boolean(
    args["paper-title"]
      || args["article-url"]
      || args["article-file"]
      || args["pdf-path"]
  );

  if (!hasPaperSource) {
    return null;
  }

  const collectScript = path.join(__dirname, "collect-paper-evidence.js");
  const collectArgs = [collectScript];
  const passthroughKeys = [
    "paper-title",
    "paper-url",
    "article-url",
    "article-file",
    "pdf-path",
    "max-text-chars",
    "snippet-chars"
  ];

  for (const key of passthroughKeys) {
    if (args[key]) {
      collectArgs.push(`--${key}`, args[key]);
    }
  }

  const completed = await execFileAsync(process.execPath, collectArgs, {
    maxBuffer: MAX_BUFFER,
    env: process.env
  });
  return JSON.parse(completed.stdout);
}

function buildSpec(args, repoEvidence, paperEvidence) {
  validateEvidence(repoEvidence);
  validatePaperEvidence(paperEvidence);

  const paperTitle = args["paper-title"]
    || paperEvidence?.paper?.resolvedTitle
    || paperEvidence?.paper?.requestedTitle;
  const paperUrl = args["paper-url"]
    || paperEvidence?.paper?.preferredCitationUrl
    || paperEvidence?.paper?.paperUrl
    || paperEvidence?.paper?.articleUrl
    || "";
  const githubUrl = args["github-url"] || repoEvidence.repo.githubUrl;

  if (!paperTitle) {
    fail("Missing required paper evidence. Provide --paper-title, --article-url, --article-file, --pdf-path, or --paper-evidence-file");
  }

  const text = [
    collectTextCorpus(repoEvidence),
    collectPaperTextCorpus(paperEvidence)
  ].filter(Boolean).join("\n\n");
  const domain = inferDomain(text, args.domain);
  const analysisType = inferAnalysisType(text, args["analysis-type"]);
  const runtime = inferRuntime(repoEvidence, text, args["tool-runtime"]);
  const primaryTool = inferPrimaryTool(repoEvidence, paperTitle, args["primary-tool"]);
  const skillName = inferSkillName(primaryTool, args["skill-name"]);
  const displayName = inferDisplayName(primaryTool, args["display-name"]);
  const exampleGene = inferExampleGene(repoEvidence);
  const hasExamples = ensureArray(repoEvidence.selections?.examples).length > 0;
  const inputContract = inferInputContract(domain, analysisType, exampleGene);
  const algorithmClassification = inferAlgorithmClassification(
    domain,
    analysisType,
    runtime,
    primaryTool,
    githubUrl,
    text,
    args["preferred-language"]
  );

  const rawSpec = {
    skillName,
    displayName,
    paperTitle,
    paperUrl,
    githubUrl,
    algorithmClassification,
    metadata: {
      version: args.version || "0.3.0",
      author: args.author || "OpenAI Codex",
      domain,
      analysis_type: analysisType,
      primary_tool: primaryTool,
      tool_runtime: runtime,
      dependencies: inferDependencies(runtime, primaryTool, text),
      trigger_keywords: inferTriggerKeywords(primaryTool, domain, analysisType, text),
      allowed_extra_flags: ["--input", "--out", "--config", "--dry-run", "--resume"],
      legacy_aliases: inferLegacyAliases(primaryTool, skillName),
      param_hints: inferParamHints(domain, analysisType)
    },
    routing: inferRouting(primaryTool, domain, analysisType, hasExamples),
    inputContract: {
      formats: inputContract.formats,
      required_manifest_fields: inputContract.required_manifest_fields,
      file_fields: inputContract.file_fields,
      state_requirements: inputContract.state_requirements
    },
    parameterPolicy: inferParameterPolicy(domain, analysisType, runtime, text, repoEvidence),
    executionContract: inferExecutionContract(repoEvidence, domain, analysisType, runtime, primaryTool, algorithmClassification),
    qcContract: inferQcContract(domain, analysisType, runtime),
    outputBundle: inferOutputBundle(),
    reproducibilityContract: inferReproducibilityContract(),
    testContract: {
      expected_status: "dry_run_ready",
      demo_input_manifest: inputContract.demo_input_manifest,
      demo_files: inputContract.demo_files,
      smoke_scenarios: [
        pair("The dry-run generates the full bundle.", "The dry-run generates the full bundle."),
        pair("validate-output fails when report.md is missing.", "validate-output fails when report.md is missing.")
      ]
    },
    references: inferReferences(repoEvidence, paperEvidence),
    failureModes: inferFailureModes(domain, analysisType, runtime),
    citations: inferCitations(paperTitle, paperUrl, githubUrl, paperEvidence)
  };
  return finalizeSpec(rawSpec);
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoEvidence = await loadRepoEvidence(args);
  const paperEvidence = await loadPaperEvidence(args);
  const spec = buildSpec(args, repoEvidence, paperEvidence);

  if (args.out) {
    await writeJson(args.out, spec);
  } else {
    process.stdout.write(`${JSON.stringify(spec, null, 2)}\n`);
  }
}

main().catch((error) => {
  fail(error.stack || error.message);
});
