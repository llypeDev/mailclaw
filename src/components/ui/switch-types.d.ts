import type { ButtonHTMLAttributes } from "react";

export type SwitchProps = Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	// Orange's Switch owns the button's type and its submitted value (no call site set them).
	"onChange" | "role" | "type" | "value" | "defaultValue"
> & {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
};
