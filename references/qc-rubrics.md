# QC Rubrics / 质控判定模板

Use this file to convert method notes into explicit QC rules.

## Rule Format

Every rule should specify:

- `metric`
- `what_it_checks`
- `pass`
- `warn`
- `fail`
- `why_it_matters`

## Single-Cell RNA-seq

Common metrics:

- UMI count or library size
- mitochondrial fraction
- number of detected genes
- doublet risk
- batch mixing after integration
- cell-type or cluster stability

## Bulk RNA-seq

Common metrics:

- library size outliers
- PCA outliers
- sample-sample correlation
- dispersion fit quality
- replicate count sufficiency

## ATAC-seq or ChIP-seq

Common metrics:

- FRiP
- NSC or RSC
- peak counts
- IDR consistency
- replicate concordance

## Spatial Transcriptomics

Common metrics:

- spot count quality
- tissue coverage
- spatial coordinate presence
- spatial structure preservation
- deconvolution confidence

## Interpretation Boundary

QC results must also define what can be concluded.

- `pass`: workflow outputs may support normal interpretation
- `warn`: results may be usable but conclusions must carry caveats
- `fail`: outputs should not be treated as biologically reliable results
