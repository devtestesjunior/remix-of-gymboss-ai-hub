import { billingOrigin, priceIdForPlan, type SaasPlan } from "./stripe";

const version = "2024-06-20";

async function stripeForm(path: string, body: URLSearchParams, idempotencyKey: string) {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("Billing unavailable");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": idempotencyKey, "Stripe-Version": version },
    body,
  });
  const payload: unknown = await response.json().catch(() => null);
  const id = typeof payload === "object" && payload && "id" in payload && typeof payload.id === "string" ? payload.id : null;
  const url = typeof payload === "object" && payload && "url" in payload && typeof payload.url === "string" ? payload.url : null;
  if (!response.ok || !id) {
    const error = typeof payload === "object" && payload && "error" in payload ? payload.error : null;
    const code = typeof error === "object" && error && "code" in error ? error.code : "unknown";
    console.error("[stripe] request failed", path, response.status, code);
    throw new Error("Billing unavailable");
  }
  return { id, url };
}

export async function createStripeCustomer(academyId: string, email: string) {
  const body = new URLSearchParams({ email, "metadata[academy_id]": academyId });
  const customer = await stripeForm("customers", body, `customer-${academyId}`);
  if (!/^cus_[A-Za-z0-9]+$/.test(customer.id)) throw new Error("Billing unavailable");
  return customer.id;
}

export async function createStripeCheckout(input: { academyId: string; plan: SaasPlan; customerId: string; origin: string }) {
  const price = priceIdForPlan(input.plan);
  if (!price) throw new Error("Billing unavailable");
  const success = `${input.origin}/app/configuracoes?aba=cobranca`;
  const cancel = `${input.origin}/app/configuracoes?aba=cobranca`;
  const body = new URLSearchParams({
    mode: "subscription",
    customer: input.customerId,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: success,
    cancel_url: cancel,
    client_reference_id: input.academyId,
    "metadata[academy_id]": input.academyId,
    "metadata[plan]": input.plan,
    "subscription_data[metadata][academy_id]": input.academyId,
    "subscription_data[metadata][plan]": input.plan,
    locale: "pt-BR",
    "payment_method_types[0]": "card",
  });
  const session = await stripeForm("checkout/sessions", body, `checkout-${input.academyId}-${input.plan}`);
  if (!session.url?.startsWith("https://checkout.stripe.com/")) throw new Error("Billing unavailable");
  return session.url;
}

async function stripeGet(path: string) {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("Billing unavailable");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${key}`, "Stripe-Version": version } });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object") throw new Error("Billing unavailable");
  return payload as Record<string, unknown>;
}

let portalConfiguration: string | null = null;

async function gymspotterPortalConfiguration() {
  if (portalConfiguration) return portalConfiguration;
  const prices = (["starter", "pro", "premium"] as const).map(plan => priceIdForPlan(plan)).filter((price): price is string => !!price);
  if (prices.length !== 3) throw new Error("Billing unavailable");
  const body = new URLSearchParams({
    "features[invoice_history][enabled]": "true",
    "features[payment_method_update][enabled]": "true",
    "features[subscription_cancel][enabled]": "true",
    "features[subscription_cancel][mode]": "at_period_end",
    "features[subscription_update][enabled]": "true",
    "features[subscription_update][default_allowed_updates][0]": "price",
    "features[subscription_update][proration_behavior]": "create_prorations",
  });
  for (const [index, price] of prices.entries()) {
    const priceRecord = await stripeGet(`prices/${price}`);
    const product = typeof priceRecord.product === "string" ? priceRecord.product : null;
    if (!product) throw new Error("Billing unavailable");
    body.set(`features[subscription_update][products][${index}][product]`, product);
    body.set(`features[subscription_update][products][${index}][prices][0]`, price);
    body.set(`features[subscription_update][products][${index}][adjustable_quantity][enabled]`, "false");
  }
  const created = await stripeForm("billing_portal/configurations", body, "gymspotter-portal-configuration");
  if (!/^bpc_[A-Za-z0-9]+$/.test(created.id)) throw new Error("Billing unavailable");
  portalConfiguration = created.id;
  return created.id;
}
export async function stripeSubscriptionItem(subscriptionId: string) {
  if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) throw new Error("Billing unavailable");
  const payload = await stripeGet(`subscriptions/${subscriptionId}`);
  const items = payload.items as { data?: { id?: string }[] } | undefined;
  const itemId = items?.data?.[0]?.id;
  if (!itemId || !/^si_[A-Za-z0-9]+$/.test(itemId)) throw new Error("Billing unavailable");
  return itemId;
}

export async function createStripePortal(customerId: string, origin: string, change?: { subscriptionId: string; itemId: string; priceId: string }) {
  const body = new URLSearchParams({ customer: customerId, return_url: `${origin}/app/configuracoes?aba=cobranca`, configuration: await gymspotterPortalConfiguration() });
  if (change) {
    body.set("flow_data[type]", "subscription_update_confirm");
    body.set("flow_data[subscription_update_confirm][subscription]", change.subscriptionId);
    body.set("flow_data[subscription_update_confirm][items][0][id]", change.itemId);
    body.set("flow_data[subscription_update_confirm][items][0][price]", change.priceId);
    body.set("flow_data[subscription_update_confirm][items][0][quantity]", "1");
    body.set("flow_data[after_completion][type]", "redirect");
    body.set("flow_data[after_completion][redirect][return_url]", `${origin}/app/configuracoes?aba=cobranca`);
  }
  const session = await stripeForm("billing_portal/sessions", body, `portal-${customerId}-${crypto.randomUUID()}`);
  if (!session.url?.startsWith("https://billing.stripe.com/")) throw new Error("Billing unavailable");
  return session.url;
}

export function originFromRequest(request: Request) {
  return billingOrigin(request.url);
}
