import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDatabaseConfig, withDatabase } from "@/db/with-database";
import { withStorage } from "@/lib/storage";
import { openFileBucket } from "./file-bucket";
import { openMailer, type Mailer, type MailerConfig } from "./mailer";
import { openAssets, openRateLimiter } from "./misc";
import { openQueue, type InProcessQueue } from "./queue";
import { RealtimeHubRegistry } from "./realtime";
import { openSqliteDatabase, type SqliteDatabase } from "./sqlite-database";
import type { NodeRuntime } from "./types";

function optional(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value || undefined;
}

/**
 * Plain string settings the app reads from `env` (see env.d.ts), copied verbatim
 * from the process environment when set. On Workers these are vars and secrets;
 * here anything missing from this list is silently ignored, so a new setting read
 * through `env` must be added. Deliberately an allowlist: the process environment
 * also holds PATH, credentials of other tools and DATABASE_*, which the database
 * layer reads from process.env itself and which must not change shape here.
 */
export const PASSTHROUGH_VARIABLES = [
	"AI_MODEL",
	"AI_BASE_URL",
	"AI_API_KEY",
	"B2_KEY_ID",
	"B2_APPLICATION_KEY",
	"B2_BUCKET",
	"B2_ENDPOINT",
	"S3_BUCKET",
	// AWS credentials for SES/SNS/S3 (src/lib/aws/config.ts) and the S3 storage fallback.
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_REGION",
	"AWS_DEFAULT_REGION",
	"RESEND_API_KEY",
	"CF_TOKEN",
	"CF_API_KEY",
	"CF_EMAIL",
	// Worker the zone's Email Routing rules target (the relay Worker when self-hosted).
	"CF_EMAIL_WORKER_NAME",
	"CF_ACCOUNT_ID",
	"TURNSTILE_SECRET_KEY",
	"GITHUB_UPDATE_TOKEN",
	"GITHUB_UPDATE_REF",
	"GITHUB_UPDATE_REPO",
	"GITHUB_UPDATE_SOURCE_REPO",
	"INBOUND_WEBHOOK_SECRET",
	"INBOUND_REQUIRE_SIGNED_HEADERS",
	"VAPID_PUBLIC_KEY",
	"VAPID_PRIVATE_KEY",
	"VAPID_SUBJECT",
	"APNS_KEY_ID",
	"APNS_TEAM_ID",
	"APNS_PRIVATE_KEY",
	"APNS_RELAY_URL",
	"SPAMHAUS_DQS_KEY",
	"ABUSECH_AUTH_KEY",
	"SPAM_DOMAIN_AGE_CHECK",
] as const;

export function passthroughVariables(source: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
	const values: Record<string, string | undefined> = {};
	for (const name of PASSTHROUGH_VARIABLES) values[name] = source[name]?.trim() || undefined;
	return values;
}

function mailerConfig(): MailerConfig {
	const smtp = optional("SMTP_URL");
	if (smtp) return { kind: "smtp", url: smtp };
	const accountId = optional("CF_ACCOUNT_ID");
	const token = optional("CF_TOKEN");
	if (accountId && token) return { kind: "cloudflare", accountId, token };
	return { kind: "none" };
}

/**
 * Assemble a `CloudflareEnv` for the Node runtime from environment variables
 * and local resources. Everything the app reaches through `getEnv()` is here,
 * so application code does not know which platform it runs on.
 */
export function createNodeRuntime(): NodeRuntime {
	const dataDir = resolve(optional("DATA_DIR") ?? "./data");
	mkdirSync(join(dataDir, "blobs"), { recursive: true });

	// DATABASE_URL moves the data to PostgreSQL, MySQL or libSQL; otherwise it lives in a local SQLite file.
	const database = getDatabaseConfig({}).driver === "d1" ? openSqliteDatabase(join(dataDir, "mailclaw.sqlite")) : undefined;
	const bucket = openFileBucket(join(dataDir, "blobs"));
	const mailer = openMailer(mailerConfig());
	// Each inbound job holds a whole raw message (up to SMTP_MAX_SIZE) while it is parsed,
	// so only a couple run at once; outbound sends and import chunks are lighter.
	const inboundQueue = openQueue("mailclaw-inbound", { kind: "inbound", concurrency: 2 });
	const outboundQueue = openQueue("mailclaw-outbound", { kind: "outbound", concurrency: 4 });
	const agentQueue = openQueue("mailclaw-agent", { kind: "agent", concurrency: 2 });
	const realtime = new RealtimeHubRegistry();
	const publicDir = resolve(optional("PUBLIC_DIR") ?? "./public");

	const env = {
		DB: database,
		BUCKET: bucket,
		EMAIL: mailer,
		INBOUND_QUEUE: inboundQueue,
		OUTBOUND_QUEUE: outboundQueue,
		AGENT_QUEUE: agentQueue,
		...passthroughVariables(),
		REALTIME: realtime.namespace(),
		ASSETS: openAssets(publicDir),
		IMAGES: undefined as unknown as CloudflareEnv["IMAGES"],
		WORKER_SELF_REFERENCE: undefined as unknown as CloudflareEnv["WORKER_SELF_REFERENCE"],
		LOGIN_RATE_LIMIT: openRateLimiter(20, 60),
		DEVICE_LOGIN_RATE_LIMIT: openRateLimiter(10, 60),
		AGENT_RATE_LIMIT: openRateLimiter(120, 60),
		S3_REGION: optional("S3_REGION") ?? optional("AWS_REGION"),
		S3_ACCESS_KEY_ID: optional("S3_ACCESS_KEY_ID") ?? optional("AWS_ACCESS_KEY_ID"),
		S3_SECRET_ACCESS_KEY: optional("S3_SECRET_ACCESS_KEY") ?? optional("AWS_SECRET_ACCESS_KEY"),
		// Marks the runtime for the few places that must behave differently.
		MAILCLAW_RUNTIME: "node",
		APP_URL: optional("APP_URL")?.replace(/\/$/, ""),
	} as unknown as CloudflareEnv;
	const storageEnv = withDatabase(withStorage(env));
	realtime.bindEnv(storageEnv);

	return {
		env: storageEnv,
		dataDir,
		database: database as unknown as SqliteDatabase | undefined,
		mailer: mailer as unknown as Mailer,
		inboundQueue: inboundQueue as unknown as InProcessQueue,
		outboundQueue: outboundQueue as unknown as InProcessQueue,
		agentQueue: agentQueue as unknown as InProcessQueue,
		realtime,
	};
}
