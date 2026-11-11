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
        brand: {
          accent: "rgb(var(--sr-accent) / <alpha-value>)",
          "accent-hover": "rgb(var(--sr-accent-hover) / <alpha-value>)",
          ink: "rgb(var(--sr-ink) / <alpha-value>)",
        },
        canvas: {
          bg: "#101012",
          node: "#2e2e30",
          border: "#424244",
        },
        oii: {
          bg: "#101012",
          surface: "#222224",
          surface2: "#2e2e30",
          pink: "rgb(var(--sr-accent) / <alpha-value>)",
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
