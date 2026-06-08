const FULLSCREEN_URL = chrome.runtime.getURL("popup/dist/index.html?fullscreen=1");

export function isFullscreenView() {
  return (
    document.documentElement.classList.contains("fullscreen") ||
    new URLSearchParams(window.location.search).get("fullscreen") === "1"
  );
}

export function initFullscreenView() {
  if (new URLSearchParams(window.location.search).get("fullscreen") === "1") {
    document.documentElement.classList.add("fullscreen");
  }
}

export function openFullscreenApp() {
  chrome.tabs.create({ url: FULLSCREEN_URL });
}
