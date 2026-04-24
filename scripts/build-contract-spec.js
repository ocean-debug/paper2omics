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

function pair(zh, en) {
  return { zh, en };
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
    joinPreviews(sections.examples)
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
    ...ensureArray(sections.examples).map((entry) => entry.path)
  ]);
}

function regexCount(text, expressions) {
  return expressions.reduce((count, expression) => {
    const matched = text.match(expression);
    return count + (matched ? matched.length : 0);
  }, 0);
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
      return pair("单细胞组学", "single-cell omics");
    case "bulk-rna":
      return pair("整体转录组", "bulk transcriptomics");
    case "spatial":
      return pair("空间转录组", "spatial transcriptomics");
    case "atac-chip":
      return pair("表观组学", "epigenomics");
    case "proteomics":
      return pair("蛋白质组学", "proteomics");
    case "multi-omics":
      return pair("多组学", "multi-omics");
    default:
      return pair("组学分析", "omics analysis");
  }
}

function inferAnalysisLabels(analysisType) {
  switch (analysisType) {
    case "virtual-knockout":
      return pair("虚拟敲除", "virtual knockout");
    case "differential-expression":
      return pair("差异表达", "differential expression");
    case "gene-regulatory-network":
      return pair("基因调控网络分析", "gene regulatory network analysis");
    case "peak-calling":
      return pair("峰调用", "peak calling");
    case "integration":
      return pair("整合分析", "integration analysis");
    default:
      return pair("方法执行", "method execution");
  }
}

function inferRouting(primaryTool, domain, analysisType, hasExamples) {
  const domainLabel = inferDomainLabels(domain);
  const analysisLabel = inferAnalysisLabels(analysisType);

  if (domain === "single-cell" && analysisType === "virtual-knockout") {
    return {
      why_this_exists: pair(
        `这个 skill 把 ${primaryTool} 的论文和官方仓库整理成可路由、可校验、可报告的执行合同，用于在 WT 单细胞表达矩阵上执行虚拟敲除分析。`,
        `This skill turns ${primaryTool} into a routable, validated, and report-producing execution contract for virtual knockout on WT single-cell expression matrices.`
      ),
      when_to_use: [
        pair(
          "当任务是从 WT scRNA-seq 矩阵出发，对候选基因执行虚拟敲除并输出扰动或差异调控结果时使用。",
          "Use when the task starts from a WT scRNA-seq matrix and needs virtual knockout plus perturbation or differential-regulation outputs."
        ),
        pair(
          hasExamples
            ? "当需要区分核心 WT-only 工作流与仓库里的 manuscript 复现实例时使用。"
            : "当需要把核心方法与包装层执行合同明确分开时使用。",
          hasExamples
            ? "Use when the user needs the core WT-only workflow clearly separated from manuscript-style reproduction branches."
            : "Use when the user needs the core method separated from the wrapper-level execution contract."
        )
      ],
      when_not_to_use: [
        pair(
          "不要用于真实 CRISPR KO 实验设计、通用差异表达分析或多样本整合。",
          "Do not use for real CRISPR KO experimental design, generic differential expression, or multi-sample integration."
        ),
        pair(
          "不要在没有 WT 输入矩阵的情况下使用。",
          "Do not use when no WT input matrix is available."
        )
      ],
      route_elsewhere: [
        pair(
          "如果任务还是 FASTQ 到表达矩阵的上游处理，路由到比对或定量 skill。",
          "If the task is still upstream FASTQ-to-matrix processing, route to an alignment or quantification skill."
        ),
        pair(
          "如果任务是 bulk RNA-seq 差异表达，路由到 bulk differential-expression skill。",
          "If the task is bulk RNA-seq differential expression, route to a bulk differential-expression skill."
        )
      ]
    };
  }

  return {
    why_this_exists: pair(
      `这个 skill 把 ${primaryTool} 的 ${domainLabel.zh} ${analysisLabel.zh} 方法整理成可路由、可校验、可报告的执行合同。`,
      `This skill turns ${primaryTool} into a routable, validated, and report-producing execution contract for ${domainLabel.en} ${analysisLabel.en}.`
    ),
    when_to_use: [
      pair(
        `当任务需要基于官方论文与仓库执行 ${analysisLabel.zh}，并且结果必须可追溯、可复现时使用。`,
        `Use when the task needs ${analysisLabel.en} grounded in the official paper and repository, with traceable and reproducible outputs.`
      )
    ],
    when_not_to_use: [
      pair(
        "不要用于与该组学类型不匹配的输入数据。",
        "Do not use for input data that does not match this omics modality."
      )
    ],
    route_elsewhere: [
      pair(
        "如果任务仍处于上游原始测序数据处理阶段，路由到更上游的预处理或定量 skill。",
        "If the task is still in raw-data preprocessing, route to an upstream preprocessing or quantification skill."
      )
    ]
  };
}

