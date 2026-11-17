import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "mailclaw-sns-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

await build({
	entryPoints: [join(root, "src/lib/aws/sns-signature.ts")],
	outfile: join(dir, "sns.mjs"), bundle: true, platform: "node", format: "esm", logLevel: "silent",
});
const { verifySnsSignature, isValidSigningCertUrl } = await import(pathToFileURL(join(dir, "sns.mjs")).href);

// The key and a minimal self-signed X.509 certificate are made here with Node alone: no openssl
// binary (Windows does not ship one) and no private key in the repository.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const tlv = (tag, ...parts) => {
	const value = Buffer.concat(parts);
	const n = value.length;
	const length = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
	return Buffer.concat([Buffer.from([tag, ...length]), value]);
};
const sha256WithRsa = tlv(0x30, tlv(0x06, Buffer.from("2a864886f70d01010b", "hex")), tlv(0x05));
const name = tlv(0x30, tlv(0x31, tlv(0x30, tlv(0x06, Buffer.from("550403", "hex")), tlv(0x0c, Buffer.from("sns.test")))));
const tbs = tlv(0x30,
	tlv(0xa0, tlv(0x02, Buffer.from([2]))), // [0] version v3
	tlv(0x02, Buffer.from([1])), // serial
	sha256WithRsa,
	name, // issuer
	tlv(0x30, tlv(0x17, Buffer.from("000101000000Z")), tlv(0x17, Buffer.from("491231235959Z"))), // validity
	name, // subject
	publicKey.export({ type: "spki", format: "der" }),
);
const der = tlv(0x30, tbs, sha256WithRsa, tlv(0x03, Buffer.from([0]), createSign("RSA-SHA256").update(tbs).sign(privateKey)));
const loadCertificate = async () => der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength);

const base = { Type: "Notification", MessageId: "m-1", TopicArn: "arn:aws:sns:us-east-1:1:t", Message: "{}", Timestamp: new Date().toISOString(), SignatureVersion: "2", SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem" };
function sign(envelope, algorithm = "RSA-SHA256") {
	const signer = createSign(algorithm);
	signer.update(["Message", "MessageId", "Timestamp", "TopicArn", "Type"].map((key) => `${key}\n${envelope[key]}\n`).join(""));
	return signer.sign(privateKey, "base64");
}

test("accepts a correctly signed notification and rejects tampering", async () => {
	const envelope = { ...base, Signature: sign(base) };
	assert.equal(await verifySnsSignature(envelope, { loadCertificate }), true);
	assert.equal(await verifySnsSignature({ ...envelope, Message: "{\"x\":1}" }, { loadCertificate }), false);
	assert.equal(await verifySnsSignature({ ...envelope, TopicArn: "arn:other" }, { loadCertificate }), false);
});

test("accepts SignatureVersion 1 (SHA-1)", async () => {
	const v1 = { ...base, SignatureVersion: "1" };
	assert.equal(await verifySnsSignature({ ...v1, Signature: sign(v1, "RSA-SHA1") }, { loadCertificate }), true);
});

test("rejects stale timestamps and missing signatures", async () => {
	const old = { ...base, Timestamp: new Date(Date.now() - 3 * 86_400_000).toISOString() };
	assert.equal(await verifySnsSignature({ ...old, Signature: sign(old) }, { loadCertificate }), false);
	assert.equal(await verifySnsSignature(base, { loadCertificate }), false);
});

test("rejects foreign certificate URLs", () => {
	for (const url of ["http://sns.us-east-1.amazonaws.com/c.pem", "https://evil.example/c.pem", "https://sns.us-east-1.amazonaws.com.evil.example/c.pem", "https://sns.us-east-1.amazonaws.com:8443/c.pem", "https://sns.us-east-1.amazonaws.com/c.txt"]) {
		assert.equal(isValidSigningCertUrl(url), false, url);
	}
	assert.equal(isValidSigningCertUrl("https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc.pem"), true);
});
