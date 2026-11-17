/**
 * Messages removed per request. They are deleted in batches of `MESSAGE_DELETE_BATCH` (90), each a
 * handful of queries and one bucket delete per kind of object, so two batches fit one request.
 */
export const EMPTY_FOLDER_BATCH_SIZE = 180;
