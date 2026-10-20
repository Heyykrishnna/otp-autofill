export function createManifest({ version, clientId, publicKey }) {
  if (clientId && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId))
    throw new Error(
      "Use a valid Chrome Extension OAuth client ID from Google Cloud.",
    )
  if (publicKey && !/^[A-Za-z0-9+/=]+$/.test(publicKey))
    throw new Error(
      "CRX_PUBLIC_KEY must be a base64-encoded extension public key.",
    )
  return {
    manifest_version: 3,
    name: "OTP Autofill",
    version,
    description:
      "Privacy-first Gmail verification codes, filled on sites you approve.",
    minimum_chrome_version: "120",
    action: { default_popup: "popup.html", default_title: "OTP Autofill" },
    options_ui: { page: "options.html", open_in_tab: true },
    background: { service_worker: "background.js", type: "module" },
    icons: {
      16: "icons/16.png",
      32: "icons/32.png",
      48: "icons/48.png",
      128: "icons/128.png",
    },
    permissions: ["identity", "storage", "activeTab", "scripting"],
    host_permissions: [
      "https://gmail.googleapis.com/*",
      "https://oauth2.googleapis.com/*",
    ],
    optional_host_permissions: [
      "https://*/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
    ],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
    ...(clientId
      ? {
          oauth2: {
            client_id: clientId,
            scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
          },
        }
      : {}),
    ...(publicKey ? { key: publicKey } : {}),
  }
}
