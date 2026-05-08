# TREC Contract Red Flag Scanner: PRD

## Problem

Texans signing TREC standard contracts (1-4 Family Resale, Farm and Ranch, etc.) usually don't know which clauses are standard form language and which have been modified by the other party. Modifications can be subtle and consequential. Most buyers and sellers don't pay a lawyer to review every contract, and even when they do, the lawyer's first job is comparing the document against the standard form, which is mechanical work.

## What we're building

A landing page where someone drags in a TREC contract PDF, gets a free summary plus red-flag check in under a minute, and can pay $5 to unlock a full detailed report.

## User flow

1. User lands on a page with a single drop zone: "Drop your TREC contract PDF here."
2. PDF uploads, AI processes.
3. Free preview appears:
   - Which TREC form was detected (e.g., "20-18 One to Four Family Residential Contract")
   - Number of modifications detected vs. the standard form
   - Top 3 red flags (titles only)
   - Basic terms summary (price, key dates, parties, financing type)
4. Paywall: "Unlock full report: $5."
5. After payment, the full report renders on the page and is downloadable as a PDF.

## Free vs. paid

**Free:**
- Form identification with confidence score
- Count of modifications
- Top 3 red flag titles (no explanations)
- Basic terms (price, option period, closing date, parties, financing)

**Paid ($5):**
- Every modification shown side-by-side with the standard form
- Plain-English explanation of what each change means
- Risk rating per change (low / medium / high)
- Suggested questions to ask the other party or your agent/attorney
- Full term-by-term summary
- Downloadable PDF report

## What counts as a red flag

- Any deviation from the published TREC form text (added, removed, or reworded clauses)
- Known scary patterns regardless of standardness: "as-is" without inspection contingency, unusually short option periods (under 5 days), seller financing with unusual terms, removed default remedies, blanks left unfilled in critical fields, dates that don't reconcile with each other

## Inputs

- Single PDF upload, drag-drop or click. Max 10MB. No multi-file, no other formats.

## Outputs

- Free summary rendered inline (target: under 30 seconds end-to-end)
- Paid report rendered inline + downloadable PDF (target: under 60 seconds end-to-end)

## Standard contracts we compare against

The current published TREC forms. Pull the latest versions at build time and re-pull on a schedule (TREC updates these periodically). Cover at minimum:

- 20-18 One to Four Family Residential Contract (Resale)
- 23-19 Residential Condominium Contract (Resale)
- 24-19 Farm and Ranch Contract
- 25-13 Unimproved Property Contract
- 30-17 Residential Contract (New Home, Incomplete Construction)
- 9-17 Residential Contract (New Home, Completed Construction)
- Common addenda (financing, HOA, lead-based paint, etc.)

## Success metrics

- Accuracy: 95%+ of actual modifications caught (measured against a hand-reviewed test set of ~20 contracts)
- Conversion: 5%+ of uploaders pay the $5
- Speed: under 60 seconds from drop to free summary

## What this is NOT

- Not legal advice (prominent disclaimer on every screen and in the report)
- Not a replacement for a real estate attorney
- Not editing, generating, or signing contracts
- Not storing user contracts beyond the active session (privacy promise on the page)
- Not multi-state (Texas only for v1)

## Tech

Built on Netlify. AI via Netlify AI Gateway. Persistence via Netlify DB / Blobs as needed. Payment via Polar embedded checkout (Polar is merchant of record). Agent picks the rest.

## Out of scope for v1

- User accounts or login
- History of past uploads
- Editing or annotating the contract in-browser
- Email delivery of reports
- Non-TREC or non-Texas contracts
- Negotiation suggestions or counter-offer drafting
