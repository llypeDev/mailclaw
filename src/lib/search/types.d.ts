export type ParsedSearchQuery = {
	/** Free text after operators are removed; matched against every indexed column. */
	text: string;
	from?: string;
	to?: string;
	subject?: string;
	hasAttachment?: boolean;
	read?: "read" | "unread";
	starred?: boolean;
	/** Inclusive lower bound on the message date, from `after:YYYY-MM-DD`. */
	after?: Date;
	/** Exclusive upper bound on the message date, from `before:YYYY-MM-DD`. */
	before?: Date;
	/** True when anything in the query needs the full-text index. */
	needsFullText: boolean;
};

export type SearchToken = { term: string; negate: boolean; phrase: boolean };

/**
 * An FTS5 MATCH expression and how to apply it: `include` keeps the rows it matches, `exclude` drops them.
 * A query made only of negations is `exclude`, because FTS5 has no expression that matches every row.
 */
export type FtsMatch = { mode: "include" | "exclude"; expression: string };
