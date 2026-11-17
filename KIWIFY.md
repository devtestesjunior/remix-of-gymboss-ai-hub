# Kiwify — histórico

A venda de assinatura saiu da Kiwify. O checkout, o webhook e a revisão em Master passam a usar o Stripe. Este arquivo descreve a integração antiga, que permanece no código até o SQL do Stripe ser aplicado e a rota antiga ser retirada.

# Kiwify — activation and review

## Endpoint and pending setup

Implemented POST route: `/api/public/kiwify/webhook`.
Production host confirmed by project URL lookup: `https://gymboss-ai-command-center.lovable.app`.
The future production webhook address is `https://gymboss-ai-command-center.lovable.app/api/public/kiwify/webhook`.
**This implementation has not been published. Do not configure production delivery until a separately authorized publication makes this route live.**

After publication, register that address in Kiwify with triggers `compra_aprovada`, `compra_reembolsada`, `chargeback`, `subscription_renewed`, `subscription_late`, `subscription_canceled`.
Copy the webhook token from Kiwify directly into **Project Settings → Secrets**, name `KIWIFY_WEBHOOK_TOKEN`. It is currently absent. No token was generated, saved or requested in chat. Missing configuration returns HTTP 503 without processing. No other auth header is required.

Existing checkout links remain unchanged. Exact codes map Start `gNqK4eC` → `starter`, Pro `HHpoAGt` → `pro`, Elite `zbICqSC` → `premium`.

## Review and security

The provider signs raw bytes with HMAC-SHA1. Validation precedes JSON parsing; comparison is constant-time. No payloads, signatures, tokens, card data, names or phone numbers are stored/logged. Only the customer email and normalized billing identifiers/status/dates are stored.

Email matching unions distinct academies from owner_email and active owner/admin academy_user records. Zero/multiple matches remain pending and do not mutate tenants. A super administrator can select exactly one academy in **Master → Assinaturas Kiwify**, after independently verifying a real purchase and the recipient academy.

**Kiwify's Testar Webhook sends fictitious IDs using the same signed contract, without a guaranteed test flag. Therefore every new subscription requires that initial manual confirmation, even with one email match.** Recognized future events for the verified subscription synchronize automatically; customer/tenant changes remain pending. Explicit test flags and unknown event/status/checkout combinations cannot be confirmed through the review action.

Only one verified Kiwify subscription per academy is supported. Switching subscription IDs requires a separately designed retirement/replacement workflow; this implementation deliberately refuses a second association instead of guessing precedence.

Idempotency is `(order_id, webhook_event_type)`, falling back to `(subscription_id, webhook_event_type)`. Processing, event insertion, review and academy updates run atomically. Paid periods extend access; late keeps the existing paid-through deadline; cancellation keeps provider access_until; refund/chargeback revoke access immediately and subsequent cancellation/payment replays cannot undo terminal revocation.

Existing permissive tenant policies and role helpers are unchanged. Additional restrictive billing gates on operational tables enforce verified subscription expiry dynamically, without requiring a cron. Master access and public booking reads remain unchanged. Academy status is updated on events; after time-only expiry its stored status may still say active, but operational RLS access is denied. Billing review records are SELECT-only to super_admin; mutations are service-only RPCs. No academy/user/role creation occurs.

## Verification

`bun test src/lib/kiwify.test.ts src/lib/access-destination.test.ts src/lib/public-booking.test.ts src/lib/email-stub.server.test.ts`

SQL regression: run `KIWIFY_LOCAL_DB_TEST=1 bun test src/lib/kiwify.database.test.ts` only with a disposable PostgreSQL instance on `/tmp/kiwify/socket:55439`, user lovable, database postgres. It rolls back all fixtures and never uses managed connection variables. The temporary database must have an empty public schema and USAGE for PUBLIC. Never point it at application data.

Validated official signature vector, invalid signatures, exact mappings, normalized fields, direct HTTP responses, duplicate events, atomic rollback, ambiguous/unmatched emails, authorized review, late/cancellation deadlines, chargeback replay resistance, private grants and tenant/expiry isolation.
Authenticated live Master page verified empty on desktop/mobile; signed-in academy user redirected away from Master. No real Kiwify payment or production webhook delivery was tested because token/publication are pending. No new full security scan was requested or claimed.

Official references:
- https://docs.kiwify.com.br/api-reference/webhooks/receiving
- https://docs.kiwify.com.br/api-reference/webhooks/subscription-events