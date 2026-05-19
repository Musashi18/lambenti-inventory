import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17202a",
        panel: "#ffffff",
        canvas: "#f4f7fb",
        mint: "#1b998b",
        coral: "#d95d39",
        gold: "#d8a23a"
      }
    }
  },
  plugins: []
};

export default config;

