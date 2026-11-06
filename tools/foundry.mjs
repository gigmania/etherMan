import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

// Resolve the pinned optional native package directly. The upstream npm wrapper
// does not propagate its child exit code, which can hide a failed test run.
export function foundryBinary(tool) {
  if (!["forge", "anvil"].includes(tool))
    throw new Error("Unsupported Foundry tool");
  const arch = process.arch === "x64" ? "amd64" : process.arch;
  const extension = process.platform === "win32" ? ".exe" : "";
  return require.resolve(
    `@foundry-rs/${tool}-${process.platform}-${arch}/bin/${tool}${extension}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [, , tool, ...args] = process.argv;
  const child = spawn(foundryBinary(tool), args, { stdio: "inherit" });
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
}
