import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import openapiTS, { astToString, COMMENT_HEADER } from "openapi-typescript";
import { defineConfig } from "vite";
import consts from "./rollup-lib/consts.js";
import getGitStatus from "./rollup-lib/getGitStatus.js";

const openapiUrl = new URL("../openapi.json", import.meta.url);
const openapiPath = fileURLToPath(openapiUrl);
const bindingsPath = fileURLToPath(
  new URL("src/ts/bindings.d.ts", import.meta.url),
);
/** The backend for the dev server's proxy. */
const backend = "http://localhost:3000";

/**
 * Generates the TypeScript API bindings from openapi.json once at the start of
 * each build, with the same options and output as `npm run build:api`. In watch mode and
 * on the dev server they are regenerated when openapi.json changes.
 */
const openapiBindings = () => {
  const generate = async () => {
    const ast = await openapiTS(openapiUrl, { emptyObjectsUnknown: true });
    const code = `${COMMENT_HEADER}${astToString(ast)}`;
    const current = await readFile(bindingsPath, "utf8").catch(() => "");
    if (code !== current) {
      await writeFile(bindingsPath, code);
    }
  };
  return {
    name: "openapi-bindings",
    async buildStart() {
      this.addWatchFile(openapiPath);
      await generate();
    },
    configureServer(server) {
      server.watcher.add(openapiPath);
      server.watcher.on("change", (file) => {
        if (file === openapiPath) {
          generate().catch((e) => server.config.logger.error(e.message));
        }
      });
    },
  };
};

export default defineConfig(({ mode }) => ({
  root: "src",
  // Copied unchanged, e.g. src/public/assets/… is served as /assets/….
  publicDir: "public",
  plugins: [consts({ git: getGitStatus }), openapiBindings()],
  build: {
    outDir: "../../static",
    emptyOutDir: true,
    target: "esnext",
    sourcemap: mode !== "release",
  },
  server: {
    proxy: {
      "/api": backend,
      "/songs": backend,
      "/openapi.json": backend,
      "/swagger": backend,
    },
  },
}));
