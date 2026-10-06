const DEFAULT_URL = chrome.runtime.getURL("images/background.jpg");
const TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SIDE = 3840;

const preview = document.getElementById("preview");
const label = document.getElementById("label");
const dropzone = document.getElementById("dropzone");
const input = document.getElementById("file");
const status = document.getElementById("status");

function setStatus(text, kind) {
  status.textContent = text;
  status.className = "status" + (kind ? " " + kind : "");
}

function showCurrent({ customBackground, customBackgroundUpdated }) {
  preview.src = customBackground || DEFAULT_URL;
  label.textContent = customBackground
    ? `Custom (uploaded ${new Date(customBackgroundUpdated).toLocaleString()})`
    : "Default";
}

// Scale down to MAX_SIDE, re-encode as WebP (also strips EXIF/location data).
async function normalize(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function handleFiles(files, extraNote = "") {
  const file = files[0];
  if (!file) return;
  if (!TYPES.includes(file.type)) {
    setStatus("That file type isn't supported. Use a PNG, JPEG or WebP image.", "error");
    return;
  }
  if (file.size > MAX_BYTES) {
    setStatus("That image is larger than 20 MB.", "error");
    return;
  }

  dropzone.classList.add("busy");
  setStatus("Processing…");
  try {
    const dataUrl = await normalize(file);
    const data = { customBackground: dataUrl, customBackgroundUpdated: Date.now() };
    await chrome.storage.local.set(data);
    showCurrent(data);
    setStatus("Background updated. Open tabs have been updated." + extraNote, "ok");
  } catch (err) {
    setStatus(`Couldn't use that image: ${err.message || err}`, "error");
  } finally {
    dropzone.classList.remove("busy");
  }
}

dropzone.addEventListener("click", () => input.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    input.click();
  }
});
input.addEventListener("change", () => {
  handleFiles(input.files);
  input.value = "";
});

dropzone.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag-over");
});
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag-over");
});
dropzone.addEventListener("dragleave", (e) => {
  if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove("drag-over");
});
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  const files = e.dataTransfer.files;
  handleFiles(files, files.length > 1 ? " (Only the first file was used.)" : "");
});

// Stop Chrome from opening a file dropped outside the drop zone.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

chrome.storage.local.get(["customBackground", "customBackgroundUpdated"]).then(showCurrent);
