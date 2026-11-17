"use client";

import { useRef } from "react";
import type { PointerEvent } from "react";
import type { ResizeHandleProps } from "./resize-handle-types";

export function ResizeHandle({ label, onResizeStart, onResize, onResizeEnd }: ResizeHandleProps) {
	const startX = useRef<number | null>(null);

	function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
		if (event.button !== 0) return;
		startX.current = event.clientX;
		event.currentTarget.setPointerCapture(event.pointerId);
		onResizeStart?.();
		event.preventDefault();
	}

	function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
		if (startX.current === null) return;
		onResize(event.clientX - startX.current);
	}

	function handlePointerEnd() {
		if (startX.current === null) return;
		startX.current = null;
		onResizeEnd?.();
	}

	// Kept (Orange's Splitter owns both panes; this is a lone edge handle). A 1px rule appears on hover and
	// turns accent while dragging, Orange's feedback for a grab target.
	return (
		<div
			role="separator"
			aria-label={label}
			aria-orientation="vertical"
			className="absolute inset-y-0 right-0 z-20 w-2 translate-x-1/2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors after:duration-150 hover:after:bg-line-strong active:after:bg-accent motion-reduce:after:transition-none"
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerEnd}
			onPointerCancel={handlePointerEnd}
		/>
	);
}
