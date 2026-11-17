# Stripe — assinatura da academia

Checkout hospedado no cartão, faturas da própria assinatura e portal do cliente. O acesso da academia continua saindo só do webhook assinado, nunca da página de sucesso.

## Segredos

Grave no ambiente, sem colocar no repositório:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_STARTER` — R$ 97/mês
- `STRIPE_PRICE_PRO` — R$ 197/mês
- `STRIPE_PRICE_PREMIUM` — R$ 397/mês

`APP_ORIGIN` é opcional. Sem ele, a URL de volta usa o host do pedido.

Webhook de produção, depois que a rota estiver publicada:

`https://gymboss-ai-command-center.lovable.app/api/public/stripe/webhook`

Eventos: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created`.

Sem o segredo do webhook a rota responde 503 e não grava nada.

## Banco

`database/staged/0007_stripe_billing.sql` não entrou no journal do Drizzle. Aplique pelo fluxo autorizado de migration antes de cobrar de verdade. Até lá, o Checkout não consegue gravar o cliente nem liberar a academia.

Uma academia tem uma assinatura confirmada por vez. Pagamento com `academy_id` libera sozinho. E-mail ambíguo ou academia ausente fica em **Master → Assinaturas**. Reembolso e disputa encerram o acesso e um replay não desfaz isso. Falha de cobrança mantém o prazo já pago. O portal entra no lugar de um segundo checkout enquanto o período está aberto.

No Dashboard do Stripe, configure o Customer Portal para troca de cartão, cancelamento e consulta de faturas.
