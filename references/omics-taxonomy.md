# Omics Workflow Taxonomy / 组学流程归一化词表

Use this file to normalize heterogeneous papers into one stable workflow shape.

## Canonical Output Sections / 标准输出段落

Use this order unless the user explicitly asks for a different presentation:

1. `Paper / 论文`
2. `Omics Modality / 组学类型`
3. `Biological Question / 生物学问题`
4. `Required Inputs / 所需输入`
5. `Environment / Dependencies / 环境与依赖`
6. `Step-by-step Workflow / 分步流程`
7. `Key Parameters / 关键参数`
8. `Outputs / 输出结果`
9. `Validation / Benchmark / Case Study / 验证与案例`
10. `Caveats / 注意事项`
11. `Evidence Map / 证据映射`

## Modality Labels / 组学类型标签

Prefer one primary label, then add qualifiers only when needed.

| Canonical label | Chinese label | Typical cues |
| --- | --- | --- |
| `single-cell transcriptomics` | `单细胞转录组` | scRNA-seq, cell barcode, UMI, Seurat, Scanpy |
| `spatial transcriptomics` | `空间转录组` | Visium, spot, slide, spatial coordinates |
| `bulk transcriptomics` | `整体转录组` | RNA-seq, count matrix, bulk samples |
| `epigenomics` | `表观组学` | ATAC-seq, chromatin accessibility, methylation |
| `proteomics` | `蛋白质组学` | peptide, phospho, LC-MS/MS, MaxQuant |
| `metabolomics` | `代谢组学` | metabolite, LC-MS, GC-MS |
| `multi-omics` | `多组学` | joint model, integrated latent space, cross-modal alignment |

## Canonical Step Names / 标准步骤名

Map method-specific language into these step buckets.

| Canonical step | Chinese label | Typical aliases |
| --- | --- | --- |
| `input assembly` | `输入整理` | collect samples, load matrix, read assay |
| `quality control` | `质量控制` | filtering, mt ratio filter, low-quality cell removal |
| `normalization` | `归一化` | log-normalize, size-factor normalize, scaling |
| `feature selection` | `特征筛选` | HVG, variable genes, marker filtering |
| `batch correction` | `批次校正` | Harmony, MNN, integration |
| `graph or network construction` | `图或网络构建` | kNN graph, GRN, adjacency matrix, coexpression network |
| `latent representation` | `低维表示` | PCA, manifold alignment, embedding, factor model |
| `perturbation or contrast` | `扰动或条件对比` | virtual KO, differential comparison, simulation |
| `statistical scoring` | `统计打分` | Z score, likelihood, posterior, enrichment score |
| `downstream interpretation` | `下游解释` | enrichment, pathway analysis, marker annotation |
| `validation` | `验证` | benchmark, case study, manuscript figure recreation |

## Common Workflow Patterns / 常见流程模式

### Single-cell perturbation workflows / 单细胞扰动工作流

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

### Bulk omics comparison workflows / 整体组学比较流程

- `input assembly`
- `quality control`
- `normalization`
- `contrast or model fitting`
- `statistical scoring`
- `downstream interpretation`
- `validation`

### Integrative multi-omics workflows / 多组学整合流程

- `input assembly`
- `modality-specific preprocessing`
- `cross-modal alignment`
- `latent representation`
- `contrast or task-specific inference`
- `downstream interpretation`
- `validation`

## Translation Rules / 中英双语规则

- Keep the method name in the original paper form, for example `scTenifoldKnk`.
- Translate workflow headings, but keep package names, function names, and file names in English.
- When an omics subtype has no natural short Chinese translation, keep the English term and add a concise Chinese explanation.

## What Not To Do / 不要这样做

- Do not invent missing preprocessing steps because they are common in the field.
- Do not collapse manuscript-only steps into the core method unless the paper or main implementation says they are required.
- Do not confuse downstream validation with core method outputs.
