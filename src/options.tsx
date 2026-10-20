import { Brand, Shield } from "./ui/brand"
import { useExtension } from "./ui/use-extension"

import "./ui/styles.css"

export default function Options() {
  const { snapshot, error, busy, act, addAccount } = useExtension()
  const connected =
    snapshot?.settings.connected || Boolean(snapshot?.accounts.length)
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
        <h2>Authorized inboxes</h2>
        <p>
          Search only inboxes you explicitly authorize. Recipient hints and
          request references separate login attempts; unresolved matches need
          your choice.
        </p>
        {snapshot?.accounts.length ? (
          <ul className="site-list">
            {snapshot.accounts.map((account) => (
              <li key={account.id}>
                <span>
                  {account.email}
                  <small>
                    {account.available
                      ? " · Authorized"
                      : " · Reconnect needed"}
                  </small>
                </span>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void act({ type: "REMOVE_ACCOUNT", id: account.id })
                  }
                >
                  Disconnect inbox
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">No authorized inboxes yet.</p>
        )}
        <p>
          For several inboxes, configure the local companion with a Desktop
          OAuth client, run <code>npm run companion</code>, then add each
          account. Credentials and email processing stay on your machine.
          Restarting the companion requires reconnecting its accounts.
        </p>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void addAccount()}
        >
          Add Gmail inbox
        </button>
        {snapshot?.accountError && (
          <p className="notice" role="status">
            {snapshot.accountError}
          </p>
        )}
      </section>
      <section className="settings-card">
        <h2>Automatic matching</h2>
        <p>
          Third-party delivery services are associated automatically using the
          intended website, Gmail sender-authentication results, authorized
          recipient, request references, code format and freshness. You do not
          need to maintain sender mappings. Conflicting or incomplete evidence
          still requires confirmation.
        </p>
      </section>
      <section className="settings-card">
        <h2>After filling</h2>
        <div className="toggle-row">
          <div>
            <h3>Press Enter after fill</h3>
            <p>
              Continue automatically after a successful fill. Turn this off on
              sites that already continue themselves.
            </p>
          </div>
          <button
            className={`switch ${snapshot?.settings.pressEnter !== false ? "on" : ""}`}
            type="button"
            role="switch"
            aria-checked={snapshot?.settings.pressEnter !== false}
            aria-label="Press Enter after fill"
            disabled={busy || !snapshot}
            onClick={() =>
              void act({
                type: "SET_AFTER_FILL",
                pressEnter: snapshot?.settings.pressEnter === false,
                enterDelayMs: snapshot?.settings.enterDelayMs ?? 150,
              })
            }
          >
            <span />
          </button>
        </div>
        <label>
          Delay before Enter
          <select
            className="settings-input"
            aria-label="Delay before Enter"
            value={snapshot?.settings.enterDelayMs ?? 150}
            disabled={busy || !snapshot}
            onChange={(event) =>
              void act({
                type: "SET_AFTER_FILL",
                pressEnter: snapshot?.settings.pressEnter !== false,
                enterDelayMs: Number(event.target.value),
              })
            }
          >
            <option value={0}>Immediately</option>
            <option value={150}>150 milliseconds</option>
            <option value={300}>300 milliseconds</option>
            <option value={500}>500 milliseconds</option>
            <option value={1000}>1 second</option>
            <option value={2000}>2 seconds</option>
          </select>
        </label>
        <p>
          Enter is sent once to the filled field. Standard forms use validated
          submission when the site does not handle Enter. Cancelled, changed,
          hidden or already-submitted forms are skipped.
        </p>
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
            Email is parsed locally in the extension or its optional companion
            and is not persisted. Google credentials stay in Chrome Identity or
            companion memory.
          </li>
          <li>
            Candidate codes live in memory during an attempt, for at most two
            minutes. No OTP history is saved.
          </li>
          <li>
            Primary-account tokens use Chrome Identity; additional inbox
            credentials stay in companion memory. Webpage scripts do not receive
            Google credentials.
          </li>
          <li>
            Settings, verified account identity and after-fill preferences
            persist locally. Attempt status, used message IDs and local
            companion pairing use trusted session storage.
          </li>
          <li>
            No analytics, developer-hosted backend or remote scripts. Enter
            after filling is configurable above. Optional multi-inbox access
            uses a companion bound to local loopback.
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
