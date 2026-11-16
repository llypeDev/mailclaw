// Software rasterizer + PNG/ICO encoder for the Mailclaw app icons.
// No dependencies: signed-distance shapes give analytic anti-aliasing at any size.
import zlib from "node:zlib";
import fs from "node:fs";

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const cover = (distance) => clamp(0.5 - distance, 0, 1);
const hex = (value) => [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
	const qx = Math.abs(px - cx) - (hw - r);
	const qy = Math.abs(py - cy) - (hh - r);
	return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
	const pax = px - ax;
	const pay = py - ay;
	const bax = bx - ax;
	const bay = by - ay;
	const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
	return Math.hypot(pax - bax * h, pay - bay * h);
}

// Variant "a": white envelope cut by three claw slashes that expose the plate.
// Variant "b": navy plate, white envelope, amber claw slashes laid on top.
const VARIANTS = {
	a: { plateTop: "#2563EB", plateBottom: "#7C3AED", slash: null },
	b: { plateTop: "#111A2E", plateBottom: "#0A1120", slash: "#F59E0B" },
};

function renderIcon(size, variant = "a") {
	const theme = VARIANTS[variant] ?? VARIANTS.a;
	const plateTop = hex(theme.plateTop);
	const plateBottom = hex(theme.plateBottom);
	const slashColor = theme.slash ? hex(theme.slash) : null;

	// Detail tiers: the claw has to stay readable, but below 48px the envelope carries the icon
	// and the slashes thin out so they do not eat it.
	const tier = size >= 96 ? "full" : size >= 48 ? "mid" : size >= 24 ? "small" : "tiny";
	const s = (v) => v * size;
	const radius = s(0.225);
	const body = {
		cx: s(0.5),
		cy: s(0.545),
		hw: s(tier === "full" ? 0.305 : tier === "mid" ? 0.32 : 0.34),
		hh: s(tier === "full" ? 0.215 : tier === "mid" ? 0.225 : 0.24),
		r: Math.max(s(0.055), size >= 48 ? 2 : 1.5),
	};
	const flap = {
		visible: true,
		a: [s(0.225), s(0.362)],
		b: [s(0.5), s(0.552)],
		c: [s(0.775), s(0.362)],
		radius: Math.max(s(0.026), size >= 96 ? 1.2 : size >= 48 ? 0.9 : 0.7),
	};
	// Detail tiers: three claw slashes down to 48px, fewer below that, where the envelope has to
	// carry the icon on its own.
	// Three slashes down to 96px, then fewer: below that they collide with the flap and the
	// envelope reads as noise.
	const slashTiers = {
		full: { count: 3, radius: Math.max(s(0.026), 0.9), spacing: Math.max(s(0.105), 2.2), halfLength: s(0.56), shift: s(0.045) },
		mid: { count: 2, radius: Math.max(s(0.018), 1), spacing: Math.max(s(0.125), 2.6), halfLength: s(0.58), shift: s(0.045) },
		small: { count: 1, radius: Math.max(s(0.034), 0.9), spacing: s(0.14), halfLength: s(0.6), shift: s(0.045) },
		tiny: { count: 0, radius: 0, spacing: 0, halfLength: 0, shift: 0 },
	};
	const slashes = slashTiers[tier];
	const offsets = Array.from({ length: slashes.count }, (_, index) => (index - (slashes.count - 1) / 2) * slashes.spacing);
	const angle = (-34 * Math.PI) / 180;
	const dx = Math.cos(angle);
	const dy = Math.sin(angle);
	const nx = -dy;
	const ny = dx;

	const pixels = Buffer.alloc(size * size * 4);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const px = x + 0.5;
			const py = y + 0.5;

			const plateAlpha = cover(sdRoundRect(px, py, size / 2, size / 2, size / 2 - 0.5, size / 2 - 0.5, radius));
			if (plateAlpha <= 0) continue;

			const t = py / size;
			let r = plateTop[0] + (plateBottom[0] - plateTop[0]) * t;
			let green = plateTop[1] + (plateBottom[1] - plateTop[1]) * t;
			let blue = plateTop[2] + (plateBottom[2] - plateTop[2]) * t;

			let envelope = cover(sdRoundRect(px, py, body.cx, body.cy, body.hw, body.hh, body.r));
			if (flap.visible && envelope > 0) {
				const flapDistance = Math.min(
					sdSegment(px, py, flap.a[0], flap.a[1], flap.b[0], flap.b[1]),
					sdSegment(px, py, flap.b[0], flap.b[1], flap.c[0], flap.c[1]),
				);
				envelope *= 1 - cover(flapDistance - flap.radius);
			}

			let slashHit = 0;
			for (const offset of offsets) {
				const cx = body.cx + nx * (offset - slashes.shift);
				const cy = body.cy + ny * (offset - slashes.shift);
				const distance = sdSegment(
					px,
					py,
					cx - dx * slashes.halfLength,
					cy - dy * slashes.halfLength,
					cx + dx * slashes.halfLength,
					cy + dy * slashes.halfLength,
				);
				slashHit = Math.max(slashHit, cover(distance - slashes.radius));
			}

			// The envelope is painted white everywhere the slashes do not cut it.
			const white = envelope * (1 - slashHit);
			r += (255 - r) * white;
			green += (255 - green) * white;
			blue += (255 - blue) * white;

			if (slashColor) {
				const painted = envelope * slashHit;
				r += (slashColor[0] - r) * painted;
				green += (slashColor[1] - green) * painted;
				blue += (slashColor[2] - blue) * painted;
			}

			const index = (y * size + x) * 4;
			pixels[index] = Math.round(clamp(r, 0, 255));
			pixels[index + 1] = Math.round(clamp(green, 0, 255));
			pixels[index + 2] = Math.round(clamp(blue, 0, 255));
			pixels[index + 3] = Math.round(plateAlpha * 255);
		}
	}
	return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	return value >>> 0;
});

