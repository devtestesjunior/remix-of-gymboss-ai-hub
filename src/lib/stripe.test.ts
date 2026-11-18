import { createHmac } from "node:crypto";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { billingOrigin, normalizeStripe, planForPrice, priceIdForPlan } from "./stripe";
import { handleStripeWebhook, validStripeSignature } from "./stripe-webhook.server";

const secret = "whsec_test_secret";
const env = { STRIPE_PRICE_STARTER: "price_start", STRIPE_PRICE_PRO: "price_pro", STRIPE_PRICE_PREMIUM: "price_elite" };
const periodEnd = 1893456000;
const invoice = {
  id: "evt_paid", type: "invoice.paid", livemode: false,
  data: { object: { id: "in_1", customer: "cus_1", customer_email: "Owner@Example.invalid", subscription: "sub_1", status: "paid", amount_paid: 19700, currency: "brl", charge: "ch_1", lines: { data: [{ price: { id: "price_pro" }, period: { end: periodEnd } }] }, subscription_details: { metadata: { academy_id: "00000000-0000-4000-8000-000000000001", plan: "pro" } } } },
};

function header(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { timestamp, value: `t=${timestamp},v1=${signature}` };
}

test("price ids map Start, Pro and Elite and ignore unknown prices", () => {
  assert.equal(priceIdForPlan("pro", env), "price_pro");
  assert.equal(planForPrice("price_elite", env), "premium");
  assert.equal(planForPrice("price_other", env), null);
  assert.equal(priceIdForPlan("starter", {}), null);
});

test("invoice.paid keeps only normalized billing fields", () => {
  const event = normalizeStripe({ ...invoice, data: { object: { ...invoice.data.object, card: "private", customer_name: "private" } } }, env);
  assert.equal(event.event_type, "invoice_paid");
  assert.equal(event.plan, "pro");
  assert.equal(event.customer_email, "owner@example.invalid");
  assert.equal(event.access_until, "2030-01-01T00:00:00.000Z");
  assert.equal(event.reason, null);
  assert.equal(JSON.stringify(event).includes("private"), false);
});

test("failed payment, cancellation, refund and dispute do not extend a paid period", () => {
  const failed = normalizeStripe({ ...invoice, id: "evt_fail", type: "invoice.payment_failed" }, env);
  assert.equal(failed.event_type, "invoice_payment_failed");
  assert.equal(failed.reason, null);
  const canceled = normalizeStripe({ id: "evt_cancel", type: "customer.subscription.updated", livemode: true, data: { object: { id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: true, current_period_end: periodEnd, metadata: { academy_id: "00000000-0000-4000-8000-000000000001", plan: "pro" } } } }, env);
  assert.equal(canceled.event_type, "subscription_canceled");
  assert.equal(canceled.access_until, "2030-01-01T00:00:00.000Z");
  const unpaid = normalizeStripe({ id: "evt_unpaid", type: "customer.subscription.updated", livemode: true, data: { object: { id: "sub_1", status: "unpaid", current_period_end: periodEnd } } }, env);
  assert.equal(unpaid.access_until, "1970-01-01T00:00:00.000Z");
  assert.equal(normalizeStripe({ id: "evt_refund", type: "charge.refunded", livemode: true, data: { object: { id: "ch_1", invoice: "in_1", currency: "brl", amount_refunded: 19700 } } }, env).event_type, "charge_refunded");
  assert.equal(normalizeStripe({ id: "evt_dispute", type: "charge.dispute.created", livemode: true, data: { object: { id: "dp_1", charge: "ch_1", currency: "brl", amount: 19700 } } }, env).event_type, "charge_disputed");
});

test("checkout binds the academy without counting as a paid invoice", () => {
  const event = normalizeStripe({ id: "evt_checkout", type: "checkout.session.completed", livemode: false, data: { object: { id: "cs_1", mode: "subscription", payment_status: "paid", customer: "cus_1", subscription: "sub_1", client_reference_id: "00000000-0000-4000-8000-000000000001", customer_email: "owner@example.invalid", metadata: { academy_id: "00000000-0000-4000-8000-000000000001", plan: "starter" } } } }, env);
  assert.equal(event.event_type, "checkout_completed");
  assert.equal(event.plan, "starter");
  assert.equal(event.reason, null);
  assert.equal(normalizeStripe({ ...invoice, data: { object: { ...invoice.data.object, lines: { data: [{ price: { id: "price_start" }, period: { end: periodEnd } }] }, subscription_details: { metadata: { plan: "pro" } } } } }, env).reason, "plan_mismatch");
});

