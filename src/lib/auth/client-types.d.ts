export type AuthFetchOptions = RequestInit & {
	redirectOnUnauthorized?: boolean;
};

export type AuthSessionResponse = {
	ok?: boolean;
	/** Set by sign-in responses once the session cookie exists. */
	authenticated?: boolean;
	/** Only for non-browser callers; browsers get the session as an httpOnly cookie. */
	token?: string;
	redirect?: string;
	error?: string;
};

export type AuthSessionChangedDetail = {
	authenticated: boolean;
};
