# Research API fixtures

Captured on **2026-09-27** from the three keyless APIs the research fallback uses. Raw
responses, unmodified, so the parsers are tested against the real shapes rather than
against a tidied idea of them. `.prettierignore` covers this directory.

| File | Request |
|---|---|
| `europepmc-search.json` | `search?query=(magnesium OR "vitamin D" OR "gut microbiome") AND (SRC:MED) AND (FIRST_PDATE:[2026-03-01 TO 2026-09-27]) AND HAS_ABSTRACT:Y&resultType=core&pageSize=25&sort=CITED desc` |
| `europepmc-by-pmid.json` | `search?query=(EXT_ID:41837770 OR EXT_ID:40535201 OR EXT_ID:41669894 OR EXT_ID:41724097)&resultType=core` — the abstract-hydration path |
| `europepmc-preprints.json` | the same search restricted to `SRC:PPR`, so the preprint-exclusion rule is tested against real preprint records |
| `crossref-works.json` | `works?query.bibliographic=magnesium+deficiency+randomized&filter=from-pub-date:2026-03-01,until-pub-date:2026-09-27,type:journal-article,has-abstract:true&rows=20` |
| `pubmed-esearch.json` | `esearch.fcgi?db=pubmed&term=magnesium+deficiency[title/abstract] AND 2026/03/01:2026/09/27[dp]&retmax=20` |
| `pubmed-esummary.json` | `esummary.fcgi?db=pubmed&id=<the 20 ids above>` |

## What the captures establish

* **Europe PMC returns everything needed in one call** — abstract, DOI, PMID, PMCID,
  journal title, ISSN/eISSN, `citedByCount`, `isOpenAccess`, `pubTypeList`, MeSH terms.
  It is the primary provider for that reason.
* **Crossref abstracts are JATS XML**, e.g. `<jats:p>Hypomagnesemia is …`, and short
  (394 characters in the first record). The parser strips tags and the eligibility filter
  drops anything too thin to write from.
* **PubMed `esummary` carries no abstract at all.** Identifiers, journal, dates and
  publication types only. A PubMed candidate therefore has its abstract hydrated from
  Europe PMC by PMID — which is what `europepmc-by-pmid.json` records.
* **Preprints are `source: "PPR"` and have no journal title.** Restricting to `SRC:MED`
  excludes them structurally; the preprint-server name check is a second line.
* **Lucene precedence is the real trap, not the date filter.** `EXT_ID:a OR EXT_ID:b OR
  EXT_ID:c AND SRC:MED` returns **1** hit because it parses as `a OR b OR (c AND SRC:MED)`;
  parenthesised, the same ids return **3**. Six separate probes of
  `FIRST_PDATE:[… TO …]` — with and without parentheses, with and without `sort=CITED desc`
  — returned **zero** out-of-range records, so the date filter itself behaves. Every clause
  this client builds is parenthesised, and the code re-checks dates anyway.
