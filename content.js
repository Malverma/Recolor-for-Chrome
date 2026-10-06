let custom = null;
let fallback = null;

function apply() {
  const url = custom || fallback;
  if (url) {
    document.documentElement.style.setProperty("--fr-bg-image", `url("${url}")`);
  } else {
    document.documentElement.style.removeProperty("--fr-bg-image");
  }
}

chrome.storage.local.get(["customBackground", "defaultBackground"]).then(
  ({ customBackground, defaultBackground }) => {
    custom = customBackground;
    fallback = defaultBackground;
    apply();
  },
  () => {}
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if ("customBackground" in changes) custom = changes.customBackground.newValue;
  if ("defaultBackground" in changes) fallback = changes.defaultBackground.newValue;
  apply();
});
