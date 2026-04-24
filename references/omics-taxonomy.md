# Omics Workflow Taxonomy

Use this file to normalize heterogeneous papers into one stable workflow shape.

## Canonical Output Sections

Use this order unless the user explicitly asks for a different presentation:

1. `Paper`
2. `Omics Modality`
3. `Biological Question`
4. `Required Inputs`
5. `Environment / Dependencies`
6. `Step-by-step Workflow`
7. `Key Parameters`
8. `Outputs`
9. `Validation / Benchmark / Case Study`
10. `Caveats`
11. `Evidence Map`

## Modality Labels

Prefer one primary label, then add qualifiers only when needed.

| Canonical label | Typical cues |
| --- | --- |
| `single-cell transcriptomics` | scRNA-seq, cell barcode, UMI, Seurat, Scanpy |
| `spatial transcriptomics` | Visium, spot, slide, spatial coordinates |
| `bulk transcriptomics` | RNA-seq, count matrix, bulk samples |
| `epigenomics` | ATAC-seq, chromatin accessibility, methylation |
| `proteomics` | peptide, phospho, LC-MS/MS, MaxQuant |
| `metabolomics` | metabolite, LC-MS, GC-MS |
| `multi-omics` | joint model, integrated latent space, cross-modal alignment |

## Canonical Step Names

Map method-specific language into these step buckets.

| Canonical step | Typical aliases |
| --- | --- |
| `input assembly` | collect samples, load matrix, read assay |
| `quality control` | filtering, mt ratio filter, low-quality cell removal |
| `normalization` | log-normalize, size-factor normalize, scaling |
| `feature selection` | HVG, variable genes, marker filtering |
| `batch correction` | Harmony, MNN, integration |
| `graph or network construction` | kNN graph, GRN, adjacency matrix, coexpression network |
| `latent representation` | PCA, manifold alignment, embedding, factor model |
| `perturbation or contrast` | virtual KO, differential comparison, simulation |
| `statistical scoring` | Z score, likelihood, posterior, enrichment score |
| `downstream interpretation` | enrichment, pathway analysis, marker annotation |
| `validation` | benchmark, case study, manuscript figure recreation |

## Common Workflow Patterns

### Single-Cell Perturbation Workflows

- `input assembly`: count matrix with genes in rows and cells in columns
- `quality control`: cell and gene filtering
- `normalization`
- `feature selection`
- `graph or network construction`
- `perturbation or contrast`
- `latent representation`
- `statistical scoring`
- `downstream interpretation`
- `validation`

### Bulk Omics Comparison Workflows

- `input assembly`
- `quality control`
- `normalization`
- `contrast or model fitting`
- `statistical scoring`
- `downstream interpretation`
- `validation`

### Integrative Multi-Omics Workflows

- `input assembly`
- `modality-specific preprocessing`
- `cross-modal alignment`
- `latent representation`
- `contrast or task-specific inference`
- `downstream interpretation`
- `validation`

## Naming Rules

- Keep the method name in the original paper form, for example `scTenifoldKnk`.
- Keep package names, function names, and file names in their source form.
- Prefer concise English workflow headings that can be reused across generated child skills.

## What Not To Do

- Do not invent missing preprocessing steps because they are common in the field.
- Do not collapse manuscript-only steps into the core method unless the paper or main implementation says they are required.
- Do not confuse downstream validation with core method outputs.
