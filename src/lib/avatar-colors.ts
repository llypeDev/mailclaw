// Avatar fills are Orange's data-viz colours tinted into the surface, at two strengths, so they follow
// every theme (light, dark and high contrast) and the initials keep the theme's text colour.
const VIZ_TOKENS = ["--or-color-viz-1", "--or-color-viz-2", "--or-color-viz-3", "--or-color-viz-4", "--or-color-viz-5"];
const avatarColors = [24, 40].flatMap((strength) =>
	VIZ_TOKENS.map((token) => `color-mix(in oklab, var(${token}) ${strength}%, var(--or-color-surface))`),
);

export function getAvatarColorStyle(identity: string): { backgroundColor: string; color: string } {
	let hash = 0;
	const stableIdentity = identity.trim().toLowerCase();

	for (let i = 0; i < stableIdentity.length; i++) {
		hash = (Math.imul(hash, 31) + stableIdentity.charCodeAt(i)) | 0;
	}

	const background = avatarColors[(hash >>> 0) % avatarColors.length];
	return { backgroundColor: background, color: "var(--or-color-text)" };
}
