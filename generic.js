// Generic mode: every website without a dedicated stylesheet.
//
// Finds the page's base background color, then marks every element painted
// in the same color as what's behind it with [data-fr-clear] so
// css/generic.css can make it transparent. Opaque headers, sidebars and
// columns in other colors, and neutral gray/white/black cards, become
// translucent panels [data-fr-panel], flipped [data-fr-flip] when they would
// otherwise end up light. Popups and anything
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
  // Gray, white or black: a surface color rather than a brand/accent color.
  const isNeutral = ({ r, g, b }) => Math.max(r, g, b) - Math.min(r, g, b) < 24;
  const POPUP_ROLES = /^(dialog|alertdialog|menu|listbox|tooltip)$/;
  const TRANSPARENT = 0.05;
  const CARD_ALPHA = 0.25;

  // A "read more" fade: a gradient from transparent to the color behind it,
  // laid over truncated text (e.g. Google's knowledge panel description).
  function isFade(el, behind) {
    const image = getComputedStyle(el).backgroundImage;
    if (!image.startsWith("linear-gradient(") || image.includes("url(")) return false;
    const stops = (image.match(/rgba?\([^)]*\)/g) || []).map(toRgba);
    return (
      stops.length >= 2 &&
      stops.some((c) => c.a < TRANSPARENT) &&
      stops.every((c) => c.a < TRANSPARENT || distance(c, behind) < COLOR_DISTANCE)
    );
  }

  // The fade el sits next to, within a few levels, if any: el is then the
  // opaque bar that carries a "Show more" button below the fade.
  function fadeBeside(el, behind) {
    for (let p = el.parentElement, i = 0; p && i < 4; p = p.parentElement, i++) {
      for (const sibling of p.children) {
        if (!sibling.contains(el) && isFade(sibling, behind)) return sibling;
      }
    }
    return null;
  }

  // The corner radius of a rounded child that fills el (e.g. a pill-shaped
  // "Show more" button on a square bar), so el's tint can follow its shape.
  function fillingRadius(el, rect) {
    let level = [...el.children];
    for (let depth = 0; depth < 3 && level.length; depth++) {
      for (const child of level) {
        const r = child.getBoundingClientRect();
        if (Math.abs(r.width - rect.width) > 4 || Math.abs(r.height - rect.height) > 4) continue;
        const radius = parseFloat(getComputedStyle(child).borderRadius);
        if (radius > 0) return `${Math.min(radius, rect.width / 2, rect.height / 2)}px`;
      }
      level = level.flatMap((child) => [...child.children]);
    }
    return null;
  }

  // What each element was classified as, so later passes don't re-read
  // backgrounds the extension itself has already changed.
  const classified = new WeakMap();

  // Fades whose content is masked. The mask only applies while the fade is
  // showing ([data-fr-fade-on] on its parent), so expanded text ("Show
  // more" clicked) is never hidden. Re-checked after every batch of changes.
  const fades = new Set();

  function updateFade(fade) {
    if (!fade.isConnected) {
      fades.delete(fade);
      return;
    }
    fade.parentElement.toggleAttribute("data-fr-fade-on", fade.getClientRects().length > 0);
  }

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
    } else if (!ctx.overlay && isFade(el, ctx.behind)) {
      // Instead of fading the cut-off text into the page color, fade the
      // text itself out to transparent: mask each in-flow sibling (the
      // content under the fade) from the fade's top to ~55% of the way down,
      // where the original gradient is nearly opaque.
      const fadeRect = rect;
      const contents = [];
      for (const sibling of el.parentElement.children) {
        if (sibling === el) continue;
        const position = getComputedStyle(sibling).position;
        if (position === "absolute" || position === "fixed") continue;
        const top = sibling.getBoundingClientRect().top;
        const start = Math.max(0, Math.round(fadeRect.top - top));
        contents.push({ el: sibling, start, end: start + Math.round(fadeRect.height * 0.55) });
      }
      return { kind: "fade", overlay, contents };
    }
    if (!color) return { kind: "none", overlay };

    // The bar under a fade: same tint as a card, rounded like the button on
    // it. Real popups never sit beside a fade, so they stay opaque.
    const fade =
      ctx.overlay &&
      !POPUP_ROLES.test(el.getAttribute("role") || "") &&
      distance(color, ctx.behind) < COLOR_DISTANCE &&
      fadeBeside(el, ctx.behind);
    if (fade) {
      const radius = fillingRadius(el, rect);
      return { kind: "panel", color, overlay, alpha: CARD_ALPHA, flip: false, radius };
    }

    // Same color as what's behind it (result boxes, cards, wrappers on the
    // page or on a panel): clearing it looks the same, and lets the
    // wallpaper through once what's behind it is cleared too. Popups stay
    // opaque so they remain readable over the content beneath them.
    if (!ctx.overlay && !overlay && !pinned && distance(color, ctx.behind) < COLOR_DISTANCE) {
      return { kind: "clear", color, overlay };
    }

    // Cards, info rows, list items in a neutral color of their own (e.g. the
    // facts rows in Google's knowledge panel): treated like panels so the
    // wallpaper tints through. Colored boxes (buttons, badges, alerts) and
    // popups keep their look.
    const card =
      !overlay && !pinned && isNeutral(color) && rect.width >= 120 && rect.height >= 32;

    // Headers, sidebars, columns, app shells in their own color: translucent
    // panel. Flip it if it would end up light: a light panel on a page that
    // isn't inverted, or a dark one on a page that is.
    if ((sized || card) && !ctx.overlay) {
      const endsLight = isLight(color) !== (pageInverted !== ctx.flipped);
      // Cards sit over smaller areas, so they can be more see-through.
      const alpha = sized ? 0.6 : CARD_ALPHA;
      return { kind: "panel", color, overlay, alpha, flip: endsLight && !ctx.flipped };
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
    } else if (result.kind === "fade") {
      el.setAttribute("data-fr-fade", "");
      for (const { el: content, start, end } of result.contents) {
        content.style.setProperty("--fr-mask-start", `${start}px`);
        content.style.setProperty("--fr-mask-end", `${end}px`);
        content.setAttribute("data-fr-fade-content", "");
      }
      fades.add(el);
      updateFade(el);
    } else if (result.kind === "panel") {
      const { r, g, b } = result.color;
      el.style.setProperty("--fr-panel", `rgba(${r}, ${g}, ${b}, ${result.alpha})`);
      el.setAttribute("data-fr-panel", "");
      if (result.radius) el.style.setProperty("border-radius", result.radius, "important");
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
    for (const fade of fades) updateFade(fade);
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
