import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after, afterEach } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// src/lib/time: time zone names, wall-clock arithmetic across DST gaps and overlaps, the user's zone
// as the browser keeps it (localStorage, with a per-page cache), and recent days in a zone. Browser
// globals (window, localStorage, document) are stubbed per test and removed afterwards.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-time-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	stdin: {
		contents: `export * from "./src/lib/time/utils.ts"; export * from "./src/lib/time/client.ts";`,
		resolveDir: root,
		sourcefile: "time-test-entry.ts",
		loader: "ts",
	},
	outfile: join(outDir, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	logLevel: "silent",
});
const lib = await import(pathToFileURL(join(outDir, "entry.mjs")).href);

const iso = (date) => date.toISOString();

/** A browser-like global scope: window with localStorage and events, and optionally <html lang>. */
function stubBrowser({ stored = null, failingStorage = false, lang } = {}) {
	const values = new Map(stored === null ? [] : [["mailclaw-user-time-zone", stored]]);
	const events = [];
	const localStorage = {
		getItem(key) {
			if (failingStorage) throw new Error("SecurityError");
			return values.has(key) ? values.get(key) : null;
		},
		setItem(key, value) {
			if (failingStorage) throw new Error("QuotaExceededError");
			values.set(key, String(value));
		},
		removeItem(key) {
			if (failingStorage) throw new Error("SecurityError");
			values.delete(key);
		},
	};
	globalThis.window = { localStorage, dispatchEvent: (event) => events.push(event.type) };
	globalThis.localStorage = localStorage;
	if (lang !== undefined) globalThis.document = { documentElement: { lang } };
	lib.clearUserTimeZoneCache();
	return { values, events };
}

afterEach(() => {
	delete globalThis.window;
	delete globalThis.localStorage;
	delete globalThis.document;
	lib.clearUserTimeZoneCache();
});

test("time zone names are canonicalised, and anything unknown or empty is UTC", () => {
	assert.equal(lib.normalizeTimeZone("america/new_york"), "America/New_York");
	assert.equal(lib.normalizeTimeZone("Europe/Lisbon"), "Europe/Lisbon");
	assert.equal(lib.normalizeTimeZone("Mars/Olympus_Mons"), "UTC");
	for (const value of [null, undefined, ""]) assert.equal(lib.normalizeTimeZone(value), "UTC", String(value));
	// Cached answers stay the same on a second call.
	assert.equal(lib.normalizeTimeZone("america/new_york"), "America/New_York");
	assert.equal(lib.normalizeTimeZone("Mars/Olympus_Mons"), "UTC");

	assert.equal(lib.isValidTimeZone("Europe/Lisbon"), true);
	assert.equal(lib.isValidTimeZone("UTC"), true);
	assert.equal(lib.isValidTimeZone("Nowhere/Special"), false);
});

test("a request's zone comes from the caller, then ?timeZone=, then X-Time-Zone", () => {
	const plain = new Request("https://mail.example.com/api/stats");
	const query = new Request("https://mail.example.com/api/stats?timeZone=Asia/Tokyo", { headers: { "X-Time-Zone": "Europe/Paris" } });
	const header = new Request("https://mail.example.com/api/stats", { headers: { "X-Time-Zone": "europe/paris" } });
	assert.equal(lib.getRequestTimeZone(plain), "UTC");
	assert.equal(lib.getRequestTimeZone(query), "Asia/Tokyo");
	assert.equal(lib.getRequestTimeZone(header), "Europe/Paris");
	assert.equal(lib.getRequestTimeZone(query, "America/Sao_Paulo"), "America/Sao_Paulo");
	assert.equal(lib.getRequestTimeZone(query, null), "Asia/Tokyo", "a user without a saved zone falls back to the request");
	assert.equal(lib.getRequestTimeZone(new Request("https://x.example/?timeZone=Bogus/Zone")), "UTC");
});

