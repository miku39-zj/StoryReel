# Theme — Design Tokens, CSS Variables & Tailwind Config

## Design System Overview

StoryReel uses a near-black cinematic dark theme with a single hot-pink accent (`#e91e8c`). There are no CSS custom properties (no `var(--*)`) — all tokens live directly in Tailwind config and are applied as inline styles or Tailwind classes.

---

## Tailwind Config — Full Source

File: `/Users/lizejun/newbee/tailwind.config.ts`

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: {
          bg: "#080808",
          node: "#1a1a1a",
          border: "#2a2a2a",
        },
        oii: {
          bg: "#080808",
          surface: "#141414",
          surface2: "#1a1a1a",
          pink: "#e91e8c",
          border: "rgba(255,255,255,0.06)",
          muted: "rgba(255,255,255,0.5)",
          pill: "rgba(255,255,255,0.08)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
```

---

## Global CSS — Full Source

File: `/Users/lizejun/newbee/app/globals.css`

```css
@import "@xyflow/react/dist/style.css";

@tailwind base;
@tailwind components;
@tailwind utilities;

html,
body {
  height: 100%;
  margin: 0;
  background: #080808;
  color: #ffffff;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

/* Star/dot texture overlay */
body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  background-image:
    radial-gradient(circle, rgba(255,255,255,0.35) 1px, transparent 1px),
    radial-gradient(circle, rgba(255,255,255,0.18) 1px, transparent 1px),
    radial-gradient(circle, rgba(255,255,255,0.10) 1px, transparent 1px);
  background-size: 180px 180px, 120px 120px, 90px 90px;
  background-position: 0 0, 60px 40px, 30px 80px;
}

/* Ensure content sits above star texture */
#__next,
main,
aside,
nav,
header,
.above-stars {
  position: relative;
  z-index: 1;
}

/* React Flow dark theme overrides */
.react-flow {
  background: #080808;
}

.react-flow__attribution {
  display: none;
}

/* Remove React Flow node default border/outline */
.react-flow__node,
.react-flow__node.selected,
.react-flow__node:focus,
.react-flow__node:focus-visible,
.react-flow__node:focus-within {
  outline: none !important;
  box-shadow: none !important;
  border: none !important;
}

.react-flow__controls {
  background: #141414;
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
}

.react-flow__controls-button {
  background: #141414;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.7);
  fill: rgba(255,255,255,0.7);
  transition: background 150ms ease;
}

.react-flow__controls-button:hover {
  background: #1a1a1a;
}

.react-flow__minimap {
  background: #141414;
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
}

.react-flow__edge-path {
  stroke: rgba(255,255,255,0.2);
  stroke-width: 2;
}

.react-flow__edge.selected .react-flow__edge-path,
.react-flow__edge:focus .react-flow__edge-path {
  stroke: #e91e8c;
  stroke-width: 3;
}

.react-flow__handle {
  width: 10px;
  height: 10px;
  background: rgba(255,255,255,0.2);
  border: 2px solid #080808;
}

.react-flow__handle:hover {
  background: #e91e8c;
}

.react-flow__background {
  background: #080808;
}
```

---

## Color Palette

| Token | Value | Usage |
|---|---|---|
| `oii-bg` / `canvas-bg` | `#080808` | Page background, React Flow canvas |
| `oii-surface` | `#141414` | Cards, panels, floating bars |
| `oii-surface2` / `canvas-node` | `#1a1a1a` | Node backgrounds, inputs |
| `canvas-border` | `#2a2a2a` | Heavier borders |
| `oii-pink` | `#e91e8c` | Primary accent — CTA buttons, selected state, logo gradient stop |
| Purple accent | `#9c27b0` | Logo gradient second stop |
| `oii-border` | `rgba(255,255,255,0.06)` | Subtle dividers, card borders |
| `oii-muted` | `rgba(255,255,255,0.5)` | Secondary text |
| `oii-pill` | `rgba(255,255,255,0.08)` | Pill/tag backgrounds |

### Node Accent Colors (canvas nodes only)

| Node type | Accent color |
|---|---|
| VideoNode | `#e91e8c` (pink) |
| ChoiceNode | `#f59e0b` (amber) |
| ConditionNode | `#8b5cf6` (purple) |
| MergeNode | `#22c55e` (green) |
| EndingNode | `#ef4444` (red) |

### Creation Pipeline Step Accents

| Step | Accent |
|---|---|
| story | `#3b82f6` (blue) |
| branch | `#f59e0b` (amber) |
| storyboard | `#8b5cf6` (purple) |
| visual | `#ec4899` (pink) |
| video | `#f97316` (orange) |
| validate | `#14b8a6` (teal) |

---

## Typography

- Font family: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- No custom web fonts loaded
- Typical sizes used in components: 9px (badges), 10–11px (meta/labels), 12–13px (UI text), 14px (body), 16px (player buttons), 32px+ (headings in EndingScreen)

---

## Background Texture

The global `body::before` applies a three-layer radial-gradient star/dot texture at z-index -1. All layout elements use `position: relative; z-index: 1` (or the `.above-stars` class) to sit above it.

---

## Shadow / Glow Patterns

- Panel/card shadow: `0 2px 12px rgba(0,0,0,0.5)`
- Pink CTA glow: `0 2px 8px rgba(233,30,140,0.4)`
- Selected node glow: `0 0 0 3px rgba(233,30,140,0.12), 0 4px 24px rgba(0,0,0,0.6)`
- Floating bar shadow: `0 2px 12px rgba(0,0,0,0.5)`

---

## Border Radius Conventions

- Large cards / nodes: `16px` (rounded-2xl)
- Smaller inputs / buttons: `8–10px` (rounded-lg / rounded-xl)
- Pills / tags: `9999px` (rounded-full)
- Logo icon: `8px` (rounded-[8px])
