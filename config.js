// Resolves the API folder relative to wherever this project is served from,
// so it works whether it's at http://localhost/Study%20Hub/ or a subfolder.
const baseApiUrl = (() => {
  const path = window.location.pathname;
  const dir = path.substring(0, path.lastIndexOf("/"));
  return `${dir}/api`;
})();

const themeStorageKey = "study-hub-theme";
let initialTheme = "light";
try {
  const savedTheme = localStorage.getItem(themeStorageKey);
  if (savedTheme === "light" || savedTheme === "dark")
    initialTheme = savedTheme;
} catch {}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(themeStorageKey, theme);
  } catch {}

  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    button.textContent = theme === "dark" ? "☼" : "☾";
    button.setAttribute("aria-label", `Switch to ${nextTheme} theme`);
    button.title = `Switch to ${nextTheme} theme`;
    button.setAttribute("aria-pressed", String(theme === "light"));
  });
}

applyTheme(initialTheme);
document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const nextTheme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
  });
});

const apiClient = {
  async post(url, formData) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      });
      const data = await res
        .json()
        .catch(() => ({ success: false, message: "Invalid server response." }));
      return { status: res.status, data };
    } catch (err) {
      return {
        status: 0,
        data: { success: false, message: "Network error: " + err.message },
      };
    }
  },

  async get(url) {
    try {
      const res = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
      });
      const data = await res
        .json()
        .catch(() => ({ success: false, message: "Invalid server response." }));
      return { status: res.status, data };
    } catch (err) {
      return {
        status: 0,
        data: { success: false, message: "Network error: " + err.message },
      };
    }
  },
};

// Small helper: build a FormData from a plain object, used all over app.js.
function toFormData(obj) {
  const fd = new FormData();
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined && v !== null) fd.append(k, v);
  });
  return fd;
}