test("zoned fields are the wall clock of the zone, carried in a UTC date", () => {
	const instant = new Date("2026-11-16T12:00:00.250Z");
	assert.equal(iso(lib.zonedDateFields(instant, "America/Sao_Paulo")), "2026-11-16T09:00:00.250Z");
	assert.equal(iso(lib.zonedDateFields(instant, "Asia/Kolkata")), "2026-11-16T17:30:00.250Z");
	assert.equal(iso(lib.zonedDateFields(instant, "UTC")), "2026-11-16T12:00:00.250Z");
	assert.equal(iso(lib.zonedDateFields(new Date("2026-12-31T23:30:00Z"), "Pacific/Auckland")), "2027-01-01T12:30:00.000Z", "the date rolls over with the zone");
	// Midnight is 00, never 24 (hourCycle h23).
	assert.equal(iso(lib.zonedDateFields(new Date("2026-11-16T05:00:00Z"), "America/New_York")), "2026-11-16T00:00:00.000Z");
});

test("wall-clock fields become an instant, moving forward over a DST gap and taking the earlier of a repeat", () => {
	const wall = (value) => new Date(`${value}Z`);
	assert.equal(iso(lib.dateFromZonedFields(wall("2026-11-16T09:00:00"), "America/Sao_Paulo")), "2026-11-16T12:00:00.000Z");
	assert.equal(iso(lib.dateFromZonedFields(wall("2026-07-01T12:00:00"), "Europe/Lisbon")), "2026-07-01T11:00:00.000Z");
	// New York springs forward on 2026-03-08: 02:30 does not exist and becomes 03:30 EDT.
	assert.equal(iso(lib.dateFromZonedFields(wall("2026-03-08T02:30:00"), "America/New_York")), "2026-03-08T07:30:00.000Z");
	// It falls back on 2026-11-01: 01:30 happens twice and the EDT one comes first.
	assert.equal(iso(lib.dateFromZonedFields(wall("2026-11-01T01:30:00"), "America/New_York")), "2026-11-01T05:30:00.000Z");

	for (const value of ["2026-01-15T08:45:00", "2026-06-15T23:59:00", "2026-11-01T03:00:00"]) {
		const instant = lib.dateFromZonedFields(wall(value), "America/New_York");
		assert.equal(iso(lib.zonedDateFields(instant, "America/New_York")), iso(wall(value)), value);
	}
});

test("recent days are whole local days, oldest first, and a DST day is 23 hours long", () => {
	const days = lib.recentZonedDays("America/New_York", 3, new Date("2026-03-09T12:00:00Z"));
	assert.deepEqual(days.map((day) => [day.date, iso(day.start), iso(day.end)]), [
		["2026-03-07", "2026-03-07T05:00:00.000Z", "2026-03-08T05:00:00.000Z"],
		["2026-03-08", "2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z"],
		["2026-03-09", "2026-03-09T04:00:00.000Z", "2026-03-10T04:00:00.000Z"],
	]);
	// Just after midnight UTC it is still the previous day in Sao Paulo.
	assert.deepEqual(lib.recentZonedDays("America/Sao_Paulo", 1, new Date("2026-11-17T01:00:00Z")).map((day) => day.date), ["2026-11-16"]);
	assert.deepEqual(lib.recentZonedDays("UTC", 0, new Date()), []);
});

test("on the server the user's zone is UTC and there is no display locale", () => {
	assert.equal(lib.getUserTimeZone(), "UTC");
	assert.equal(lib.getDisplayLocale(), undefined);
	assert.equal(iso(lib.parseUserDateTimeLocal("2026-11-16T09:30")), "2026-11-16T09:30:00.000Z");
	assert.equal(lib.formatUserDateTimeLocal(new Date("2026-11-16T09:30:45Z")), "2026-11-16T09:30");
});

test("datetime-local values must be real minutes", () => {
	for (const value of ["2026-02-30T10:00", "2026-11-16T24:00", "2026-11-16 09:30", "2026-11-16T09:30:00", "", "16/11/2026 09:30"]) {
		assert.equal(lib.parseUserDateTimeLocal(value), null, value);
	}
	assert.equal(iso(lib.parseUserDateTimeLocal("2028-02-29T00:00")), "2028-02-29T00:00:00.000Z");
});

