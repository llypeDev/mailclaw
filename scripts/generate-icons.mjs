// Builds the app icon set and favicon from one piece of artwork (assets/icon.png).
// No dependencies: a small PNG codec, a rounded-plate compositor and a Lanczos resampler.
import zlib from "node:zlib";
import fs from "node:fs";

const SOURCE = "assets/icon.png";
const SIZES = [48, 96, 192, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PLATE_TOP = [255, 255, 255];
const PLATE_BOTTOM = [234, 240, 250];
const PLATE_RADIUS = 0.225;

// ---------- PNG decode (8-bit RGBA, non-interlaced) ----------

function decodePNG(file) {
	const buffer = fs.readFileSync(file);
	if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(`${file} is not a PNG`);
	let offset = 8;
	let width = 0;
	let height = 0;
	const idat = [];
	while (offset < buffer.length) {
		const length = buffer.readUInt32BE(offset);
		const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
		const data = buffer.subarray(offset + 8, offset + 8 + length);
		if (type === "IHDR") {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			const [depth, colour, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
			if (depth !== 8 || colour !== 6 || interlace !== 0) {
				throw new Error(`unsupported PNG: depth ${depth}, colour type ${colour}, interlace ${interlace}`);
			}
		} else if (type === "IDAT") {
			idat.push(data);
		} else if (type === "IEND") {
			break;
		}
		offset += 12 + length;
	}

	const raw = zlib.inflateSync(Buffer.concat(idat));
	const stride = width * 4;
	const pixels = Buffer.alloc(width * height * 4);
	let previous = Buffer.alloc(stride);
	for (let y = 0; y < height; y += 1) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const current = Buffer.from(line);
		for (let index = 0; index < stride; index += 1) {
			const left = index >= 4 ? current[index - 4] : 0;
			const up = previous[index];
			const upLeft = index >= 4 ? previous[index - 4] : 0;
			let value = current[index];
			if (filter === 1) value += left;
			else if (filter === 2) value += up;
			else if (filter === 3) value += (left + up) >> 1;
			else if (filter === 4) {
				const estimate = left + up - upLeft;
				const distanceLeft = Math.abs(estimate - left);
				const distanceUp = Math.abs(estimate - up);
				const distanceUpLeft = Math.abs(estimate - upLeft);
				value += distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft ? left : distanceUp <= distanceUpLeft ? up : upLeft;
			}
			current[index] = value & 0xff;
		}
		current.copy(pixels, y * stride);
		previous = current;
	}
	return { width, height, pixels };
}

// ---------- Resampling ----------

const LOBES = 4;

function lanczos(x) {
	if (x === 0) return 1;
	if (x <= -LOBES || x >= LOBES) return 0;
	const px = Math.PI * x;
	return (LOBES * Math.sin(px) * Math.sin(px / LOBES)) / (px * px);
}

function weights(sourceLength, targetLength) {
	const scale = targetLength / sourceLength;
	const support = scale < 1 ? LOBES / scale : LOBES;
	const table = [];
	for (let index = 0; index < targetLength; index += 1) {
		const centre = (index + 0.5) / scale - 0.5;
		const start = Math.max(0, Math.ceil(centre - support));
		const end = Math.min(sourceLength - 1, Math.floor(centre + support));
		const row = [];
		let total = 0;
		for (let sample = start; sample <= end; sample += 1) {
			const weight = lanczos((sample - centre) * (scale < 1 ? scale : 1));
			if (weight === 0) continue;
			row.push([sample, weight]);
			total += weight;
		}
		table.push(row.map(([sample, weight]) => [sample, weight / total]));
	}
	return table;
}

/** Resizes premultiplied RGBA. Both passes keep accumulation in floats. */
function resize(source, width, height, targetWidth, targetHeight) {
	const horizontal = new Float32Array(targetWidth * height * 4);
	const columns = weights(width, targetWidth);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < targetWidth; x += 1) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (const [sample, weight] of columns[x]) {
				const index = (y * width + sample) * 4;
				r += source[index] * weight;
				g += source[index + 1] * weight;
				b += source[index + 2] * weight;
				a += source[index + 3] * weight;
			}
			const out = (y * targetWidth + x) * 4;
			horizontal[out] = r;
			horizontal[out + 1] = g;
			horizontal[out + 2] = b;
			horizontal[out + 3] = a;
		}
	}

	const vertical = new Float32Array(targetWidth * targetHeight * 4);
	const rows = weights(height, targetHeight);
	for (let y = 0; y < targetHeight; y += 1) {
		for (let x = 0; x < targetWidth; x += 1) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (const [sample, weight] of rows[y]) {
				const index = (sample * targetWidth + x) * 4;
				r += horizontal[index] * weight;
				g += horizontal[index + 1] * weight;
				b += horizontal[index + 2] * weight;
				a += horizontal[index + 3] * weight;
			}
			const out = (y * targetWidth + x) * 4;
			vertical[out] = Math.min(255, Math.max(0, r));
			vertical[out + 1] = Math.min(255, Math.max(0, g));
			vertical[out + 2] = Math.min(255, Math.max(0, b));
			vertical[out + 3] = Math.min(255, Math.max(0, a));
		}
	}
	return vertical;
}

