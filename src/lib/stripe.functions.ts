import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { priceIdForPlan, saasPlans } from "./stripe";

const input = z.object({ academyId: z.string().uuid(), plan: z.enum(saasPlans), intent: z.enum(["manage", "subscribe"]) }).strict();

export const openStripeBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => input.parse(value))
  .handler(async ({ data, context }) => {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("A cobrança precisa da chave de serviço do Supabase no ambiente local.");
    const { data: roles, error: roleError } = await context.supabase.from("user_roles").select("role,academy_id").eq("user_id", context.userId);
    if (roleError || !roles?.some(role => role.academy_id === data.academyId && role.role === "admin")) throw new Error("Acesso exclusivo do administrador da academia.");
    const { data: academy, error: academyError } = await context.supabase.from("academy").select("owner_email").eq("id", data.academyId).maybeSingle();
    const email = academy?.owner_email?.trim().toLowerCase();
    if (academyError || !email) throw new Error("Não foi possível identificar a academia.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { originFromRequest, createStripeCustomer, createStripeCheckout, createStripePortal, stripeSubscriptionItem } = await import("./stripe-api.server");
    const origin = originFromRequest(getRequest());
    const { data: subscription, error: subscriptionError } = await supabaseAdmin.from("stripe_subscription").select("id,state,access_until,verified").eq("academy_id", data.academyId).eq("verified", true).maybeSingle();
    if (subscriptionError) throw new Error("A cobrança ainda não está disponível.");
    const { data: customer, error: customerError } = await supabaseAdmin.from("stripe_customer").select("customer_id").eq("academy_id", data.academyId).maybeSingle();
    if (customerError) throw new Error("A cobrança ainda não está disponível.");
    const stillOpen = !!subscription && subscription.state !== "revoked" && (subscription.state === "active" || subscription.state === "late" || (!!subscription.access_until && new Date(subscription.access_until).getTime() > Date.now()));
    if (customer?.customer_id && (data.intent === "manage" || stillOpen)) {
      const price = priceIdForPlan(data.plan);
      if (data.intent === "subscribe" && stillOpen && subscription && price) {
        try {
          const itemId = await stripeSubscriptionItem(subscription.id);
          return { url: await createStripePortal(customer.customer_id, origin, { subscriptionId: subscription.id, itemId, priceId: price }) };
        } catch {
          return { url: await createStripePortal(customer.customer_id, origin) };
        }
      }
      return { url: await createStripePortal(customer.customer_id, origin) };
    }
    const customerId = customer?.customer_id ?? await createStripeCustomer(data.academyId, email);
    const { data: bound, error: bindError } = await supabaseAdmin.rpc("stripe_bind_customer", { p_academy: data.academyId, p_customer: customerId, p_actor: context.userId });
    if (bindError || !bound) throw new Error("Não foi possível preparar a cobrança.");
    return { url: await createStripeCheckout({ academyId: data.academyId, plan: data.plan, customerId: bound, origin }) };
  });

export const resolveStripeSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ subscriptionId: z.string().regex(/^sub_[A-Za-z0-9]+$/), academyId: z.string().uuid(), confirmedRealPurchase: z.literal(true) }).strict().parse(value))
  .handler(async ({ data, context }) => {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("A cobrança precisa da chave de serviço do Supabase no ambiente local.");
    const { data: allowed, error: roleError } = await context.supabase.rpc("is_super_admin");
    if (roleError || !allowed) throw new Error("Acesso exclusivo do super administrador.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("stripe_resolve", { p_subscription: data.subscriptionId, p_academy: data.academyId, p_actor: context.userId });
    if (error) throw new Error("Não foi possível associar. Confira a assinatura e se a academia já possui assinatura confirmada.");
    return { success: true };
  });