function inferInputContract(domain, analysisType, geneName) {
  if (domain === "single-cell" && analysisType === "virtual-knockout") {
    return {
      formats: [
        {
          name: "input_manifest.json",
          zh: "推荐输入是 JSON manifest，用来声明矩阵路径和对象状态。",
          en: "The preferred input is a JSON manifest that declares matrix paths and object state."
        },
        {
          name: "matrix_market_or_csv",
          zh: "表达矩阵可以是 Matrix Market 或 CSV，但 manifest 必须声明方向和是否为原始计数。",
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
          zh: "WT 表达矩阵路径必须存在。",
          en: "The WT expression matrix path must exist."
        }
      ],
      state_requirements: [
        {
          path: "inputs.wt_matrix.orientation",
          required: true,
          equals: "genes_by_cells",
          zh: "WT 矩阵必须是基因在行、细胞在列。",
          en: "The WT matrix must be organized as genes in rows and cells in columns."
        },
        {
          path: "inputs.wt_matrix.normalization",
          required: true,
          one_of: ["raw_counts", "unnormalized_counts"],
          zh: "核心输入应为原始或未标准化计数，以免静默跳过方法要求的前置质量控制。",
          en: "Core input should remain raw or otherwise unnormalized so method-level preflight assumptions are not silently bypassed."
        },
        {
          path: "inputs.wt_matrix.has_gene_names",
          required: true,
          equals: true,
          zh: "矩阵必须保留基因名，否则无法验证待敲除基因是否存在。",
          en: "The matrix must retain gene names so the wrapper can verify that the knockout gene exists."
        },
        {
          path: "inputs.analysis_mode",
          required: true,
          one_of: ["core_wt_only", "paper_reproduction"],
          zh: "必须显式声明是核心 WT-only 路径还是论文复现路径。",
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
        zh: "推荐输入是 JSON manifest，用来声明文件路径和对象状态。",
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
        zh: "主输入文件路径必须存在。",
        en: "The primary input file path must exist."
      }
    ],
    state_requirements: [
      {
        path: "inputs.analysis_mode",
        required: true,
        equals: "core",
        zh: "必须显式声明本次运行的分析模式。",
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

function inferLiteratureDefaults(text, analysisType) {
  const defaults = [];

  const quantileMatch = text.match(/quantile\(abs\(X\),\s*([0-9.]+)\)/i);
  if (quantileMatch) {
    defaults.push({
      name: "edge_weight_quantile",
      value: quantileMatch[1],
      rationale: pair(
        `源码中用 quantile(abs(X), ${quantileMatch[1]}) 过滤低权重边。`,
        `The source code uses quantile(abs(X), ${quantileMatch[1]}) to filter low-weight edges.`
      )
    });
  }

  const lambdaMatch = text.match(/lambda\s*=\s*([0-9.]+)/i);
  if (lambdaMatch) {
    defaults.push({
      name: "direction_lambda",
      value: lambdaMatch[1],
      rationale: pair(
        `源码中的方向约束函数默认使用 lambda = ${lambdaMatch[1]}。`,
        `The directionality helper defaults to lambda = ${lambdaMatch[1]} in the source code.`
      )
    });
  }

  if (defaults.length === 0 && analysisType === "virtual-knockout") {
    defaults.push({
      name: "method_defaults",
      value: "see_repository_defaults",
      rationale: pair(
        "参数默认值未在当前证据截断片段中完整确认，应以主实现和官方 README 为准。",
        "Method defaults are not fully confirmed in the truncated evidence and should be checked against the main implementation and official README."
      )
    });
  }

  return defaults;
}

function inferParameterPolicy(domain, analysisType, runtime, text) {
  const literatureDefaults = inferLiteratureDefaults(text, analysisType);

  if (domain === "single-cell" && analysisType === "virtual-knockout") {
    return {
      required_user_decisions: [
        pair(
          "必须提供待敲除的基因符号，并确认该基因在过滤后仍保留。",
          "The knockout gene must be provided and confirmed to remain present after filtering."
        ),
        pair(
          "必须确认本次运行是核心 WT-only 分析还是论文复现分支。",
          "The user must confirm whether the run targets the core WT-only analysis or a paper-reproduction branch."
        )
      ],
      user_required: [
        {
          name: "knockout_gene",
          description: pair("目标敲除基因。", "Target knockout gene."),
          sources: [
            "config.analysis.knockout_gene",
            "manifest.inputs.knockout_gene"
          ],
          rationale: pair(
            "这决定哪个基因的出边会被置零，不能自动猜测。",
            "This determines which gene loses its outgoing edges and must not be guessed."
          )
        },
        {
          name: "analysis_mode",
          description: pair("核心路径还是论文复现分支。", "Core path versus paper-reproduction branch."),
          sources: [
            "config.analysis.analysis_mode",
            "manifest.inputs.analysis_mode"
          ],
          rationale: pair(
            "它决定是否允许 manuscript 里的真实 WT/KO 对照分支进入执行计划。",
            "It determines whether real WT/KO manuscript branches may enter the execution plan."
          )
        }
      ],
      auto_detected: [
        {
          name: "r_runtime_available",
          description: pair("Rscript 是否可用。", "Whether Rscript is available."),
          sources: [
            "runtime.targets.Rscript.available"
          ],
          fallback_value: false,
          rationale: pair(
            "native execution 依赖 Rscript。",
            "Native execution depends on Rscript."
          )
        },
        {
          name: "wt_input_normalization",
          description: pair("从 manifest 读取 WT 输入矩阵状态。", "Read the WT input matrix state from the manifest."),
          sources: [
            "manifest.inputs.wt_matrix.normalization"
          ],
          fallback_value: "unknown",
          rationale: pair(
            "wrapper 不能静默假设输入已经标准化或未标准化。",
            "The wrapper must not silently assume whether the input is normalized."
          )
        }
      ],
      literature_defaults: literatureDefaults,
      wrapper_defaults: [
        {
          name: "result_bundle_version",
          value: "1.0",
          rationale: pair(
            "统一结果目录结构，便于 smoke test、报告重建和复现记录。",
            "A fixed result bundle keeps smoke tests, report regeneration, and reproducibility records consistent."
          )
        },
        {
          name: "dry_run_mode",
          value: "true",
          rationale: pair(
            "默认先验证合同与运行时，再决定是否真正消耗集群资源。",
            "Default to validating the contract and runtime before executing the full analysis."
          )
        }
      ],
      decision_rules: [
        {
          titleZh: "优先走核心 WT-only 路径",
          titleEn: "Prefer the core WT-only path",
          detailsZh: "如果只有 WT 输入，就只生成虚拟敲除核心路径，不把 manuscript 复现脚本并入最小执行合同。",
          detailsEn: "If only WT input is available, keep the workflow on the virtual-knockout core path and do not merge manuscript reproduction scripts into the minimum contract."
        },
        {
          titleZh: "运行时缺失时阻断 native execution",
          titleEn: "Block native execution when a required runtime is missing",
          detailsZh: "如果 Rscript 不可用，返回结构化 blocked 状态，而不是假装方法已经执行成功。",
          detailsEn: "If Rscript is unavailable, emit a structured blocked status instead of pretending the method already ran."
        }
      ]
    };
  }

  return {
    required_user_decisions: [
      pair(
        "用户必须确认输入对象已经满足方法前提状态。",
        "The user must confirm that the input object already satisfies method prerequisites."
      )
    ],
    user_required: [],
    auto_detected: [
      {
        name: `${runtime}_runtime_available`,
        description: pair("检查主要运行时是否可用。", "Check whether the primary runtime is available."),
        sources: [
          `runtime.targets.${runtime === "r" ? "Rscript" : "python"}.available`
        ],
        fallback_value: false,
        rationale: pair(
          "native execution 依赖主要运行时。",
          "Native execution depends on the primary runtime."
        )
      }
    ],
    literature_defaults: literatureDefaults,
    wrapper_defaults: [
      {
        name: "result_bundle_version",
        value: "1.0",
        rationale: pair(
          "固定结果目录结构，方便验证和报告。",
          "A fixed result bundle simplifies validation and reporting."
        )
      }
    ],
    decision_rules: [
      {
        titleZh: "证据优先于想当然",
        titleEn: "Evidence over assumptions",
        detailsZh: "如果论文和仓库证据不足，就显式标注未确认，而不是静默补全。",
        detailsEn: "If the paper or repository evidence is incomplete, mark the field as unconfirmed instead of silently filling it in."
      }
    ]
  };
}

function classifyReferenceNote(item) {
  const base = getBasename(item.path).toLowerCase();
  if (base.includes("readme")) {
    return pair("仓库总览与输入输出说明。", "Repository overview plus input and output guidance.");
  }
  if (base.includes("description") || base.includes("namespace")) {
    return pair("依赖与导出接口证据。", "Dependency and exported-interface evidence.");
  }
  if (base.includes("qc")) {
    return pair("质量控制实现。", "Quality-control implementation.");
  }
  if (base.includes("regulation")) {
    return pair("差异调控或统计评分实现。", "Differential-regulation or statistical-scoring implementation.");
  }
  if (base.includes("plot")) {
    return pair("可视化或下游结果展示实现。", "Visualization or downstream result-display implementation.");
  }
  if (item.path.includes("manuscript/") || item.path.includes("examples/")) {
    return pair("复现实例或 manuscript 分支证据。", "Reproduction example or manuscript-branch evidence.");
  }
  return pair("主实现文件。", "Main implementation file.");
}

function buildReferenceItems(entries) {
  return ensureArray(entries).map((entry) => {
    const note = classifyReferenceNote(entry);
    return {
      label: entry.path,
      url: entry.githubUrl,
      noteZh: note.zh,
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
        ? `论文摘要证据：${paper.abstract}`
        : "论文来源证据。",
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
    ...ensureArray(sections.dependencies).slice(0, 2)
  ]);

  const paperSections = [];
  if (paperItems.length > 0) {
    paperSections.push({
      title: "Paper evidence / 论文证据",
      items: paperItems
    });
  }
  paperSections.push({
    title: "Repository and reproduction evidence / 仓库与复现证据",
    items: papersItems
  });

  return {
    methods: [
      {
        title: "Core implementation / 核心实现",
        items: methodsItems
      }
    ],
    papers: paperSections
  };
}

function inferWorkflowSteps(evidence, domain, analysisType) {
  const readmePaths = ensureArray(evidence.selections?.readme).slice(0, 1).map((entry) => entry.path);
  const entrypointPaths = ensureArray(evidence.selections?.entrypoints).slice(0, 4).map((entry) => entry.path);
  const examplePaths = ensureArray(evidence.selections?.examples).slice(0, 4).map((entry) => entry.path);
  const hasExamples = examplePaths.length > 0;

  if (domain === "single-cell" && analysisType === "virtual-knockout") {
    return [
      {
        titleZh: "路由并校验输入 manifest",
        titleEn: "Route and validate the input manifest",
        detailsZh: "先确认任务属于 WT-only virtual knockout，再检查矩阵方向、计数状态和 knockout gene 字段。",
        detailsEn: "First confirm that the task belongs to WT-only virtual knockout, then validate matrix orientation, count-state assumptions, and knockout-gene fields.",
        layer: "core",
        evidence: dedupe([...readmePaths, ...entrypointPaths.slice(0, 2)])
      },
      {
        titleZh: "规划核心 virtual knockout 路径",
        titleEn: "Plan the core virtual-knockout path",
        detailsZh: "按源码证据组织 QC、网络构建、方向约束、扰动模拟以及差异调控评分。",
        detailsEn: "Use the implementation evidence to organize QC, network construction, directionality constraints, perturbation simulation, and differential-regulation scoring.",
        layer: "core",
        evidence: entrypointPaths
      },
      {
        titleZh: "显式隔离 manuscript 复现分支",
        titleEn: "Explicitly isolate manuscript reproduction branches",
        detailsZh: hasExamples
          ? "只有在分析模式显式允许时，才把仓库中的 manuscript 或 example 分支纳入复现计划。"
          : "如果缺少官方 example 或 manuscript 证据，则不要臆造复现分支。",
        detailsEn: hasExamples
          ? "Only allow manuscript or example branches into the plan when the analysis mode explicitly enables reproduction."
          : "If the repository lacks official examples or manuscript evidence, do not invent reproduction branches.",
        layer: "reproduction",
        evidence: examplePaths.length > 0 ? examplePaths : ["未在论文或代码中确认 / Not confirmed in paper or code"]
      },
      {
        titleZh: "生成结果合同与报告",
        titleEn: "Assemble the result contract and report",
        detailsZh: "无论是否 dry-run，都要输出标准 bundle、参数解析、运行时探测、QC 摘要和 caveats。",
        detailsEn: "Whether or not the run is a dry-run, emit the standard bundle, parameter resolution, runtime probe, QC summary, and caveats.",
        layer: "wrapper",
        evidence: dedupe([...readmePaths, ...ensureArray(evidence.selections?.dependencies).slice(0, 1).map((entry) => entry.path)])
      }
    ];
  }

  return [
    {
      titleZh: "校验输入合同",
      titleEn: "Validate the input contract",
      detailsZh: "先检查 manifest、数据对象状态和所需文件路径。",
      detailsEn: "First validate the manifest, data-object state, and required file paths.",
      layer: "core",
      evidence: dedupe([...readmePaths, ...entrypointPaths.slice(0, 1)])
    },
    {
      titleZh: "规划核心方法步骤",
      titleEn: "Plan the core method steps",
      detailsZh: "根据主实现文件整理核心方法顺序，并保持证据映射。",
      detailsEn: "Use the main implementation files to map the core method order while preserving evidence references.",
      layer: "core",
      evidence: entrypointPaths
    },
    {
      titleZh: "生成结果合同与报告",
      titleEn: "Assemble the result contract and report",
      detailsZh: "输出标准结果目录、机器可读结果和报告。",
      detailsEn: "Emit the standard result bundle, machine-readable result, and report.",
      layer: "wrapper",
      evidence: readmePaths
    }
  ];
}

function inferRequiredOutputs(domain, analysisType) {
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

function inferExecutionContract(evidence, domain, analysisType, runtime, primaryTool) {
  const runtimeTargets = [
    {
      name: "python",
      executable: "python",
      required: true,
      zh: "Python orchestrator 运行时。",
      en: "Python orchestrator runtime."
    }
  ];

  if (runtime === "r") {
    runtimeTargets.push({
      name: "Rscript",
      executable: "Rscript",
      required: true,
      zh: `${primaryTool} native execution 运行时。`,
      en: `${primaryTool} native execution runtime.`
    });
  }

  return {
    runtime_targets: runtimeTargets,
    workflow_steps: inferWorkflowSteps(evidence, domain, analysisType),
    command_templates: [
      `echo Planning ${primaryTool}`,
      "echo Manifest: {manifest_path}",
      "echo Output directory: {out_dir}"
    ],
    required_outputs: inferRequiredOutputs(domain, analysisType),
    supports_native_run: false
  };
}

function inferQcContract(domain, analysisType, runtime) {
  if (domain === "single-cell" && analysisType === "virtual-knockout") {
    return {
      rules: [
        {
          metric: "input_contract_integrity",
          zh: "检查 WT 输入矩阵路径、方向、计数状态和 knockout gene 是否满足合同。",
          en: "Check whether the WT matrix path, orientation, count state, and knockout gene satisfy the contract.",
          passZh: "输入合同通过，可以进入执行规划。",
          passEn: "The input contract passes and execution planning may continue.",
          warnZh: "dry-run 仅完成预检，尚未形成方法级 QC 结论。",
          warnEn: "The dry-run only completed preflight checks and has not produced method-level QC conclusions.",
          failZh: "输入违反合同，结果不能当作可靠分析执行。",
          failEn: "The input violates the contract and the output must not be treated as a reliable executed analysis."
        },
        {
          metric: "single_cell_preflight",
          zh: "检查单细胞输入是否保留基因名，并避免把已标准化矩阵冒充原始计数。",
          en: "Check that gene names are retained and that a normalized matrix is not misrepresented as raw counts.",
          passZh: "对象状态满足单细胞扰动工作流前提。",
          passEn: "The object state satisfies the prerequisites for a single-cell perturbation workflow.",
          warnZh: "对象状态部分依赖 manifest 声明，仍需在正式运行前核实。",
          warnEn: "Part of the object state still depends on manifest declarations and should be verified before a full run.",
          failZh: "对象状态与方法要求不一致。",
          failEn: "The object state is inconsistent with the method requirements."
        },
        {
          metric: "runtime_readiness",
          requires_runtime: true,
          zh: "检查 Python 和 Rscript 是否可用。",
          en: "Check whether Python and Rscript are available.",
          passZh: "运行时已就绪。",
          passEn: "Required runtimes are ready.",
          warnZh: "dry-run 可以继续，但 native execution 尚未真正消耗方法运行时。",
          warnEn: "The dry-run may continue, but native execution has not yet consumed the method runtime.",
          failZh: "必需运行时缺失，应返回 blocked 状态。",
          failEn: "A required runtime is missing and the wrapper should return a blocked status."
        }
      ],
      validation_scenarios: [
        pair(
          "最小 smoke test：manifest 有效、dry-run 成功、bundle 完整。",
          "Minimum smoke test: valid manifest, successful dry-run, and a complete result bundle."
        ),
        pair(
          "缺失运行时测试：模拟 Rscript 缺失并返回 blocked_runtime_missing。",
          "Missing-runtime test: simulate a missing Rscript and return blocked_runtime_missing."
        )
      ],
      interpretation_boundary: [
        pair(
          "通过仅表示合同和预检查通过，不等同于生物学结论已经成立。", 
          "A pass only means the contract and preflight checks succeeded; it does not mean the biological conclusion is already established."
        ),
        pair(
          "警告表示结果可用于规划或报告，但必须保留 caveat。", 
          "A warning means the output may guide planning or reporting, but caveats must remain visible."
        ),
        pair(
          "失败表示结果不能写成可信结论。", 
          "A failure means the output must not be written up as a reliable conclusion."
        )
      ].map((item, index) => ({
        status: ["pass", "warn", "fail"][index],
        zh: item.zh,
        en: item.en
      }))
    };
  }

  return {
    rules: [
      {
        metric: "input_contract_integrity",
        zh: "检查输入路径和对象状态是否满足合同。",
        en: "Check whether input paths and object state satisfy the contract.",
        passZh: "输入合同通过。",
        passEn: "The input contract passes.",
        warnZh: "dry-run 只完成了预检。",
        warnEn: "The dry-run only completed preflight checks.",
        failZh: "输入违反合同。",
        failEn: "The input violates the contract."
      },
      {
        metric: "runtime_readiness",
        requires_runtime: true,
        zh: `检查 ${runtime} 运行时是否可用。`,
        en: `Check whether the ${runtime} runtime is available.`,
        passZh: "运行时已就绪。",
        passEn: "The runtime is ready.",
        warnZh: "dry-run 可以继续，但 native execution 尚未验证。",
        warnEn: "The dry-run may continue, but native execution is not yet validated.",
        failZh: "运行时缺失，应返回 blocked 状态。",
        failEn: "The runtime is missing and the wrapper should return a blocked status."
      }
    ],
    validation_scenarios: [
      pair(
        "最小 smoke test：manifest 有效且 bundle 完整。",
        "Minimum smoke test: valid manifest and complete bundle."
      )
    ],
    interpretation_boundary: [
      { status: "pass", ...pair("合同与预检查通过。", "The contract and preflight checks passed.") },
      { status: "warn", ...pair("结果可用但必须保留 caveat。", "The result may be usable but must retain caveats.") },
      { status: "fail", ...pair("结果不能当作可靠分析输出。", "The result must not be treated as a reliable analysis output.") }
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
      "reproducibility",
      "logs"
    ],
    result_fields: [
      "status",
      "skill_name",
      "paper_title",
      "runtime_probe",
      "input_validation",
      "parameter_resolution",
      "qc_summary",
      "artifacts",
      "caveats",
      "citations_used"
    ],
    bundle_notes: [
      pair(
        "即使是 dry-run，也必须产出完整目录结构和机器可读 result.json。",
        "Even a dry-run must emit the full directory structure and a machine-readable result.json."
      ),
      pair(
        "不要把 manuscript 复现实例的产物静默写成核心方法已经得出的结论。",
        "Do not silently rewrite manuscript-reproduction artifacts as if they were core-method conclusions."
      )
    ]
  };
}

function inferReproducibilityContract() {
  return {
    capture_items: [
      pair("输入 manifest 路径和关键状态字段。", "Input manifest path and key state fields."),
      pair("参数解析来源和默认值理由。", "Parameter-resolution sources and default rationales."),
      pair("运行时探测结果、计划命令和安装记录。", "Runtime probe results, planned commands, and installation records.")
    ],
    install_policy: [
      pair(
        "如果目标运行环境缺少依赖，只在该环境内安装，并把命令写入 reproducibility 目录。",
        "If the target runtime environment lacks dependencies, install them only inside that environment and record the commands under reproducibility."
      )
    ]
  };
}

function inferFailureModes(domain, analysisType, runtime) {
  const base = [
    {
      conditionZh: "输入对象状态与合同不一致",
      conditionEn: "The input object state is inconsistent with the contract",
      recoveryZh: "要求用户修正 manifest，并显式声明对象状态而不是让 wrapper 自行猜测。",
      recoveryEn: "Require the user to correct the manifest and explicitly declare object state instead of letting the wrapper guess."
    },
    {
      conditionZh: `${runtime === "r" ? "Rscript" : "主要运行时"} 缺失`,
      conditionEn: `${runtime === "r" ? "Rscript" : "The primary runtime"} is missing`,
      recoveryZh: "返回 blocked_runtime_missing，并在目标环境安装所需运行时后重试。",
      recoveryEn: "Return blocked_runtime_missing and retry after installing the required runtime in the target environment."
    }
  ];

  if (domain === "single-cell" && analysisType === "virtual-knockout") {
    base.push({
      conditionZh: "用户把 manuscript 复现分支当作核心方法输入要求",
      conditionEn: "The user treats manuscript reproduction branches as core-method input requirements",
      recoveryZh: "在报告里显式标记复现分支，只把 WT-only 路径保留为最小执行合同。",
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
      noteZh: "主论文链接。",
      noteEn: "Primary paper link."
    },
    {
      label: "Official repository",
      url: githubUrl,
      noteZh: "官方代码仓库。",
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

  return {
    skillName,
    displayName,
    paperTitle,
    paperUrl,
    githubUrl,
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
    parameterPolicy: inferParameterPolicy(domain, analysisType, runtime, text),
    executionContract: inferExecutionContract(repoEvidence, domain, analysisType, runtime, primaryTool),
    qcContract: inferQcContract(domain, analysisType, runtime),
    outputBundle: inferOutputBundle(),
    reproducibilityContract: inferReproducibilityContract(),
    testContract: {
      expected_status: "dry_run_ready",
      demo_input_manifest: inputContract.demo_input_manifest,
      demo_files: inputContract.demo_files,
      smoke_scenarios: [
        pair("dry-run 生成完整 bundle。", "The dry-run generates the full bundle."),
        pair("缺失 report.md 时 validate-output 返回失败。", "validate-output fails when report.md is missing.")
      ]
    },
    references: inferReferences(repoEvidence, paperEvidence),
    failureModes: inferFailureModes(domain, analysisType, runtime),
    citations: inferCitations(paperTitle, paperUrl, githubUrl, paperEvidence)
  };
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
