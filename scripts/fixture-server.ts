import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
const root = process.cwd();
const dir = path.join(root, "data", "browser-fixture-app");
fs.mkdirSync(dir, { recursive: true });
function copy(source: string, target: string) {
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(source))
      copy(path.join(source, name), path.join(target, name));
  } else fs.copyFileSync(source, target);
}
for (const name of [
  "src",
  "tsconfig.json",
  "next-env.d.ts",
  "next.config.ts",
  "package.json",
])
  copy(path.join(root, name), path.join(dir, name));
if (!fs.existsSync(path.join(dir, "node_modules")))
  fs.symlinkSync(
    path.join(root, "node_modules"),
    path.join(dir, "node_modules"),
    "junction",
  );
fs.writeFileSync(
  path.join(dir, ".env"),
  fs
    .readFileSync(".env.example", "utf8")
    .replace("http://localhost:3000", "http://localhost:3001"),
);
const child = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/next/dist/bin/next"),
    "dev",
    "--webpack",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3001",
  ],
  {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  },
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code || 0));
