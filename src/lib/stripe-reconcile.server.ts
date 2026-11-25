import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { StripeBillingEvent } from "./stripe";

const monthly = { starter: 97, pro: 197, premium: 397 } as const;
type Admin = SupabaseClient<Database>;

export async function confirmPaidInvoice(admin: Admin, event: StripeBillingEvent) {
  if (event.event_type !== "invoice_paid" || event.reason || !event.academy_id || !event.subscription_id || !event.plan || !event.access_until || !event.customer_email) return;
  const now = new Date().toISOString();
  const { data: current, error: currentError } = await admin.from("stripe_subscription").select("id,access_until").eq("academy_id", event.academy_id).eq("verified", true).maybeSingle();
  if (currentError) throw currentError;
  const incomingWins = !current || current.id === event.subscription_id || !current.access_until || Date.parse(event.access_until) >= Date.parse(current.access_until);
  if (!incomingWins) return;
  if (current && current.id !== event.subscription_id) {
    const { error } = await admin.from("stripe_subscription").update({ verified: false, state: "canceled", updated_at: now }).eq("id", current.id);
    if (error) throw error;
  }
  const { error: subscriptionError } = await admin.from("stripe_subscription").upsert({
    id: event.subscription_id,
    academy_id: event.academy_id,
    customer_id: event.customer_id,
    customer_email: event.customer_email,
    price_id: event.price_id,
    plan: event.plan,
    state: "active",
    access_until: event.access_until,
    last_paid_until: event.access_until,
    verified: true,
    livemode: event.livemode,
    updated_at: now,
  }, { onConflict: "id" });
  if (subscriptionError) throw subscriptionError;
  const { error: academyError } = await admin.from("academy").update({
    plano: event.plan,
    valor_mensal: monthly[event.plan],
    status: "active",
  }).eq("id", event.academy_id);
  if (academyError) throw academyError;
  const { error: eventError } = await admin.from("stripe_event").upsert({
    identity: event.identity,
    event_type: event.event_type,
    subscription_id: event.subscription_id,
    customer_email: event.customer_email,
    price_id: event.price_id,
    plan: event.plan,
    access_until: event.access_until,
    invoice_id: event.invoice_id,
    charge_id: event.charge_id,
    invoice_status: event.invoice_status,
    amount: event.amount,
    currency: event.currency,
    reason: null,
    livemode: event.livemode,
    state: "applied",
    applied_at: now,
  }, { onConflict: "identity" });
  if (eventError) throw eventError;
}
