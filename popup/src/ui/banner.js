import { BANNER_HIDE_MS } from "../config.js";
import { banner } from "../dom.js";
import { clearBannerTimeout, setBannerTimeout } from "../state.js";

export function showBanner(message, variant = "info", persist = false) {
  banner.textContent = message;
  banner.classList.remove("banner--hidden", "banner--info", "banner--error");
  banner.classList.add(variant === "error" ? "banner--error" : "banner--info");

  clearBannerTimeout();
  if (!persist) {
    setBannerTimeout(
      window.setTimeout(() => {
        banner.classList.add("banner--hidden");
      }, BANNER_HIDE_MS)
    );
  }
}

export function hideBanner() {
  banner.classList.add("banner--hidden");
  clearBannerTimeout();
}
