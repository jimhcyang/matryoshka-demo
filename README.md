# Matryoshka Public Demo

[Website](https://jimhcyang.github.io/matryoshka-demo/) |
[Publication workflow](https://github.com/jimhcyang/matryoshka-demo/actions/workflows/pages.yml)

The repository and pinned datasets are published. GitHub Pages deployment
status is recorded in the linked workflow; a successful repository push or
local validation does not by itself establish a successful website deployment.
The live `publication.json` identifies the presentation actually being served.

An inspectable, saved analyst workbench for historical Iran cables, Vietnam
cables and paired-release Central Intelligence Bulletins. Tasks are hypothesis
assessment, reconstruction and redaction recovery.

This repository is the **public presentation export**, not the private research
workspace. It contains no API keys, model-call service, collaborator manuscripts,
human-review notes or complete research execution logs. Opening the website
cannot spend API credits or submit a new inference request.

## Corpus Versions

The default CIB Corpus Map uses the source-reviewed resource
`cib_resource_623c60e1e128944377f0`: aliases
`alias_sense_fa9fe8608add36db785f`, graph `graph_2e1f8d6c2443987c`, and rebuilt
hierarchy `hierarchy_dcfb5058b0e6e571`. This is the verified engineering release,
not an independent historical-identity accuracy estimate.

The active current workbench's CIB examples bind this same source-only resource.
Older results remain historical records, not relabeled current executions.
The explicit `revision=study` map is retained for archival compatibility, not
as the active CIB workbench's default. See [the release protocol](docs/CORPUS_RELEASES.md).

Iran and Vietnam remain usable legacy graph releases. They have **not** been
rebuilt or certified under the newer source-only CIB alias workflow. Their
older exports display unknown identity authority rather than inventing a
source-specific identity certificate. The portable extraction/alias code and
three-corpus examples are maintained in the separate, currently access-controlled
[matryoshka-extraction-alias repository](https://github.com/jimhcyang/matryoshka-extraction-alias).

## What The Demo Shows

- Fifteen temporary presentation questions: five per task, with distinct episodes.
- Only genuinely completed planning conditions are supplied; a missing arm is
  not filled using another arm's result.
- Source quotations, explicit evidence judgments, candidate rankings and saved
  graph-relevance flow. A route or a grammatical fit does not establish a fact.
- Separate hypothesis and reconstruction examples: neither a polarity-flipped
  question nor a task-switched repetition is another presentation example.
- Partial, unsupported and contradictory outcomes remain visible. These are
  outcome-informed development examples, **not a benchmark accuracy estimate**.

Six questions are explicitly marked temporary diagnostics and retain unresolved
outcomes. Reaching fifteen examples is not a claim of fifteen successful
recoveries or of meeting the final evidence-quality targets. The displayed
local support decisions and separate post-run opinions remain different axes.
No absolute-never hypothesis is needed to complete this temporary selection.

The landing page separates Corpus Map exploration from the Analyst Workbench.
Read the [eight-page methods guide](https://jimhcyang.github.io/matryoshka-demo/docs/matryoshka-guide.pdf)
for local grammar, query controls, retrieval, hierarchy diffusion and decisions.

This is saved replay, not an interactive inference service. In one measured
Iran redaction, offline construction took 17.1 minutes for A and about 69.5
minutes for B/C. C abstained and used B's broader operations in that case.
These are latency limitations, not webpage loading times or general arm-speed
estimates. No runtime improvement is claimed by this presentation update.

## Run Locally

Use a modern browser with Web Crypto and gzip decompression support. Serve the
`site` directory over HTTP rather than opening HTML files directly:

```sh
python3 -m http.server 8080 --directory site
```

Open the server's printed URL. The same files are deployed using GitHub Pages;
project-relative URLs work without a Python backend. Do not put credentials into
the static site or add an API proxy to the public transport.
Full-map data still requires an internet connection to the pinned GitHub files;
the browser never calls a paid model API.

For a genuinely offline saved viewer, use the
[offline bundle builder](docs/OFFLINE_BUNDLE.md). It copies the verified datasets
into a separate directory and localizes graph transport without changing saved
answers or rankings. The full bundle is about 3.5 GiB; serve that directory over
HTTP. It does not contain a fresh-query inference backend.

The graph datasets live in `datasets/`, outside the Pages artifact. They
are independently compressed and fetched from this repository at one immutable
Git commit, with wire and decoded hashes checked in the browser. This avoids
large shared-dictionary downloads during map exploration. No GitHub API token
is needed. A full clone includes these data files and is much larger than the UI.

## Provenance And Reproducibility

`site/publication.json` lists the exported file hashes, source release basis,
case families, parent report commitment and public transport transformations.
The API index maps finite, canonical saved requests to verified data files.
Missing or changed packets fail closed; no other condition is substituted.

Original inference checkpoints, grades, source extraction, aliases and hierarchy
are not changed by export. The public transport has new hashes rather than
pretending an edited public file is the original sealed research artifact.
An inference receipt is explicitly not the complete native checkpoint download.

Route cards prefer distinct, straightforward three- or four-edge witnesses
where available, with no repeated states or community re-entry and at most one
hierarchy rise/fall. Longer simple source chains remain possible. This is a
bounded presentation choice over the saved graph, not a retrieval improvement
or new factual proof. Short paths are retained honestly where appropriate.

Evidence uses strict query-date cutoffs and whole-origin-document exclusion.
CIB evidence is earlier-visible; cable evidence follows the saved historical
classification/handling policy. The separate Corpus Map has its own declared
exploration scope. Entity identities and hierarchy are retrospective.

## Maintainer Checks

```sh
python3 -m pip install -r requirements-dev.txt
python3 -m pytest -q tests
python3 tools/validate_publication.py --site site --base-path /matryoshka-demo/
```

The exporter requires the original local source workspace and its pinned saved
artifacts. It does not rerun extraction, aliasing, retrieval, ranking or grading.
Publication checks verify declarations and bytes; they are not a legal opinion,
independent historical identity audit or proof of model generalization.

Managed-browser fixture checks are documented in `runtime/tests/README.md`.
Use the managed Chromium headless shell, never a personal Chrome profile.

CI explicitly pins a completed full privacy scan of the unchanged graph
datasets and freshly checks every dataset file hash. A dataset or validator
change invalidates that receipt; the default command above always does the
full scan. New workbench payloads still undergo full publication checking.

## Rights

See `site/NOTICES.txt`. This public demo does not grant a new blanket license to
underlying source documents, third-party assets or the private research corpus.
Historical source classification labels are preserved; public availability is
not represented as a new declassification decision by this project.
