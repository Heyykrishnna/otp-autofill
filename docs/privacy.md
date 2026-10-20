# Privacy and security

OTP Autofill helps move a Gmail verification code into an approved website's form. It requests Gmail read-only access through Google's authorization screen. This Google scope grants broad read access; the extension's implementation restricts its actual use to recent verification-message discovery during active attempts. It never asks for a Gmail password.

## Data use

The background worker sends authenticated requests directly to Gmail API. Message bodies are decoded and parsed locally. No body or code is sent to a developer-operated backend, analytics provider, or AI model. Google's API and OAuth systems necessarily receive the requests needed to authorize and retrieve mail.

Once a code is selected, it is delivered to the intended content script and written into the approved site's input. The receiving website can read the code and may process it according to its own privacy policy. Only grant permission to websites you trust.

Application code never persists tokens. Chrome Identity manages the authorization cache. Candidate codes are held only in memory for the active attempt, which expires within two minutes, and are discarded when filled, cancelled, disconnected, timed out, or the worker stops. Email bodies are not retained after parsing. There is no OTP history or analytics.

Local persistent storage holds three settings: automatic fill enabled, Gmail connected, and whether revocation could not be confirmed. Temporary trusted session storage holds active attempt status and safe candidate metadata. Chrome manages optional website grants. No application data is synchronized through `chrome.storage.sync`.

## User controls

- Grant access one HTTPS site at a time from the popup. Remove grants in Settings or Chrome's extension controls.
- Disable automatic filling to stop attempts.
- Disconnect Gmail from Settings to stop processing, request Google revocation, and clear Chrome's cached authorization for this extension.
- If Google revocation fails, local access is still disconnected and the UI directs you to [Google Account connections](https://myaccount.google.com/connections) to remove the grant.
- Uninstall the extension to remove its local extension storage. Uninstallation alone should not be relied on to revoke an OAuth grant; remove it through Google as needed.

## Threat model

| Threat                                 | Controls and limits                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wrong website receives a code          | Explicit site grant, active top frame, exact sender-domain relationship, format constraints, and same-document validation                                                                        |
| Multiple or stale codes                | Timestamp limits, deduplication, conservative ambiguity, and a two-minute attempt deadline                                                                                                       |
| Webpage requests privileged operations | No window-message bridge or externally-connectable entry; trusted extension-page routing for connection/settings/actions                                                                         |
| Token disclosure                       | Background-only Gmail module, no DOM token exposure, no application token storage or logging                                                                                                     |
| DOM changes during retrieval           | Target/constraint revalidation and navigation cancellation before delivery                                                                                                                       |
| Typed input overwritten                | Empty-only preflight and cancellation on trusted user input                                                                                                                                      |
| Malicious regex or email HTML          | Conservative pattern whitelist, no execution of page regex, bounded text decoding, no HTML rendering                                                                                             |
| Duplicate/infinite work                | In-flight locks, message-ID reuse, request/time budgets, retry backoff, and cancellation                                                                                                         |
| Spoofed email sender                   | Domain matching is an error-reduction measure, not sender authentication. Gmail delivery/authentication controls remain relevant. Do not assume sender matching proves a message is trustworthy. |
| Malicious approved website             | An approved website can shape its own fields and read a filled code. This extension cannot make an untrusted website safe.                                                                       |

No CAPTCHA bypass, challenge circumvention, hidden form submission, SMS interception, or remote-code execution is included. Release owners must add their real operator identity, support contact, policy URL, and applicable legal disclosures before publishing this text as a public policy.
