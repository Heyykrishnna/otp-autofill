export function isExtensionUi(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    [
      chrome.runtime.getURL("popup.html"),
      chrome.runtime.getURL("options.html"),
    ].includes(sender.url ?? "")
  )
}
