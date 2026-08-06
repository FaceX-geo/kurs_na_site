CREATE INDEX IF NOT EXISTS session_user_created_cursor_idx
    ON identity.session (user_account_id, created_at DESC, id DESC);
