import { Brand, Shield } from "./ui/brand"
import { useExtension } from "./ui/use-extension"

import "./ui/styles.css"

const STATE_LABELS = {
  idle: "Ready when you are",
  detected: "Verification field found",
  waiting: "Waiting for your email",
  candidate_found: "Matching email found",
  identified: "Code identified",
  filled: "You're ready to continue",
  completed: "Verification complete",
  failed: "Code wasn't accepted",
  timed_out: "This attempt timed out",
  permission_required: "Connection needed",
  ambiguous: "Your choice is needed",
  cancelled: "Attempt stopped",
}

export default function Popup() {
  const { snapshot, error, busy, act, enableSite } = useExtension()
  const connected =
    (snapshot?.settings.connected ?? false) ||
    Boolean(snapshot?.accounts.some((account) => account.available))
  const flow = snapshot?.flow
  const enabled = snapshot?.settings.autofill ?? true

  return (
    <main className="popup-shell">
      <header className="topbar">
        <Brand />
        <button
          className="icon-button"
          aria-label="Open settings"
          title="Settings and privacy"
          onClick={() => void chrome.runtime.openOptionsPage()}
        >
          ⚙
        </button>
      </header>
      <section className="hero">
        <div className="eyebrow">
          <span
            className={`status-dot ${connected && enabled ? "green" : ""}`}
          />
          {connected && enabled ? "READY TO ASSIST" : "YOUR INBOX, CONNECTED"}
        </div>
        <h1>
          Less switching.
          <br />
          <span>More getting in.</span>
        </h1>
        <p>
          Your email verification codes,
          <br />
          right where you need them.
        </p>
      </section>
      <section className="account-card" aria-label="Gmail connection">
        <div className="account-row">
          <span className="mail-icon" aria-hidden="true">
            M
          </span>
          <div className="grow">
            <h2>Gmail</h2>
            <p>
              {connected
                ? "Connected · read-only access"
                : "Connect your verification inbox"}
            </p>
          </div>
          <span className={`badge ${connected ? "connected" : ""}`}>
            {connected ? "Connected" : "Not linked"}
          </span>
        </div>
        {!connected && (
          <>
            <p className="permission-copy">
              With your permission, OTP Autofill reads recent verification
              emails during an active attempt. Messages are processed locally.
              Enter after filling can be changed in Settings.
            </p>
            <button
              className="primary"
              disabled={busy || !snapshot?.configured}
              onClick={() => void act({ type: "CONNECT" })}
            >
              {busy ? "Connecting…" : "Connect with Google"}
              <span aria-hidden="true">↗</span>
            </button>
          </>
        )}
        {snapshot && !snapshot.configured && (
          <p className="notice">
            Google OAuth setup is required for this build. Open Settings for the
            setup steps.
          </p>
        )}
      </section>
      {snapshot?.accounts.length ? (
        <p className="permission-copy">
          Authorized inboxes:{" "}
          {snapshot.accounts.map((account) => account.email).join(", ")}. Manage
          accounts in Settings.
        </p>
      ) : null}
      {snapshot?.accountError && (
        <p className="notice" role="status">
          {snapshot.accountError}
        </p>
      )}
      <section className="toggle-row">
        <div>
          <h2>Automatic fill</h2>
          <p>Fill a reliable match on approved sites.</p>
        </div>
        <button
          className={`switch ${enabled ? "on" : ""}`}
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Automatic fill"
          disabled={busy || !snapshot}
          onClick={() => void act({ type: "SET_AUTOFILL", value: !enabled })}
        >
          <span />
        </button>
      </section>
      <p className="permission-copy">
        After filling:{" "}
        {snapshot?.settings.pressEnter === false
          ? "wait for you to continue"
          : "press Enter automatically"}
        . Change this in Settings.
      </p>
      <section className="flow-panel" aria-label="Current page">
        <div className="section-label">
          <span>ON THIS PAGE</span>
          {snapshot?.allowed && (
            <span className="site-granted">Access granted</span>
          )}
        </div>
        <h2>
          {flow ? STATE_LABELS[flow.state] : "Ready for a verification code"}
        </h2>
        <p aria-live="polite">
          {flow?.detail ??
            (snapshot?.allowed
              ? "Open a verification form. We'll look for a matching email when it appears."
              : "Enable access on a site to detect its verification form.")}
        </p>
        {flow && (
          <div className="domain">
            <span aria-hidden="true">↳</span> {flow.hostname}
          </div>
        )}
        {snapshot?.origin && !snapshot.allowed && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void enableSite()}
          >
            Enable on this site <span aria-hidden="true">→</span>
          </button>
        )}
        {snapshot && !snapshot.origin && (
          <p className="notice">
            Open an HTTPS website to enable autofill. Browser pages and embedded
            frames are unsupported.
          </p>
        )}
        {snapshot?.allowed && (
          <button
            className="secondary"
            disabled={busy || !connected || !enabled}
            onClick={() => void act({ type: "RETRY_FLOW" })}
          >
            Find & fill OTP <span aria-hidden="true">→</span>
          </button>
        )}
        {flow?.state === "ambiguous" && (
          <div className="candidates">
            {flow.candidates.map((candidate) => (
              <button
                className="candidate"
                key={candidate.id}
                disabled={busy}
                onClick={() =>
                  void act({
                    type: "CHOOSE_CANDIDATE",
                    id: flow.id,
                    candidateId: candidate.id,
                  })
                }
              >
                <span>
                  <strong>{candidate.sender}</strong>
                  {candidate.account && <small>{candidate.account}</small>}
                  {candidate.reason && <small>{candidate.reason}</small>}
                  <small>
                    {new Date(candidate.receivedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {candidate.length} characters
                  </small>
                </span>
                <span>Fill →</span>
              </button>
            ))}
          </div>
        )}
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {snapshot?.systemError && (
        <p className="error" role="alert">
          {snapshot.systemError}
        </p>
      )}
      {snapshot?.settings.revocationPending && (
        <p className="notice">
          Disconnected locally. Google revocation could not be confirmed.{" "}
          <a
            href="https://myaccount.google.com/connections"
            target="_blank"
            rel="noreferrer"
          >
            Remove access at Google
          </a>
          .
        </p>
      )}
      <footer className="privacy-footer">
        <Shield />
        <span>Local processing. No code history.</span>
        <button
          className="text-button"
          onClick={() => void chrome.runtime.openOptionsPage()}
        >
          Privacy ↗
        </button>
      </footer>
    </main>
  )
}
