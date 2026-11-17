import { z } from "zod";

export const saasPlans = ["starter", "pro", "premium"] as const;
export type SaasPlan = (typeof saasPlans)[number];
const priceEnv = { starter: "STRIPE_PRICE_STARTER", pro: "STRIPE_PRICE_PRO", premium: "STRIPE_PRICE_PREMIUM" } as const;
const identifier = z.string().min(1).max(255).regex(/^[a-zA-Z0-9_]+$/);
const uuid = z.string().uuid();

export function priceIdForPlan(plan: SaasPlan, env: NodeJS.ProcessEnv = process.env) {
  const value = env[priceEnv[plan]]?.trim();
  return value && /^price_[A-Za-z0-9]+$/.test(value) ? value : null;
}

export function planForPrice(priceId: string | null, env: NodeJS.ProcessEnv = process.env): SaasPlan | null {
  if (!priceId) return null;
  return saasPlans.find(plan => priceIdForPlan(plan, env) === priceId) ?? null;
}

export function rememberSaasPlan(plan: SaasPlan) {
  sessionStorage.setItem("gymspotter.saas-plan", plan);
}

export function currentSaasPlan(): SaasPlan | undefined {
  if (typeof sessionStorage === "undefined") return;
  const plan = sessionStorage.getItem("gymspotter.saas-plan");
  return plan === "starter" || plan === "pro" || plan === "premium" ? plan : undefined;
}

export function forgetSaasPlan() {
  sessionStorage.removeItem("gymspotter.saas-plan");
}

export function billingOrigin(requestUrl: string, configured = process.env.APP_ORIGIN) {
  if (configured) {
    const url = new URL(configured);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !local) throw new Error("Invalid billing origin");
    return url.origin;
  }
  return new URL(requestUrl).origin;
}

const stripeEvent = z.object({
  id: identifier,
  type: z.string().min(1).max(80),
  livemode: z.boolean(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }).passthrough(),
}).passthrough();

function text(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 255 ? value : null;
}
function id(value: unknown) {
  const parsed = text(typeof value === "object" && value && "id" in value ? (value as { id: unknown }).id : value);
  return parsed && identifier.safeParse(parsed).success ? parsed : null;
}
function emailOf(value: unknown) {
  const parsed = z.string().trim().email().max(254).transform(item => item.toLowerCase()).safeParse(value);
  return parsed.success ? parsed.data : null;
}
function academyOf(value: unknown) {
  return uuid.safeParse(value).success ? String(value) : null;
}
function unixIso(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function amountOf(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100_000_000 ? value : null;
}
function record(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function metadataOf(source: Record<string, unknown> | null) {
  return record(source?.metadata);
}
function metadataAcademy(source: Record<string, unknown> | null) {
  return academyOf(metadataOf(source)?.academy_id) ?? academyOf(source?.client_reference_id);
}
function metadataPlan(source: Record<string, unknown> | null): SaasPlan | null {
  const plan = metadataOf(source)?.plan;
  return plan === "starter" || plan === "pro" || plan === "premium" ? plan : null;
}
function priceFrom(source: Record<string, unknown> | null) {
  const price = record(source?.price);
  const pricing = record(record(source?.pricing)?.price_details);
  return id(price?.id) ?? id(pricing?.price);
}
function periodEnd(source: Record<string, unknown> | null) {
  const period = record(source?.period);
  return unixIso(source?.current_period_end) ?? unixIso(period?.end);
}

export function normalizeStripe(input: unknown, env: NodeJS.ProcessEnv = process.env) {
  const event = stripeEvent.parse(input);
  const object = event.data.object;
  const lines = record(object.lines);
  const line = Array.isArray(lines?.data) ? record(lines.data[0]) : null;
  const items = record(object.items);
  const item = Array.isArray(items?.data) ? record(items.data[0]) : null;
  const subscriptionDetails = record(object.subscription_details) ?? record(record(object.parent)?.subscription_details);
  const customerDetails = record(object.customer_details);
  const subscriptionId = id(object.subscription) ?? id(subscriptionDetails?.subscription) ?? (event.type.startsWith("customer.subscription.") ? id(object.id) : null);
  const priceId = priceFrom(line) ?? priceFrom(item);
  const pricedPlan = planForPrice(priceId, env);
  const declaredPlan = metadataPlan(object) ?? metadataPlan(subscriptionDetails);
  const plan = pricedPlan ?? (event.type === "checkout.session.completed" ? declaredPlan : null);
  const accessUntil = periodEnd(line) ?? periodEnd(item) ?? periodEnd(object);
  const invoiceId = event.type.startsWith("invoice.") ? id(object.id) : id(object.invoice);
  const chargeId = event.type === "charge.refunded" ? id(object.id) : id(object.charge);
  const mappedType = event.type === "invoice.paid" ? "invoice_paid"
    : event.type === "invoice.payment_failed" ? "invoice_payment_failed"
    : event.type === "charge.refunded" ? "charge_refunded"
    : event.type === "charge.dispute.created" ? "charge_disputed"
    : event.type === "checkout.session.completed" ? "checkout_completed"
    : event.type === "customer.subscription.deleted" ? "subscription_canceled"
    : event.type === "customer.subscription.updated" ? (object.cancel_at_period_end === true || ["canceled", "unpaid", "incomplete_expired"].includes(String(object.status)) ? "subscription_canceled" : object.status === "past_due" ? "invoice_payment_failed" : null)
    : null;
  const supported = mappedType !== null && (event.type !== "checkout.session.completed" || object.mode === "subscription");
  const unpaidCheckout = mappedType === "checkout_completed" && object.payment_status !== "paid" && object.payment_status !== "no_payment_required";
  const currency = text(object.currency)?.toLowerCase() ?? null;
  return {
    identity: event.id,
    event_type: mappedType ?? event.type,
    subscription_id: subscriptionId,
    customer_id: id(object.customer),
    customer_email: emailOf(object.customer_email) ?? emailOf(customerDetails?.email),
    academy_id: metadataAcademy(object) ?? metadataAcademy(subscriptionDetails),
    price_id: priceId,
    plan,
    access_until: mappedType === "subscription_canceled" && object.status === "unpaid" ? new Date(0).toISOString() : accessUntil,
    invoice_id: invoiceId,
    charge_id: chargeId,
    invoice_status: text(object.status),
    amount: amountOf(object.amount_paid) ?? amountOf(object.amount_refunded) ?? amountOf(object.amount),
    currency,
    livemode: event.livemode,
    reason: !supported ? "unsupported_event"
      : unpaidCheckout ? "unpaid_checkout"
      : currency !== null && currency !== "brl" ? "invalid_currency"
      : pricedPlan && declaredPlan && pricedPlan !== declaredPlan ? "plan_mismatch"
      : mappedType === "invoice_paid" && !pricedPlan ? "unknown_price"
      : mappedType === "invoice_paid" && !accessUntil ? "invalid_period"
      : (mappedType === "invoice_paid" || mappedType === "checkout_completed") && !subscriptionId ? "incomplete_subscription"
      : null,
  };
}

export type StripeBillingEvent = ReturnType<typeof normalizeStripe>;
