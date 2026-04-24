#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_MAX_FILES = 8;
const DEFAULT_MAX_PREVIEW_CHARS = 1200;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i += 1;
  }

  return args;
}

function parseGithubUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch (error) {
    fail(`Invalid GitHub URL: ${input}`);
  }

  if (!url.hostname.endsWith("github.com")) {
    fail(`Expected a github.com URL, received: ${input}`);
  }

  const segments = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
  if (segments.length < 2) {
    fail(`Could not parse owner/repo from: ${input}`);
  }

  return {
    owner: segments[0],
    repo: segments[1],
    githubUrl: `https://github.com/${segments[0]}/${segments[1]}`
  };
}

function buildHeaders(token) {
  const headers = {
    "User-Agent": "paper2omics",
    Accept: "application/vnd.github+json"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function getJson(url, token) {
  const response = await fetch(url, { headers: buildHeaders(token) });
  if (!response.ok) {
    const body = await response.text();
    fail(`GitHub API request failed (${response.status}) for ${url}: ${body.slice(0, 300)}`);
  }

  return response.json();
}

function isDependencyFile(filePath) {
  const base = path.posix.basename(filePath).toLowerCase();
  return new Set([
    "description",
    "namespace",
    "package.json",
    "package-lock.json",
    "requirements.txt",
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "environment.yml",
    "environment.yaml",
    "dockerfile",
    "renv.lock",
    "snakefile",
    "nextflow.config",
    "makefile"
  ]).has(base);
}

function isReadmeFile(filePath) {
  const base = path.posix.basename(filePath).toLowerCase();
  return base === "readme.md" || base === "readme.rst" || base === "readme";
}

function isEntrypointFile(filePath) {
  const normalized = filePath.toLowerCase();
  if (normalized.startsWith("r/") && normalized.endsWith(".r")) {
    return true;
  }

  if (normalized.startsWith("src/")) {
    return true;
  }

  return new Set([
    "main.py",
    "main.r",
    "app.py",
    "index.js",
    "index.ts",
    "cli.py"
  ]).has(path.posix.basename(normalized));
}

function isExampleFile(filePath) {
  const normalized = filePath.toLowerCase();
  return [
    "example/",
    "examples/",
    "tutorial/",
    "tutorials/",
    "vignette/",
    "vignettes/",
    "demo/",
    "demos/",
    "notebook/",
    "notebooks/",
    "inst/manuscript/"
  ].some((marker) => normalized.includes(marker));
}

function isNotebookFile(filePath) {
  return filePath.toLowerCase().endsWith(".ipynb");
}

function isDocsFile(filePath) {
  const normalized = filePath.toLowerCase();
  return [
    "doc/",
    "docs/",
    "documentation/",
    "vignette/",
    "vignettes/",
    "tutorial/",
    "tutorials/"
  ].some((marker) => normalized.includes(marker));
}

function isLikelyTextFile(filePath) {
  const base = path.posix.basename(filePath).toLowerCase();
  const ext = path.posix.extname(base);
  if (!ext) {
    return new Set(["description", "namespace", "dockerfile", "makefile"]).has(base);
  }

  return new Set([
    ".md",
    ".rst",
    ".txt",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".py",
    ".r",
    ".rmd",
    ".rhistory",
    ".jl",
    ".m",
    ".sh",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".ipynb",
    ".csv",
    ".tsv"
  ]).has(ext);
}

function comparePaths(left, right) {
  return left.path.localeCompare(right.path);
}

function limitEntries(entries, maxFiles) {
  return entries.sort(comparePaths).slice(0, maxFiles);
}

async function walkLocalFiles(rootDir) {
  const root = path.resolve(rootDir);
  const entries = [];

  async function visit(currentDir) {
    const dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "__pycache__") {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const stat = await fs.stat(fullPath);
      const relative = path.relative(root, fullPath).split(path.sep).join("/");
      entries.push({
        path: relative,
        size: stat.size,
        type: "blob",
        localPath: fullPath
      });
    }
  }

  await visit(root);
  return entries;
}

async function fetchLocalFileContent(rootDir, filePath, maxPreviewChars) {
  const fullPath = path.join(path.resolve(rootDir), ...filePath.split("/"));
  const decoded = await fs.readFile(fullPath, "utf8");
  const preview = decoded.length > maxPreviewChars
    ? `${decoded.slice(0, maxPreviewChars)}\n...[truncated]`
    : decoded;

  return {
    path: filePath,
    size: Buffer.byteLength(decoded),
    preview,
    githubUrl: null
  };
}

async function fetchFileContent(owner, repo, ref, filePath, token, maxPreviewChars) {
  const encodedPath = filePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
  const payload = await getJson(url, token);

  if (payload.encoding !== "base64" || !payload.content) {
    return null;
  }

  const decoded = Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8");
  const preview = decoded.length > maxPreviewChars
    ? `${decoded.slice(0, maxPreviewChars)}\n...[truncated]`
    : decoded;

  return {
    path: filePath,
    size: payload.size,
    preview,
    githubUrl: `https://github.com/${owner}/${repo}/blob/${ref}/${filePath}`
  };
}

async function collectSnapshots(owner, repo, ref, entries, token, maxPreviewChars) {
  const snapshots = [];
  for (const entry of entries) {
    const base = {
      path: entry.path,
      size: entry.size,
      githubUrl: `https://github.com/${owner}/${repo}/blob/${ref}/${entry.path}`
    };

    if (!isLikelyTextFile(entry.path)) {
      snapshots.push({ ...base, preview: null, note: "Skipped binary or unsupported text format." });
      continue;
    }

    try {
      const snapshot = await fetchFileContent(owner, repo, ref, entry.path, token, maxPreviewChars);
      snapshots.push(snapshot ? snapshot : { ...base, preview: null, note: "No textual payload returned." });
    } catch (error) {
      snapshots.push({ ...base, preview: null, note: `Failed to fetch content: ${error.message}` });
    }
  }

  return snapshots;
}

async function collectLocalSnapshots(rootDir, normalizedGithubUrl, ref, entries, maxPreviewChars) {
  const snapshots = [];
  for (const entry of entries) {
    const base = {
      path: entry.path,
      size: entry.size,
      githubUrl: `${normalizedGithubUrl}/blob/${ref}/${entry.path}`
    };

    if (!isLikelyTextFile(entry.path)) {
      snapshots.push({ ...base, preview: null, note: "Skipped binary or unsupported text format." });
      continue;
    }

    try {
      const snapshot = await fetchLocalFileContent(rootDir, entry.path, maxPreviewChars);
      snapshots.push({ ...snapshot, githubUrl: base.githubUrl });
    } catch (error) {
      snapshots.push({ ...base, preview: null, note: `Failed to read local content: ${error.message}` });
    }
  }

  return snapshots;
}

function inferLanguages(blobs) {
  const extensionLanguage = new Map([
    [".py", "python"],
    [".r", "r"],
    [".rmd", "r"],
    [".m", "matlab"],
    [".jl", "julia"],
    [".js", "javascript"],
    [".ts", "typescript"],
    [".sh", "shell"],
    [".ipynb", "notebook"]
  ]);
  const counts = {};
  for (const entry of blobs) {
    const base = path.posix.basename(entry.path).toLowerCase();
    if (base === "description" || base === "namespace") {
      counts.r = (counts.r || 0) + 1;
      continue;
    }
    const language = extensionLanguage.get(path.posix.extname(base));
    if (language) {
      counts[language] = (counts[language] || 0) + 1;
    }
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0) || 1;
  return Object.fromEntries(
    Object.entries(counts)
      .sort((left, right) => right[1] - left[1])
      .map(([language, count]) => [language, Number((count / total).toFixed(3))])
  );
}

function inferPackageType(dependencyEntries, languages) {
  const paths = dependencyEntries.map((entry) => path.posix.basename(entry.path).toLowerCase());
  const hasPython = paths.some((item) => ["pyproject.toml", "setup.py", "requirements.txt", "setup.cfg"].includes(item));
  const hasR = paths.some((item) => ["description", "namespace", "renv.lock"].includes(item));
  const hasWorkflow = paths.some((item) => ["snakefile", "nextflow.config"].includes(item));
  if ((hasPython && hasR) || (languages.python && languages.r)) {
    return "multi_language_package";
  }
  if (hasPython) {
    return "python_package";
  }
  if (hasR) {
    return "r_package";
  }
  if (hasWorkflow) {
    return "workflow_package";
  }
  return "unknown";
}

function extractHintLines(entries, patterns) {
  const lines = [];
  for (const entry of entries) {
    for (const line of String(entry.preview || "").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length > 240) {
        continue;
      }
      if (patterns.some((pattern) => pattern.test(trimmed))) {
        lines.push(`${entry.path}: ${trimmed}`);
      }
    }
  }
  return [...new Set(lines)].slice(0, 12);
}

