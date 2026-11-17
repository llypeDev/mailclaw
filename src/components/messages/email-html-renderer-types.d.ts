export interface EmailFrameCspOptions {
	/** The app origin, e.g. `https://mail.example`. */
	origin: string;
	/** Remote images load from the network, not through the proxy. */
	directRemote: boolean;
}

export interface EmailFrameDocumentOptions {
	/** Sanitized mail markup. */
	html: string;
	csp: string;
	style: string;
	dir: string;
	classes: Array<string | false | null | undefined>;
}

export type EmailFrameLinkAction =
	| { kind: "none" }
	| { kind: "external" }
	| { kind: "fragment"; id: string }
	| { kind: "handler"; href: string };

export interface EmailFrameMetrics {
	scrollHeight: number;
	offsetHeight: number;
	clientHeight: number;
}
