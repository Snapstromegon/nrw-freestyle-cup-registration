// Lets `node --test` import the frontend's TypeScript sources directly by
// transpiling `.ts` files with the project's TypeScript compiler. Node's
// built-in type stripping does not support enums, which `utils.ts` uses.
import { registerHooks } from "node:module";
import ts from "typescript";

registerHooks({
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
