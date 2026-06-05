import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts: ["3449-2a09-bac5-426f-2664-00-3d3-1.ngrok-free.app"],
    },
  },
});
