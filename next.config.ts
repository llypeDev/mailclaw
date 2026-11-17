import type { NextConfig } from "next";
import { getSecurityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
	distDir: process.env.MAILCLAW_RUNTIME === "node" ? ".next-node" : undefined,
	turbopack: {
		root: import.meta.dirname,
		resolveAlias: process.env.MAILCLAW_RUNTIME === "node" ? {
			"cloudflare:workers": "./server/runtime/cloudflare-workers.ts",
		} : {},
	},
  allowedDevOrigins: ['mail.dev'],
	// Type errors fail the build; `npx tsc --noEmit` runs the same check locally.
	typescript: {
		ignoreBuildErrors: false,
	},
	// Native and server-only packages used by the self-hosted runtime; never bundle them.
	serverExternalPackages: ["better-sqlite3", "nodemailer", "smtp-server", "ws"],
	async headers() {
		return [
			{
				source: "/(.*)",
				headers: getSecurityHeaders(),
			},
		];
	},
};

export default nextConfig;
