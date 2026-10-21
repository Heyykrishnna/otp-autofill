# Architecture

## Runtime separation

The extension has three browser execution environments. Optional multi-inbox mode adds a local companion process with its own memory-only account vault; see [multi-inbox setup](multi-inbox-setup.md). The popup and options page are trusted React interfaces. An isolated-world top-frame content script sees approved forms and applies a selected code. The background service worker owns Chrome Identity, Gmail HTTP calls, matching, and attempt coordination. Page JavaScript has no messaging bridge to the extension.

The content script is registered dynamically only for granted origins. Neither broad required website access nor permanent inbox polling is used. Required hosts are Gmail API and Google's revocation endpoint. Optional hosts are HTTPS sites and loopback HTTP. The `activeTab` permission supports inspection of the currently selected site after a popup interaction; enabling persistent detection still requires a host grant.

## Attempt flow

1. Discover exactly one empty, visible, supported target.
2. Create an isolated UUID, creation timestamp, hostname, and field constraints.
3. Register the attempt without reading mail, including inactive tabs, to identify overlapping sessions. Send a polling request to the background worker. Revalidate the sender's extension identity, top frame, document ID, current tab URL, active tab, and site grant.
4. Search only explicitly authorized inboxes: Chrome Identity's verified profile inbox and any separately authorized companion inboxes. Discover at most ten recent messages per inbox. Search at most two inboxes concurrently; use account-namespaced message IDs.
5. Retrieve at most three bodies concurrently, decode supported MIME, and immediately discard bodies after candidate extraction.
6. Require a sender relationship, compatible format, eligible timestamps and any known recipient/request reference. Direct sender domains can qualify automatically. Third-party inference requires one explicit verification/action domain related to the website, passing Gmail sender-authentication evidence and headers addressing the verified inbox. Incomplete evidence can be offered for confirmation; unrelated mail is excluded. Deduplicate identical codes only within the same inbox.
7. Return a uniquely qualifying code only to the initiating content script, or expose candidate metadata to the popup for explicit choice.
8. Revalidate the document URL, exact input elements and constraints, visibility, emptiness, and attempt ID before setting values with the native setter. Dispatch input and change events. After acknowledgement, read the current Enter policy, wait the configured delay, revalidate the active document and filled inputs, then send Enter once. Standard forms use requestSubmit when Enter is not handled; disabled, invalid, already-submitted or changed forms are skipped.
9. Acknowledge filling, clear candidate data, and stop polling. Explicit accessible success or invalid-input signals may refine the status. Navigation, manual input, expiry, revocation, and disabling stop the attempt.

## Verification-link flow

An approved page can start a link attempt only when no OTP target exists and its visible text explicitly asks the user to check email for an activation, confirmation, or verification link. The worker searches the same bounded recent-message window. It accepts only HTTPS URLs without embedded credentials, requires the destination to share the signup site's registrable domain, and requires either a related sender domain or passing sender-authentication evidence. Distinct eligible URLs are ambiguous.

A unique match produces an in-page confirmation dialog containing only the sender domain and destination hostname. Approval obtains any missing per-host permission and opens the URL in a new tab with the signup tab as opener. Every redirect must stay on the same registrable website. The verification content script scans visible controls in linear DOM time and clicks only one unambiguous allow-listed activation, confirmation, continuation, or verification action per step. Required empty fields, destructive labels, repeated controls, multiple possible controls, domain escape, six clicks, twelve navigations, or a 45-second deadline stop automation. Explicit visible verified, activated, confirmed, or successful status text is the completion base case. Only then does the worker notify and refresh the original document.

## Matching policy

Parsing and matching are independent pure modules. Parsing uses recognized verification phrases and nearby candidates, accepts bounded sign-in connectors such as “code to sign into your account,” rejects actual reference, phone, invoice, account-number and request-ID contexts, preserves case, and normalizes only grouped numeric spacing. The matcher uses the public suffix list through `tldts`, with private domains enabled, instead of unsafe substring or last-two-label matching. Cross-suffix sibling domains additionally require an exact registrable-label match, sender-aligned verification or raw action-link domains, organization corroboration in both sender name and subject, aligned Gmail authentication, and an addressed authorized inbox.

Automatic selection requires extraction confidence of at least 0.95 and a unique compatible code. Forwarded messages, incomplete inbox searches and unresolved overlapping same-provider sessions require a choice. An exact request reference can resolve session overlap. Candidates from a broader phrase window can be offered for explicit selection at confidence 0.85, provided every site, time, and format constraint also passes. These are deterministic policy thresholds, not statistically calibrated probabilities.

The current discovery window allows messages received up to fifteen seconds before field detection to accommodate form rendering and clock skew. Messages older than three minutes or more than fifteen seconds in the future are rejected. A user-triggered resend uses a strict timestamp floor without the overlap. Explicit relative expiry text further narrows eligibility. Delayed duplicates are suppressed by consumed message IDs and memory-only salted code fingerprints; worker restarts preserve message IDs but not fingerprints. An attempt lasts at most two minutes. An oversized discovery result is retried conservatively instead of silently trusting a partial result.

## Polling and cancellation

The content script schedules bounded heartbeats rather than relying on long-running service-worker timers or artificially keeping the worker alive. Typical intervals start at five seconds, increase gradually, and cap at twenty seconds. The worker independently enforces minimum per-attempt and account-level request intervals and honors bounded Retry-After values. Each HTTP request has a ten-second timeout. A one-time 401 refresh is permitted. Transient network/server failures retry within the attempt deadline.

Workers hold per-tab attempts and request AbortControllers in memory. Content scripts preserve their original timestamps through worker restarts. No candidate cache survives restart. Document identity and current URL are checked before and after Gmail reads and before manual delivery. Late responses from a cancelled attempt cannot fill a replacement form.

## Storage

| Location                 | Contents                                                                                                          | Lifetime                                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Chrome Identity          | Google-managed access token cache                                                                                 | Managed by Chrome; cleared on disconnect                                                                                           |
| `chrome.storage.local`   | Autofill/connection flags, verified primary email, companion enablement, Enter preferences and revocation warning | Until changed or extension data is removed                                                                                         |
| `chrome.storage.session` | Flow status, safe candidate metadata including inbox, local pairing credential and bounded consumed message IDs   | Flow status clears on worker start/tab removal; consumed IDs expire logically after three minutes; pairing lasts a browser session |
| Worker memory            | Candidate codes or verification URLs, request state, bounded link traversal state and salted code fingerprints    | Sensitive candidates clear at delivery/cancellation or two-minute deadline; link traversal has a 45-second deadline                |
| Companion memory         | Separate Google access/refresh credentials and verified inbox identity                                            | Until disconnect, process exit or authorization failure                                                                            |
| Content isolated world   | Target elements and temporary selected code                                                                       | Delivery/attempt only                                                                                                              |

Both storage areas are restricted to trusted extension contexts. Google access and refresh tokens are never persisted by application code. The optional local pairing credential is opaque and is not a Google token. No bodies, code history, browsing history, account passwords, or analytics are stored.

## Build and provider extension

Vite builds the two React pages. Esbuild bundles the background worker and isolated content script. The manifest factory reads only the explicitly named public OAuth client ID and optional extension public key. No environment values are injected into page code. Packaging includes only build output.

The Gmail module translates the external provider into normalized messages; the parser and matcher do not depend on Chrome or Gmail. A future provider can produce those normalized messages. The [edge-case matrix](edge-cases.md) specifies automatic third-party inference and conservative account/session selection. Non-Gmail providers remain outside this release. Enter after filling is now a configurable continuation action; see [automatic matching and Enter](automatic-matching.md).
