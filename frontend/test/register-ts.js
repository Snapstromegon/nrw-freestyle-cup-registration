// Lets `node --test` import the frontend's TypeScript sources directly by
// transpiling `.ts` files with the project's TypeScript compiler. Node's
// built-in type stripping does not support enums, which `utils.ts` uses.
import { registerHooks } from "node:module";
import ts from "typescript";

registerHooks({
  // Relative imports without an extension (`./utils`) mean the `.ts` file,
  // as for Vite.
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        error?.code === "ERR_MODULE_NOT_FOUND" &&
        specifier.startsWith(".") &&
        !/\.[a-z]+$/i.test(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".ts")) {
      return nextLoad(url, context);
    }
    const { source } = nextLoad(url, { ...context, format: "module" });
    const { outputText } = ts.transpileModule(source.toString(), {
      fileName: url,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
      },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});