function premultiply(pixels, count) {
	const out = new Float32Array(count * 4);
	for (let index = 0; index < count; index += 1) {
		const alpha = pixels[index * 4 + 3] / 255;
		out[index * 4] = pixels[index * 4] * alpha;
		out[index * 4 + 1] = pixels[index * 4 + 1] * alpha;
		out[index * 4 + 2] = pixels[index * 4 + 2] * alpha;
		out[index * 4 + 3] = pixels[index * 4 + 3];
	}
	return out;
}

// ---------- Composition ----------

const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
	const qx = Math.abs(px - cx) - (hw - r);
	const qy = Math.abs(py - cy) - (hh - r);
	return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Crops to the artwork's visible pixels so the plate is not filled with the file's own margins. */
function trim(source, threshold = 8) {
	let left = source.width;
	let right = -1;
	let top = source.height;
	let bottom = -1;
	for (let y = 0; y < source.height; y += 1) {
		for (let x = 0; x < source.width; x += 1) {
			if (source.pixels[(y * source.width + x) * 4 + 3] <= threshold) continue;
			if (x < left) left = x;
			if (x > right) right = x;
			if (y < top) top = y;
			if (y > bottom) bottom = y;
		}
	}
	if (right < left || bottom < top) return source;
	const width = right - left + 1;
	const height = bottom - top + 1;
	const pixels = Buffer.alloc(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		source.pixels.copy(pixels, y * width * 4, ((y + top) * source.width + left) * 4, ((y + top) * source.width + left + width) * 4);
	}
	return { width, height, pixels };
}

/**
 * Artwork is drawn on a light plate so launchers and iOS do not have to invent a background;
 * below 64px the art grows so the mailbox does not shrink into mush.
 */
function compose(art, artWidth, artHeight, size, rounded = true) {
	const scale = size <= 32 ? 0.98 : size <= 64 ? 0.94 : 0.86;
	const target = Math.max(1, Math.round(size * scale));
	const fit = target / Math.max(artWidth, artHeight);
	const scaledWidth = Math.max(1, Math.round(artWidth * fit));
	const scaledHeight = Math.max(1, Math.round(artHeight * fit));
	const scaled = resize(art, artWidth, artHeight, scaledWidth, scaledHeight);
	const insetX = Math.round((size - scaledWidth) / 2);
	const insetY = Math.round((size - scaledHeight) / 2);

	const canvas = Buffer.alloc(size * size * 4);
	const radius = rounded ? size * PLATE_RADIUS : 0;
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const px = x + 0.5;
			const py = y + 0.5;
			const plate = clamp(0.5 - sdRoundRect(px, py, size / 2, size / 2, size / 2 - 0.5, size / 2 - 0.5, radius), 0, 1);
			const t = py / size;
			let r = PLATE_TOP[0] + (PLATE_BOTTOM[0] - PLATE_TOP[0]) * t;
			let g = PLATE_TOP[1] + (PLATE_BOTTOM[1] - PLATE_TOP[1]) * t;
			let b = PLATE_TOP[2] + (PLATE_BOTTOM[2] - PLATE_TOP[2]) * t;

			const ax = x - insetX;
			const ay = y - insetY;
			if (ax >= 0 && ay >= 0 && ax < scaledWidth && ay < scaledHeight) {
				const index = (ay * scaledWidth + ax) * 4;
				const alpha = scaled[index + 3] / 255;
				if (alpha > 0 && plate > 0) {
					const base = alpha * plate;
					r = r + (scaled[index] / alpha - r) * base;
					g = g + (scaled[index + 1] / alpha - g) * base;
					b = b + (scaled[index + 2] / alpha - b) * base;
				}
			}

			const out = (y * size + x) * 4;
			canvas[out] = Math.round(clamp(r, 0, 255));
			canvas[out + 1] = Math.round(clamp(g, 0, 255));
			canvas[out + 2] = Math.round(clamp(b, 0, 255));
			canvas[out + 3] = Math.round(plate * 255);
		}
	}
	return canvas;
}

