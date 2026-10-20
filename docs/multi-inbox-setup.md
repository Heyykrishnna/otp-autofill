# Multiple authorized Gmail inboxes

The existing Chrome Extension OAuth client remains the single-account connection. The optional local companion is a desktop process that authorizes additional inboxes independently using Google's authorization-code flow with PKCE. It avoids browser implicit token flows and a developer-hosted mail service.

## Requirements

- The existing project dependencies, Node.js 22.12+ and Chrome extension installation.
- A Google Cloud project with Gmail API enabled and the intended accounts permitted by the consent audience.
- A separate OAuth client of type **Desktop app**. Do not replace the existing **Chrome Extension** client.

## Configure the companion

1. Create the Desktop app OAuth client in Google Auth Platform.
2. Keep the existing `.env.local` file. Add `GOOGLE_DESKTOP_OAUTH_CLIENT_ID` with the Desktop client ID. If Google issued a client secret, set `GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET` there as well. Never commit the file or a downloaded credentials file.
3. Set `EXPECTED_EXTENSION_ID` to the installed extension's actual ID. This is the only extension origin allowed to call the companion.
4. Start it in a terminal from the project directory:

   ```sh
   npm run companion
   ```

5. Keep the process running while using its inboxes. It binds only to `127.0.0.1:43127`. OAuth callbacks use temporary random loopback ports. A port conflict must be resolved before starting; the process does not bind to public network interfaces.
6. Rebuild/reload the updated extension, open Settings and choose **Add Gmail inbox**. Approve Chrome's loopback connection permission and complete Google's consent for that specific account.
7. Return to Settings. The verified account appears under **Authorized inboxes**. Repeat for each additional inbox, up to five companion accounts. The existing Chrome account is optional and separate.

The browser callback shows whether connection succeeded. If consent is declined or expires, no inbox is added. Existing authorized inboxes remain separate. Tests and CI do not supply real credentials or authorize accounts.

## Account handling

The companion verifies each new token against Gmail's profile endpoint and addresses later Gmail requests using that verified email. Each account has its own access/refresh credentials. Concurrent refreshes are coordinated. Expired or revoked accounts are marked unavailable or surfaced as failed searches; other inboxes are never silently substituted.

The extension can infer a recipient from supported form hints. If two inboxes could supply the intended code, it offers a metadata-only choice. A failed inbox read also prevents treating an incomplete search as a confident automatic match.

## Storage and privacy

- Access tokens and refresh tokens for companion inboxes remain only in the local process's memory. Restarting or stopping it forgets the accounts and requires reconnecting them.
- The Desktop client configuration lives in the ignored local environment file. It is not compiled into the extension ZIP.
- Pairing uses an opaque local session credential in trusted Chrome session storage. The companion checks its exact extension origin, loopback Host header and pairing credential. Browser pages and unpaired callers are rejected.
- Authorization uses one-time state, a high-entropy verifier and SHA-256 PKCE challenge. The authorization code is exchanged locally; Google tokens are never returned to the extension through the companion protocol.
- Local Gmail parsing, message text and metadata can pass between the companion and extension over loopback. This is not an encrypted protection against malware on the same device; the browser, OS and local process must be trusted.
- Disconnect requests Google revocation and removes local account state. If revocation cannot be confirmed, remove the app in [Google Account connections](https://myaccount.google.com/connections).
- A forced process termination cannot guarantee Google-side revocation. Gmail's broad read-only scope and the receiving website's access to a filled code still apply.

## Running checks

The existing `npm run check` command includes companion protocol tests. Some tests need temporary local TCP listeners, in addition to the existing Chromium test server. The tests mock Google responses and never use a real account or secret.

## Official references

- [Google OAuth for Desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app): PKCE, state, loopback callbacks, token exchange and refresh.
- [Chrome Identity](https://developer.chrome.com/docs/extensions/reference/api/identity): the existing profile-based Google token flow.
- [Gmail scope definitions](https://developers.google.com/workspace/gmail/api/auth/scopes): broad read-only permission and applicable review requirements.

Live Desktop OAuth registration, consent and revocation must be verified with the project owner's controlled accounts before describing this mode as live validated.

## This workspace's configured client

On 21 October 2026, the owner approved creating **OTP Autofill Local Companion**, of type **Desktop**, in project `otp-autofill-512219`. Its creation was verified in the Google Cloud client list alongside the existing Chrome Extension client. Configuration was saved only in ignored `.env.local` with mode `600`; no credential JSON was downloaded or committed. New clones must create their own client.

Creating the client does not authorize any inbox. Each additional account still requires its own consent and must be allowed by the project's Testing audience. The companion must remain running. If Settings reports an incomplete update, reload the extension card in `chrome://extensions`, close the old settings tab and reopen Settings before adding an account.
