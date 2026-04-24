# Source Priority / 证据优先级

Use this file when paper text, README text, and code do not fully agree.

## Priority Rules / 优先级规则

Choose the evidence source based on the claim you are making.

### Method intent / 方法意图

Use this priority:

1. Paper full text
2. Paper abstract or official article page
3. Main implementation files
4. Official manuscript, vignette, tutorial, or example scripts
5. README and package description files

### Runtime and environment / 运行环境与依赖

Use this priority:

1. Lockfiles and dependency manifests such as `requirements.txt`, `pyproject.toml`, `DESCRIPTION`, `renv.lock`, `environment.yml`
2. Installation instructions in the README
3. Import statements in example or manuscript scripts

### Reproduction details / 复现细节

Use this priority:

1. Official manuscript scripts
2. Official example or tutorial scripts
3. README walkthroughs
4. Inference from the main code

## Conflict Handling / 冲突处理

When sources disagree:

- State both claims if the conflict matters to execution.
- Prefer the higher-priority source for the final recommendation.
- Add a bilingual uncertainty note:
  - `未在源码/论文中确认 / Not confirmed in paper or code`
  - `论文与实现存在差异 / The paper and implementation differ`
  - `README 提供的是简化示例 / The README provides a simplified example`

## Evidence Map Style / 证据映射写法

For each important workflow step, record:

- what the step does
- where it is supported
- whether it belongs to the core method or a reproduction branch

Use labels like these:

- `paper`
- `article-page`
- `main-code`
- `manuscript`
- `example`
- `readme`
- `dependency-file`

## Missing Information / 缺失信息处理

If the paper or repository does not expose enough detail:

- Do not fill the gap with general domain knowledge unless the user explicitly asks for a best-effort inference.
- Say exactly which detail is missing.
- Suggest the next best official artifact to inspect, such as a manuscript script, vignette, or issue thread.

## Separation Rule / 分层规则

Keep these layers separate in the final summary and child skill:

- `core method`: the minimum pipeline implied by the paper plus main implementation
- `repo operationalization`: install and run instructions exposed by the repository
- `manuscript reproduction`: case-study-specific preprocessing, figure scripts, enrichment analyses, or benchmarks
