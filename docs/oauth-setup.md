# Google OAuth setup

Live Gmail access requires a Google Cloud project you control, Gmail API enabled, and a Chrome Extension OAuth client tied to the exact extension ID. A client ID is public configuration. Never add a client secret, Gmail password, service-account key, or access token to this project.

## Development configuration

1. Run `npm ci` and `npm run build`. Load `build/chrome-mv3-prod` as an unpacked extension in `chrome://extensions`.
2. Copy its extension ID. Keeping the same absolute unpacked directory preserves the development identity; for distribution use a stable public key and confirm the resulting ID.
3. In Google Cloud, create/select a project and enable **Gmail API**.
4. Configure Google Auth Platform branding, audience, developer contact, and consent details. For controlled external testing, use Testing status and add the intended Gmail test users. Organization-specific restrictions may also apply.
5. Add only `https://www.googleapis.com/auth/gmail.readonly` to requested data access.
6. Create an OAuth client of type **Chrome Extension**, using the extension ID. A web-application OAuth client is unsuitable for Chrome Identity's `getAuthToken` flow.
7. Copy `.env.example` to `.env.local` and set `GOOGLE_OAUTH_CLIENT_ID` to the issued ID ending in `.apps.googleusercontent.com`.
8. Optionally set `CRX_PUBLIC_KEY` to the extension's public manifest key for stable identity. This is the public key only; keep private signing keys outside the project and archive.
9. Rebuild, reload the extension, and verify its ID still matches the OAuth client. Build environment variables override local environment files.
10. Read the disclosure and choose **Connect with Google**. Sign into the intended controlled Gmail account, grant read-only access, then enable the intended verification site.

The options page shows the current extension ID and configuration guidance. Missing configuration disables connection. Invalid non-empty OAuth client configuration fails the build instead of shipping a silently invalid manifest. Rebuilding is required after changing environment configuration.

## Existing local installation

The confirmed unpacked installation for this workspace uses ID `pfhmngabnonjbbmomndimnkebibdmjkh` from `artifacts/otp-autofill-0.1.0`. Keep that folder unchanged and register this exact ID when creating the Google OAuth client. The ID is derived from the installed directory path; it is not a public key, OAuth client ID, or authorization token.

Local configuration records the expected extension ID and directory. After setting the real `GOOGLE_OAUTH_CLIENT_ID` in `.env.local`, run `npm run build:local`, then reload this existing extension in Chrome. The sync step checks that the update preserves the configured ID and backs up the old folder. Leave `CRX_PUBLIC_KEY` blank for this path-based setup unless deliberately migrating to a different stable identity.

The dedicated Google Cloud project for this local setup is `otp-autofill-512219`, named **OTP Autofill**. Its creation was approved by the owner. Gmail API is enabled, and the **OTP Autofill Chrome** client is registered as a Chrome Extension client for the existing extension ID above. Its public client ID is stored in the ignored `.env.local` file and included in the configured build.

The consent audience is **External**, publishing status is **Testing**, and the owner's Gmail account is the sole test user. The consent configuration requests only `https://www.googleapis.com/auth/gmail.readonly`. These settings prepare authorization; they do not grant inbox access. The owner subsequently reloaded the extension, completed its Google connection flow, and confirmed **Gmail connected** on 21 October 2026. For a different account, add the intended test user and complete that account's consent flow separately.

## Verification and public release

Gmail read-only access is a restricted scope. Public distribution requires the applicable Google review, accurate branding and privacy disclosures, and Chrome Web Store review. The absence of a backend does not waive platform requirements. Security assessment obligations depend on the final data flows and applicable Google policy; confirm them with Google before distributing.

Publish a real privacy-policy URL and developer contact, document the narrow use of broad mailbox permission, and prepare a controlled demonstration of authorization, filling, and revocation. Test cancellation, expiration, refused scope, administrator restrictions, and Google-side revocation using a controlled account.

## Troubleshooting

| Symptom                               | Check                                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Connect button disabled               | Local environment is configured, build was rerun, and extension was reloaded                                                |
| OAuth fails immediately               | OAuth client type and exact extension ID; Google account sign-in and administrator policy                                   |
| Consent cannot proceed                | Test-user membership, requested restricted scope, and project's consent status                                              |
| Gmail API reports permission required | Gmail API activation, granted scope, revoked access, and Workspace administrator policy                                     |
| Code never fills                      | Current site grant, active visible tab, empty supported target, exact sender-domain relationship, timestamps, and ambiguity |
| Disconnect revocation warning         | Remove access at Google Account connections; local cached authorization has already been cleared                            |

Official references: [Chrome Identity](https://developer.chrome.com/docs/extensions/reference/api/identity), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [Chrome optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions).
