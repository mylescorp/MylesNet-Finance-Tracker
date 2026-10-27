"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

type Theme = "system" | "light" | "dark";

const storageKey = "mylesnet-theme";
const nextTheme: Record<Theme, Theme> = {
  system: "light",
  light: "dark",
  dark: "system",
};

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

  const label = theme === "system" ? "System theme" : `${theme[0]?.toUpperCase()}${theme.slice(1)} theme`;
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  function cycleTheme() {
    const updated = nextTheme[theme];
    if (updated === "system") window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, updated);
    applyTheme(updated);
    window.dispatchEvent(new Event("mylesnet-theme-change"));
  }

  return (
    <button
      className="icon-button theme-control"
      type="button"
      onClick={cycleTheme}
      aria-label={`${label}. Switch to ${nextTheme[theme]} theme.`}
      title={`${label} · click to change`}
    >
      <Icon size={17} aria-hidden="true" />
      <span className="theme-control-label">{label}</span>
    </button>
  );
}
