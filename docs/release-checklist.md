# Release checklist

## Build and regression gate

- [ ] Run `npm ci` from the committed lockfile.
- [ ] Run `npm run check` and record its actual outcome.
- [ ] Run `npm audit` and review all advisories.
- [ ] Review the entire source diff, manifest permissions, outgoing requests, and packaged files.
- [ ] Confirm no test fixtures, source maps, credentials, private keys, development profiles, or environment files are packaged.
- [ ] Configure the release OAuth client and stable extension identity, then rebuild the final artifact.
- [ ] Run `npm run package` and verify ZIP contents.

## Live validation gate

- [ ] Complete the controlled Gmail checklist in `testing.md` using real OAuth and a test account.
- [ ] Test actual Chrome site-permission prompts, denial/revocation, and signed-in/out browser profiles.
- [ ] Exercise worker suspension, browser restarts, delayed delivery, resend overlap, and supported live websites.
- [ ] Confirm no incorrect automatic fills or unintended submissions in the representative beta suite.
- [ ] Record supported sites/form formats and remaining compatibility limitations.

## Public distribution gate

- [ ] Supply the real operator identity, support contact, public privacy-policy URL, and accurate store listing.
- [ ] Complete applicable Google restricted-scope review and assessment requirements.
- [ ] Complete Chrome Web Store policy review, disclosure requirements, screenshots, and demonstration materials.
- [ ] Verify the final distributed extension ID exactly matches its Google OAuth client.
- [ ] Obtain the owner's authorization to publish the reviewed release artifact.

An automatically tested local build is not evidence of Google verification, store approval, real-account compatibility, or a completed production rollout.