function unique(values, limit = 40) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function sourceText(value) {
  if (Array.isArray(value)) {
    return value.join("");
  }
  return String(value || "");
}

function extractRegexMatches(text, regex, mapper = (match) => match[1] || match[0], limit = 40) {
  const values = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    values.push(mapper(match).trim());
  }
  return unique(values, limit);
}

function extractStaticSignals(code, language) {
  const normalized = String(code || "");
  const isPython = language === "python";
  const isR = language === "r";
  const imports = isPython
    ? unique([
      ...extractRegexMatches(normalized, /^\s*(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.]+))/gm, (match) => match[1] || match[2])
    ])
    : unique([
      ...extractRegexMatches(normalized, /\blibrary\(([^)\s,]+)\)/g),
      ...extractRegexMatches(normalized, /\brequire\(([^)\s,]+)\)/g)
    ]);
  const functionDefinitions = isPython
    ? extractRegexMatches(normalized, /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/gm, (match) => `${match[1]}(${match[2]})`)
    : extractRegexMatches(normalized, /([A-Za-z.][A-Za-z0-9._]*)\s*(?:<-|=)\s*function\s*\(([^)]*)\)/g, (match) => `${match[1]}(${match[2]})`);
  const assignments = isPython
    ? extractRegexMatches(normalized, /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)
    : extractRegexMatches(normalized, /([A-Za-z.][A-Za-z0-9._]*)\s*(?:<-|=)\s*/g);
  const functionCalls = extractRegexMatches(
    normalized,
    /\b([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g,
    (match) => match[1]
  ).filter((name) => !["if", "for", "while", "switch", "function", "return"].includes(name));
  const fileReads = extractRegexMatches(
    normalized,
    /\b(?:read\.csv|read_csv|readRDS|read_h5ad|scanpy\.read|sc\.read|open|readLines)\s*\(\s*["']([^"']+)["']/g
  );
  const fileWrites = extractRegexMatches(
    normalized,
    /\b(?:write\.csv|to_csv|saveRDS|write_h5ad|writeLines)\s*\([^"']*["']([^"']+)["']/g
  );

  return {
    imports,
    function_definitions: functionDefinitions,
    assignments,
    function_calls: unique(functionCalls),
    file_reads: fileReads,
    file_writes: fileWrites
  };
}

function notebookCodeCells(snapshot) {
  try {
    const parsed = JSON.parse(snapshot.preview || "");
    return (parsed.cells || [])
      .map((cell, index) => ({
        index,
        cell_type: cell.cell_type,
        source: sourceText(cell.source)
      }))
      .filter((cell) => cell.cell_type === "code");
  } catch (error) {
    return [];
  }
}

function inferLanguageFromPath(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".py")) {
    return "python";
  }
  if (lower.endsWith(".r") || lower.endsWith(".rmd")) {
    return "r";
  }
  if (lower.endsWith(".ipynb")) {
    return "notebook";
  }
  return "unknown";
}

function buildMiningMetadata({ notebooks, examples, entrypoints }) {
  const notebookMetadata = notebooks.map((snapshot) => {
    const cells = notebookCodeCells(snapshot);
    const cellSignals = cells.map((cell) => ({
      cell_index: cell.index,
      ...extractStaticSignals(cell.source, "python")
    }));
    return {
      path: snapshot.path,
      source_type: "notebook",
      cell_count: cells.length,
      execution_order: cells.map((cell) => cell.index),
      imports: unique(cellSignals.flatMap((item) => item.imports)),
      assignments: unique(cellSignals.flatMap((item) => item.assignments)),
      function_calls: unique(cellSignals.flatMap((item) => item.function_calls)),
      file_reads: unique(cellSignals.flatMap((item) => item.file_reads)),
      file_writes: unique(cellSignals.flatMap((item) => item.file_writes)),
      cells: cellSignals
    };
  });

  const scriptSnapshots = [...examples, ...entrypoints].filter((snapshot) => /\.(py|r|rmd)$/i.test(snapshot.path));
  const scriptMetadata = scriptSnapshots.map((snapshot) => ({
    path: snapshot.path,
    source_type: "script",
    language: inferLanguageFromPath(snapshot.path),
    ...extractStaticSignals(snapshot.preview || "", inferLanguageFromPath(snapshot.path))
  }));

  const executionOrder = [
    ...notebookMetadata.flatMap((item) => item.execution_order.map((cellIndex) => ({
      source: item.path,
      source_type: "notebook",
      cell_index: cellIndex
    }))),
    ...scriptMetadata.map((item, index) => ({
      source: item.path,
      source_type: "script",
      order_index: index
    }))
  ];
  const variableFlow = [
    ...notebookMetadata.flatMap((item) => item.assignments.map((name) => ({ source: item.path, variable: name }))),
    ...scriptMetadata.flatMap((item) => item.assignments.map((name) => ({ source: item.path, variable: name })))
  ];
  const fileFlow = [
    ...notebookMetadata.flatMap((item) => [
      ...item.file_reads.map((filePath) => ({ source: item.path, direction: "read", path: filePath })),
      ...item.file_writes.map((filePath) => ({ source: item.path, direction: "write", path: filePath }))
    ]),
    ...scriptMetadata.flatMap((item) => [
      ...item.file_reads.map((filePath) => ({ source: item.path, direction: "read", path: filePath })),
      ...item.file_writes.map((filePath) => ({ source: item.path, direction: "write", path: filePath }))
    ])
  ];
  const functionCallGraph = scriptMetadata.flatMap((item) => item.function_calls.map((name) => ({
    source: item.path,
    call: name
  })));

  return {
    notebooks: notebookMetadata,
    scripts: scriptMetadata,
    execution_order: executionOrder,
    variable_flow: variableFlow,
    file_flow: fileFlow,
    function_call_graph: functionCallGraph
  };
}

async function writeJson(targetPath, payload) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(payload, null, 2), "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const githubUrl = args["github-url"];
  if (!githubUrl) {
    fail("Missing required argument: --github-url");
  }

  const outputPath = args.out;
  const maxFiles = Number.parseInt(args["max-files"] || `${DEFAULT_MAX_FILES}`, 10);
  const maxPreviewChars = Number.parseInt(
    args["max-preview-chars"] || `${DEFAULT_MAX_PREVIEW_CHARS}`,
    10
  );
  const tokenEnv = args["token-env"] || "GITHUB_TOKEN";
  const token = process.env[tokenEnv] || "";
  const localPath = args["local-path"] ? path.resolve(args["local-path"]) : "";

  const { owner, repo, githubUrl: normalizedGithubUrl } = parseGithubUrl(githubUrl);

  let repoMeta;
  let blobs;
  if (localPath) {
    const stat = await fs.stat(localPath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      fail(`--local-path must point to an existing directory: ${localPath}`);
    }
    repoMeta = {
      default_branch: args["default-branch"] || "local",
      description: "",
      homepage: null
    };
    blobs = await walkLocalFiles(localPath);
  } else {
    repoMeta = await getJson(`https://api.github.com/repos/${owner}/${repo}`, token);
    const tree = await getJson(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(repoMeta.default_branch)}?recursive=1`,
      token
    );
    blobs = (tree.tree || []).filter((entry) => entry.type === "blob");
  }

  const readmeEntries = limitEntries(blobs.filter((entry) => isReadmeFile(entry.path)), maxFiles);
  const dependencyEntries = limitEntries(blobs.filter((entry) => isDependencyFile(entry.path)), maxFiles);
  const entrypointEntries = limitEntries(blobs.filter((entry) => isEntrypointFile(entry.path)), maxFiles);
  const exampleEntries = limitEntries(
    blobs.filter((entry) => isExampleFile(entry.path) && isLikelyTextFile(entry.path)),
    maxFiles
  );
  const notebookEntries = limitEntries(blobs.filter((entry) => isNotebookFile(entry.path)), maxFiles);
  const docsEntries = limitEntries(
    blobs.filter((entry) => isDocsFile(entry.path) && isLikelyTextFile(entry.path)),
    maxFiles
  );

  const snapshot = localPath
    ? (entries) => collectLocalSnapshots(localPath, normalizedGithubUrl, repoMeta.default_branch, entries, maxPreviewChars)
    : (entries) => collectSnapshots(owner, repo, repoMeta.default_branch, entries, token, maxPreviewChars);
  const readme = await snapshot(readmeEntries);
  const dependencies = await snapshot(dependencyEntries);
  const entrypoints = await snapshot(entrypointEntries);
  const examples = await snapshot(exampleEntries);
  const notebooks = await snapshot(notebookEntries);
  const docs = await snapshot(docsEntries);
  const languages = inferLanguages(blobs);
  const packageType = inferPackageType(dependencyEntries, languages);
  const hintSources = [...readme, ...dependencies, ...examples, ...docs];
  const installHints = extractHintLines(hintSources, [
    /\binstall\b/i,
    /pip\s+install/i,
    /conda\s+(install|env|create)/i,
    /install\.packages/i,
    /devtools::install/i,
    /remotes::install/i
  ]);
  const cliHints = extractHintLines(hintSources, [
    /\busage\b/i,
    /--help\b/i,
    /python\s+[\w./-]+\.py/i,
    /Rscript\s+/i,
    /\bcommand line\b/i
  ]);
  const miningMetadata = buildMiningMetadata({ notebooks, examples, entrypoints });

  const payload = {
    generatedAt: new Date().toISOString(),
    repo: {
      owner,
      repo,
      githubUrl: normalizedGithubUrl,
      defaultBranch: repoMeta.default_branch,
      description: repoMeta.description,
      homepage: repoMeta.homepage || null,
      localPath: localPath || null
    },
    counts: {
      totalFiles: blobs.length,
      readmeFiles: readmeEntries.length,
      dependencyFiles: dependencyEntries.length,
      entrypointFiles: entrypointEntries.length,
      exampleFiles: exampleEntries.length,
      notebookFiles: notebookEntries.length,
      docsFiles: docsEntries.length
    },
    languages,
    packageInfo: {
      packageType,
      hasReadme: readmeEntries.length > 0,
      hasDocs: docsEntries.length > 0,
      hasTutorials: exampleEntries.some((entry) => /tutorial|vignette/i.test(entry.path)),
      hasNotebooks: notebookEntries.length > 0
    },
    miningMetadata,
    installHints,
    cliHints,
    selections: {
      readme,
      dependencies,
      entrypoints,
      examples,
      notebooks,
      docs
    },
    pathIndex: {
      dependencyFiles: dependencyEntries.map((entry) => entry.path),
      entrypointFiles: entrypointEntries.map((entry) => entry.path),
      exampleFiles: exampleEntries.map((entry) => entry.path),
      notebookFiles: notebookEntries.map((entry) => entry.path),
      docsFiles: docsEntries.map((entry) => entry.path)
    },
    notes: [
      "Treat README as a navigation aid, not the final source of truth.",
      "Prefer the paper plus main implementation for core workflow claims.",
      "Treat manuscript and example files as reproduction evidence."
    ]
  };

  if (outputPath) {
    await writeJson(outputPath, payload);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

main().catch((error) => {
  fail(error.stack || error.message);
});
