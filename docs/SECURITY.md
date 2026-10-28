# Security notes

- The game preview iframe intentionally omits `allow-same-origin`; treat preview code as untrusted.
- Do not add `allow-same-origin` to the preview sandbox without reviewing the isolation model.
- Firebase is not integrated in this prototype. When it is added, use deny-by-default Firestore/Storage rules, authenticated ownership checks, and App Check as an additional anti-abuse layer. Firebase web configuration is not a secret.
- Do not add service-account credentials or private API keys to this static site.
