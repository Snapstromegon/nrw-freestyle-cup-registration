import { rollupPluginHTML as html } from "@web/rollup-plugin-html";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import { copy } from "@web/rollup-plugin-copy";
import { writeFile } from "fs/promises";
import openapiTS, { astToString } from "openapi-typescript";
import { URL } from "url";
import consts from "./rollup-lib/consts.js";
import getGitStatus from "./rollup-lib/getGitStatus.js";

const generateOpenApiBindings = ({ input, output }) => {
  return {
    name: "generate-openapi-bindings",
    buildStart: {
      first: true,
      sequential: true,
      async handler() {
        this.addWatchFile(input);
        const ast = await openapiTS(new URL(input, import.meta.url));
        const code = astToString(ast);
        await writeFile(output, code);
      },
    },
  };
};

export default {
  input: "src/index.html",
  output: {
    dir: "../static",
    format: "es",
    sourcemap: globalThis.process.env.NODE_ENV !== "production",
  },
  plugins: [
    consts({
      git: getGitStatus,
    }),
    generateOpenApiBindings({
      input: "../openapi.json",
      output: "src/ts/bindings.d.ts",
    }),
    html({ publicPath: "/" }),
    typescript(),
    resolve(),
    commonjs(),
    copy({ patterns: "assets/**", rootDir: "src" }),
  ],
};
