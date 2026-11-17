/**
 * The phone Compose button, drawn by both `FloatingComposer` and its lazy stand-in so the two look the
 * same: the page's primary action in the accent, square, floating with the overlay shadow.
 */
export const COMPOSE_FAB_CLASS =
	"fixed end-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex h-12 items-center gap-3 border border-accent-border bg-accent px-5 font-display text-base font-medium text-on-accent shadow-lg transition-colors hover:bg-accent-hover active:bg-accent-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:hidden";
