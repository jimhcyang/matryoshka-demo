# Scoring And Evidence

Scores describe evidence alignment and candidate priority. They are not
calibrated probabilities that an answer is correct. A high retrieval score,
grammatical insertion or graph connection does not by itself establish support.

Score labels matter: source-alignment indices, contextual proposal indices and
candidate ranking points are different quantities. Compare candidates within
the same recorded calculation, not across those score families. The formulas
below describe source-assessed results, including the active Live processor.

## Finding Sources

Individual facts are searched with BM25. Graph relevance and reciprocal-rank
fusion help select documents. Within those documents, fact-by-fact passage
nominations share inspection opportunities. These retrieval ranks select what
to inspect; they do not enter the final source-alignment formula below.

Source dates, release visibility, document exclusions and handling restrictions
constrain the available evidence. An exact quotation must replay against its
recorded source text. Graph inspection follows the extraction linked to that
quotation; community membership is navigation, not corroboration.

## Alignment

For the fact or candidate being assessed, let Q be its normalized token set and
S the token set of its own source quotation:

    containment = |Q intersect S| / |Q|
    Jaccard = |Q intersect S| / |Q union S|
    L = 0.5 * containment + 0.5 * Jaccard
    A = 0.75 * structured_alignment + 0.25 * L

Empty denominators contribute zero. Tokens are case-insensitive and
deduplicated. Structured alignment evaluates the applicable requested facets,
including actor, action or property, arguments, issue, time, quantity, polarity,
modality, attribution and conditions. Only applicable facets enter its
denominator. Matching a different actor, event or time does not satisfy the
requested relationship.

Semantic assessments are model-assisted, with separate review where required.
Local checks validate source spans, scope, response consistency and arithmetic;
they do not turn interpretation into a guaranteed fact. Failed or unreviewed
assessments receive no positive directional credit.

## Redaction

In source-assessed results, candidate phrases originate in inspected corpus
passages. Any permitted change
of form retains its source wording and recorded transformation. Completed
insertions must pass the applicable slot, grammar and scope checks.

The source assessment concerns the candidate's inserted contribution, not every
statement in the surrounding input. Source-assessed candidate priority is:

    priority = (C + 0.99 * A) / 3

C is 2 for accepted direct source support, 1 for inferential context and 0 for
unresolved, held or conflicting evidence. This makes accepted direct support
rank above contextual suggestions. Candidates are ordered by descending
priority, with a stable identifier tie-break. Equal calculated scores remain
equal; the interface does not invent differences.

Source support, insertion fit and recovery of the concealed wording are
different judgments. A well-supported candidate need not reproduce the complete
hidden answer. Fewer than five candidates may survive the checks.

Context-only proposal records instead use:

    priority = 0.55 * own_page_focal_coverage
             + 0.25 * local_grammatical_fit
             + 0.20 * nonrepeated_content_fraction

That score can reach one without factual support. Saved candidate ranking
points retain their own recorded evidence, fit and ordering rules; they are not
rescaled into this source-priority formula. Their score details identify the
applicable calculation. Replaying a score does not create a missing semantic
assessment or independent review.

## Mosaic

Each requested fact has its own source accounts and alignment indices. A
complete Mosaic requires source support for every required fact, with applicable
qualifications and operators retained. A high average alignment cannot make an
unsupported fact complete. Partial and contextual accounts remain distinguishable
from complete support.

## Hypothesis

Support, opposition and context are assessed separately. Opposition must address
the same issue and preserve actor, role, time and qualification bindings; missing
evidence is not opposition. An accepted opposing account may align through an
explicit conflict in the requested polarity or modality rather than literal
agreement with the input.

For each fact and direction, only the strongest contribution from one historical
document is counted, then those document contributions are summed. Repeated
passages from the same document do not become extra votes. Different documents
are not assumed to be independent reports. Direction totals may exceed one;
they are accumulated indices, not probabilities or percentages of truth.

## Reading The Display

Green denotes support, red opposition and amber context or partial evidence.
A mixed green/amber card has support and context associations, not opposition.
A green/red card has recorded associations in both directions. The source
details identify which fact or candidate each association concerns.

Source quotations and checks explain the result; the Analyst Summary digests
that result after processing and does not determine the ranking. Each source
label links to its document and exact quotation. Unprocessed work and empty
bounded searches do not establish that no answer exists in the corpus.

## Visiting Delegation

The delegation study uses the registered later-release corpus through its
recorded cutoff, including the source document. Its quotations retain their
original edition and page provenance. It is not an earlier-release-only
recovery test, and the still-withheld historical answer is not supplied as
ground truth. A nominated answer and its supporting context remain inspectable
without declaring that the concealed identity has been verified.