function renderIcon(source, size, rounded = true) {
	const art = premultiply(source.pixels, source.width * source.height);
	return compose(art, source.width, source.height, size, rounded);
}

// ---------- PNG / ICO encode ----------

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
	// Adaptive per-row filtering: gradients and 3D shading compress far better with Paeth/Sub than
	// with no filter, which is the difference between a 300 KB and a 90 KB icon.
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	const previous = Buffer.alloc(stride);
	const current = Buffer.alloc(stride);
	for (let y = 0; y < height; y += 1) {
		pixels.copy(current, 0, y * stride, (y + 1) * stride);
		let bestFilter = 0;
		let bestScore = Infinity;
		let bestRow = null;
		for (let filter = 0; filter < 5; filter += 1) {
			const row = Buffer.alloc(stride);
			let score = 0;
			for (let index = 0; index < stride; index += 1) {
				const left = index >= 4 ? current[index - 4] : 0;
				const up = previous[index];
				const upLeft = index >= 4 ? previous[index - 4] : 0;
				let value = current[index];
				if (filter === 1) value -= left;
				else if (filter === 2) value -= up;
				else if (filter === 3) value -= (left + up) >> 1;
				else if (filter === 4) {
					const estimate = left + up - upLeft;
					const distanceLeft = Math.abs(estimate - left);
					const distanceUp = Math.abs(estimate - up);
					const distanceUpLeft = Math.abs(estimate - upLeft);
					value -= distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft ? left : distanceUp <= distanceUpLeft ? up : upLeft;
				}
				value &= 0xff;
				row[index] = value;
				score += value < 128 ? value : 256 - value;
			}
			if (score < bestScore) {
				bestScore = score;
				bestFilter = filter;
				bestRow = row;
			}
		}
		raw[y * (stride + 1)] = bestFilter;
		bestRow.copy(raw, y * (stride + 1) + 1);
		current.copy(previous);
	}
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

// ---------- Commands ----------

function writeIcons(directory = "public") {
	const source = trim(decodePNG(SOURCE));
	console.log(`source ${SOURCE}: ${source.width}x${source.height} after trim`);
	fs.mkdirSync(directory, { recursive: true });
	for (const size of SIZES) {
		// 192 and 512 are launcher and apple-touch icons: a square, fully opaque plate, because iOS
		// renders transparent corners black and every launcher applies its own mask.
		fs.writeFileSync(`${directory}/icon-${size}.png`, encodePNG(size, size, renderIcon(source, size, size < 192)));
	}
	const ico = ICO_SIZES.map((size) => ({ size, png: encodePNG(size, size, renderIcon(source, size)) }));
	fs.writeFileSync(`${directory}/favicon.ico`, encodeICO(ico));
	console.log(`icons written to ${directory}/ (${SIZES.join(", ")} and a ${ICO_SIZES.length}-size favicon)`);
}

function writeContactSheet(file) {
	const source = trim(decodePNG(SOURCE));
	const width = 1024;
	const height = 800;
	const canvas = Buffer.alloc(width * height * 4);
	for (let index = 0; index < width * height; index += 1) {
		canvas[index * 4] = 245;
		canvas[index * 4 + 1] = 245;
		canvas[index * 4 + 2] = 245;
		canvas[index * 4 + 3] = 255;
	}
	const rows = [
		{ top: 8, items: [[512, 1], [192, 1], [96, 1]] },
		{ top: 540, items: [[48, 4], [32, 8], [16, 8]] },
	];
	for (const row of rows) {
		let cursor = 8;
		for (const [size, scale] of row.items) {
			const pixels = renderIcon(source, size);
			const drawn = size * scale;
			for (let y = 0; y < drawn; y += 1) {
				for (let x = 0; x < drawn; x += 1) {
					const source_index = (Math.floor(y / scale) * size + Math.floor(x / scale)) * 4;
					const alpha = pixels[source_index + 3] / 255;
					if (alpha === 0) continue;
					const target = ((row.top + y) * width + cursor + x) * 4;
					for (let channel = 0; channel < 3; channel += 1) {
						canvas[target + channel] = Math.round(pixels[source_index + channel] * alpha + canvas[target + channel] * (1 - alpha));
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
if (command === "write") writeIcons(argument ?? "public");
else if (command === "preview") writeContactSheet(`${argument ?? "."}/sheet.png`);
else console.log("usage: node scripts/generate-icons.mjs write [directory] | preview <directory>");
