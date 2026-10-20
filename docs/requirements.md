# PRD implementation map

The user-supplied OTP Autofill PRD is the product reference. Its embedded roadmap and recommendations are requirements context; they do not authorize public deployment, external communications, or account changes. The implemented scope covers the P0 single-account Gmail MVP. P1/P2 providers, multi-account, analytics, and trusted-site submission remain outside this release.

| Requirement          | Implementation                                                                                  | Validation                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| FR-01 Onboarding     | Popup disclosure, configuration guidance, recoverable errors                                    | Browser UI tests; live OAuth consent still required                        |
| FR-02 Authentication | Chrome Identity, read-only scope, one-time invalid-token retry, disconnect and revoke           | Gmail integration tests; controlled live-account validation still required |
| FR-03 Detection      | Accessible labels, autocomplete, named fields, split inputs, dynamic observation, exclusions    | DOM unit tests and real Chromium forms                                     |
| FR-04 Discovery      | Active-attempt Gmail query, ten-message budget, bounded concurrency and retries                 | Gmail and coordinator integration tests                                    |
| FR-05 Parsing        | Plain text, nested MIME, HTML entities, numeric/grouped/alphanumeric extraction                 | Supported fixtures and browser pipeline tests                              |
| FR-06 Matching       | Public suffix aware sender relationship, timing, compatibility, uniqueness and abstention       | Matcher fixtures and coordinator/browser tests                             |
| FR-07 Filling        | Native setter, input/change events, empty-only policy, document/target revalidation             | DOM tests and React browser fixtures                                       |
| FR-08 State          | Typed flow states, deadline, cancellation, permission and transient-error states                | Lifecycle/coordinator/browser tests                                        |
| FR-09 Popup/settings | Connection, automatic-fill toggle, current status, manual retry, candidate choice, site removal | Browser UI and coordinator tests                                           |
| FR-10 Submission     | No submission implementation or permission path                                                 | Browser fixtures assert no automatic submission                            |

## Acceptance boundaries

The initial fixture suite is a controlled regression suite, not evidence that the PRD's proposed 98% extraction or 95% field-detection targets have been met across real websites. Those rates require a representative held-out beta corpus and a documented denominator. The under-ten-second delivery target is subject to API latency, browser throttling, retry backoff, and email delivery, and is not claimed as a measured production guarantee.

Website references and brand words in email bodies do not grant trust: the MVP requires a sender-domain relationship to avoid weak text-only correlation. Complex input patterns and unfamiliar formats abstain. Explicit success signals are heuristic; the extension does not receive authoritative authentication results from arbitrary websites.

See the release checklist for remaining OAuth, store, and controlled-account work.
