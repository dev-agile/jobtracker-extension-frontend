import { sendMessage } from "../api/messaging.js";

export function getAuth() {
  return sendMessage({ type: "GET_AUTH" });
}

export function login(email, password) {
  return sendMessage({ type: "LOGIN", payload: { email, password } });
}

export function logout() {
  return sendMessage({ type: "LOGOUT" });
}

export function previewInvite(token) {
  return sendMessage({ type: "PREVIEW_INVITE", payload: { token } });
}

export function acceptInvite(token, password, displayName) {
  return sendMessage({
    type: "ACCEPT_INVITE",
    payload: { token, password, displayName },
  });
}
