import { useRef, useState } from "react";
import type { TouchEvent } from "react";

/**
 * Closing the composer. On phones the popup is a bottom sheet: it slides away (and can be dragged
 * down to dismiss) and lets the page behind grow back before unmounting.
 */
export function useSheetDismiss(onClose: (() => void) | undefined, phoneSheet: boolean) {
	const [closing, setClosing] = useState(false);
	const dragStart = useRef<number | null>(null);
	const [dragY, setDragY] = useState(0);

	function dismiss() {
		if (!onClose) return;
		if (!phoneSheet || closing) { onClose(); return; }
		setClosing(true);
		window.setTimeout(onClose, 260);
	}

	const sheetDrag = phoneSheet ? {
		onTouchStart: (event: TouchEvent) => { dragStart.current = event.touches[0].clientY; },
		onTouchMove: (event: TouchEvent) => {
			if (dragStart.current !== null) setDragY(Math.max(0, event.touches[0].clientY - dragStart.current));
		},
		onTouchEnd: () => {
			dragStart.current = null;
			if (dragY > 110) dismiss();
			setDragY(0);
		},
	} : {};

	return { dismiss, closing, dragY, sheetDrag };
}
