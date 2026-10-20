# Automatic matching and Enter after filling

## What happens automatically

A supported empty OTP form registers its website, document, field constraints, time and any full recipient/request hints. Only authorized inboxes are searched. The matcher checks code shape, extraction context, receipt time, explicit expiry, consumed message IDs and concurrent attempts.

A sender on the website's registrable domain can match directly. A third-party delivery sender needs all of these additional signals for automatic selection:

- The subject, verification text or actual verification/continue link identifies the intended website. Redirect parameters are not decoded into trusted destinations. Privacy/footer links do not become verification actions merely because they are links.
- The recognized verification domains identify one website. Conflicting verification-site references require confirmation.
- Gmail's first Authentication-Results header identifies `mx.google.com` and reports DMARC pass aligned with the visible sender domain. Explicit DMARC/ARC failure prevents automatic selection. Arbitrary lower or foreign authentication headers are not promoted.
- To/Delivered-To/X-Original-To evidence addresses the verified authorized inbox, including supported Gmail aliases.
- Recipient/request constraints, uniqueness, expiry, code format, extraction score and complete inbox search still pass.

There is no editable sender map, hardcoded provider whitelist, background browsing of unrelated sites or learned persistent mail history. Brand wording is weak evidence and cannot alone trigger third-party automatic fill. A website with no distinguishing information may require confirmation or manual entry. These rules reduce mistakes; they are not measured accuracy percentages or proof that an authenticated sender is an authorized provider for a website.

## Enter settings

Settings → **After filling** contains:

- **Press Enter after fill**: enabled by default, with a switch to turn it off.
- **Delay before Enter**: immediate, 150 ms (default), 300 ms, 500 ms, 1 second or 2 seconds.

The extension acknowledges a successful fill first. It then reads the current policy again, checks the active tab/document and original values, focuses the last OTP input and dispatches Enter. A standard form falls back to `requestSubmit` only if the site did not prevent Enter or already submit. Form validation, disabled submit controls, changed fields, visibility, navigation and known completion state are respected. It never calls `form.submit()` or adds debugger permission to forge physical keypresses.

Script-created keyboard events are not trusted physical keypresses. A custom site may require a real user action. Sites that continue through a background fetch on input without dispatching a submit event cannot always be recognized as already submitted; disable Enter for those sites. The setting is global for this version.

## Existing installations

Reload the extension card in `chrome://extensions`, close the old settings tab and reopen Settings. Refresh an already-open verification page so the latest content controller is active. The installed folder remains `artifacts/otp-autofill-0.1.0` to preserve its path-derived ID, while its manifest version is 0.3.1.

Additional inboxes require the updated companion source. If an older companion is running, restart it with `npm run companion` and reconnect its accounts; credentials intentionally do not survive process exit. Primary Chrome Identity mode does not require that process.

## References

- [Gmail message authentication](https://support.google.com/mail/answer/180707)
- [Authentication-Results trust considerations](https://www.rfc-editor.org/rfc/rfc8601)
- [Validated requestSubmit behavior](https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/requestSubmit)
- [Script-created event trust](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted)

If Chrome's Errors page still lists `assets/styles-Cy5V007h.js` with “reading length,” that record came from the old v0.2.0 UI. The current UI validates inbox/site lists and flow data before rendering. Reload the extension card, close old settings tabs and reopen the popup; its footer shows the running UI version. Clear the historical error records after reloading, then check whether a new error appears. Syncing files or refreshing the Errors page alone does not reload the running extension.
