"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

type Theme = "system" | "light" | "dark";

const storageKey = "mylesnet-theme";
const themes: { id: Theme; label: string; Icon: typeof Sun }[] = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
  { id: "system", label: "System", Icon: Monitor },
];

function subscribe(onChange: () => void) {
  window.addEventListener("mylesnet-theme-change", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("mylesnet-theme-change", onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getTheme(): Theme {
  const stored = window.localStorage.getItem(storageKey);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function applyTheme(theme: Theme) {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
    return;
  }
  document.documentElement.dataset.theme = theme;
}

export function ThemeControl() {
  const theme = useSyncExternalStore<Theme>(subscribe, getTheme, (): Theme => "system");

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function selectTheme(updated: Theme) {
    if (updated === "system") window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, updated);
    applyTheme(updated);
    window.dispatchEvent(new Event("mylesnet-theme-change"));
  }

  return (
    <div className="appearance-selector" role="group" aria-label="Appearance">
      {themes.map(({ id, label, Icon }) => (
        <button
          key={id}
          className={`appearance-option${theme === id ? " appearance-option-active" : ""}`}
          type="button"
          onClick={() => selectTheme(id)}
          aria-label={`${label} theme`}
          aria-pressed={theme === id}
          title={`${label} theme`}
        >
          <Icon size={15} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
