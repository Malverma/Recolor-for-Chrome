// Generic mode: every website without a dedicated stylesheet.
//
// Finds the page's base background color, then marks every element painted
// in the same color as what's behind it with [data-fr-clear] so
// css/generic.css can make it transparent. Opaque headers, sidebars and
// columns in other colors become translucent panels [data-fr-panel], flipped
// [data-fr-flip] when they would otherwise end up light. Popups and anything
// with its own background image are left alone. Light pages are also marked
// [data-fr-invert] to force them dark.
(() => {
  if (!/^(text\/html|application\/xhtml\+xml)$/.test(document.contentType)) return;

  const root = document.documentElement;
  const SKIP = new Set([
    "IMG", "VIDEO", "CANVAS", "IFRAME", "SVG", "PICTURE", "OBJECT", "EMBED",
    "INPUT", "TEXTAREA", "SELECT", "BUTTON", "DIALOG", "SCRIPT", "STYLE",
  ]);
  const MAX_ELEMENTS = 50000;
  const COLOR_DISTANCE = 30;

  // Resolve any CSS color (rgb, oklch, color(), …) to sRGB through a 1×1 canvas.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const colorCache = new Map();

  function toRgba(color) {
    let rgba = colorCache.get(color);
    if (!rgba) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      rgba = { r, g, b, a: a / 255 };
      colorCache.set(color, rgba);
    }
    return rgba;
  }

  // The element's background color, if it is a plain opaque color.
  function solidBackground(el) {
    const cs = getComputedStyle(el);
    if (cs.backgroundImage !== "none") return null;
    const c = toRgba(cs.backgroundColor);
    return c.a >= 0.9 ? c : null;
  }

  function isLarge(el) {
    const rect = el.getBoundingClientRect();
    return rect.width >= innerWidth * 0.5 && rect.height >= innerHeight * 0.5;
  }

  function findBase() {
    const fromRoot = solidBackground(document.body) || solidBackground(root);
    if (fromRoot) return fromRoot;
    for (const el of document.body.querySelectorAll(":scope > *, :scope > * > *")) {
      if (!SKIP.has(el.tagName.toUpperCase()) && isLarge(el)) {
        const c = solidBackground(el);
        if (c) return c;
      }
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  let base;
  let pageInverted = false;
  let rootCtx;

  const distance = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  const isLight = ({ r, g, b }) => 0.2126 * r + 0.7152 * g + 0.0722 * b > 128;
  const POPUP_ROLES = /^(dialog|alertdialog|menu|listbox|tooltip)$/;

  // What each element was classified as, so later passes don't re-read
  // backgrounds the extension itself has already changed.
  const classified = new WeakMap();

  // Read-only: decide what to do with el, given the context it sits in.
  //   ctx.behind  – color painted behind el (page base, or nearest opaque ancestor)
  //   ctx.flipped – an ancestor panel is flipped
  //   ctx.overlay – el is inside a popup (menu, dropdown, dialog, tooltip)
  function classify(el, ctx) {
    const cs = getComputedStyle(el);
    if (cs.display === "none") return null; // not cached: re-checked once shown
    if (cs.display === "contents") return { kind: "pass" };

    const rect = el.getBoundingClientRect();
    const sized =
      el === document.body ||
      ((rect.width >= innerWidth * 0.5 || rect.height >= innerHeight * 0.5) &&
        Math.min(rect.width, rect.height) >= 24);
    const floating = cs.position === "absolute" || cs.position === "fixed";
    const pinned = floating || cs.position === "sticky";
    const overlay = (floating && !sized) || POPUP_ROLES.test(el.getAttribute("role") || "");

    let color = null;
    if (cs.backgroundImage === "none") {
      const c = toRgba(cs.backgroundColor);
      if (c.a >= 0.9) color = c;
    }
    if (!color) return { kind: "none", overlay };

    // Same color as what's behind it (result boxes, cards, wrappers on the
    // page or on a panel): clearing it looks the same, and lets the
    // wallpaper through once what's behind it is cleared too. Popups stay
    // opaque so they remain readable over the content beneath them.
    if (!ctx.overlay && !overlay && !pinned && distance(color, ctx.behind) < COLOR_DISTANCE) {
      return { kind: "clear", color, overlay };
    }

    // Headers, sidebars, columns, app shells in their own color: translucent
    // panel. Flip it if it would end up light: a light panel on a page that
    // isn't inverted, or a dark one on a page that is.
    if (sized && !ctx.overlay) {
      const endsLight = isLight(color) !== (pageInverted !== ctx.flipped);
      return { kind: "panel", color, overlay, flip: endsLight && !ctx.flipped };
    }

    // Anything else keeps its look.
    return { kind: "solid", color, overlay };
  }

  function childContext(ctx, result) {
    if (result.kind === "pass") return ctx;
    let next = ctx;
    if (result.overlay && !ctx.overlay) next = { ...next, overlay: true };
    if (result.kind === "panel") {
      next = { ...next, behind: result.color, flipped: ctx.flipped || result.flip };
    } else if (result.kind === "solid") {
      next = { ...next, behind: result.color };
    }
    return next;
  }

  function apply(el, result) {
    if (result.kind === "clear") {
      el.setAttribute("data-fr-clear", "");
    } else if (result.kind === "panel") {
      const { r, g, b } = result.color;
      el.style.setProperty("--fr-panel", `rgba(${r}, ${g}, ${b}, 0.6)`);
      el.setAttribute("data-fr-panel", "");
      if (result.flip) el.setAttribute("data-fr-flip", "");
    }
  }

  // Context for an element from its (already classified) ancestors, or null
  // if one of them hasn't been processed (hidden, or inside skipped content).
  function contextFor(el) {
    const chain = [];
    for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
      if (SKIP.has(p.tagName.toUpperCase())) return null;
      chain.push(p);
    }
    let ctx = rootCtx;
    for (let i = chain.length - 1; i >= 0; i--) {
      const result = classified.get(chain[i]);
      if (!result) return null;
      ctx = childContext(ctx, result);
    }
    return ctx;
  }

  // Classify a subtree. All reads happen first and all writes after, so the
  // browser only has to compute styles and layout once per pass.
  function processTree(start, ctx) {
    const writes = [];
    const stack = [[start, ctx]];
    let count = 0;
    while (stack.length && count < MAX_ELEMENTS) {
      const [el, elCtx] = stack.pop();
      count++;
      let result = classified.get(el);
      if (!result) {
        result = classify(el, elCtx);
        if (!result) continue;
        classified.set(el, result);
        writes.push([el, result]);
      }
      const next = childContext(elCtx, result);
      for (const child of el.children) {
        if (!SKIP.has(child.tagName.toUpperCase())) stack.push([child, next]);
      }
    }
    for (const [el, result] of writes) apply(el, result);
  }

  // Added nodes and class/visibility changes are processed in batches.
  const dirty = new Set();
  let pending = false;

  function flush() {
    pending = false;
    const batch = new Set(dirty);
    dirty.clear();
    for (const el of batch) {
      if (!el.isConnected || SKIP.has(el.tagName.toUpperCase())) continue;
      let covered = false;
      for (let p = el.parentElement; p && !covered; p = p.parentElement) covered = batch.has(p);
      if (covered) continue;
      const ctx = el === document.body ? rootCtx : contextFor(el);
      if (ctx) processTree(el, ctx);
    }
  }

  function markDirty(el) {
    dirty.add(el);
    if (pending) return;
    pending = true;
    setTimeout(flush, 300);
  }

  function onMutations(records) {
    for (const m of records) {
      if (m.type === "childList") {
        for (const node of m.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) markDirty(node);
      } else {
        markDirty(m.target);
      }
    }
  }

  function activate() {
    if (!document.body) return;
    base = findBase();
    const { r, g, b } = base;
    pageInverted = isLight(base);
    root.style.setProperty("--fr-base", `rgb(${r}, ${g}, ${b})`);
    if (pageInverted) {
      // Light pages are forced dark (see "Forced dark mode" in generic.css).
      root.style.setProperty("--fr-tint", "rgba(0, 0, 0, 0.6)");
      root.setAttribute("data-fr-invert", "");
    } else {
      root.style.setProperty("--fr-tint", `rgba(${r}, ${g}, ${b}, 0.55)`);
    }
    root.setAttribute("data-fr", "");
    rootCtx = { behind: base, flipped: false, overlay: false };
    processTree(document.body, rootCtx);
    new MutationObserver(onMutations).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "open"],
    });
    addEventListener("resize", () => markDirty(document.body));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", activate, { once: true });
  } else {
    activate();
  }
})();
