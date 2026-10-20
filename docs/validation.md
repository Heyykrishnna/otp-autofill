# Validation report

Version 0.3.0 validated locally on 21 October 2026 with Node.js 24 and the project-locked Playwright Chromium runtime.

| Check                                           | Actual result                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm run check`                                 | Passed                                                                                                             |
| `npm run typecheck` within the check command    | Passed strict TypeScript checks                                                                                    |
| `npm run lint` within the check command         | Passed                                                                                                             |
| `npm run format:check` within the check command | Passed                                                                                                             |
| `npm test` within the check command             | 121 tests passed across ten files                                                                                  |
| `npm run build` within the check command        | Passed; installable Manifest V3 output generated                                                                   |
| `npm run test:e2e` within the check command     | 27 Chromium browser tests passed                                                                                   |
| `npm audit --audit-level=moderate`              | Zero vulnerabilities reported                                                                                      |
| `npm ls --depth=0`                              | Dependency tree resolved without missing or invalid dependencies                                                   |
| `node scripts/package.mjs`                      | ZIP created successfully with 13 build files                                                                       |
| ZIP integrity and byte comparison               | Archive entries exactly match the generated build                                                                  |
| Production artifact inspection                  | Runtime entry points present; no fixture tokens, test OAuth client, environment files, or source maps in the build |
| Popup and settings screenshots                  | Visually inspected; readable layout with no observed clipping                                                      |

The archive is `artifacts/otp-autofill-0.3.0.zip`; its checksum is in `artifacts/SHA256SUMS`. For the existing installation, keep using `artifacts/otp-autofill-0.1.0` so its path-derived ID continues to match the registered OAuth client. Loading a different folder produces a different development identity.

The production build was installed directly in an isolated Chromium profile to confirm that missing OAuth configuration produces setup guidance and a disabled connection action. Other browser tests used a separate build copy with controlled Identity and Gmail responses; they did not access a real inbox or change the production manifest.

Initial failures found during development were corrected and covered by the final passing run, including trailing code punctuation, trusted extension-page routing, recovery after toggling automatic fill, and deterministic initial form selection. Regression tests also cover retrying partially failed Gmail batches and resuming existing content scripts.

## Remaining release requirements

- The owner confirmed **Gmail connected** after reloading the extension and completing its Google connection flow. That status was reported by the owner; browser automation could not inspect the extension page directly. A real OTP retrieval/fill, cancellation, and Google-side revocation were not independently tested.
- Actual Chrome host-permission prompts and supported live websites require the controlled beta checks in `testing.md`.
- Google restricted-scope verification, public privacy-policy publication, and Chrome Web Store review remain outstanding.
- The PRD's proposed accuracy and latency targets have not been established through a representative beta corpus. Fixture success is not a production performance claim.

No local validation failure remains unresolved in the final checked build.

## Repository publication

Published to [Heyykrishnna/otp-autofill](https://github.com/Heyykrishnna/otp-autofill) on `main` on 21 October 2026. The initial published commit is `c0699d018fa26025e93df36afff5d2141f62f2d3`. All 69 published files were compared with the local Git tree. All 60 non-Markdown files, including application code, tests, tooling, dependency manifests, configuration, assets and the existing PDF, retained their original bytes during documentation preparation.

Before publication, `npm run check` passed again with 83 unit/integration tests and 17 Chromium tests, and `npm audit --audit-level=moderate` reported zero vulnerabilities. Markdown links and anchors were checked. Private environment files, generated runtime builds, archives, installation backups and browser diagnostics were excluded from the commit.

The first [GitHub Actions run](https://github.com/Heyykrishnna/otp-autofill/actions/runs/39486162609) completed successfully. CI uses the repository's configuration without the owner's ignored local OAuth settings. New clones must configure their own extension identity and Google OAuth client as described in the README.

## Existing Chrome installation update

The user confirmed loading `artifacts/otp-autofill-0.1.0` unpacked in Chrome with ID `pfhmngabnonjbbmomndimnkebibdmjkh`. The path-derived identity was verified before updating this directory. `npm run sync:local` passed, retained that ID, and preserved the previous installation under `artifacts/.backups/`. All 13 installed files were compared byte-for-byte with the validated build. The ZIP and checksum were refreshed. The owner subsequently confirmed reloading and completing the Google connection flow, reporting **Gmail connected**.

The owner explicitly approved creation of the Google Cloud project `otp-autofill-512219`, and its successful creation was verified in Chrome. No billing configuration was performed. Gmail API activation, the **OTP Autofill Chrome** client of type **Chrome Extension**, External/Testing audience with the owner as the sole test user, and the saved `gmail.readonly` consent scope were verified through the Google Cloud UI.

After the real public OAuth client ID was added to the ignored local environment file, `npm run check` passed again: strict types, lint, formatting, 83 unit/integration tests, production build, and 17 Chromium tests. The configured manifest contains the issued client ID and only `gmail.readonly`. The synced installation and ZIP were verified byte-for-byte against all 13 build files, and the checksum was refreshed. The previous installation was preserved under `artifacts/.backups/otp-autofill-eAkJ1E/previous`.

Chrome's extension pages cannot be controlled through the available browser automation because of its URL security policy. The owner performed those actions and confirmed **Gmail connected**. No token or inbox content was inspected by browser automation. A real OTP retrieval/fill remains a separate live acceptance check.

## Version 0.3.0: edge cases, automatic matching and configurable Enter

The owner confirmed that existing autofill was working, then requested automatic third-party association and configurable Enter after filling. Sender mapping controls and matching dependencies were removed. The current matcher combines intended verification domains, Gmail authentication evidence, addressed authorized inbox, request/recipient constraints, expiry, uniqueness and complete-search status. Incomplete evidence still abstains or offers a choice. It does not claim measured precision or prove third-party ownership of a website.

`npm run check` passed with strict types, lint, formatting, 121 unit/integration tests and 27 Chromium tests. Browser fixtures include automatic third-party association through both Chrome Identity and the real random-port multi-inbox companion, partial failure abstention, split/single React fill and Enter, cancelling a delayed Enter, and recovery from an older worker snapshot. Unit tests cover native validated submission, prevented Enter, invalid forms, changed values, duplicate submission and current-policy revalidation.

A startup settings migration introduced during development was reproduced overwriting the fixture's connection state; it was removed before installation. The source now reads/migrates supported preferences during normal settings operations rather than writing connection defaults during startup. No unresolved functional failure remains in the final checked code. Later cosmetic changes to the settings toggle were checked with formatting, production build and the relevant browser screenshot test.

The Desktop client **OTP Autofill Local Companion** was created in the existing project with the owner's explicit action-time approval, and its secret was saved only in ignored mode-600 `.env.local`. No additional inbox consent is implied by client creation. Additional live-account consent, real third-party templates, real-site Enter behavior and Google-side revocation remain controlled acceptance checks. An already-running older companion requires restart/reconnection to use its updated email-evidence parser; tokens intentionally remain memory-only.

The owner removed the v0.1.0 illustrated PDF from the remote repository in commit f8d9d0a; that change was preserved. A private historical local copy remains under ignored artifacts/history, superseded by the current matching, architecture and privacy documents. No Google secret, test credentials or environment file belongs in the extension ZIP or Git tree.

The owner subsequently clarified that automatic filling was working. This is user-reported live behavior; Enter on real sites and newly inferred third-party templates have not been independently observed. Reloading the updated extension card and refreshing an already-open verification page are required to activate this build.
