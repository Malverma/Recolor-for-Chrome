# Recolor for Chrome — Chrome Extension Spec

Repository: <https://github.com/Malverma/Recolor-for-Chrome>

Version 2.2.2. Ported from **Recolor for Firefox** v2.0.0
(<https://github.com/Malverma/Firefox-Recolor>). This spec covers the Chrome
version. Behavior is the same as the Firefox version unless this spec says
otherwise. Section 10 lists every difference in one place.

The name follows the "<Name> for Chrome" form. Google's branding guidelines
allow that form, but don't allow the Chrome logo or wording that suggests
Google endorses the extension. Check the current Chrome Web Store branding
guidelines before submitting.

## 1. Overview

**Recolor for Chrome** is a Chrome extension (Manifest V3) that puts a
wallpaper image behind **every website** (`http://*/*`, `https://*/*`). Each
page's opaque background layers are made transparent (or lightly tinted) so
the wallpaper shows through behind the existing UI. **Light sites are forced
into dark mode** so they match the wallpaper instead of clashing with it.

Most sites use **generic mode** (section 5.9), which measures the page and
clears its background automatically. These sites have hand-tuned stylesheets
instead, because generic mode can't handle their custom theme systems:

| Site           | URLs                                                   |
| -------------- | ------------------------------------------------------ |
| YouTube        | `https://www.youtube.com/*` (except `/embed/*`)        |
| YouTube Music  | `https://music.youtube.com/*`                          |

The wallpaper defaults to the bundled `images/background.jpg`. The user can
open a drag-and-drop upload page from the toolbar and drop in their own image.
It **replaces** the current wallpaper on every site at once.

Chrome doesn't let extensions run scripts on its own New Tab page, so the
extension replaces the New Tab page with its own (section 5.10): the
wallpaper, a clock, and a search box.

The extension is **purely cosmetic**. It changes how sites look and nothing
else.

It should also work unchanged in other Chromium browsers (Edge, Brave, Opera,
Vivaldi). Chrome is the only browser this spec targets and tests.

## 2. Goals

- Show a fixed, full-viewport wallpaper behind every website.
- Make each site's opaque background layers transparent or translucent so the
  wallpaper is visible.
- Keep all text, icons, thumbnails, and controls readable.
- Let the user upload their own wallpaper through a drag-and-drop page.
- A newly uploaded image replaces whatever wallpaper was in use (the default or
  a previous upload) on every site. It applies right away, with no page
  reload.
- Keep generic-mode and site-stylesheet code the same as the Firefox version
  (section 5.1) so fixes can be shared between the two.

## 3. Non-Goals

The extension must **not**:

- Change playback, search, email, ads, recommendations, or any other site
  behavior.
- Read, store, or send any user data, email contents, search queries, watch
  history, or account info.
- Make network requests. The default image ships inside the extension, and
  uploaded images stay in local extension storage.
- Change layout, sizing, spacing, fonts, or the colors of foreground elements
  (text, buttons, icons, thumbnails).
- Inject any UI (buttons, panels, overlays) into web pages. The upload UI
  lives on its own extension page.
- Touch the content of iframes (embedded videos, ads, Gmail chat, comment
  widgets). Only the top-level page is styled. The `<iframe>` element on the
  outer page may be styled (section 5.9, "Ad frames") but its document never is.
- Touch non-HTML documents (images, plain text, PDFs opened directly) or
  pages Chrome protects (`chrome://`, `chrome-extension://`,
  `chromewebstore.google.com`). Chrome blocks content scripts on these anyway.
  The New Tab page is replaced instead (section 5.10).
- Copy Google's New Tab page (shortcuts, Google doodle, cards).
- Expose any web-accessible resource. Chrome extension IDs are fixed, so a
  web-accessible file would let any site detect the extension (section 4.1).
- Have per-site wallpapers or per-site on/off switches (v2).
- Keep a history or gallery of uploaded images (one slot only).
- Offer a "reset to default" button (v2).

## 4. Background Image

### 4.1 Default image

- `images/background.jpg` (1920×1280, copyright-free), bundled with the
  extension.
- Used whenever no custom image has been uploaded.
- A higher-resolution file can be dropped in at the same path with no code
  changes.
- **Different from Firefox:** content scripts don't load the default image
  by URL. In Firefox, `background.jpg` is a web-accessible resource. That's
  safe there because each install gets a random `moz-extension://` UUID. In
  Chrome the extension ID is the same for every user, so any page could
  request `chrome-extension://<id>/images/background.jpg` to detect the
  extension. Instead:
  - On `runtime.onInstalled` (install, update, and Chrome update), the
    service worker reads the bundled file and stores it as a data URL under
    the `defaultBackground` key in `chrome.storage.local` (section 5.3).
  - `content.js` uses `customBackground || defaultBackground` (section 5.4).
  - The manifest has no `web_accessible_resources` entry.
  - The upload page is an extension page, so it can still show the default
    with `chrome.runtime.getURL("images/background.jpg")`.

### 4.2 Custom image

- Stored in `chrome.storage.local` under the key `customBackground` as a data
  URL string, plus `customBackgroundUpdated` (timestamp in ms).
- One image is shared by all sites.
- Only one custom image exists at a time. Saving a new one overwrites the key,
  so the previous upload is discarded.
- The bundled `background.jpg` file is never modified (extension files are
  read-only). "Replace" means the custom image takes precedence over it.
- Accepted input types: PNG, JPEG, WebP. Max input file size: 20 MB.
- Before saving, the upload page normalizes the image:
  - Decode it with `createImageBitmap`.
  - If the longest side is over 3840 px, scale it down to 3840 px, keeping
    the aspect ratio.
  - Re-encode with `OffscreenCanvas.convertToBlob({ type: "image/webp",
    quality: 0.9 })`, then convert to a data URL.
  - This keeps storage size bounded and strips metadata (EXIF, location).
- Animated GIFs and other formats are rejected with a clear message.
- **Storage quota:** Chrome limits `storage.local` to 10 MB unless the
  extension has the `unlimitedStorage` permission. A 3840 px WebP can be
  several MB, and base64 makes it about 33% bigger. Together with
  `defaultBackground`, that can get close to 10 MB. The manifest requests
  `unlimitedStorage`, which adds no install warning.

## 5. Technical Design

### 5.1 File Structure

```
Recolor-for-Chrome/
├── manifest.json
├── background.js          (service worker: toolbar button, seeds default image)
├── content.js             (sets the wallpaper URL; shared by all sites)
├── generic.js             (generic mode: finds and clears page backgrounds)
├── css/
│   ├── generic.css
│   ├── youtube.css
│   └── youtube-music.css
├── upload/
│   ├── upload.html
│   ├── upload.css
│   └── upload.js
├── newtab/                (replacement New Tab page)
│   ├── newtab.html
│   ├── newtab.css
│   └── newtab.js
├── images/
│   └── background.jpg
├── icons/
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   ├── icon-128.png
│   └── source/icon.svg    (master artwork, not packaged)
├── LICENSE
└── spec.md                (not packaged)
```

How each file relates to the Firefox repo:

| File                         | From Firefox                                                     |
| ---------------------------- | ---------------------------------------------------------------- |
| `generic.js`                 | Adds the neutral-card rule (5.9); otherwise identical. No extension APIs. |
| `css/*.css`                  | Identical except the header comment; `generic.css` adds the ad-frame rule (5.9). |
| `upload/upload.css`          | Identical.                                                       |
| `upload/upload.html`         | Title and heading text changed.                                  |
| `upload/upload.js`           | `browser.*` → `chrome.*`, one comment changed.                   |
| `content.js`                 | Rewritten to use `chrome.*` and the stored default (5.4).        |
| `background.js`              | Rewritten as a service worker that seeds the default (5.3).      |
| `manifest.json`              | Rewritten for Chrome (5.2).                                      |
| `icons/`                     | New eyedropper icon, exported from `icons/source/icon.svg`.      |
| `newtab/`                    | New (5.10).                                                      |
| `.amo-upload-uuid`           | Dropped (Firefox Add-ons only).                                  |

The `--fr-*` custom properties and `data-fr-*` attributes keep their names,
so `generic.js` and the CSS stay close to the Firefox repo (the Chrome-only
changes in 5.9 can be ported back).

### 5.2 Manifest (Manifest V3)

```json
{
  "manifest_version": 3,
  "name": "Recolor for Chrome",
  "version": "2.2.2",
  "description": "Puts your chosen wallpaper behind every website and on new tabs, forces light sites dark, with tuned styles for YouTube.",
  "homepage_url": "https://github.com/Malverma/Recolor-for-Chrome",
  "minimum_chrome_version": "120",
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "permissions": ["storage", "unlimitedStorage", "search"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_title": "Recolor for Chrome: change background",
    "default_icon": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png"
    }
  },
  "options_ui": {
    "page": "upload/upload.html",
    "open_in_tab": true
  },
  "chrome_url_overrides": {
    "newtab": "newtab/newtab.html"
  },
  "content_scripts": [
    {
      "matches": ["https://www.youtube.com/*"],
      "exclude_matches": ["https://www.youtube.com/embed/*"],
      "css": ["css/youtube.css"],
      "js": ["content.js"],
      "run_at": "document_start"
    },
    {
      "matches": ["https://music.youtube.com/*"],
      "css": ["css/youtube-music.css"],
      "js": ["content.js"],
      "run_at": "document_start"
    },
    {
      "matches": ["http://*/*", "https://*/*"],
      "exclude_matches": [
        "https://www.youtube.com/*",
        "https://music.youtube.com/*"
      ],
      "css": ["css/generic.css"],
      "js": ["content.js", "generic.js"],
      "run_at": "document_start"
    }
  ]
}
```

- `background.service_worker` replaces Firefox's `background.scripts`.
  Chrome MV3 has no persistent or event background pages.
- `browser_specific_settings` (the Gecko ID and data-collection
  declaration) is removed. Chrome warns about unknown keys, and Chrome Web
  Store collects privacy declarations in its dashboard instead (section 8).
- No `web_accessible_resources` (section 4.1).
- `storage`, `unlimitedStorage` and `search` are the only API permissions.
  None of them shows an install warning. `search` lets the New Tab page's
  search box use the user's default search engine. The content script matches cover all
  `http`/`https` sites, so Chrome shows **"Read and change all your data on
  all websites"** at install. No `tabs` or `scripting` permission.
- Users can limit site access under chrome://extensions → Details → Site
  access. If they do, sites without access look unchanged. Nothing else
  breaks.
- The generic entry excludes every URL that has a dedicated stylesheet, so a
  page never gets both.
- Content scripts run in the top frame only (`all_frames` defaults to
  false), so iframes (Gmail chat, YouTube live chat, embeds) are never
  touched.
- `minimum_chrome_version` 120 covers everything the code uses: `:has()`
  (105), promise-based `chrome.*` APIs, `OffscreenCanvas.convertToBlob` with
  WebP output, and `backdrop-filter`.

### 5.3 background.js (service worker)

Does two things:

1. Opens the upload page when the toolbar button is clicked. There is no
   popup. Chrome closes action popups when they lose focus, for example when
   a file manager or file picker takes focus, which breaks drag-and-drop from
   the desktop. A full tab avoids that (same reason as in Firefox).
2. Copies the bundled default image into storage (section 4.1).

```js
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
```

- Listeners are registered at the top level, so they still work after Chrome
  shuts down an idle service worker and starts it again.
- `onInstalled` also runs on updates, so replacing `background.jpg` in a new
  version updates the stored copy.
- Service workers have no DOM, so the image is base64-encoded in chunks with
  `btoa` instead of `FileReader`/canvas.
- `openOptionsPage()` focuses the upload tab if one is already open. The page
  can also be opened by right-clicking the toolbar icon → **Options**, or from
  chrome://extensions → Recolor for Chrome → Details → **Extension options**.

### 5.4 content.js

Shared by all sites. Works out which image to show and passes its URL to the
site stylesheet through the `--fr-bg-image` custom property on `<html>`.
Keeps open tabs in sync when the image changes.

```js
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
```

- The storage read is async. Until it resolves, each stylesheet shows its
  fallback color (`var(--fr-bg-image, none)`), so the default image never
  flashes before a custom one.
- Tabs that load in the moment between install and the end of seeding show
  the fallback color. The default appears when `defaultBackground` arrives
  through `onChanged`.
- Tabs that were open before install or update don't get content scripts
  until they're reloaded. Chrome doesn't inject declared content scripts
  into existing tabs. This is accepted (no `scripting` permission).
- After an update or reload, content scripts still running in old tabs lose
  their connection to the extension, so `chrome.storage` calls in them fail.
  Those tabs keep the wallpaper they already have but stop syncing until
  they're reloaded. This is accepted.
- The script must not touch the DOM in any other way, listen to page
  events, or talk to the page's scripts.

### 5.5 Dedicated site stylesheets — shared pattern

Same as Firefox. Every dedicated site stylesheet follows the same pattern:

1. **Wallpaper layer** on `html`: fallback color matching the site's own
   background, then a tint gradient over `var(--fr-bg-image, none)`, with
   `center / cover no-repeat fixed`.
2. **Transparent surfaces**: the site's page-level containers get
   `background: transparent !important`.
3. **Readability layers**: bars and panels that sit over the image get a
   translucent tint plus `backdrop-filter: blur(...)`.
4. **Untouched**: menus, dropdowns, dialogs, tooltips, media players,
   thumbnails and all foreground colors.

All selectors **must be checked against the live DOM in Chrome**. YouTube
sometimes serves Chrome different markup or experiments than Firefox.

### 5.6 css/youtube.css (www.youtube.com)

Same as Firefox, unchanged:

- Theme variables overridden to `transparent` on `html`, `[dark]`, `ytd-app`:
  `--yt-spec-base-background`, `--yt-spec-general-background-a/b/c`.
  `--yt-spec-raised-background`, `--yt-spec-menu-background` and
  `--yt-spec-brand-background-*` are left alone (menus, dialogs, tooltips).
- Transparent surfaces: `body`, `ytd-app`, `#content.ytd-app`,
  `ytd-page-manager`, `ytd-masthead` (+ `#background`), mini guide, guide,
  browse/rich grid/section list, chips bar, search, channel header and tabs,
  watch page columns and metadata, Shorts containers.
- Readability: `#frosted-glass` (behind masthead and chips bar)
  `rgba(0,0,0,0.45)` + blur 12px; expanded guide
  (`tp-yt-app-drawer #contentContainer`) `rgba(0,0,0,0.35)` + blur 8px.
- Light theme (`html:not([dark])`): white tints instead of black.
- Kept solid black: `#player-full-bleed-container`, `#movie_player`,
  `.html5-video-player`. Fullscreen, miniplayer, menus and dialogs untouched.

### 5.7 css/youtube-music.css (music.youtube.com)

Same as Firefox, unchanged:

- Theme variables `--ytmusic-background`,
  `--ytmusic-general-background-a/b/c` set to `transparent`.
  `--ytmusic-brand-background-*` left alone (menus, dialogs, toasts).
- `--ytmusic-background` is also used as a foreground color by the sidebar
  play button and as the search box background. Both get the original color
  back via `--yt-sys-color-baseline--base-background`.
- `ytmusic-browse-response .background-gradient` wraps all page content:
  strip its background only, never hide it.
- `#nav-bar-background`, `#mini-guide-background` and
  `#player-bar-background` live in `ytmusic-app-layout`'s shadow root and are
  styled through `--ytmusic-nav-bar` and `--ytmusic-player-bar-background`.
- Readability: nav bar `rgba(0,0,0,0.45)`, player bar `rgba(0,0,0,0.55)` +
  blur 12px, guide `rgba(0,0,0,0.35)` + blur 8px.

### 5.8 Upload page (`upload/upload.html`, `upload.css`, `upload.js`)

A standalone extension page. It follows the system light/dark theme
(`prefers-color-scheme`) and has no external resources. MV3's default
extension-page CSP (`script-src 'self'`) already rules out inline scripts.
The page has none.

#### Changes from Firefox

- `<title>` and `<h1>`: "Recolor for Chrome: background".
- `upload.js`: every `browser.` becomes `chrome.` (`chrome.runtime.getURL`,
  `chrome.storage.local.get/set`). The window-level drop guard's comment says
  "Stop Chrome from opening a file dropped outside the drop zone."
- The default preview still uses
  `chrome.runtime.getURL("images/background.jpg")`. That works without
  `web_accessible_resources` because this is an extension page.

#### Layout

1. Heading: "Recolor for Chrome: background".
2. **Current background** preview: a 16:9 box showing the image in use, with
   a label "Default" or "Custom (uploaded <date>)".
3. **Drop zone**: a large dashed-border area reading "Drop an image here or
   click to choose a file". Clicking it or pressing Enter/Space while it is
   focused opens a hidden `<input type="file"
   accept="image/png,image/jpeg,image/webp">`.
4. A status line (`role="status"`, `aria-live="polite"`) for success and
   error messages.

#### Drag-and-drop behavior

- `dragenter`/`dragover` on the drop zone: `preventDefault()`, add a
  highlighted "drag-over" style. `dragleave`/`drop`: remove it.
- `preventDefault()` on `dragover`/`drop` for the whole window, so a file
  dropped outside the zone doesn't make Chrome open it in the tab.
- On `drop`, take `dataTransfer.files[0]`. If more than one file is dropped,
  use the first and say so in the status line.
- The file input path goes through the same handler.

#### Save flow

1. Validate type (PNG/JPEG/WebP) and size (≤ 20 MB). On failure, show an
   error and change nothing.
2. Normalize as described in 4.2.
3. `chrome.storage.local.set({ customBackground: dataUrl,
   customBackgroundUpdated: Date.now() })`. This overwrites any previous
   custom image.
4. Update the preview and show "Background updated. Open tabs have been
   updated."
5. If decoding or saving fails (including a quota error), show the error and
   leave the stored image unchanged.

### 5.9 Generic mode (`generic.js` + `css/generic.css`)

The files and behavior are **identical to Firefox** (see the Firefox spec
§5.9 for the full design). In short:

- **Activation**: only on `text/html` / `application/xhtml+xml` documents,
  after `DOMContentLoaded`. Finds the page's base color (body → html → first
  large child/grandchild → white) and sets `--fr-base`, `--fr-tint`, and
  `data-fr` on `<html>`. Light bases (luminance > 128) also get
  `data-fr-invert`.
