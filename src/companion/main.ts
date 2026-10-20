import { startCompanion } from "./server"

const service = await startCompanion({
  clientId: process.env.GOOGLE_DESKTOP_OAUTH_CLIENT_ID ?? "",
  clientSecret: process.env.GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET,
  extensionId: process.env.EXPECTED_EXTENSION_ID ?? "",
})
process.stdout.write(
  `OTP Autofill companion listening at http://127.0.0.1:${service.port}. Authorized inboxes and credentials remain in memory.\n`,
)
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void service.close().then(
      () => process.exit(0),
      () => process.exit(1),
    )
  })
