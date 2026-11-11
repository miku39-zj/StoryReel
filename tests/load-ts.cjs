const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const cache = new Map();
module.exports = function loadTs(relative) {
  const filename = path.resolve(__dirname, "..", relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  cache.set(filename, loaded);
  const baseRequire = loaded.require.bind(loaded);
  loaded.require = (request) => {
    const target = request.startsWith("@/")
      ? path.resolve(__dirname, "..", request.slice(2))
      : request.startsWith(".")
        ? path.resolve(path.dirname(filename), request)
        : null;
    if (target && fs.existsSync(target + ".ts")) return module.exports(target + ".ts");
    return baseRequire(request);
  };
  loaded._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
  return loaded.exports;
};