- **Classification**: a depth-first walk (≤ 50,000 elements per pass, with
  media, form controls, and `dialog` skipped) sorts each element with an
  opaque background as **clear** (same color as what's behind it, not
  pinned, not in an overlay), **panel** (layout-sized; its own color at 0.6
  alpha + blur 12px), **flip** (a panel that would end up light, inverted on
  its own), or **solid** (left alone).
- **Neutral cards (Chrome version only):** an element with a neutral
  (gray/white/black: channel spread < 24) background of its own that is at
  least 120×32 px, not `absolute`/`fixed`/`sticky`, and not in an overlay is
  also treated as a panel, but at **0.25** alpha (layout-sized panels stay at
  0.6) with the same 12px blur and flip rule. Example: the facts rows (CEO,
  Owners, Founders…) in Google's knowledge panel were solid gray boxes; they
  now show the wallpaper's colors through a light tint. Colored boxes
  (buttons, badges, alerts) and popups keep their look.
- **"Read more" fades (Chrome version only):** an element whose
  `background-image` is only a `linear-gradient` with stops that are
  transparent or the color behind it (a fade over truncated text) gets
  `[data-fr-fade]` and its gradient is removed. Instead, each in-flow sibling
  under it (the truncated content) gets `[data-fr-fade-content]` and a
  `mask-image` from the fade's top (`--fr-mask-start`) to 55% of the fade's
  height (`--fr-mask-end`), so the text fades out to transparent and the
  wallpaper shows rather than a dark band. The mask only applies while the
  fade is rendered (`[data-fr-fade-on]` on its parent, re-checked after every
  mutation batch), so text expanded with "Show more" is never hidden. No
  blur is used here: `clip-path`/`mask` on an ancestor makes Chrome stop
  `backdrop-filter` from seeing the content behind it.
