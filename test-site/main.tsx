import { useState } from "react"
import { createRoot } from "react-dom/client"

function Laboratory() {
  const verificationDestination = location.pathname === "/verify-email"
  const [kind, setKind] = useState(() => {
    const scenario = new URLSearchParams(location.search).get("scenario")
    return scenario &&
      [
        "single",
        "split",
        "indexed",
        "alpha",
        "dynamic",
        "negative",
        "link",
      ].includes(scenario)
      ? scenario
      : "single"
  })
  const [code, setCode] = useState("")
  const [split, setSplit] = useState(Array<string>(6).fill(""))
  const [dynamic, setDynamic] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [linkVerified, setLinkVerified] = useState(
    () => localStorage.getItem("verification-link-complete") === "true",
  )
  function change(next: string) {
    setKind(next)
    setCode("")
    setSplit(Array<string>(6).fill(""))
    setSubmitted(false)
    setDynamic(false)
  }
  if (verificationDestination)
    return linkVerified ? (
      <main>
        <h1>Email verified</h1>
        <p>Your email has been verified successfully.</p>
      </main>
    ) : (
      <main>
        <h1>Complete verification</h1>
        <p>Confirm this email verification request to continue.</p>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem("verification-link-complete", "true")
            setLinkVerified(true)
          }}
        >
          Verify email
        </button>
      </main>
    )
  return (
    <>
      <p className="note">LOCAL FORM LABORATORY · NO EMAIL CONNECTION</p>
      <h1>One code. Every kind of form.</h1>
      <p>
        Representative forms for extension testing. Email fixtures are used only
        by the automated test harness.
      </p>
      <label htmlFor="scenario">Form scenario</label>
      <select
        id="scenario"
        value={kind}
        onChange={(event) => change(event.target.value)}
      >
        <option value="single">React controlled numeric input</option>
        <option value="split">Six separate inputs</option>
        <option value="indexed">Six indexed inputs without maxlength</option>
        <option value="alpha">Case-sensitive alphanumeric</option>
        <option value="dynamic">Dynamically mounted field</option>
        <option value="negative">Unrelated fields</option>
        <option value="link">Email verification link</option>
      </select>
      {kind === "link" ? (
        <section aria-live="polite">
          <h2>{linkVerified ? "Email verified" : "Check your inbox"}</h2>
          <p>
            {linkVerified
              ? "Your email has been verified successfully."
              : "Check your inbox to verify your email using the verification link we sent."}
          </p>
        </section>
      ) : (
        <form
          data-otp-recipient={
            new URLSearchParams(location.search).get("recipient") ?? undefined
          }
          onSubmit={(event) => {
            event.preventDefault()
            setSubmitted(true)
          }}
        >
          <h2>Verify your email</h2>
          {kind === "dynamic" && !dynamic ? (
            <button type="button" onClick={() => setDynamic(true)}>
              Request code
            </button>
          ) : kind === "split" || kind === "indexed" ? (
            <fieldset aria-label="Verification code">
              <legend>Verification code</legend>
              {split.map((value, index) => (
                <input
                  key={index}
                  aria-label={
                    kind === "indexed"
                      ? `Digit ${index + 1} of 6`
                      : `Code digit ${index + 1}`
                  }
                  autoComplete={
                    kind === "indexed" && index === 0 ? "one-time-code" : "off"
                  }
                  inputMode="numeric"
                  maxLength={kind === "split" ? 1 : undefined}
                  value={value}
                  onChange={(event) =>
                    setSplit((previous) =>
                      previous.map((digit, position) =>
                        position === index ? event.target.value : digit,
                      ),
                    )
                  }
                />
              ))}
            </fieldset>
          ) : kind === "negative" ? (
            <>
              <label>
                Phone number
                <input name="phone" inputMode="numeric" maxLength={10} />
              </label>
              <label>
                Card security code
                <input name="cvv" maxLength={4} />
              </label>
              <label>
                Postal code
                <input name="zip" maxLength={6} />
              </label>
              <label>
                Password
                <input name="password" type="password" />
              </label>
            </>
          ) : (
            <label>
              Email verification code
              <input
                name="otp"
                aria-label="Email verification code"
                autoComplete="one-time-code"
                inputMode={kind === "alpha" ? "text" : "numeric"}
                pattern={kind === "alpha" ? "[A-Za-z0-9]{10}" : "[0-9]{6}"}
                maxLength={kind === "alpha" ? 10 : 6}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
          )}
          <button type="submit">Verify manually</button>
          <button
            type="button"
            onClick={() => {
              setCode("")
              setSplit(Array<string>(6).fill(""))
              setSubmitted(false)
            }}
          >
            Resend code
          </button>
          <output aria-label="React state">
            React state:{" "}
            {kind === "split" || kind === "indexed"
              ? split.join("")
              : code || "empty"}
          </output>
          <p role="status" aria-label="Verification result">
            {submitted
              ? "Verification complete"
              : "Waiting for manual submission"}
          </p>
        </form>
      )}
      <section>
        <h2>Unrelated input</h2>
        <label>
          Search
          <input name="search" placeholder="Must stay untouched" />
        </label>
        <p className="note">
          No form submits automatically. A filled code updates React state
          through native input events.
        </p>
      </section>
    </>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Missing test root")
createRoot(root).render(<Laboratory />)
