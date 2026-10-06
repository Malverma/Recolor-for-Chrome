chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// Content scripts read the default wallpaper from storage instead of a
// web-accessible URL: Chrome extension IDs are fixed, so a web-accessible
// file would let any page detect the extension.
chrome.runtime.onInstalled.addListener(async () => {
  const res = await fetch(chrome.runtime.getURL("images/background.jpg"));
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  await chrome.storage.local.set({
    defaultBackground: `data:image/jpeg;base64,${btoa(binary)}`,
  });
});
