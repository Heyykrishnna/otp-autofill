# Testing

## Automated checks

Run `npm run check` after installing dependencies and Chromium. It checks strict types, lint, formatting, Vitest tests, a production build, and the extension browser suite. Run `npm audit` separately to query live dependency advisories.

Vitest exercises parsing, decoding, format compatibility, domain matching, stale/ambiguous messages, typed input preservation, split fields with and without `maxlength`, lifecycle expiry, rate limits, authorization failures, message reuse, cancellation, and the discovery-to-fill orchestration. Inputs and expected results use controlled fixtures.

Playwright copies the production build into its own test output folder, adds fixture origins and a test-only OAuth client identifier to that copy, and starts a fresh persistent Chromium profile. Only the test harness replaces Chrome Identity and Gmail HTTP responses in that worker. No actual Gmail messages or accounts are accessed. The test site runs on loopback and is routed under controlled origins to exercise real domain matching, dynamic content-script injection, Chrome messaging, the actual worker, the parser/matcher, and React-controlled forms. A dedicated MLH-style fixture combines six indexed fields without `maxlength`, the “sign into your account” email wording, an authenticated `mlh.io` sender and an `mlh.com` page. A Luma-style fixture covers a code that precedes the sign-in phrase and six visual slots backed by one React-controlled input without `maxlength`.

`bench/otp-widgets` runs 39 cases covering real OTP widgets (input-otp, Radix, antd, Mantine, Chakra v3, Ark, PrimeReact, MUI, react-otp-input, vue3-otp-input and hand-rolled patterns), negative pages and mixed forms in headless Chromium, then runs `detectTargets` + `fillTarget` on each. See its README to run it or add a failing site.

Fill regressions cover single controllers that read `InputEvent.data`, logically ordered split boxes remounted after each character, cancellation during insertion, edits made between digits, and host `beforeinput` handling. Coordinator tests verify redelivery before acknowledgement and abstention after acknowledgement, cancellation or new overlap. Browser fixtures include MLH-style uncontrolled boxes with paste/input handlers, replacement React boxes, and Enter continuation for both.

Security regressions also exercise malformed HTML email processing and link-verification cancellation during tab creation or an in-flight action. Cancelling an approved link prevents further automated clicks and completion updates; a tab Chrome already started opening can remain available for manual review.

Multi-inbox browser tests also start the real loopback companion, authorize two fixture accounts through its callback/state protocol and verify recipient selection or manual ambiguity. Google responses remain mocked. Companion unit/integration tests cover PKCE, scope, state, profile binding, refresh coordination and caller isolation. The edge-case suite covers automatic sender inference, thread/attachment exclusion, explicit expiry, resend floors and request references.

The original production build is unchanged by browser tests. Fixture strings, test OAuth identifiers, and mocked HTTP implementations must never be present in its packaged JavaScript. Browser tests generate screenshots for layout inspection under ignored `test-results/` directories. Do not publish profile directories or browser diagnostic artifacts.

## Controlled live-account checks before beta

1. Configure a real Chrome Extension OAuth client and designated test Gmail account.
2. Confirm consent disclosure, cancellation recovery, minimum scope, and successful API access.
3. Use an approved site whose real sender domain matches. Request fresh numeric, grouped, and alphanumeric codes and verify acceptance after manual submission.
4. Exercise split fields, delayed delivery, duplicate emails, two conflicting emails, expired codes, resent codes, and an unrelated newest email.
5. Type into a field while waiting; navigate, reload, switch tabs, replace the form, and disable site permission during retrieval. Confirm no stale fill.
6. Revoke at Google, test API quota/network failures, disconnect while waiting, and test offline revocation warnings.
7. Inspect Chrome storage and network destinations for retention or unintended transmission. Do not log real tokens, codes, or mail bodies to perform these checks.
8. Validate keyboard access, focus, narrow settings layouts, popup height, and the actual Chrome host-permission prompt.
9. Configure the Desktop client, authorize two controlled inboxes separately, test identical codes across inboxes, recipient hints, one-inbox failure and revocation. Restart the companion and confirm credentials are forgotten.
10. Test third-party senders with passing/missing/failing authentication and explicit/competing website intent, two unresolved same-provider tabs, request references, forwarded/replied messages and short explicit expiry.
11. Exercise link verification with approval and decline, distinct matching links, unrelated senders, insecure URLs, cross-site redirects, multiple action buttons, destructive labels, repeated buttons, expired links, explicit failure text and explicit completion text. Confirm every verification page opens outside the origin tab and that only successful completion refreshes the origin.
12. Collect held-out fixture and supported-site results before asserting accuracy or latency targets.

These live tests require account configuration and are intentionally separate from automated fixture claims.

Enter regressions cover single/split React fields, disabled continuation, changing the setting during a pending delay, prevented Enter, incomplete forms, already-submitted forms and values changed after filling. Browser test fixtures explicitly disable Enter in the original fill-only cases. Companion browser fixtures use random loopback ports so a user-running companion is not stopped or reused by tests.