- **The bar beside a fade:** a box in the color behind it, inside an
  overlay **and** next to such a fade (within 4 levels; the bar carrying
  "Show more"), becomes a card. If a rounded child fills it (the pill
  button), the bar gets that child's `border-radius` (clamped to half its
  height), so the tint matches the button's shape instead of a square. Real
  popups never sit beside a fade, so menus and dropdowns stay opaque. All reads happen before any writes,
  and each element's result is cached in a `WeakMap`.
- **Updates**: a `MutationObserver` on `body` (childList plus `class`,
  `style`, `hidden`, `open`), batched every 300 ms. `resize` re-processes
  from `body`.
- **Forced dark mode**: `filter: invert(1) hue-rotate(180deg)` on
  `html[data-fr-invert]`. The wallpaper moves to an inverted-back
  `html::before` layer, and media is inverted back. All of it is switched off
  under `:has(:fullscreen)`.

**Chrome-specific checks** (verify during testing; adjust only if Chrome
behaves differently):

- **Root filter and fixed positioning.** The spec says a `filter` on the
  root element doesn't create a containing block for `position: fixed`.
  Chrome follows this (Dark Reader's filter mode relies on it). Test item 10
  confirms it.
- **`background-attachment: fixed` cost.** Chrome repaints fixed
  backgrounds while scrolling, and `backdrop-filter` panels on top add to
  that. Check that scrolling stays smooth (test item 14). If it doesn't,
  switch generic mode to the `html::before` fixed layer (already used in
  forced dark mode) on every page.
- **Chrome's own dark modes.** Chrome's "Auto Dark Mode for Web Contents"
  (chrome://flags/#enable-force-dark, or the Android setting) and the Dark
  Reader extension both darken pages too. Combined with forced dark mode,
  light pages can end up inverted twice (light again). That's a known
  conflict. The extension doesn't try to detect it.

**Ad frames (Chrome version only).** Ad slots are usually transparent
wrappers around an `<iframe>`. When an iframe's used `color-scheme` differs
from its document's, the browser paints an opaque backdrop behind the frame
(white for a light-scheme document). Ad documents use the default light
scheme, so on dark-scheme pages every unused part of an ad slot showed as a
solid white box. `generic.css` sets the frame element's scheme to match:

```css
html[data-fr] iframe {
  color-scheme: light !important;
}
```

The frame then stays transparent wherever the ad doesn't paint. The ad
creative itself (its image or its own background) is opaque and stays as
it is; the extension never touches a frame's content. Verified on
speedtest.net.

**Known limits**: the same as Firefox §5.9, plus the Chrome checks above.
Ads whose creative fills the slot with its own background still look solid.

### 5.10 New Tab page (`newtab/newtab.html`, `newtab.css`, `newtab.js`)

Chrome blocks content scripts on its New Tab page, so the extension
overrides it with `chrome_url_overrides.newtab`.

- **Layout:** the wallpaper (same tint and `cover / fixed` setup as
  `youtube.css`), a large clock, the date, and a pill-shaped search box,
  centered. A small "Change background" button in the bottom-right corner
  opens the upload page.
- **Wallpaper:** `customBackground` from storage, or
  `chrome.runtime.getURL("images/background.jpg")` (allowed on extension
  pages). Updates live through `storage.onChanged`.
- **Search:** `chrome.search.query({ text, disposition: "CURRENT_TAB" })`, so
  it uses whatever search engine the user has set as default. The search
  box has `autofocus`, but Chrome normally keeps focus in the address bar
  on a new tab, which also searches.
- **No shortcuts or most-visited tiles.** Those need the `topSites`
  permission, which adds an install warning ("Read a list of your most
  frequently visited websites"). Left as a future idea.
- The first time a user opens a new tab after installing, Chrome asks
  whether to keep the changed New Tab page. Choosing "Change it back"
  disables the whole extension, so the store listing should mention the
  New Tab page.
- Follows the extension-page CSP: no inline scripts or styles, no external
  resources.

## 6. Behavior Requirements

| ID   | Requirement                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------- |
| R1   | The wallpaper is visible on every dedicated site and on standard HTML pages elsewhere.           |
| R1a  | Light pages are shown in dark mode; photos, video, and the wallpaper are not inverted.           |
| R2   | The wallpaper stays applied after in-app (SPA) navigation without a reload.                      |
| R3   | The wallpaper is fixed; it does not scroll with content.                                        |
| R4   | The wallpaper covers the full viewport at any window size, without stretching (`cover`).         |
| R5   | No flash of the default image when a custom image is set. Generic mode never paints a wrong background color (a light page may show white until it has parsed). |
| R6   | Playback, search, email, controls, and navigation work exactly as without the extension.        |
| R7   | The extension makes no network requests.                                                        |
| R8   | Iframe contents, non-HTML documents, and Chrome-protected pages are never changed.               |
| R9   | The toolbar button opens the upload page (or focuses it if already open).                       |
| R10  | Dropping or choosing a valid image replaces the wallpaper on all open tabs within ~1 s, without a reload. |
| R11  | Only one custom image is stored; a new upload overwrites the previous one.                       |
| R12  | Invalid files (wrong type, too large, corrupt) show an error and leave the current wallpaper unchanged. |
| R13  | The custom image survives browser restarts and extension updates.                                |
| R14  | Disabling the extension fully restores each site's original look (after a reload). Removing it also deletes the stored images. |
| R15  | Text contrast stays readable (target WCAG AA, 4.5:1, for main body text over tinted surfaces).   |
| R16  | No extension file is reachable from web pages (no web-accessible resources).                    |
| R17  | Opening a new tab shows the wallpaper, a clock, and a search box that uses the default search engine. |
| R18  | On dark pages, empty parts of ad slots show the wallpaper instead of a white box.                |

## 7. Testing

Manual test pass in Chrome. Load the extension from chrome://extensions:
turn on **Developer mode**, click **Load unpacked**, and select the repo
folder. Unpacked extensions keep `storage.local` across browser restarts and
the reload button, so R13 can be tested directly. (Firefox needed
`web-ext run` with a persistent profile for this.)

After changing any file, click the reload icon on the extension's card and
reload the test tabs (see 5.4 on old tabs).

**YouTube**

1. Visit Home, Subscriptions, Shorts, You, a search, a channel, a playlist,
   and a video. The wallpaper shows everywhere, and the player stays black.
2. Try theater mode, fullscreen, and the miniplayer.
3. Open the three-dot menu, account menu, Share, "Save to playlist". They
   are opaque and readable.
4. Switch YouTube to light theme. Text stays readable.

**YouTube Music**

5. Visit Home, Explore, Library, a search, an artist, an album, a playlist.
6. Play a song and open Now Playing (Song and Video modes).
7. Open a track menu and "Save to playlist". They are opaque.

**Generic mode and forced dark**

8. Gmail: inbox, an email with images, Compose, account menu. Everything is
   dark and readable, and photos and avatars look normal.
9. Google Search: home page, results, Images tab, a video result. The search
   box and dropdown are dark, and thumbnails look normal.
10. A light site with a fixed/sticky header: the header stays in place while
    scrolling (confirms the root-filter behavior in Chrome).
11. Play an embedded video and make it fullscreen. It isn't inverted.
12. A site that's already dark (e.g. GitHub in dark mode): not inverted. The
    wallpaper shows with a tint in the site's own color.
12a. Google results: the box around each result and the result chips show
    the wallpaper. The search suggestion dropdown stays opaque.
12b. Sites with a white header or sidebar (on a light or dark page), and a
    dark-colored nav bar on a light page: every bar ends up dark, translucent
    and blurred, with light text and buttons. Logos and avatars look normal,
    and dropdown menus open in the right place.
13. Visit a range of sites: a light news site, a dark site, Wikipedia,
    Reddit, a docs site, a web app (e.g. Google Docs). The wallpaper shows
    where the page background was. Cards, images, sticky headers, and menus
    keep their look, and text stays readable.
14. On an infinite-scroll page, scroll a long way. New content keeps the
    effect, and scrolling stays smooth. Check frame rate with DevTools →
    Rendering → Frame Rendering Stats.
15. Open a direct image URL and a `.txt` file URL. They are unchanged.
16. A page with an embedded YouTube video: the embed itself is unchanged.
17. chrome://settings and chromewebstore.google.com are unchanged.
16a. Google search for a company (e.g. "youtube"): the knowledge panel's
    facts rows are translucent and tinted by the wallpaper; text is readable.
    The description fades out into the wallpaper (no black band), the "Show
    more" pill's tint is rounded like its border (no square), and no cut-off
    text peeks out under it. Clicking "Show more" shows the full text.
17a. A dark site with display ads (e.g. speedtest.net): no white boxes
    around or behind ads; the ads themselves look normal.

**New Tab page**

17b. Open a new tab. The wallpaper, clock, date, and search box show. Keep
    the page when Chrome asks.
17c. Type in the search box and press Enter. The default search engine's
    results open in the same tab.
17d. Upload a new image while a New Tab page is open. It switches without
    a reload.
17e. "Change background" opens the upload page.

**Upload page**

18. Click the toolbar button. The upload page opens. Click again, and the
    same tab is focused.
19. Right-click the toolbar icon → Options. The same page opens.
20. Drag a JPEG from the file manager onto the drop zone. After the drop, the
    preview and every open tab switch to the new image.
21. Drop a second image. It replaces the first everywhere.
22. Click the drop zone and pick a PNG through the file picker.
23. Drop a `.gif`, a `.txt`, and a file over 20 MB. Each shows an error.
24. Drop a file outside the drop zone. Chrome doesn't open it.
25. Upload a large, detailed 4K photo (to test the quota). It saves without
    a quota error.
26. Restart Chrome. The custom image is still in use.

**Install, update, cleanup**

27. Fresh install: open a new site right away. The default wallpaper
    appears (it may take a moment while seeding finishes).
28. Bump the version and reload the extension. The custom image is still
    there, and newly loaded tabs show it.
29. From a normal web page's console, `fetch("chrome-extension://<id>/images/background.jpg")`
    fails (R16).
30. DevTools Network tab: no requests from the extension.
31. Disable the extension and reload each site. The original look comes back.
32. Remove the extension, then reinstall it. The default wallpaper is back
    and the custom image is gone.

## 8. Packaging & Distribution

- Build: zip the extension files from the repo root, leaving out `spec.md`,
  `.git*`, and any build output:
  `zip -r recolor-for-chrome-2.2.2.zip . -x 'spec.md' '.git*' '*.zip' 'icons/source/*' 'issue*.png'`.
- Publish through the Chrome Web Store Developer Dashboard (one-time $5
  developer registration).
- Store listing assets:
  - 128×128 icon (`icons/icon-128.png`, 96×96 artwork with 16 px transparent
    padding, as Google recommends).
- Icon: a white eyedropper (the color-picker tool) dropping a color, on a
  rounded square with a purple → pink → orange gradient. The design is
  also in Penpot (page "Google Icon 128", one board per size with PNG
  export set). The SVG's viewBox is trimmed to the rounded square, so the
  square fills 96×96 exactly in the 128 icon and the full canvas at 16/32/48. Re-export after
  editing the SVG:
  `for n in 16 32 48; do rsvg-convert -w $n -h $n icons/source/icon.svg -o icons/icon-$n.png; done`
  and `rsvg-convert -w 96 -h 96 icons/source/icon.svg | magick - -background none -gravity center -extent 128x128 icons/icon-128.png`.
  - At least one screenshot at 1280×800 or 640×400 (e.g. YouTube Music, a
    light site forced dark, the upload page).
  - Small promo tile, 440×280.
- Privacy practices tab:
  - **Single purpose:** "Displays a user-chosen wallpaper behind web pages
    and darkens light pages to match."
  - **Permission justifications:** `storage`: saves the chosen wallpaper
    locally. `unlimitedStorage`: high-resolution wallpapers can be larger
    than the 10 MB default quota. `search`: the New Tab page's search box
    sends the typed text to the user's default search engine. New Tab
    override: shows the wallpaper on new tabs. Host access (content scripts on all
    sites): restyles each page's background. No remote code.
  - **Data usage:** collects no user data. Certify the required data-use
    statements.
- Broad host access usually means a longer review. Keep the listing's
  description specific about what is changed on pages.
- For local use without the store, users can keep loading it unpacked.
  Chrome on Windows and macOS doesn't allow installing `.crx` files from
  outside the store.

## 9. Future Ideas

Same as the Firefox version, plus Chrome-specific ones:

- Per-site wallpapers and per-site on/off toggles (e.g. to turn generic
  mode off on a site where it misbehaves).
- A "Reset to default" button (just removes `customBackground`).
- Sliders for dim/blur strength on the upload page.
- Dedicated stylesheets for more sites where generic mode falls short.
- Remember per-site light/dark detection to avoid the brief white flash.
- A toggle to turn forced dark mode off.
- Paste an image from the clipboard on the upload page.
- Animated (GIF/WebP) wallpapers.
- Shortcuts / most-visited tiles on the New Tab page (`topSites`), or a
  setting to keep Chrome's own New Tab page.
- Re-style tabs that were already open at install, using the `scripting`
  permission (adds no new warning, since host access is already granted).
- Share one codebase with Firefox: a `browser`/`chrome` shim and a small
  build step that writes each browser's manifest.

## 10. Differences from Recolor for Firefox (summary)

| Area                      | Firefox                                              | Chrome                                                            |
| ------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| Name                      | Recolor for Firefox                                  | Recolor for Chrome                                                |
| API namespace             | `browser.*`                                          | `chrome.*` (promise-based in MV3)                                 |
| Background                | `background.scripts` (event page)                    | `background.service_worker`                                       |
| Default image delivery    | Web-accessible `background.jpg` (random per-install UUID) | Seeded into `storage.local` as `defaultBackground`; no web-accessible resources |
| Permissions               | `storage`                                            | `storage`, `unlimitedStorage` (10 MB default quota), `search`     |
| Browser-specific manifest | `browser_specific_settings.gecko` (ID, min 142, data collection) | `minimum_chrome_version: "120"`; privacy set in the store dashboard |
| Icons                     | 48, 96                                               | 16, 32, 48, 128                                                   |
| Protected pages           | `about:`, addons.mozilla.org                         | `chrome://`, chromewebstore.google.com                            |
| New Tab page              | Not changed                                          | Replaced with a wallpaper page (5.10)                             |
| Ad frames                 | Not handled                                          | `iframe { color-scheme: light }` removes white backdrops (5.9)    |
| Options entry points      | about:addons → Preferences                           | Toolbar right-click → Options; chrome://extensions → Details      |
| Dev loading               | `about:debugging` temporary add-on (storage lost on unload) | chrome://extensions → Load unpacked (storage kept)          |
| Build                     | `web-ext build`                                      | `zip` (Section 8)                                                 |
| Distribution              | AMO (signing required)                               | Chrome Web Store                                                  |
| Small neutral boxes       | Stay solid                                           | Translucent "cards" at 0.25 alpha + blur (5.9)                    |
| Unchanged                 | Site CSS, upload page layout and flow                | Same                                                              |
