-- The last TOTP time step accepted for the account (RFC 6238 section 5.2): a
-- code is accepted only for a later step, so one seen over a shoulder or
-- phished cannot sign in again within its ~90-second window.
ALTER TABLE "users" ADD COLUMN "totp_last_step" bigint;
