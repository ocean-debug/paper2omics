#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_MAX_TEXT_CHARS = 6000;
const DEFAULT_SNIPPET_CHARS = 1200;
const DEFAULT_FETCH_TIMEOUT_MS = 15000;
const DEFAULT_FETCH_RETRIES = 2;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

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

function parseNonNegativeInteger(name, value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail(`Expected --${name} to be a non-negative integer, received: ${value}`);
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, options = {}) {
  const timeoutMs = parseNonNegativeInteger("fetch-timeout-ms", options.timeoutMs, DEFAULT_FETCH_TIMEOUT_MS);
  const retries = parseNonNegativeInteger("fetch-retries", options.retries, DEFAULT_FETCH_RETRIES);
  const headers = options.headers || {};

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, { headers }, timeoutMs);
      if (!response.ok) {
        const body = await response.text();
        const message = `Failed to fetch article URL (${response.status}): ${url}; ${body.slice(0, 300)}`;
        if (!RETRYABLE_STATUS.has(response.status) || attempt >= retries) {
          fail(message);
        }
        await sleep(250 * (attempt + 1));
        continue;
      }
      return response.text();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        fail(`Failed to fetch article URL: ${url}; ${error.message}`);
      }
      await sleep(250 * (attempt + 1));
    }
  }
  fail(`Failed to fetch article URL: ${url}; ${lastError ? lastError.message : "unknown error"}`);
}

function ensureValue(value) {
  return value === undefined || value === null ? "" : String(value);
}

function collapseWhitespace(value) {
  return ensureValue(value).replace(/\s+/g, " ").trim();
}

