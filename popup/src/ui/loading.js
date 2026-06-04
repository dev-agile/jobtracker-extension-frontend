import { loader, refreshBtn } from "../dom.js";

export function setLoading(isLoading) {
  loader.classList.toggle("is-visible", isLoading);
  refreshBtn.disabled = isLoading;
}
