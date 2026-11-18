# CA certificates

`supabase-prod-ca-2021.crt` is Supabase's public root CA ("Supabase Root 2021 CA", valid until
2031-04-26, SHA-256 fingerprint `80:70:25:AD:...:72:E6:CA:FA`). Supabase signs database and pooler
certificates with it, and Node does not trust it by default, so the API loads it via `DATABASE_CA`
to verify the connection instead of disabling verification. It is public, not a secret.

Source: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
(also under Supabase → Database settings → SSL).
