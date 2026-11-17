"use client";

import { ContactAvatar } from "@/components/contacts/contact-avatar";
import { cn } from "@/lib/utils";
import type { RecipientSuggestionsProps } from "./recipient-suggestions-types";

/**
 * Contact suggestions under a To/Cc/Bcc field. Rendered as a listbox the parent
 * input owns; options keep focus on the input by preventing mousedown.
 */
export function RecipientSuggestions({
	id,
	mailboxId,
	suggestions,
	activeIndex,
	onPick,
	onHover,
}: RecipientSuggestionsProps) {
	return (
		<ul
			id={`${id}-suggestions`}
			role="listbox"
			className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto border border-line-strong bg-surface-raised py-1 text-fg shadow-lg"
		>
			{suggestions.map((suggestion, index) => (
				<li
					key={suggestion.email}
					id={`${id}-suggestion-${index}`}
					role="option"
					aria-selected={index === activeIndex}
					onMouseDown={(event) => {
						event.preventDefault();
						onPick(suggestion);
					}}
					onMouseEnter={() => onHover(index)}
					className={cn(
						"flex cursor-pointer items-center gap-2.5 border-s-2 px-3 py-2 text-start",
						index === activeIndex ? "border-accent bg-accent-subtle" : "border-transparent hover:bg-surface-hover",
					)}
				>
					<ContactAvatar
						mailboxId={mailboxId}
						address={suggestion.email}
						name={suggestion.displayName ?? ""}
						hasManagedAvatar={suggestion.hasAvatar}
						className="h-7 w-7 text-xs"
					/>
					<span className="min-w-0 flex-1">
						<span className="block truncate text-sm text-fg">
							{suggestion.displayName ?? suggestion.email}
						</span>
						{suggestion.displayName && (
							<span className="block truncate font-mono text-xs text-fg-subtle">{suggestion.email}</span>
						)}
					</span>
				</li>
			))}
		</ul>
	);
}
