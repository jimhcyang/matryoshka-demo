# Source-Bound Candidate Scoring

## Source Availability

The delegation study admits the complete registered later edition of
CIA-RDP79T00975A004300220001-9, dated 17 February 1959. All 17 physical PDF
pages enter the corpus, including page 8's sentence about an exercise observed
by the Swedes. Its original classification, release stamp and remaining masks
are preserved. Ordinary saved cases retain their original source restrictions.
This study is not an earlier-release-only recovery test. The withheld
delegation's identity remains unknown.

## Retrieval And Inspection

BM25 searches individual facts. Graph propagation and reciprocal-rank fusion
remain unchanged. Inspection keeps its 32-page bound, but diversity distinguishes
a registered source edition from an earlier masked edition of the same
document. Editions still count as one historical document, not independent
corroboration.

Candidate construction retains 64 assessment opportunities: 32 primary and
32 supplemental. The new supplemental mode alternates existing literal-source
groups and licensed source-form groups in their existing order. A licensed form
does not bypass source, grammar, controller, joint-slot or counterevidence
checks. Without licensed forms, allocation remains identical to the old mode.

## Realization

A literal source noun may produce an adjective through the installed WordNet
resource. For example, the source word Swedes can license Swedish. The exact
original quotation, source span, resource version and derivation are recorded.
The actual completed insertion must pass adjective, head and joint-slot checks.
The noun is not relabelled as a verbatim source adjective. Neither the conversion
nor its score proves that the named group is the withheld delegation.

No candidate enters through an input-only suggestion channel in new executions.
An input mention may contribute to ordinary contextual relevance only after the
candidate is independently nominated from an admitted, inspected corpus page.

## Arithmetic

The terminal points formula is unchanged:

    score = 100*tier + (40*W + 25*B/1023) + 35*u/(1+u)
    u = max(0, (S + F + 0.5*C)/(1+O))
    W = bool(B & ~18)

The variable tier is the existing evidence tier: contextual 0, partially grounded 1, or
evidence-backed 2. Rejected candidates remain rejected. B is the existing
source/function feature bitset. S, O and C are source-weighted support,
opposition and context contributions. Neither tiers nor factual decisions are
changed by this arithmetic revision. Points are not correctness probabilities.

Each contribution is its checked fit multiplied by its source weight:

    weight(r) = 0.5 + 0.5/(1+log2(r))

r is the better of the saved fused page position and a saved BM25 position for
an actual parsed fact. Unknown fact IDs and invented ranks are rejected. A
missing recorded rank receives weight 0.5. For each direction and historical
document, only the largest contribution counts; repeated pages, editions and
quotations do not create additional votes.

F has five bounded components:

    0.32 * source-owned relation fit
  + 0.16 * source-owned role fit
  + 0.16 * source type OR checked realized-form fit
  + 0.16 * lexical overlap
  + 0.20 * visible-scope fit

Realized-form fit is separate from raw source type and cannot stack with its
0.16 allocation. Lexical overlap balances the focal fact and the best
background fact equally; without background facts it uses the focal fact.
Matches are computed for individual fact/quotation pairs, not by joining
unrelated quotations. Visible-scope fit requires exact input/source anchors.
The extension for source-derived NORP forms accepts explicitly typed Other or
group anchors, never missing, differently capitalized or invented types. It records relevance, not
coreference or proof of the missing relationship.

Context contributions use each quotation's own occurrence and fit. Adding an
unrelated citation cannot inherit another quotation's lexical license or score.
Actual resource paths and proof flags replay; caller-provided truth flags alone
are insufficient. Existing requirement-level support and opposition remain
separate from these contextual features.

## Saved Results

The two refreshed delegation inputs use terminal-evidence-fit/7 and the admitted
source edition. Fourteen other displayed cases retain their prior native
executions, source policies and scores. Their scores are not retroactively
rewritten. Every candidate's expanded scorecard records the applicable version,
components and quotations. This is a curated casebook, not a benchmark estimate.