test("signature uses the raw body, rejects stale timestamps and missing secrets fail closed", async () => {
  const body = JSON.stringify(invoice);
  const signed = header(body);
  assert.equal(validStripeSignature(new TextEncoder().encode(body), signed.value, secret, signed.timestamp * 1000), true);
  assert.equal(validStripeSignature(new TextEncoder().encode(body + " "), signed.value, secret, signed.timestamp * 1000), false);
  assert.equal(validStripeSignature(new TextEncoder().encode(body), signed.value, secret, signed.timestamp * 1000 + 300_001), false);
  let calls = 0;
  const request = (signature: string, payload = body) => new Request("https://gymboss-ai-command-center.lovable.app/api/public/stripe/webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body: payload });
  assert.equal((await handleStripeWebhook(request(signed.value), undefined, async () => { calls++; })).status, 503);
  assert.equal((await handleStripeWebhook(request("t=1,v1=" + "0".repeat(64)), secret, async () => { calls++; })).status, 401);
  const ok = await handleStripeWebhook(request(signed.value), secret, async event => { assert.equal(event.identity, "evt_paid"); calls++; });
  assert.equal(ok.status, 204);
  assert.equal(calls, 1);
  assert.equal((await handleStripeWebhook(request(signed.value), secret, async () => { throw new Error("private"); })).status, 503);
});

test("paid invoices reject trials, zero amounts and a price that does not match the plan", () => {
  assert.equal(normalizeStripe({ ...invoice, data: { object: { ...invoice.data.object, amount_paid: 0 } } }, env).reason, "unpaid_invoice");
  assert.equal(normalizeStripe({ ...invoice, data: { object: { ...invoice.data.object, amount_paid: 100, billing_reason: "subscription_create" } } }, env).reason, "amount_mismatch");
  assert.equal(normalizeStripe({ ...invoice, data: { object: { ...invoice.data.object, amount_paid: 5000, billing_reason: "subscription_update" } } }, env).reason, null);
  const action = normalizeStripe({ ...invoice, id: "evt_action", type: "invoice.payment_action_required" }, env);
  assert.equal(action.event_type, "invoice_payment_failed");
  assert.equal(action.reason, null);
  const trialing = normalizeStripe({ id: "evt_trial", type: "customer.subscription.created", livemode: false, data: { object: { id: "sub_1", customer: "cus_1", status: "trialing", metadata: { academy_id: "00000000-0000-4000-8000-000000000001", plan: "pro" } } } }, env);
  assert.equal(trialing.reason, "unsupported_event");
  const removed = normalizeStripe({ id: "evt_deleted", type: "customer.subscription.deleted", livemode: true, created: periodEnd, data: { object: { id: "sub_1", customer: "cus_1", status: "canceled", ended_at: periodEnd, current_period_end: periodEnd + 86400 } } }, env);
  assert.equal(removed.event_type, "subscription_canceled");
  assert.equal(removed.access_until, "2030-01-01T00:00:00.000Z");
  const asyncFailed = normalizeStripe({ id: "evt_async", type: "checkout.session.async_payment_failed", livemode: false, data: { object: { id: "cs_2", mode: "subscription", payment_status: "unpaid", customer: "cus_1", subscription: "sub_1" } } }, env);
  assert.equal(asyncFailed.reason, "unpaid_checkout");
});

test("billing origin stays on the request host unless an explicit https origin is configured", () => {
  assert.equal(billingOrigin("http://localhost:8080/app"), "http://localhost:8080");
  assert.equal(billingOrigin("https://gymboss-ai-command-center.lovable.app/api", "https://gymboss-ai-command-center.lovable.app"), "https://gymboss-ai-command-center.lovable.app");
  assert.throws(() => billingOrigin("https://gymboss-ai-command-center.lovable.app", "http://evil.example"));
});
