import { test } from "node:test";
import { strict as assert } from "node:assert";
import { currentSaasPlan, forgetSaasPlan, normalizeStripe, planForPrice, priceIdForPlan, rememberSaasPlan, saasPlans, type SaasPlan } from "./stripe";
import { createStripeCheckout, createStripePortal } from "./stripe-api.server";

const prices = {
  STRIPE_PRICE_STARTER: "price_Start97",
  STRIPE_PRICE_PRO: "price_Pro197",
  STRIPE_PRICE_PREMIUM: "price_Elite397",
};
const academyId = "00000000-0000-4000-8000-000000000001";
const periodEnd = 1893456000;

function invoice(priceId: string, declared?: string) {
  return {
    id: "evt_plan",
    type: "invoice.paid",
    livemode: false,
    data: {
      object: {
        id: "in_1",
        customer: "cus_1",
        subscription: "sub_1",
        status: "paid",
        amount_paid: 9700,
        currency: "brl",
        lines: { data: [{ price: { id: priceId }, period: { end: periodEnd } }] },
        subscription_details: { metadata: { academy_id: academyId, ...(declared ? { plan: declared } : {}) } },
      },
    },
  };
}

test("Start, Pro and Elite each resolve to one Stripe price", () => {
  assert.deepEqual(saasPlans, ["starter", "pro", "premium"]);
  assert.equal(priceIdForPlan("starter", prices), "price_Start97");
  assert.equal(priceIdForPlan("pro", prices), "price_Pro197");
  assert.equal(priceIdForPlan("premium", prices), "price_Elite397");
  assert.equal(planForPrice("price_Start97", prices), "starter");
  assert.equal(planForPrice("price_Pro197", prices), "pro");
  assert.equal(planForPrice("price_Elite397", prices), "premium");
});

test("plan lookup rejects blank, padded and malformed price ids", () => {
  assert.equal(priceIdForPlan("starter", { STRIPE_PRICE_STARTER: "  price_Start97  " }), "price_Start97");
  assert.equal(priceIdForPlan("starter", { STRIPE_PRICE_STARTER: " " }), null);
  assert.equal(priceIdForPlan("pro", { STRIPE_PRICE_PRO: "price_bad-id" }), null);
  assert.equal(priceIdForPlan("premium", {}), null);
  assert.equal(planForPrice(null, prices), null);
  assert.equal(planForPrice("price_other", prices), null);
  assert.equal(planForPrice("price_Start97", { ...prices, STRIPE_PRICE_PRO: "price_Start97" }), "starter");
});

test("a paid invoice takes the plan from its price, not from an unverified label", () => {
  for (const [priceId, plan] of [["price_Start97", "starter"], ["price_Pro197", "pro"], ["price_Elite397", "premium"]] as const) {
    const event = normalizeStripe(invoice(priceId), prices);
    assert.equal(event.plan, plan);
    assert.equal(event.price_id, priceId);
    assert.equal(event.reason, null);
  }
  const unknown = normalizeStripe(invoice("price_other", "premium"), prices);
  assert.equal(unknown.plan, null);
  assert.equal(unknown.reason, "unknown_price");
  const mismatch = normalizeStripe(invoice("price_Start97", "pro"), prices);
  assert.equal(mismatch.plan, "starter");
  assert.equal(mismatch.reason, "plan_mismatch");
});

test("checkout can remember a selected plan and a paid invoice can confirm it", () => {
  const storage = new Map<string, string>();
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); },
    removeItem: (key) => { storage.delete(key); },
  } as Storage;
  try {
    assert.equal(currentSaasPlan(), undefined);
    rememberSaasPlan("premium");
    assert.equal(currentSaasPlan(), "premium");
    storage.set("gymspotter.saas-plan", "enterprise");
    assert.equal(currentSaasPlan(), undefined);
    rememberSaasPlan("starter");
    forgetSaasPlan();
    assert.equal(currentSaasPlan(), undefined);
  } finally {
    globalThis.sessionStorage = previous;
  }

  const selected = normalizeStripe({
    id: "evt_checkout",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { id: "cs_1", mode: "subscription", payment_status: "paid", customer: "cus_1", subscription: "sub_1", metadata: { academy_id: academyId, plan: "premium" } } },
  }, prices);
  assert.equal(selected.plan, "premium");
  assert.equal(selected.reason, null);
  const unlabeled = normalizeStripe({
    id: "evt_checkout_blank",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { id: "cs_2", mode: "subscription", payment_status: "paid", customer: "cus_1", subscription: "sub_1", metadata: { academy_id: academyId, plan: "enterprise" } } },
  }, prices);
  assert.equal(unlabeled.plan, null);
});

