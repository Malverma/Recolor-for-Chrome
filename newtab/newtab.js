const DEFAULT_URL = chrome.runtime.getURL("images/background.jpg");

const time = document.getElementById("time");
const date = document.getElementById("date");
const search = document.getElementById("search");
const query = document.getElementById("query");

let custom = null;

function applyBackground() {
  document.documentElement.style.setProperty("--fr-bg-image", `url("${custom || DEFAULT_URL}")`);
}

chrome.storage.local.get("customBackground").then(
  ({ customBackground }) => {
    custom = customBackground;
    applyBackground();
  },
  () => applyBackground()
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "customBackground" in changes) {
    custom = changes.customBackground.newValue;
    applyBackground();
  }
});

function tick() {
  const now = new Date();
  time.textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  date.textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  setTimeout(tick, 1000 - now.getMilliseconds());
}
tick();

// Searches with the user's default search engine.
search.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = query.value.trim();
  if (text) chrome.search.query({ text, disposition: "CURRENT_TAB" });
});

document.getElementById("change").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
