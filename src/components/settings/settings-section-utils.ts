// Shared classes for the settings pages, after Orange's settings template: sections ruled off by a 1px
// line, rows of settings in a 1px frame separated by 1px rules, labels on the start side and their
// control aligned on the end side.

/** A framed stack of setting rows, separated by 1px rules. */
export const SETTING_ROWS_CLASS = "divide-y divide-line border border-line bg-surface";

/** One setting: label and description on the start side, its control aligned on the end side. */
export const SETTING_ROW_CLASS = "flex items-center gap-4 px-4 py-4 sm:px-5";

/** The setting's name. */
export const SETTING_TITLE_CLASS = "block text-sm font-medium text-fg";

/** One or two lines under the setting's name. */
export const SETTING_DESCRIPTION_CLASS = "mt-1 block text-sm text-fg-muted";

/** An error under a row or a form. */
export const SETTING_ERROR_CLASS = "mt-2 text-sm text-danger-text";

/** A save confirmation or neutral status next to a form's button. */
export const SETTING_STATUS_CLASS = "text-sm text-fg-muted";

/** A small hint under a field. */
export const SETTING_HINT_CLASS = "text-xs leading-5 text-fg-muted";

/** Panels stacked into one frame: neighbouring 1px borders overlap into a single rule. */
export const SETTING_STACK_CLASS = "flex flex-col [&>*+*]:-mt-px";

/** A framed panel holding a form or a list. */
export const SETTING_PANEL_CLASS = "border border-line bg-surface p-4 sm:p-6";

/** A native file input styled as Orange's control. Inside the 40px control a 4px padding leaves room
 * for the picker button (20px line + 2 × 4px), so it sits centred instead of spilling onto the border. */
export const SETTING_FILE_INPUT_CLASS =
	"block w-full border border-line-control bg-surface px-1 py-1 text-sm text-fg transition-colors hover:border-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus file:me-3 file:border-0 file:bg-surface-active file:px-3 file:py-1 file:font-display file:text-sm file:font-semibold file:text-fg";
