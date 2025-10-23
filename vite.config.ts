import react from "@vitejs/plugin-react-swc";
import externalGlobals from "rollup-plugin-external-globals";
import { defineConfig } from "vite";
import { copyFileSync, existsSync } from "fs";
import { resolve } from "path";

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  return {
    define: {
      "process.env": {
        NODE_ENV: JSON.stringify(
          command === "build" ? "production" : "development"
        ),
      },
    },
    build: {
      lib: {
        entry: "src/main.ts",
        fileName: "index",
        formats: ["es"],
      },
      rollupOptions: {
        external: ["react", "valtio"],
      },
    },
    plugins: [
      react(), 
      externalGlobals({ react: "React", valtio: "Valtio" }),
      {
        name: 'copy-css',
        writeBundle() {
          // 复制CSS文件到dist目录
          if (existsSync('styles.css')) {
            copyFileSync('styles.css', resolve('dist', 'styles.css'));
            console.log('CSS文件已复制到dist目录');
          }
        }
      }
    ],
  };
});
