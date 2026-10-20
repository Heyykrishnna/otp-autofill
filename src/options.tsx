import { Brand, Shield } from "./ui/brand"
import { useExtension } from "./ui/use-extension"

import "./ui/styles.css"

export default function Options() {
  const { snapshot, error, busy, act } = useExtension()
  const connected = snapshot?.settings.connected
  return (
    <main className="settings-shell">
      <header className="topbar">
        <Brand />
        <span className="eyebrow">SETTINGS & PRIVACY</span>
      </header>
      <section className="settings-heading">
        <h1>
          A little help.
          <br />
          <span>On your terms.</span>
        </h1>
        <p>
          Control your connection, site access, and how verification codes are
          handled.
        </p>
      </section>
      <section className="settings-card">
        <h2>Gmail connection</h2>
        <p>
          {connected
            ? "Gmail is connected with read-only permission."
            : "Gmail is disconnected. Connect from the extension popup after reviewing the disclosure."}
        </p>
        <p>
          Google grants read access to your mailbox. OTP Autofill uses it only
          to retrieve a bounded set of recent verification messages while a
          supported form is active. It cannot send, modify, or delete your
          emails with this scope.
        </p>
        {connected && (
          <button
            className="danger"
            disabled={busy}
            onClick={() => void act({ type: "DISCONNECT" })}
          >
            {busy ? "Disconnecting…" : "Disconnect Gmail & revoke access"}
          </button>
        )}
        {snapshot?.settings.revocationPending && (
          <p className="notice">
            Local access has been cleared, but Google revocation was not
            confirmed.{" "}
            <a
              href="https://myaccount.google.com/connections"
              target="_blank"
              rel="noreferrer"
            >
              Remove OTP Autofill from your Google connections
            </a>
            .
          </p>
        )}
      </section>
      <section className="settings-card">
        <h2>Approved sites</h2>
        <p>
          Access is optional and granted one site at a time from the popup.
          HTTPS subdomains require their own grant. HTTP is supported only on
          localhost for testing.
        </p>
        {snapshot?.sites.length ? (
          <ul className="site-list">
            {snapshot.sites.map((origin) => (
              <li key={origin}>
                <span>{origin.replace(/\/\*$/, "")}</span>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void act({ type: "REMOVE_SITE", origin })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">No sites approved yet.</p>
        )}
      </section>
      <section className="settings-card">
        <div className="account-row">
          <Shield />
          <h2>Your data stays under your control</h2>
        </div>
        <ul className="privacy-list">
          <li>
            Email bodies are parsed in the background worker and discarded after
            processing.
          </li>
          <li>
            Candidate codes live in memory during an attempt, for at most two
            minutes. No OTP history is saved.
          </li>
          <li>
            Google tokens remain in Chrome Identity and trusted extension code.
            Webpage scripts do not receive them.
          </li>
          <li>
            Only settings persist locally. Current attempt status uses trusted,
            temporary session storage.
          </li>
          <li>
            No analytics, external backend, remote scripts, or automatic form
            submission.
          </li>
          <li>
            Disconnect stops attempts, clears cached authorization, and requests
            Google revocation. Revocation failures are shown explicitly.
          </li>
        </ul>
        <p className="notice">
          Any site that receives a filled code can read that code. Only approve
          sites you trust. Sender domain matching reduces mistakes; it does not
          authenticate an email sender or establish a site's trustworthiness.
        </p>
      </section>
      {snapshot && !snapshot.configured && (
        <section className="settings-card">
          <h2>Finish Google OAuth setup</h2>
          <ol className="privacy-list">
            <li>Enable Gmail API in your Google Cloud project.</li>
            <li>
              Configure the consent screen with Gmail read-only scope and add
              your controlled test users.
            </li>
            <li>
              Create a Chrome Extension OAuth client using this extension's ID:{" "}
              <code>{chrome.runtime.id}</code>.
            </li>
            <li>
              Set <code>GOOGLE_OAUTH_CLIENT_ID</code> in the project's local
              environment file, rebuild, and reload the extension.
            </li>
            <li>
              Use a stable extension public key for a consistent ID. Follow{" "}
              <code>docs/oauth-setup.md</code> before public release.
            </li>
          </ol>
        </section>
      )}
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
      <footer className="settings-footer">
        OTP Autofill · version {chrome.runtime.getManifest().version} · Built
        for explicit permission and careful matching.
      </footer>
    </main>
  )
}
