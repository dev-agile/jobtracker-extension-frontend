import { acceptInvite, getAuth, login, logout, previewInvite } from "./api.js";

const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const loginForm = document.getElementById("loginForm");
const inviteForm = document.getElementById("inviteForm");
const authError = document.getElementById("authError");
const inviteError = document.getElementById("inviteError");
const invitePreview = document.getElementById("invitePreview");
const userEmailEl = document.getElementById("userEmail");
const logoutBtn = document.getElementById("logoutBtn");
const authTabs = document.querySelectorAll("[data-auth-tab]");
const authPanels = document.querySelectorAll("[data-auth-panel]");

let onAuthed = null;

function parseInviteToken(raw) {
  const value = (raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("invite");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  } catch {
    /* not a URL */
  }
  return value;
}

function showAuthError(message) {
  if (!authError) return;
  if (!message) {
    authError.classList.add("auth-error--hidden");
    authError.textContent = "";
    return;
  }
  authError.textContent = message;
  authError.classList.remove("auth-error--hidden");
}

function showInviteError(message) {
  if (!inviteError) return;
  if (!message) {
    inviteError.classList.add("auth-error--hidden");
    inviteError.textContent = "";
    return;
  }
  inviteError.textContent = message;
  inviteError.classList.remove("auth-error--hidden");
}

function setAuthTab(tab) {
  authTabs.forEach((btn) => {
    btn.classList.toggle("auth-tab--active", btn.dataset.authTab === tab);
  });
  authPanels.forEach((panel) => {
    panel.classList.toggle(
      "auth-panel--hidden",
      panel.dataset.authPanel !== tab
    );
  });
}

export function showAuthScreen() {
  authView?.classList.remove("auth-view--hidden");
  appView?.classList.add("app-view--hidden");
}

export function showAppScreen(user) {
  authView?.classList.add("auth-view--hidden");
  appView?.classList.remove("app-view--hidden");
  if (userEmailEl && user) {
    const label = user.display_name || user.email;
    userEmailEl.textContent = label;
  }
}

export function initAuthView(callbacks) {
  onAuthed = callbacks?.onAuthed;

  authTabs.forEach((btn) => {
    btn.addEventListener("click", () => setAuthTab(btn.dataset.authTab));
  });

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showAuthError("");
    const email = loginForm.email.value.trim();
    const password = loginForm.password.value;
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const result = await login(email, password);
      if (result.error) {
        showAuthError(result.error);
        return;
      }
      showAppScreen(result.user);
      onAuthed?.(result.user);
    } catch (err) {
      showAuthError(err.message || "Login failed");
    } finally {
      submitBtn.disabled = false;
    }
  });

  const inviteTokenInput = inviteForm?.querySelector("#inviteToken");
  let previewTimer = null;

  inviteTokenInput?.addEventListener("input", () => {
    clearTimeout(previewTimer);
    const token = parseInviteToken(inviteTokenInput.value);
    if (!token) {
      invitePreview.textContent = "";
      invitePreview.classList.add("auth-hint--hidden");
      return;
    }
    previewTimer = setTimeout(async () => {
      try {
        const preview = await previewInvite(token);
        if (preview.valid) {
          invitePreview.textContent = `Invite for ${preview.email}`;
          invitePreview.classList.remove("auth-hint--hidden");
        } else {
          const reason =
            preview.reason === "expired"
              ? "Invite expired"
              : preview.reason === "already_used"
                ? "Invite already used"
                : "Invalid invite";
          invitePreview.textContent = reason;
          invitePreview.classList.remove("auth-hint--hidden");
        }
      } catch {
        invitePreview.textContent = "";
        invitePreview.classList.add("auth-hint--hidden");
      }
    }, 400);
  });

  inviteForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showInviteError("");
    const token = parseInviteToken(inviteForm.inviteToken.value);
    const password = inviteForm.invitePassword.value;
    const confirm = inviteForm.invitePasswordConfirm.value;
    const displayName = inviteForm.displayName?.value?.trim() || "";

    if (password !== confirm) {
      showInviteError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      showInviteError("Password must be at least 8 characters");
      return;
    }
    if (!token) {
      showInviteError("Paste your invite link or token");
      return;
    }

    const submitBtn = inviteForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const result = await acceptInvite(token, password, displayName);
      if (result.error) {
        showInviteError(result.error);
        return;
      }
      showAppScreen(result.user);
      onAuthed?.(result.user);
    } catch (err) {
      showInviteError(err.message || "Could not accept invite");
    } finally {
      submitBtn.disabled = false;
    }
  });

  logoutBtn?.addEventListener("click", async () => {
    await logout();
    showAuthScreen();
    loginForm?.reset();
    inviteForm?.reset();
    showAuthError("");
    showInviteError("");
  });
}

export async function bootstrapAuth() {
  const { user } = await getAuth();
  if (user) {
    showAppScreen(user);
    return user;
  }
  showAuthScreen();
  return null;
}
