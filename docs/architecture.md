# Architecture

## Runtime separation

The extension has three execution environments. The popup and options page are trusted React interfaces. An isolated-world top-frame content script sees approved forms and applies a selected code. The background service worker owns Chrome Identity, Gmail HTTP calls, matching, and attempt coordination. Page JavaScript has no messaging bridge to the extension.

The content script is registered dynamically only for granted origins. Neither broad required website access nor permanent inbox polling is used. Required hosts are Gmail API and Google's revocation endpoint. Optional hosts are HTTPS sites and loopback HTTP. The `activeTab` permission supports inspection of the currently selected site after a popup interaction; enabling persistent detection still requires a host grant.

## Attempt flow

1. Discover exactly one empty, visible, supported target.
2. Create an isolated UUID, creation timestamp, hostname, and field constraints.
3. Send a polling request to the background worker. Revalidate the sender's extension identity, top frame, document ID, current tab URL, active tab, and site grant.
4. Request Chrome Identity's cached authorization non-interactively. Discover at most ten recent candidate messages within the active attempt's search window.
5. Retrieve at most three bodies concurrently, decode supported MIME, and immediately discard bodies after candidate extraction.
6. Require a sender-domain relationship, compatible character format, compatible length/pattern, and eligible timestamps. Deduplicate identical codes; distinct codes remain ambiguous.
7. Return a uniquely qualifying code only to the initiating content script, or expose candidate metadata to the popup for explicit choice.
8. Revalidate the document URL, exact input elements and constraints, visibility, emptiness, and attempt ID before setting values with the native setter. Dispatch input and change events. Never submit.
9. Acknowledge filling, clear candidate data, and stop polling. Explicit accessible success or invalid-input signals may refine the status. Navigation, manual input, expiry, revocation, and disabling stop the attempt.

## Matching policy

Parsing and matching are independent pure modules. Parsing uses recognized verification phrases and nearby candidates, rejects unrelated reference/phone/invoice contexts, preserves case, and normalizes only grouped numeric spacing. The matcher uses the public suffix list through `tldts`, with private domains enabled, instead of unsafe substring or last-two-label matching.

Automatic selection requires extraction confidence of at least 0.95 and a unique compatible code. Candidates from a broader phrase window can be offered for explicit selection at confidence 0.85, provided every site, time, and format constraint also passes. These are deterministic policy thresholds, not statistically calibrated probabilities.

The current discovery window allows messages received up to fifteen seconds before field detection to accommodate form rendering and clock skew. Messages older than three minutes or more than fifteen seconds in the future are rejected. A new code arriving in that small overlap can remain ambiguous with the old code; request another code or enter it manually. An attempt lasts at most two minutes. An oversized discovery result is retried conservatively instead of silently trusting a partial result.

## Polling and cancellation

The content script schedules bounded heartbeats rather than relying on long-running service-worker timers or artificially keeping the worker alive. Typical intervals start at five seconds, increase gradually, and cap at twenty seconds. The worker independently enforces minimum per-attempt and account-level request intervals and honors bounded Retry-After values. Each HTTP request has a ten-second timeout. A one-time 401 refresh is permitted. Transient network/server failures retry within the attempt deadline.

Workers hold per-tab attempts and request AbortControllers in memory. Content scripts preserve their original timestamps through worker restarts. No candidate cache survives restart. Document identity and current URL are checked before and after Gmail reads and before manual delivery. Late responses from a cancelled attempt cannot fill a replacement form.

## Storage

| Location                 | Contents                                                        | Lifetime                                                    |
| ------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------- |
| Chrome Identity          | Google-managed access token cache                               | Managed by Chrome; cleared on disconnect                    |
| `chrome.storage.local`   | Autofill toggle, connection flag, revocation-failure flag       | Until changed or extension data is removed                  |
| `chrome.storage.session` | Flow UUID, hostname, timestamps, state, safe candidate metadata | Browser session, cleared on worker start and tab removal    |
| Worker memory            | Candidate codes, message IDs, active request state              | Active attempt, at most two minutes; shorter on termination |
| Content isolated world   | Target elements and temporary selected code                     | Delivery/attempt only                                       |

Both storage areas are restricted to trusted extension contexts. Tokens are never persisted by application code. No bodies, code history, browsing history, account passwords, or analytics are stored.

## Build and provider extension

Vite builds the two React pages. Esbuild bundles the background worker and isolated content script. The manifest factory reads only the explicitly named public OAuth client ID and optional extension public key. No environment values are injected into page code. Packaging includes only build output.

The Gmail module translates the external provider into normalized messages; the parser and matcher do not depend on Chrome or Gmail. A future provider can produce those normalized messages. Multi-provider selection, broader sender mappings, and automatic submission require separate specifications and security review.
