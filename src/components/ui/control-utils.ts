// Orange's text-control look (its `.or-control`), as utilities so a call site's className still wins:
// 1px control border, surface background, 15px body text, accent border plus a 1px accent ring on focus,
// danger border when aria-invalid, and the subtle disabled/read-only fill.
export const controlClassName = [
	"w-full min-w-0 border border-line-control bg-surface px-3 text-[length:var(--or-text-md)] text-fg",
	"transition-[border-color,box-shadow,background-color] duration-150 ease-out",
	"placeholder:text-fg-subtle hover:border-fg-subtle",
	"focus:border-accent focus:shadow-[0_0_0_1px_var(--or-color-accent)] focus:outline-none",
	"aria-[invalid=true]:border-danger aria-[invalid=true]:focus:shadow-[0_0_0_1px_var(--or-color-danger)]",
	"disabled:cursor-not-allowed disabled:border-line disabled:bg-canvas-subtle disabled:text-fg-disabled",
	"[&[readonly]]:bg-canvas-subtle",
].join(" ");
