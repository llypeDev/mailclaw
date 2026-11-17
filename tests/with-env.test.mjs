import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseWithEnvArgs, quoteShellArg } from "../scripts/with-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "with-env.mjs");

test("leading NAME=value arguments become the environment, the rest is the command", () => {
	assert.deepEqual(parseWithEnvArgs(["A=1", "B=x=y", "--", "node", "C=3"]), {
		env: { A: "1", B: "x=y" },
		command: ["node", "C=3"],
	});
	assert.deepEqual(parseWithEnvArgs(["EMPTY=", "next", "build"]), { env: { EMPTY: "" }, command: ["next", "build"] });
	assert.deepEqual(parseWithEnvArgs(["node"]), { env: {}, command: ["node"] });
});

test("arguments are quoted for the platform shell only when needed", () => {
	assert.equal(quoteShellArg("--config=drizzle.config.pg.ts", "linux"), "--config=drizzle.config.pg.ts");
	assert.equal(quoteShellArg("dist/server.mjs", "win32"), "dist/server.mjs");
	assert.equal(quoteShellArg("it's here", "linux"), "'it'\\''s here'");
	assert.equal(quoteShellArg('say "hi"', "win32"), '"say \\"hi\\""');
	assert.equal(quoteShellArg("C:\\a dir\\", "win32"), '"C:\\a dir\\\\"');
});

test("the command runs with the variables set and its exit code is kept", () => {
	const probe = "process.exit(process.env.WITH_ENV_A === 'one two' && process.env.WITH_ENV_B === 'x' ? 7 : 3)";
	const result = spawnSync(process.execPath, [script, "WITH_ENV_A=one two", "WITH_ENV_B=x", "--", process.execPath, "-e", probe], {
		cwd: root,
		encoding: "utf8",
	});
	assert.equal(result.status, 7, result.stderr);
});

test("no command is a usage error", () => {
	const result = spawnSync(process.execPath, [script, "A=1"], { cwd: root, encoding: "utf8" });
	assert.equal(result.status, 2);
	assert.match(result.stderr, /usage/);
});
