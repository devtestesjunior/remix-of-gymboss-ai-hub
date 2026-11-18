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

Eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `charge.refunded`, `charge.dispute.created`.

Não há período gratuito. Checkout de assinatura cobra o cartão na contratação. Fatura zerada, status `trialing` ou valor diferente do plano na criação e na renovação não liberam acesso. A troca de plano no meio do ciclo pode ter valor proporcional. O acesso operacional passa a exigir uma assinatura confirmada com prazo pago; o catálogo de planos da academia continua editável antes disso.

Sem o segredo do webhook a rota responde 503 e não grava nada.

## Banco

`database/staged/0007_stripe_billing.sql` não entrou no journal do Drizzle. Aplique pelo fluxo autorizado de migration antes de cobrar de verdade. Até lá, o Checkout não consegue gravar o cliente nem liberar a academia.

Uma academia tem uma assinatura confirmada por vez. Pagamento com `academy_id` libera sozinho. E-mail ambíguo ou academia ausente fica em **Master → Assinaturas**. Reembolso e disputa encerram o acesso e um replay não desfaz isso. Falha de cobrança mantém o prazo já pago. O portal entra no lugar de um segundo checkout enquanto o período está aberto.

No Dashboard do Stripe, configure o Customer Portal para troca de cartão, cancelamento e consulta de faturas.