function trimPreview(value, maxChars) {
  const text = ensureValue(value).trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

function decodeHtmlEntities(value) {
  return ensureValue(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function stripHtml(html) {
  return collapseWhitespace(
    decodeHtmlEntities(
      ensureValue(html)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<\/?(br|p|div|section|article|h1|h2|h3|h4|li|ul|ol|table|tr|td)[^>]*>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function extractTagTitle(html) {
  const matched = ensureValue(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return matched ? collapseWhitespace(decodeHtmlEntities(matched[1])) : "";
}

function extractMetaContent(html, names) {
  const normalizedHtml = ensureValue(html);
  for (const name of names) {
    const patterns = [
      new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+name=["']${name}["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+property=["']${name}["'][^>]*>`, "i")
    ];
    for (const pattern of patterns) {
      const matched = normalizedHtml.match(pattern);
      if (matched) {
        return collapseWhitespace(decodeHtmlEntities(matched[1]));
      }
    }
  }
  return "";
}

function extractSectionText(html, headingPattern) {
  const normalizedHtml = ensureValue(html);
  const matched = normalizedHtml.match(
    new RegExp(
      `<(?:section|div|article)[^>]*(?:id|class)=["'][^"']*${headingPattern}[^"']*["'][^>]*>([\\s\\S]*?)<\\/(?:section|div|article)>`,
      "i"
    )
  );
  return matched ? stripHtml(matched[1]) : "";
}

function extractPdfStrings(buffer, maxChars) {
  const source = buffer.toString("latin1");
  const matches = source.match(/[A-Za-z0-9][A-Za-z0-9 ,.;:()_\-\/]{20,}/g) || [];
  const unique = [];
  const seen = new Set();

  for (const item of matches) {
    const normalized = collapseWhitespace(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }

  return trimPreview(unique.join("\n"), maxChars);
}

function inferKeywords(text) {
  const normalized = ensureValue(text);
  const candidates = [
    { label: "single-cell", patterns: [/single-cell/gi, /single cell/gi] },
    { label: "scRNA-seq", patterns: [/\bscrna\b/gi, /scRNA-seq/gi, /single-cell RNA/gi] },
    { label: "virtual knockout", patterns: [/virtual knockout/gi, /in-silico knockout/gi] },
    { label: "TF perturbation", patterns: [/TF perturbation/gi, /transcription factor perturbation/gi, /in silico gene perturbation/gi] },
    { label: "CellOracle", patterns: [/CellOracle/gi] },
    { label: "gene regulatory network", patterns: [/gene regulatory network/gi, /\bscGRN\b/gi] },
    { label: "transition vector", patterns: [/transition vector/gi] },
    { label: "differential regulation", patterns: [/differential regulation/gi, /differentially regulated/gi] },
    { label: "tensor decomposition", patterns: [/tensor decomposition/gi] },
    { label: "manifold alignment", patterns: [/manifold alignment/gi] },
    { label: "wild-type", patterns: [/\bWT\b/g, /wild-type/gi] },
    { label: "bulk RNA-seq", patterns: [/bulk RNA/gi, /DESeq2/gi, /edgeR/gi] },
    { label: "spatial transcriptomics", patterns: [/spatial transcriptomics/gi, /Visium/gi, /\bspot\b/gi] }
  ];

  return candidates
    .filter((item) => item.patterns.some((pattern) => pattern.test(normalized)))
    .map((item) => item.label);
}

function inferHints(text) {
  const keywords = inferKeywords(text);
  return {
    modalityHints: keywords.filter((item) => ["single-cell", "scRNA-seq", "bulk RNA-seq", "spatial transcriptomics"].includes(item)),
    analysisHints: keywords.filter((item) => ["virtual knockout", "TF perturbation", "differential regulation", "tensor decomposition", "manifold alignment", "transition vector"].includes(item)),
    keywords
  };
}

function buildSourceRecord({ sourceType, paperTitle, paperUrl, articleUrl, pdfPath, title, abstract, fullTextPreview, rawLength }) {
  const preferredUrl = paperUrl || articleUrl || (pdfPath ? `local-file://${pdfPath.replace(/\\/g, "/")}` : "");
  const inferred = inferHints([title, abstract, fullTextPreview].filter(Boolean).join("\n\n"));

  return {
    generatedAt: new Date().toISOString(),
    paper: {
      requestedTitle: paperTitle || "",
      resolvedTitle: title || paperTitle || "",
      sourceType,
      paperUrl: paperUrl || articleUrl || "",
      articleUrl: articleUrl || "",
      pdfPath: pdfPath || "",
      preferredCitationUrl: preferredUrl,
      abstract: abstract || "",
      fullTextPreview: fullTextPreview || "",
      snippets: [
        abstract ? { label: "abstract", text: abstract } : null,
        fullTextPreview ? { label: "full_text_preview", text: fullTextPreview } : null
      ].filter(Boolean),
      rawTextLength: rawLength || 0
    },
    inferred,
    notes: [
      sourceType === "pdf"
        ? "PDF extraction uses a lightweight text heuristic when no dedicated PDF parser is configured."
        : "Article extraction prefers title, abstract-like metadata, and a stripped full-text preview.",
      "Treat paper evidence as the primary source for problem framing and method claims.",
      "Treat repository evidence as the primary source for runtime, parameters, and implementation details."
    ]
  };
}

async function readArticleFile(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return {
    raw: content,
    articleUrl: "",
    sourceType: "article_file"
  };
}

async function readArticleUrl(url, options = {}) {
  if (url.startsWith("file://")) {
    return readArticleFile(new URL(url));
  }

  return {
    raw: await fetchText(url, {
      timeoutMs: options.timeoutMs,
      retries: options.retries,
      headers: {
        "User-Agent": "paper2omics"
      }
    }),
    articleUrl: url,
    sourceType: "article_url"
  };
}

function resolvePathString(value) {
  if (!value) {
    return "";
  }
  const resolved = path.resolve(String(value));
  return resolved;
}

async function collectFromArticle(args, maxTextChars, snippetChars, fetchOptions) {
  const source = args["article-file"]
    ? await readArticleFile(args["article-file"])
    : await readArticleUrl(args["article-url"], fetchOptions);
  const html = source.raw;
  const resolvedTitle = args["paper-title"]
    || extractMetaContent(html, ["citation_title", "dc.title", "og:title", "twitter:title"])
    || extractTagTitle(html);
  const abstract = extractMetaContent(html, [
    "citation_abstract",
    "dc.description",
    "description",
    "og:description",
    "twitter:description"
  ]) || extractSectionText(html, "abstract");
  const stripped = stripHtml(html);
  const preview = trimPreview(stripped, maxTextChars);

  return buildSourceRecord({
    sourceType: source.sourceType,
    paperTitle: args["paper-title"],
    paperUrl: args["paper-url"],
    articleUrl: source.articleUrl || args["article-url"],
    title: resolvedTitle,
    abstract: trimPreview(abstract, snippetChars),
    fullTextPreview: preview,
    rawLength: stripped.length
  });
}

async function collectFromPdf(args, maxTextChars, snippetChars) {
  const pdfPath = resolvePathString(args["pdf-path"]);
  const extension = path.extname(pdfPath).toLowerCase();

  let extractedText = "";
  if ([".txt", ".md", ".html", ".htm"].includes(extension)) {
    const raw = await fs.readFile(pdfPath, "utf8");
    extractedText = extension === ".html" || extension === ".htm" ? stripHtml(raw) : collapseWhitespace(raw);
  } else {
    const rawBuffer = await fs.readFile(pdfPath);
    extractedText = extractPdfStrings(rawBuffer, maxTextChars * 2);
  }

  const lines = extractedText.split(/\n+/).map((line) => collapseWhitespace(line)).filter(Boolean);
  const title = args["paper-title"] || lines[0] || path.basename(pdfPath, extension);
  const abstractLine = lines.find((line) => /single-cell|scRNA|virtual knockout|gene regulatory network|differential regulation/i.test(line))
    || lines.slice(1, 4).join(" ");

  return buildSourceRecord({
    sourceType: "pdf",
    paperTitle: args["paper-title"],
    paperUrl: args["paper-url"],
    pdfPath,
    title,
    abstract: trimPreview(abstractLine, snippetChars),
    fullTextPreview: trimPreview(lines.join("\n"), maxTextChars),
    rawLength: extractedText.length
  });
}

function collectFromTitleOnly(args) {
  return buildSourceRecord({
    sourceType: "title_only",
    paperTitle: args["paper-title"],
    paperUrl: args["paper-url"],
    title: args["paper-title"] || "",
    abstract: "",
    fullTextPreview: args["paper-title"] || "",
    rawLength: ensureValue(args["paper-title"]).length
  });
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const maxTextChars = Number.parseInt(args["max-text-chars"] || `${DEFAULT_MAX_TEXT_CHARS}`, 10);
  const snippetChars = Number.parseInt(args["snippet-chars"] || `${DEFAULT_SNIPPET_CHARS}`, 10);
  const fetchOptions = {
    timeoutMs: parseNonNegativeInteger("fetch-timeout-ms", args["fetch-timeout-ms"], DEFAULT_FETCH_TIMEOUT_MS),
    retries: parseNonNegativeInteger("fetch-retries", args["fetch-retries"], DEFAULT_FETCH_RETRIES)
  };

  const hasPaperSource = Boolean(args["article-url"] || args["article-file"] || args["pdf-path"] || args["paper-title"]);
  if (!hasPaperSource) {
    fail("Provide one paper source via --paper-title, --article-url, --article-file, or --pdf-path");
  }

  let payload;
  if (args["article-url"] || args["article-file"]) {
    payload = await collectFromArticle(args, maxTextChars, snippetChars, fetchOptions);
  } else if (args["pdf-path"]) {
    payload = await collectFromPdf(args, maxTextChars, snippetChars);
  } else {
    payload = collectFromTitleOnly(args);
  }

  if (args.out) {
    await writeJson(args.out, payload);
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

main().catch((error) => {
  fail(error.stack || error.message);
});
