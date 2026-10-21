# Privacy and security

OTP Autofill helps move a Gmail verification code into an approved website's form and can, after explicit confirmation, open a matching email verification link. It requests Gmail read-only access through Google's authorization screen. This Google scope grants broad read access; the extension's implementation restricts its actual use to recent verification-message discovery during active attempts. It never asks for a Gmail password.

## Data use

In single-inbox mode the background worker sends authenticated requests directly to Gmail API. In optional multi-inbox mode a local loopback companion retrieves and parses mail from separately authorized accounts, then returns normalized messages to the worker. Message bodies are decoded and parsed locally. No body or code is sent to a developer-operated backend, analytics provider, or AI model. Google's API and OAuth systems necessarily receive the requests needed to authorize and retrieve mail.

Once a code is selected, it is delivered to the intended content script and written into the approved site's input. The receiving website can read the code and may process it according to its own privacy policy. Only grant permission to websites you trust.

Application code never persists Google tokens. Chrome Identity manages the primary authorization cache; the optional companion holds separate access/refresh tokens only in process memory and forgets them on exit. Its Desktop OAuth configuration remains in an ignored local environment file and is not packaged into the extension. Candidate codes are held only in memory for the active attempt, which expires within two minutes, and are discarded when filled, cancelled, disconnected, timed out, or the worker stops. Email bodies are not retained after parsing. There is no OTP history or analytics.

Verification URLs, including their tokens, remain only in worker memory until the attempt or approved traversal ends. The page prompt shows only sender and hostname. Approved links open in a separate tab. The extension requests site access for the verification host before inspecting it, stays within the same registrable website, and refreshes the origin only after explicit visible completion text. The destination website receives its own link token as it would from a manual click.

Local persistent storage holds autofill/connection flags, the verified primary inbox address, companion enablement, Enter preferences and revocation status. Temporary trusted session storage holds active attempt status, candidate metadata including the inbox address, bounded consumed message IDs and an opaque local pairing credential. Message IDs expire logically after three minutes; memory-only salted code fingerprints suppress duplicate delivery during a worker lifetime. There is no stored plaintext code or body. Chrome manages optional website grants. No application data is synchronized through `chrome.storage.sync`.

## User controls

- Grant access one HTTPS site at a time from the popup. Remove grants in Settings or Chrome's extension controls.
- Disable automatic filling to stop attempts.
- Settings → After filling controls whether Enter is sent and its delay. It is enabled by default with a 150 ms delay. The receiving site handles Enter; standard-form fallback uses validated requestSubmit. Disable it if the site continues on input without a submit event, which the extension cannot always detect.
- Add each additional Gmail inbox through its own Google consent screen. Remove individual inboxes in Settings. Restarting the companion requires reconnecting its inboxes.
- Disconnect Gmail from Settings to stop processing, request Google revocation, and clear Chrome's cached authorization and companion inbox credentials for this extension.
- If Google revocation fails, local access is still disconnected and the UI directs you to [Google Account connections](https://myaccount.google.com/connections) to remove the grant.
- Uninstall the extension to remove its local extension storage. Uninstallation alone should not be relied on to revoke an OAuth grant; remove it through Google as needed.

## Threat model

| Threat                                 | Controls and limits                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wrong website receives a code          | Explicit site grant, active top frame, sender-domain or evidence-based third-party inference, recipient/request evidence, format constraints and same-document validation                        |
| Multiple or stale codes                | Timestamp/explicit-expiry limits, strict resend floors, per-inbox deduplication, overlap detection, conservative ambiguity and a two-minute deadline                                             |
| Webpage requests privileged operations | No window-message bridge or externally-connectable entry; trusted extension-page routing for connection/settings/actions                                                                         |
| Token disclosure                       | Worker/companion-only Google tokens, PKCE and one-time OAuth state, no DOM token exposure, no disk token storage or logging                                                                      |
| DOM changes during retrieval           | Target/constraint revalidation and navigation cancellation before delivery                                                                                                                       |
| Typed input overwritten                | Empty-only preflight and cancellation on trusted user input                                                                                                                                      |
| Malicious regex or email HTML          | Conservative pattern whitelist, no execution of page regex, bounded text decoding, no HTML rendering                                                                                             |
| Duplicate/infinite work                | In-flight locks, message-ID reuse, request/time budgets, retry backoff, and cancellation                                                                                                         |
| Spoofed email sender                   | Domain matching is an error-reduction measure, not sender authentication. Gmail delivery/authentication controls remain relevant. Do not assume sender matching proves a message is trustworthy. |
| Malicious approved website             | An approved website can shape its own fields and read a filled code. This extension cannot make an untrusted website safe.                                                                       |
| Unsafe verification page               | Explicit user confirmation, per-host permission, same-site navigation, allow-listed controls, ambiguity checks, click/navigation limits and explicit completion text                             |

The companion binds only to 127.0.0.1 and checks the exact extension Origin, Host and pairing credential. This limits browser callers; local HTTP is not a protection against device malware. Removing an account requests revocation, but network failure or forced shutdown cannot guarantee Google-side revocation. See [multi-inbox setup](multi-inbox-setup.md) for controls and limits.

Third-party matching reads Gmail's first Authentication-Results header only when it identifies mx.google.com, and requires a passing DMARC result aligned with the visible sender domain. This is evidence from Gmail delivery, not independent DKIM verification or proof of a provider's relationship to a website. Imported/forged message headers and malicious approved sites remain outside this guarantee. Code selection still applies website intent, recipient, request, expiry and ambiguity rules.

No CAPTCHA bypass, challenge circumvention, SMS interception or remote-code execution is included. Automatic continuation is visible and configurable in Settings. Release owners must add their real operator identity, support contact, policy URL, and applicable legal disclosures before publishing this text as a public policy.
