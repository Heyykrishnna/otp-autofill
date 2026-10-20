# Implementation and usage guide

This guide explains how to run the existing application and where its behavior is implemented. Setup requires local configuration and a Google OAuth client; no application-code edits are needed to connect a new development installation.

## Choose your starting point

| Situation                                        | Follow this workflow                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| New clone on your machine                        | Build, load `build/chrome-mv3-prod`, register that ID and configure `.env.local`.              |
| Existing installation from the same build folder | Rebuild and use Chrome's Reload action for that same folder.                                   |
| Existing installation under `artifacts/`         | Configure the local sync variables and use `npm run build:local`.                              |
| Sharing with developers                          | Share the repository; each developer configures their own installation and Google client.      |
| Sharing one configured build with testers        | Establish a stable identity, matching OAuth client and allowed test accounts before packaging. |

The [README](../README.md#getting-started) is the complete fresh-clone walkthrough. The [OAuth guide](oauth-setup.md) covers Google-side setup.

## Runtime components

| Component         | Responsibility                                                                                                      | Main files                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Popup             | Connect, enable the active site, inspect an attempt and choose a candidate.                                         | `src/popup.tsx`, `src/ui/use-extension.ts`                                     |
| Settings          | Control autofill, disconnect Gmail, remove site grants and show disclosures.                                        | `src/options.tsx`                                                              |
| Background worker | Validate messages, own Gmail authorization, coordinate attempts and publish status.                                 | `src/background.ts`, `src/background/`                                         |
| Content script    | Discover supported empty fields, watch page changes, request polling and revalidate before filling.                 | `src/content/`                                                                 |
| Core rules        | Decode email, extract candidates, compare domains, enforce time/format rules and validate inputs.                   | `src/core/`                                                                    |
| Local companion   | Hold separate Google credentials in memory, use Desktop PKCE OAuth, expose authenticated loopback inbox operations. | `src/companion/`, `src/background/companion.ts`, `src/background/mailboxes.ts` |
| Build tools       | Bundle React pages, worker and content script; write the manifest; package or sync an installation.                 | `scripts/`, `vite.config.ts`, `manifest.config.mjs`                            |

Chrome dynamically registers an isolated content script only for granted sites. Single-inbox mode needs no backend deployment, database or webhook. Multiple inboxes use the optional local Desktop OAuth process described in [multi-inbox setup](multi-inbox-setup.md); no cloud mail backend is required.

## Algorithm walkthrough

### 1. Detect a verification field

The detector inspects at most the first 500 inputs and checks usability, OTP-related attributes and accessible labels. Single fields and supported groups of four to twelve single-character inputs can qualify. Phone, card, payment, postal and promo-like fields are excluded. Filling starts only when exactly one supported target is found and its inputs are empty.

### 2. Create and validate an attempt

The content script records a UUID, detection timestamp, hostname, recipient/request hints and field constraints. It registers inactive forms without reading mail to detect overlapping same-provider sessions. A resend uses the click time as a strict timestamp floor. The worker checks the sending extension, top frame, document ID, current URL, active tab and host permission. Gmail connection and autofill must both be enabled. The attempt expires after two minutes.

### 3. Search and parse recent email

The Gmail adapter queries verification-related messages received after detection minus fifteen seconds, excluding spam and trash. It searches only the verified primary inbox and explicitly authorized companion inboxes, at most two inboxes concurrently and ten message IDs per inbox. An additional result page triggers conservative retry rather than accepting a partial set. Bodies are fetched in batches of at most three, decoded and parsed locally.

Extraction requires a known verification phrase and a plausible nearby token. It rejects unrelated number contexts, preserves case and normalizes supported grouped numeric spacing. HTML becomes text instead of being rendered. Named attachments, explicit attachment dispositions and attached messages are excluded. Quoted reply history is stripped; recognized forwarded messages require confirmation.

### 4. Match candidates

A candidate must satisfy all of these conditions:

- Sender and page share a registrable domain, or third-party inference finds one intended website with aligned sender-authentication evidence and an addressed verified inbox. Competing domains or missing evidence require confirmation.
- Message age is at most three minutes and no more than fifteen seconds in the future.
- Message arrival is no earlier than fifteen seconds before this attempt began, or the exact resend time for strict attempts. Any recognized explicit relative expiry must remain valid.
- Known recipient/account and request references agree. Missing request evidence, overlapping unbound sessions, forwarded messages and incomplete inbox searches prevent automatic selection.
- Code shape, length and supported input pattern agree with the field constraints.
- Extraction score meets the eligibility threshold.

Identical codes are deduplicated only within their own inbox. Consumed message IDs and temporary in-memory fingerprints suppress repeated delivery across attempts. Automatic selection requires one unique eligible code with a score of at least `0.95`. Current extraction rules assign `0.98` within twenty-four characters of a recognized phrase and `0.85` within the broader sixty-five-character window. These values are rule scores, not calibrated probabilities. Lower-score or conflicting candidates require explicit selection or manual entry.

### 5. Recheck, fill and stop

Before writing, the script checks the attempt, URL, exact target elements, constraints, page visibility, usability and empty values again. It uses the native input setter, dispatches input/change events and verifies the result. The worker clears candidate references after filling is acknowledged. The configurable after-fill action sends Enter after acknowledgement and the selected delay. It rechecks current policy, active document, code values, validity and duplicate-submission state. If the site does not handle Enter, a standard form uses requestSubmit. This preserves validation and submit handlers; direct form.submit is never used.

Manual typing, navigation, target replacement, disabled autofill, removed permission, disconnect and expiry stop the attempt. Temporary failures back off within the same deadline. See [architecture](architecture.md) for detailed timing and state behavior.

## Development loop

Install dependencies from the committed lockfile:

```sh
npm ci
```

Start the watcher:

```sh
npm run dev
```

The watcher runs a build initially and rebuilds supported project changes. After a successful build, use Chrome's **Reload** action to activate it. Keep the loaded directory unchanged so that the OAuth registration remains valid.

For UI experimentation, run the fixture site in a separate terminal:

```sh
npm run test:site
```

The page is served at `http://localhost:4173`. Its query scenarios are defined in `test-site/main.tsx`. Running this server alone does not create Gmail messages or bypass matching. Automated browser tests route the page under a controlled example domain and inject fixture responses only into their isolated test copy.

## Validate a change

```sh
PLAYWRIGHT_SKIP_BROWSER_GC=1 npx playwright install chromium
npm run check
npm audit --audit-level=moderate
```

The browser-install command is needed once per environment. On Linux, CI installs Chromium system dependencies with `npx playwright install --with-deps chromium`.

`npm run check` is the project's authoritative local validation sequence. Live Gmail retrieval, real site behavior and Google-side revocation require separate account-based checks described in [testing](testing.md). Preserve the production manifest and avoid putting fixture tokens or responses into application paths.

## Update an existing artifacts installation

This workflow applies only to an existing unpacked OTP Autofill folder inside this project's `artifacts/` directory. It is optional; ordinary clones can continue loading `build/chrome-mv3-prod` directly.

In `.env.local`, set:

| Variable                 | Value to use                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_OAUTH_CLIENT_ID` | The client registered for this installed extension.                                                               |
| `EXPECTED_EXTENSION_ID`  | The exact ID displayed in Chrome.                                                                                 |
| `LOCAL_EXTENSION_DIR`    | The relative path of the already-loaded folder, such as `artifacts/otp-autofill-0.1.0`.                           |
| `CRX_PUBLIC_KEY`         | Leave blank for an existing folder-based identity, unless deliberately using its corresponding stable public key. |

Then run:

```sh
npm run build:local
```

The sync tool checks the ID before replacing files, preserves the previous installation under `artifacts/.backups/`, and rejects a different app, a symbolic-link destination or a folder outside `artifacts/`. Reload the same extension in Chrome afterward. Do not point this command at a new or unrelated folder.

## Package and share

```sh
npm run package
```

The command creates `artifacts/otp-autofill-0.3.0.zip` from the production build. Environment files and source maps are excluded. Package only after validating the intended configuration and identity.

For source sharing, send the repository link. Local `.env` files, `node_modules`, builds, ZIPs, installation backups, Playwright profiles and diagnostic output are intentionally not committed. The original illustrated PDF was removed from the public repository by its owner. Current behavior is documented in these Markdown guides.

For tester distribution, decide the extension identity and OAuth audience before sending a configured ZIP. A folder-derived ID changes between machines or extraction paths. Copying the author's ID into a recipient's config does not make their installed extension acquire that ID. A public manifest key or a managed Store identity needs a corresponding Chrome OAuth registration. Keep private signing keys outside the repository and package.

Public distribution remains subject to the [release checklist](release-checklist.md), required platform reviews and accurate privacy disclosures.

## Troubleshooting

| Symptom                             | What to inspect                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Connect is disabled                 | `.env.local` has a valid client ID; rebuild and reload the same installation.                           |
| Google rejects authorization        | OAuth client type, exact installed ID, testing audience, test-user membership and administrator policy. |
| Gmail access is denied              | Enabled Gmail API, granted read-only scope, revoked consent and account restrictions.                   |
| No field is detected                | Supported top-level target, clear OTP signals, empty inputs, visibility and site grant.                 |
| A code never fills                  | Active tab, message recency, sender-domain relationship, compatible format and ambiguity state.         |
| Sync refuses an update              | Expected ID, real existing destination inside `artifacts/` and the configured public key.               |
| A packaged copy gets a different ID | Different unpacked folder; establish its actual identity and matching OAuth registration.               |
| Disconnect warns about revocation   | Remove the Google grant manually through account connections; local processing has been disabled.       |