function crc32(buffer) {
	let value = 0xffffffff;
	for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
	return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

function encodePNG(width, height, pixels) {
	const raw = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y += 1) pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // bit depth
	header[9] = 6; // colour type: RGBA
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", header),
		pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

function encodeICO(images) {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(images.length, 4);
	let offset = 6 + 16 * images.length;
	const entries = [];
	for (const { size, png } of images) {
		const entry = Buffer.alloc(16);
		entry[0] = size >= 256 ? 0 : size;
		entry[1] = size >= 256 ? 0 : size;
		entry.writeUInt16LE(1, 4);
		entry.writeUInt16LE(32, 6);
		entry.writeUInt32LE(png.length, 8);
		entry.writeUInt32LE(offset, 12);
		offset += png.length;
		entries.push(entry);
	}
	return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

function writeIcons(directory = "public", variant = "a") {
	fs.mkdirSync(directory, { recursive: true });
	for (const size of [48, 96, 192, 512]) {
		fs.writeFileSync(`${directory}/icon-${size}.png`, encodePNG(size, size, renderIcon(size, variant)));
	}
	const ico = [16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: encodePNG(size, size, renderIcon(size, variant)) }));
	fs.writeFileSync(`${directory}/favicon.ico`, encodeICO(ico));
	console.log(`icons written to ${directory}/ (variant ${variant})`);
}

function writeContactSheet(file, variant) {
	const width = 1024;
	const height = 800;
	const canvas = Buffer.alloc(width * height * 4, 0);
	for (let index = 0; index < width * height; index += 1) {
		canvas[index * 4] = 245;
		canvas[index * 4 + 1] = 245;
		canvas[index * 4 + 2] = 245;
		canvas[index * 4 + 3] = 255;
	}
	// Top row at 1:1, bottom row zoomed so the 48px and favicon sizes can be judged.
	const rows = [
		{ top: 8, items: [[512, 1], [192, 1], [96, 1]] },
		{ top: 540, items: [[48, 4], [32, 8], [16, 8]] },
	];
	for (const row of rows) {
		let cursor = 8;
		for (const [size, scale] of row.items) {
			const pixels = renderIcon(size, variant);
			const drawn = size * scale;
			for (let y = 0; y < drawn; y += 1) {
				for (let x = 0; x < drawn; x += 1) {
					const source = (Math.floor(y / scale) * size + Math.floor(x / scale)) * 4;
					const alpha = pixels[source + 3] / 255;
					if (alpha === 0) continue;
					const target = ((row.top + y) * width + cursor + x) * 4;
					for (let channel = 0; channel < 3; channel += 1) {
						canvas[target + channel] = Math.round(pixels[source + channel] * alpha + canvas[target + channel] * (1 - alpha));
					}
				}
			}
			cursor += drawn + 8;
		}
	}
	fs.writeFileSync(file, encodePNG(width, height, canvas));
	console.log(`contact sheet: ${file}`);
}

const [, , command, argument] = process.argv;
if (command === "preview") {
	writeContactSheet(`${argument ?? "."}/sheet-a.png`, "a");
	writeContactSheet(`${argument ?? "."}/sheet-b.png`, "b");
} else if (command === "write") {
	writeIcons(argument ?? "public", process.env.ICON_VARIANT ?? "a");
} else {
	console.log("usage: node scripts/generate-icons.mjs write [directory] | preview <directory>");
}
