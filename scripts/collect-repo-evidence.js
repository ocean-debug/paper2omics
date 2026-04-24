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

  const { owner, repo, githubUrl: normalizedGithubUrl } = parseGithubUrl(githubUrl);

  const repoMeta = await getJson(`https://api.github.com/repos/${owner}/${repo}`, token);
  const tree = await getJson(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(repoMeta.default_branch)}?recursive=1`,
    token
  );

  const blobs = (tree.tree || []).filter((entry) => entry.type === "blob");
  const readmeEntries = limitEntries(blobs.filter((entry) => isReadmeFile(entry.path)), maxFiles);
  const dependencyEntries = limitEntries(blobs.filter((entry) => isDependencyFile(entry.path)), maxFiles);
  const entrypointEntries = limitEntries(blobs.filter((entry) => isEntrypointFile(entry.path)), maxFiles);
  const exampleEntries = limitEntries(
    blobs.filter((entry) => isExampleFile(entry.path) && isLikelyTextFile(entry.path)),
    maxFiles
  );

  const readme = await collectSnapshots(owner, repo, repoMeta.default_branch, readmeEntries, token, maxPreviewChars);
  const dependencies = await collectSnapshots(
    owner,
    repo,
    repoMeta.default_branch,
    dependencyEntries,
    token,
    maxPreviewChars
  );
  const entrypoints = await collectSnapshots(
    owner,
    repo,
    repoMeta.default_branch,
    entrypointEntries,
    token,
    maxPreviewChars
  );
  const examples = await collectSnapshots(
    owner,
    repo,
    repoMeta.default_branch,
    exampleEntries,
    token,
    maxPreviewChars
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    repo: {
      owner,
      repo,
      githubUrl: normalizedGithubUrl,
      defaultBranch: repoMeta.default_branch,
      description: repoMeta.description,
      homepage: repoMeta.homepage || null
    },
    counts: {
      totalFiles: blobs.length,
      readmeFiles: readmeEntries.length,
      dependencyFiles: dependencyEntries.length,
      entrypointFiles: entrypointEntries.length,
      exampleFiles: exampleEntries.length
    },
    selections: {
      readme,
      dependencies,
      entrypoints,
      examples
    },
    pathIndex: {
      dependencyFiles: dependencyEntries.map((entry) => entry.path),
      entrypointFiles: entrypointEntries.map((entry) => entry.path),
      exampleFiles: exampleEntries.map((entry) => entry.path)
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
