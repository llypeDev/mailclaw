"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { NotesBody as NotesBodyComponent } from "./conversation-notes";

type NotesBodyType = typeof NotesBodyComponent;

let loaded: NotesBodyType | null = null;
let loading: Promise<NotesBodyType> | null = null;

/**
 * Loads `NotesBody` (the note editor and renderer, which bring the rich-text editor and the HTML
 * sanitiser: DOMPurify, css-tree, parse5) in its own chunk. A failed load is forgotten so the next
 * attempt retries.
 */
export function preloadNotesBody(): Promise<NotesBodyType> {
	loading ??= import("./conversation-notes")
		.then((module) => (loaded = module.NotesBody))
		.catch((error: unknown) => {
			loading = null;
			throw error;
		});
	return loading;
}

/**
 * `NotesBody` kept out of the message list's bundle: the list only needs it once a notes popover
 * opens. Renders `fallback` until the chunk has loaded (or if it fails to).
 */
export function LazyNotesBody({ bare = false, fallback = null }: { bare?: boolean; fallback?: ReactNode }) {
	const [Body, setBody] = useState<NotesBodyType | null>(() => loaded);

	useEffect(() => {
		if (Body) return;
		let cancelled = false;
		preloadNotesBody()
			.then((component) => {
				if (!cancelled) setBody(() => component);
			})
			// The popover keeps showing the preview; the next open retries.
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [Body]);

	return Body ? <Body bare={bare} /> : <>{fallback}</>;
}
