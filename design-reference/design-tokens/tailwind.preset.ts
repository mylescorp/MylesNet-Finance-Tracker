import type { Config } from "tailwindcss";

// Shared preset for every app and the landing site. Colors are CSS variables so light and dark switch without extra classes.
// Hex based variables do not support Tailwind opacity modifiers such as bg-mn-card/50. Use a dedicated token instead.
const preset: Partial<Config> = {
  darkMode: ["selector", "[data-theme=\"dark\"]"],
  theme: {
    screens: {
      "sm": "640px",
      "md": "768px",
      "lg": "1024px",
      "xl": "1280px",
      "2xl": "1536px"
    },
    extend: {
      colors: {
        mn: {
          "bg": "var(--mn-bg)",
          "card": "var(--mn-card)",
          "side": "var(--mn-side)",
          "inset": "var(--mn-inset)",
          "ink": "var(--mn-ink)",
          "muted": "var(--mn-muted)",
          "subtle": "var(--mn-subtle)",
          "line": "var(--mn-line)",
          "line-strong": "var(--mn-line-strong)",
          "accent": "var(--mn-accent)",
          "accent-hover": "var(--mn-accent-hover)",
          "accent-bg": "var(--mn-accent-bg)",
          "on-accent": "var(--mn-on-accent)",
          "ok-bg": "var(--mn-ok-bg)",
          "ok-fg": "var(--mn-ok-fg)",
          "warn-bg": "var(--mn-warn-bg)",
          "warn-fg": "var(--mn-warn-fg)",
          "danger": "var(--mn-danger)",
          "danger-bg": "var(--mn-danger-bg)",
          "danger-fg": "var(--mn-danger-fg)",
          "info-bg": "var(--mn-info-bg)",
          "info-fg": "var(--mn-info-fg)",
          "scrim": "var(--mn-scrim)",
          "focus": "var(--mn-focus)",
          "chart-1": "var(--mn-chart-1)",
          "chart-2": "var(--mn-chart-2)",
          "chart-3": "var(--mn-chart-3)",
          "chart-4": "var(--mn-chart-4)",
          "chart-5": "var(--mn-chart-5)",
          "chart-grid": "var(--mn-chart-grid)"
        },
      },
      spacing: {
      "0": "var(--mn-space-0)",
      "0.5": "var(--mn-space-0_5)",
      "1": "var(--mn-space-1)",
      "2": "var(--mn-space-2)",
      "3": "var(--mn-space-3)",
      "4": "var(--mn-space-4)",
      "5": "var(--mn-space-5)",
      "6": "var(--mn-space-6)",
      "7": "var(--mn-space-7)",
      "8": "var(--mn-space-8)",
      "10": "var(--mn-space-10)",
      "12": "var(--mn-space-12)",
      "16": "var(--mn-space-16)",
      "20": "var(--mn-space-20)",
      "24": "var(--mn-space-24)",
      "32": "var(--mn-space-32)"
      },
      borderRadius: {
      "xs": "var(--mn-radius-xs)",
      "sm": "var(--mn-radius-sm)",
      "md": "var(--mn-radius-md)",
      "lg": "var(--mn-radius-lg)",
      "xl": "var(--mn-radius-xl)",
      "2xl": "var(--mn-radius-2xl)",
      "full": "var(--mn-radius-full)"
      },
      fontFamily: {
        sans: ["var(--mn-font-sans)"],
        serif: ["var(--mn-font-serif)"],
        mono: ["var(--mn-font-mono)"],
      },
      fontSize: {
      "eyebrow": ["var(--mn-type-eyebrow-size)", { lineHeight: "var(--mn-type-eyebrow-line)", fontWeight: "var(--mn-type-eyebrow-weight)", letterSpacing: "var(--mn-type-eyebrow-tracking)" }],
      "section-label": ["var(--mn-type-section-label-size)", { lineHeight: "var(--mn-type-section-label-line)", fontWeight: "var(--mn-type-section-label-weight)", letterSpacing: "var(--mn-type-section-label-tracking)" }],
      "caption": ["var(--mn-type-caption-size)", { lineHeight: "var(--mn-type-caption-line)", fontWeight: "var(--mn-type-caption-weight)", letterSpacing: "var(--mn-type-caption-tracking)" }],
      "body-sm": ["var(--mn-type-body-sm-size)", { lineHeight: "var(--mn-type-body-sm-line)", fontWeight: "var(--mn-type-body-sm-weight)", letterSpacing: "var(--mn-type-body-sm-tracking)" }],
      "body": ["var(--mn-type-body-size)", { lineHeight: "var(--mn-type-body-line)", fontWeight: "var(--mn-type-body-weight)", letterSpacing: "var(--mn-type-body-tracking)" }],
      "body-strong": ["var(--mn-type-body-strong-size)", { lineHeight: "var(--mn-type-body-strong-line)", fontWeight: "var(--mn-type-body-strong-weight)", letterSpacing: "var(--mn-type-body-strong-tracking)" }],
      "body-lg": ["var(--mn-type-body-lg-size)", { lineHeight: "var(--mn-type-body-lg-line)", fontWeight: "var(--mn-type-body-lg-weight)", letterSpacing: "var(--mn-type-body-lg-tracking)" }],
      "title-sm": ["var(--mn-type-title-sm-size)", { lineHeight: "var(--mn-type-title-sm-line)", fontWeight: "var(--mn-type-title-sm-weight)", letterSpacing: "var(--mn-type-title-sm-tracking)" }],
      "title": ["var(--mn-type-title-size)", { lineHeight: "var(--mn-type-title-line)", fontWeight: "var(--mn-type-title-weight)", letterSpacing: "var(--mn-type-title-tracking)" }],
      "metric": ["var(--mn-type-metric-size)", { lineHeight: "var(--mn-type-metric-line)", fontWeight: "var(--mn-type-metric-weight)", letterSpacing: "var(--mn-type-metric-tracking)" }],
      "heading": ["var(--mn-type-heading-size)", { lineHeight: "var(--mn-type-heading-line)", fontWeight: "var(--mn-type-heading-weight)", letterSpacing: "var(--mn-type-heading-tracking)" }],
      "serif-italic": ["var(--mn-type-serif-italic-size)", { lineHeight: "var(--mn-type-serif-italic-line)", fontWeight: "var(--mn-type-serif-italic-weight)", letterSpacing: "var(--mn-type-serif-italic-tracking)" }],
      "display-sm": ["var(--mn-type-display-sm-size)", { lineHeight: "var(--mn-type-display-sm-line)", fontWeight: "var(--mn-type-display-sm-weight)", letterSpacing: "var(--mn-type-display-sm-tracking)" }],
      "display": ["var(--mn-type-display-size)", { lineHeight: "var(--mn-type-display-line)", fontWeight: "var(--mn-type-display-weight)", letterSpacing: "var(--mn-type-display-tracking)" }],
      "display-lg": ["var(--mn-type-display-lg-size)", { lineHeight: "var(--mn-type-display-lg-line)", fontWeight: "var(--mn-type-display-lg-weight)", letterSpacing: "var(--mn-type-display-lg-tracking)" }]
      },
      boxShadow: {
        popover: "var(--mn-shadow-popover)",
        menu: "var(--mn-shadow-menu)",
        focus: "var(--mn-focus-ring)",
      },
      zIndex: {
      "base": "var(--mn-z-base)",
      "sticky": "var(--mn-z-sticky)",
      "sidebar": "var(--mn-z-sidebar)",
      "topbar": "var(--mn-z-topbar)",
      "dropdown": "var(--mn-z-dropdown)",
      "drawer": "var(--mn-z-drawer)",
      "modal": "var(--mn-z-modal)",
      "toast": "var(--mn-z-toast)",
      "tooltip": "var(--mn-z-tooltip)",
      "impersonation": "var(--mn-z-impersonation)"
      },
      transitionDuration: {
        fast: "var(--mn-dur-fast)",
        base: "var(--mn-dur-base)",
        slow: "var(--mn-dur-slow)",
        slower: "var(--mn-dur-slower)",
      },
      transitionTimingFunction: {
        standard: "var(--mn-ease-standard)",
        enter: "var(--mn-ease-enter)",
        exit: "var(--mn-ease-exit)",
      },
      width: { sidebar: "var(--mn-sidebar-w)", "sidebar-collapsed": "var(--mn-sidebar-w-collapsed)", menu: "var(--mn-menu-w)", "side-sheet": "var(--mn-side-sheet-w)" },
      height: { topbar: "var(--mn-topbar-h)", "bottom-nav": "var(--mn-bottom-nav-h)", btn: "var(--mn-btn-h)", input: "var(--mn-input-h)" },
      maxWidth: { content: "var(--mn-content-max)", landing: "var(--mn-landing-container)", "landing-narrow": "var(--mn-landing-container-narrow)" },
      minHeight: { touch: "var(--mn-touch-min)" },
    },
  },
};

export default preset;
