/**
 * Messages removed per statement. D1 allows 100 bound parameters, and `id IN (...)` binds one per
 * message; R2 deletes up to 1000 keys per call.
 */
export const MESSAGE_DELETE_BATCH = 90;
