import { DEFAULT_STATUS, HIDE_TEXT_RE } from "../config.js";

export function toLabelCase(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function shouldHideText(value) {
  return HIDE_TEXT_RE.test(String(value || "").trim().toLowerCase());
}

export function statusClassName(status) {
  return "status-" + (status || DEFAULT_STATUS).toLowerCase();
}
