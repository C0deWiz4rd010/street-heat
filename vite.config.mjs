import { defineConfig } from "vite";

export default defineConfig({
    base: "/street-heat/",
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    three: ["three"],
                },
            },
        },
    },
});
