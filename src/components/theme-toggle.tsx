"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "lambenti-theme";
type Theme = "light" | "dark";

function getPreferredTheme(): Theme {
  const storedTheme = window.localStorage.getItem(STORAGE_KEY);

  if (storedTheme === "dark" || storedTheme === "light") {
    return storedTheme;
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const preferredTheme = getPreferredTheme();
    applyTheme(preferredTheme);
    setIsDark(preferredTheme === "dark");
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) return;

    const theme: Theme = isDark ? "dark" : "light";
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [isDark, isReady]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      onClick={() => setIsDark((current) => !current)}
      className="fixed bottom-4 left-4 z-50 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-lg shadow-slate-900/10 transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-mint focus:ring-offset-2 lg:left-auto lg:right-4"
    >
      <span
        aria-hidden="true"
        className={`relative h-5 w-9 rounded-full transition-colors ${isDark ? "bg-mint" : "bg-slate-300"}`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${isDark ? "translate-x-4" : "translate-x-0"}`}
        />
      </span>
      <span>{isDark ? "Dark" : "Light"}</span>
    </button>
  );
}
