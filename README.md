# Matryoshka

[Demo](https://matryoshka-demo.midllmat.com/) | [Deployment](https://github.com/jimhcyang/matryoshka-demo/actions/workflows/pages.yml)

Explore historical intelligence through a knowledge graph and an analyst workbench. The three collections contain Central Intelligence Bulletins, Iran cables and Vietnam cables. Nine primary inputs cover Mosaic, Hypothesis and Redaction in each collection. Five additional authentic CIB redactions, a visiting-delegation study, a Salvadoran bench case and ten source-derived recovery studies are also available. Select Redaction and CIB in Examples to open the additional studies.

## Examples

| Collection | Investigation |
| --- | --- |
| CIB | French nuclear independence and alliance policy; Saudi technical assistance and anti-American pressure. |
| Iran | Bakhtiar's declared military backing, Bazargan's appointment, the Shah's military command and revolutionary justice. |
| Vietnam | Paracel fighting, Spratly garrisons and competing assessments of offshore negotiations and deterrence. |
| Additional CIB redactions | Harmodio Arias, an air-force commander, Betancourt, corruption and Aung Gyi. |
| Visiting delegation | Swedish is the first contextual suggestion in a later-release search. The withheld historical answer is unknown. |

The three Mosaics each have two source-model-supported components. Hypothesis retains supporting and opposing assessments with their speakers and conditions. Namyit Island resolves an unnamed garrison reference; the source's literal wording is "one island of that group." Iran's Haeri-Yazdi suggestion is partially corroborated, not direct support for every part of the input. Aung Gyi is a contextual third-ranked candidate, not evidence that he performed the concealed action.

The workbench uses one presentation: Input, Facts to look for, Facts to evidence, Selected evidence, Saved fills or task findings, and Analyst Summary. Inputs, quotations, dates, exact highlights and CIB page-paired PDFs are inspectable. Each displayed method retains its own recorded scores; source-model assessment does not rewrite the separate structural result. Scores are ordering and evidence-fit indices, not calibrated probabilities. A saved retrieval walk and subsequent inspection of a source's existing KG neighborhood remain explicitly distinct.

The graph supports hierarchy and neighborhood navigation, reversible labels, source inspection, synchronized release views and source-linked Redacted Slots. Gentle motion respects reduced-motion preferences. Identity and hierarchy organization are retrospective; their geometry does not establish a claim.

[Methods and case guide](https://matryoshka-demo.midllmat.com/docs/matryoshka-guide.pdf) | [Contained code snapshot](https://matryoshka-demo.midllmat.com/downloads/matryoshka-code.zip)

## Run Locally

```sh
python3 release-tools/serve_static.py --port 8977
```

Open `http://127.0.0.1:8977/matryoshka-demo/`. Python 3.11 or later is sufficient for saved viewing. The checkout contains its graph datasets and source replay assets; it does not import another local workspace. The optional Live page needs a separately authenticated backend. No provider credential is included or reconstructible from this repository.

Ordinary evidence is dated on or before the input's source day. CIB admits earlier/shared text, including the eligible earlier version of the origin. Iran and Vietnam use eligible CONFIDENTIAL cables and exclude the SECRET origin. The visiting-delegation study uses later-release pages through its source day, including that document. Inspecting a PDF does not change a recorded evidence policy.

The ten recovery studies come from the source-only 31-case development experiment: five primary top-five suggestions were graded whole-answer-compatible and ten whole-or-partial by a separate meaning review. Literal recovery was 1/31. These are different metrics, not held-out accuracy or certification that each suggestion is supported by its source. All original slates, scores and source qualifications are retained; no QA answer or grade enters the public solver view.

## Verify

```sh
python3 -m pip install -r requirements-dev.txt
python3 -m playwright install chromium --only-shell
python3 -m unittest discover -s release-tools/ci -p 'test_*.py'
python3 release-tools/ci/validate_manifest.py --site site --scratch /tmp/matryoshka-check --output /tmp/matryoshka-check.json
python3 release-tools/ci/browser_smoke.py --site site --output /tmp/matryoshka-browser-check
```

Use Playwright's managed Chromium headless shell, never a personal browser profile. Publication records bind the report, API index, code archive and file inventory. Verify the deployed manifest after a successful Pages workflow; a push alone is not deployment confirmation.

## Sources

See `site/NOTICES.txt` and `docs/CORPUS_RELEASES.md`. This repository grants no new rights to source documents. Original handling labels and distinct inference/source-review provenance remain recorded. Private provider requests, credentials and Live history are not public assets.
