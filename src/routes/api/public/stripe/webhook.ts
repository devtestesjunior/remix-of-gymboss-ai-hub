import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/stripe/webhook")({
  server: { handlers: { POST: async ({ request }) => {
    const { handleStripeWebhook } = await import("@/lib/stripe-webhook.server");
    return handleStripeWebhook(request, process.env.STRIPE_WEBHOOK_SECRET, async event => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.rpc("stripe_process_event", { p_event: event });
      if (error) {
        console.error("[stripe] webhook event was not stored", error.code ?? "unknown");
        throw new Error("Billing processing failed");
      }
    });
  } } },
});
