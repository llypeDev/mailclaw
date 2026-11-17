// Run a command with extra environment variables, on every platform.
// `VAR=value command` in an npm script only works under a POSIX shell; npm runs scripts through
// cmd.exe on Windows. Usage, from package.json:
//   node scripts/with-env.mjs MAILCLAW_RUNTIME=node NODE_ENV=production -- node dist/server.mjs
// Leading NAME=value arguments are set on the child's environment; `--` before the command is optional.
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

/** Split argv into the variables to set and the command to run. */
export function parseWithEnvArgs(argv) {
	const env = {};
	let index = 0;
	for (; index < argv.length; index++) {
		const match = ASSIGNMENT.exec(argv[index]);
		if (!match) break;
		env[match[1]] = match[2];
	}
	if (argv[index] === "--") index++;
	return { env, command: argv.slice(index) };
}

/** Quote one argument for the platform shell; plain words stay as they are. */
export function quoteShellArg(arg, platform = process.platform) {
	if (/^[A-Za-z0-9_\-.,:/=@+]+$/.test(arg)) return arg;
	// cmd.exe hands the quoted string to the program, which splits it with the MSVC rules:
	// backslashes before a quote (or the closing quote) are doubled, the quote is escaped.
	if (platform === "win32") return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
	return `'${arg.replace(/'/g, "'\\''")}'`;
}

function main() {
	const { env, command } = parseWithEnvArgs(process.argv.slice(2));
	if (command.length === 0) {
		console.error("usage: node scripts/with-env.mjs NAME=value [NAME=value...] [--] command [args...]");
		process.exit(2);
	}
	// A shell resolves npm's node_modules/.bin shims (next.cmd, drizzle-kit.cmd on Windows). The
	// command line is joined here because passing args alongside `shell: true` is deprecated.
	const child = spawn(command.map((arg) => quoteShellArg(arg)).join(" "), {
		stdio: "inherit",
		shell: true,
		env: { ...process.env, ...env },
	});
	const signals = ["SIGINT", "SIGTERM"];
	const forward = (signal) => child.kill(signal);
	for (const signal of signals) process.on(signal, forward);
	child.on("error", (error) => {
		console.error(error.message);
		process.exit(1);
	});
	child.on("exit", (code, signal) => {
		if (!signal) process.exit(code ?? 1);
		// Exit the way the child did, so callers see the signal and not a plain failure.
		for (const name of signals) process.off(name, forward);
		process.kill(process.pid, signal);
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