test("checkout and plan changes use the configured price without a Supabase key", async () => {
  const calls: { url: string; body: string; idempotency: string | null }[] = [];
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.STRIPE_SECRET_KEY;
  const previousPrices = {
    STRIPE_PRICE_STARTER: process.env.STRIPE_PRICE_STARTER,
    STRIPE_PRICE_PRO: process.env.STRIPE_PRICE_PRO,
    STRIPE_PRICE_PREMIUM: process.env.STRIPE_PRICE_PREMIUM,
  };
  process.env.STRIPE_SECRET_KEY = "sk_test_plans_only";
  Object.assign(process.env, prices);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, body: String(init?.body ?? ""), idempotency: headers.get("Idempotency-Key") });
    if (url.includes("/v1/prices/")) {
      const priceId = url.split("/").pop();
      return new Response(JSON.stringify({ id: priceId, product: `prod_${priceId}` }), { status: 200 });
    }
    if (url.endsWith("/v1/billing_portal/configurations")) return new Response(JSON.stringify({ id: "bpc_plans" }), { status: 200 });
    if (url.endsWith("/v1/billing_portal/sessions")) return new Response(JSON.stringify({ id: "bps_plans", url: "https://billing.stripe.com/p/session/test" }), { status: 200 });
    return new Response(JSON.stringify({ id: "cs_plans", url: "https://checkout.stripe.com/c/pay/cs_plans" }), { status: 200 });
  };
  try {
    delete process.env.STRIPE_PRICE_PRO;
    await assert.rejects(() => createStripeCheckout({ academyId, plan: "pro", customerId: "cus_1", origin: "http://127.0.0.1:8080" }), /Billing unavailable/);
    assert.equal(calls.length, 0);
    process.env.STRIPE_PRICE_PRO = prices.STRIPE_PRICE_PRO;

    for (const plan of saasPlans) {
      const url = await createStripeCheckout({ academyId, plan, customerId: "cus_1", origin: "http://127.0.0.1:8080" });
      assert.equal(url, "https://checkout.stripe.com/c/pay/cs_plans");
    }
    const expectedPrice: Record<SaasPlan, string> = { starter: "price_Start97", pro: "price_Pro197", premium: "price_Elite397" };
    saasPlans.forEach((plan, index) => {
      const body = new URLSearchParams(calls[index].body);
      assert.equal(body.get("line_items[0][price]"), expectedPrice[plan]);
      assert.equal(body.get("metadata[plan]"), plan);
      assert.equal(body.get("subscription_data[metadata][plan]"), plan);
      assert.equal(body.get("metadata[academy_id]"), academyId);
      assert.match(calls[index].idempotency ?? "", new RegExp(`^checkout-${academyId}-${plan}-`));
    });

    const portal = await createStripePortal("cus_1", "http://127.0.0.1:8080", { subscriptionId: "sub_1", itemId: "si_1", priceId: "price_Elite397" });
    assert.equal(portal, "https://billing.stripe.com/p/session/test");
    const configuration = new URLSearchParams(calls.find(call => call.url.endsWith("/v1/billing_portal/configurations"))?.body);
    assert.equal(configuration.get("features[subscription_update][products][0][prices][0]"), "price_Start97");
    assert.equal(configuration.get("features[subscription_update][products][1][prices][0]"), "price_Pro197");
    assert.equal(configuration.get("features[subscription_update][products][2][prices][0]"), "price_Elite397");
    const session = new URLSearchParams(calls.find(call => call.url.endsWith("/v1/billing_portal/sessions"))?.body);
    assert.equal(session.get("flow_data[subscription_update_confirm][items][0][price]"), "price_Elite397");
    assert.equal(process.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
    for (const [key, value] of Object.entries(previousPrices)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
