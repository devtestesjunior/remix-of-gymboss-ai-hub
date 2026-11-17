import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { resolveStripeSubscription } from "@/lib/stripe.functions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

export const Route = createFileRoute("/master/assinaturas")({
  component: Subscriptions,
  head: () => ({ meta: [
    { title: "Assinaturas · Master | Gym Spotter" },
    { name: "description", content: "Revisão de assinaturas e eventos Stripe do Gym Spotter." },
    { property: "og:title", content: "Assinaturas · Master | Gym Spotter" },
    { property: "og:description", content: "Revisão de assinaturas e eventos Stripe do Gym Spotter." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
});

function Subscriptions() {
  const queryClient = useQueryClient();
  const resolve = useServerFn(resolveStripeSubscription);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ["stripe-master-review"], queryFn: async () => {
    const [subscriptions, events, academies] = await Promise.all([
      supabase.from("stripe_subscription").select("id,academy_id,customer_email,plan,state,access_until,verified").order("created_at", { ascending: false }).limit(200),
      supabase.from("stripe_event").select("id,subscription_id,event_type,state,reason,received_at").eq("state", "pending").order("received_at", { ascending: false }).limit(200),
      supabase.from("academy").select("id,name").order("name"),
    ]);
    if (subscriptions.error || events.error || academies.error) throw new Error("Não foi possível carregar as assinaturas.");
    return { subscriptions: subscriptions.data, events: events.data, academies: academies.data };
  } });
  async function associate(subscriptionId: string) {
    const academyId = selected[subscriptionId] ?? data?.subscriptions.find(s => s.id === subscriptionId)?.academy_id;
    if (!academyId || !confirmed[subscriptionId]) return;
    setBusy(true);
    try {
      await resolve({ data: { subscriptionId, academyId, confirmedRealPurchase: true } });
      await queryClient.invalidateQueries({ queryKey: ["stripe-master-review"] });
      toast.success("Assinatura associada e eventos processados.");
    } catch { toast.error("Associação não concluída. Confira a academia e os eventos pendentes."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6">
    <PageHeader title="Assinaturas" description="Revisão de compras Stripe e associação às academias." />
    {isLoading && <p role="status">Carregando…</p>}
    {error && <p role="alert" className="text-destructive">Não foi possível carregar as assinaturas.</p>}
    {data?.subscriptions.length === 0 && <p className="text-muted-foreground">Nenhuma assinatura recebida.</p>}
    <div className="grid gap-4 lg:grid-cols-2">{data?.subscriptions.map(s => {
      const eligible = data.events.some(e => e.subscription_id === s.id && ["no_tenant", "ambiguous_tenant", "missing_academy"].includes(e.reason ?? ""));
      return <section key={s.id} className="min-w-0 rounded-lg border border-border bg-card p-5 space-y-3">
        <h2 className="break-all font-semibold">{s.customer_email}</h2>
        <p className="break-all text-xs text-muted-foreground">{s.id}</p>
        <p className="text-sm">{s.plan ?? "Checkout não reconhecido"} · {s.state}{s.access_until ? ` · Até ${new Date(s.access_until).toLocaleString("pt-BR")}` : ""}</p>
        {s.verified ? <p className="text-sm">{data.academies.find(a => a.id === s.academy_id)?.name ?? "Academia associada"}</p> : eligible && <>
          <Label htmlFor={`academy-${s.id}`}>Academia</Label>
          <Select value={selected[s.id] ?? s.academy_id ?? ""} onValueChange={value => setSelected(previous => ({ ...previous, [s.id]: value }))}>
            <SelectTrigger id={`academy-${s.id}`}><SelectValue placeholder="Selecionar academia" /></SelectTrigger>
            <SelectContent>{data.academies.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex items-start gap-2"><Checkbox id={`confirm-${s.id}`} checked={confirmed[s.id] ?? false} onCheckedChange={value => setConfirmed(previous => ({ ...previous, [s.id]: value === true }))} /><Label htmlFor={`confirm-${s.id}`} className="leading-5">Conferi no Stripe a cobrança real e a academia destinatária.</Label></div>
          <Button disabled={busy || !confirmed[s.id] || !(selected[s.id] ?? s.academy_id)} onClick={() => associate(s.id)}>Confirmar associação</Button>
        </>}
        {data.events.filter(e => e.subscription_id === s.id).map(e => <p key={e.id} className="break-words text-xs text-muted-foreground">{e.event_type} · {e.reason ?? "Pendente"}</p>)}
      </section>;
    })}</div>
    {data?.events.some(e => !e.subscription_id) && <section className="space-y-2"><h2 className="font-semibold">Eventos sem assinatura válida</h2>{data.events.filter(e => !e.subscription_id).map(e => <p key={e.id} className="text-sm text-muted-foreground">{e.event_type} · {e.reason}</p>)}</section>}
  </div>;
}