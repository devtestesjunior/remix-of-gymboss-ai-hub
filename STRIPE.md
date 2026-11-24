# Stripe — assinatura da academia

Checkout hospedado no cartão, faturas da própria assinatura e portal do cliente. O acesso da academia continua saindo só do webhook assinado, nunca da página de sucesso.

## Segredos

Estas variáveis são só do servidor. Não use o prefixo `VITE_` e não as grave no `.env` versionado.

No computador local, coloque em `.env.local`, que já está no `.gitignore`. No Lovable, coloque nos segredos do projeto, no ambiente do servidor:

- `STRIPE_SECRET_KEY` — chave secreta de teste (`sk_test_...`) ou de produção (`sk_live_...`). O Checkout e o portal leem só esta chave.
- `STRIPE_WEBHOOK_SECRET` — segredo de assinatura do endpoint. Teste e produção usam segredos diferentes.
- `STRIPE_PRICE_STARTER` — `price_1Uca3W2K6BggOvSMuNUSu0dx`, Start, R$ 97/mês.
- `STRIPE_PRICE_PRO` — `price_1Uca3Z2K6BggOvSMaOSSsV6G`, Pro, R$ 197/mês.
- `STRIPE_PRICE_PREMIUM` — `price_1Uca3b2K6BggOvSMjuDuEYBo`, Elite, R$ 397/mês.

`APP_ORIGIN` é opcional. Se existir, precisa ser `https` fora de `localhost` e `127.0.0.1`. Sem ele, a URL de volta usa o host do pedido.

O webhook e o vínculo do cliente também precisam de `SUPABASE_SERVICE_ROLE_KEY` no mesmo ambiente de servidor. Essa chave não entra no navegador.

Webhook de produção, depois que a rota estiver publicada:

`https://gymboss-ai-command-center.lovable.app/api/public/stripe/webhook`

Eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `charge.refunded`, `charge.dispute.created`.

O endpoint de teste está ativo, mas sem versão de API fixa. O Stripe não permite alterar essa versão sem criar outro endpoint e outro segredo. Os eventos saem na versão padrão da conta, `2026-10-28.endive`. O processamento lê a assinatura, o preço e o fim do período tanto nesse formato quanto no formato `2024-06-20` usado nas chamadas do Checkout.

Não há período gratuito. Checkout de assinatura cobra o cartão na contratação. Fatura zerada, status `trialing` ou valor diferente do plano na criação e na renovação não liberam acesso. A troca de plano no meio do ciclo pode ter valor proporcional. O acesso operacional passa a exigir uma assinatura confirmada com prazo pago; o catálogo de planos da academia continua editável antes disso.

Sem o segredo do webhook a rota responde 503 e não grava nada.

## Banco

`database/staged/0007_stripe_billing.sql` não entrou no journal do Drizzle. Aplique uma vez, como dono da migration, dentro de uma transação. Não desligue o RLS, não conceda escrita a `anon` ou `authenticated` e não rode o script com o papel do navegador. Até a aplicação, o Checkout não consegue gravar o cliente nem liberar a academia.

Uma academia tem uma assinatura confirmada por vez. Pagamento com `academy_id` libera sozinho. E-mail ambíguo ou academia ausente fica em **Master → Assinaturas**. Reembolso e disputa encerram o acesso e um replay não desfaz isso. Falha de cobrança mantém o prazo já pago. O portal entra no lugar de um segundo checkout enquanto o período está aberto.

No Dashboard do Stripe, configure o Customer Portal para troca de cartão, cancelamento e consulta de faturas.