test("in the browser the saved zone wins over the device and is cached until cleared", () => {
	const device = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	const browser = stubBrowser({ stored: JSON.stringify({ userId: "u1", timeZone: "asia/tokyo" }) });
	assert.equal(lib.getUserTimeZone(), "Asia/Tokyo");
	assert.equal(iso(lib.parseUserDateTimeLocal("2026-11-16T09:00")), "2026-11-16T00:00:00.000Z");
	assert.equal(lib.formatUserDateTimeLocal(new Date("2026-11-16T00:00:00Z")), "2026-11-16T09:00");

	browser.values.set("mailclaw-user-time-zone", JSON.stringify({ timeZone: "Europe/Paris" }));
	assert.equal(lib.getUserTimeZone(), "Asia/Tokyo", "cached for the page");
	lib.clearUserTimeZoneCache();
	assert.equal(lib.getUserTimeZone(), "Europe/Paris");

	for (const stored of [JSON.stringify({ timeZone: "Bogus/Zone" }), JSON.stringify({ timeZone: 5 }), "not json", "null"]) {
		browser.values.set("mailclaw-user-time-zone", stored);
		lib.clearUserTimeZoneCache();
		assert.equal(lib.getUserTimeZone(), device, stored);
	}
	browser.values.delete("mailclaw-user-time-zone");
	lib.clearUserTimeZoneCache();
	assert.equal(lib.getUserTimeZone(), device);

	stubBrowser({ failingStorage: true });
	assert.equal(lib.getUserTimeZone(), device, "blocked storage falls back to the device zone");
});

test("dates are formatted in the page's language and the user's zone", () => {
	stubBrowser({ stored: JSON.stringify({ timeZone: "America/Sao_Paulo" }), lang: "en-US" });
	assert.equal(lib.getDisplayLocale(), "en-US");
	const options = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
	assert.equal(lib.formatUserDate("2026-11-16T12:00:00Z", options), "09:00");
	assert.equal(lib.formatUserDate(new Date("2026-11-16T12:00:00Z"), { ...options, timeZone: "Asia/Kolkata" }), "17:30", "an explicit zone wins");
	assert.equal(lib.formatUserDate("2026-11-16T12:00:00Z", { month: "long", day: "numeric", timeZone: "UTC" }), "November 16");

	globalThis.document.documentElement.lang = "de";
	assert.equal(lib.formatUserDate("2026-11-16T12:00:00Z", { month: "long", day: "numeric", timeZone: "UTC" }), "16. November");
	globalThis.document.documentElement.lang = "";
	assert.equal(lib.getDisplayLocale(), undefined);
});

test("saving the preference stores it, drops the cache and tells the page once", () => {
	const browser = stubBrowser({ stored: JSON.stringify({ timeZone: "Asia/Tokyo" }) });
	assert.equal(lib.getUserTimeZone(), "Asia/Tokyo");

	lib.saveUserTimeZonePreference("u1", "Europe/Lisbon");
	assert.equal(browser.values.get("mailclaw-user-time-zone"), JSON.stringify({ userId: "u1", timeZone: "Europe/Lisbon" }));
	assert.deepEqual(browser.events, [lib.USER_TIME_ZONE_CHANGED_EVENT]);
	assert.equal(lib.getUserTimeZone(), "Europe/Lisbon");

	lib.saveUserTimeZonePreference("u1", "Europe/Lisbon");
	assert.equal(browser.events.length, 1, "saving the same value again changes nothing");

	lib.saveUserTimeZonePreference("u1", null);
	assert.equal(browser.events.length, 2);
	assert.equal(lib.getUserTimeZone(), Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", "no saved zone means the device zone");

	lib.clearUserTimeZonePreference();
	assert.equal(browser.values.has("mailclaw-user-time-zone"), false);
});

test("the preference survives storage that refuses to write", () => {
	const browser = stubBrowser({ failingStorage: true });
	assert.doesNotThrow(() => lib.saveUserTimeZonePreference("u1", "Asia/Tokyo"));
	assert.deepEqual(browser.events, [lib.USER_TIME_ZONE_CHANGED_EVENT], "the page still hears about the change");
	assert.doesNotThrow(() => lib.clearUserTimeZonePreference());
});
