import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useTenant } from "@/lib/tenant-context";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { toast } from "sonner";
import { fmtBRL } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { BookingLinkCard } from "@/components/booking-link-card";
import { useServerFn } from "@tanstack/react-start";
import { openStripeBilling } from "@/lib/stripe.functions";
import type { SaasPlan } from "@/lib/stripe";

export const Route = createFileRoute("/app/configuracoes")({ component: Config, head: () => ({ meta: [{"title": "Configurações · Academia | Gym Spotter"}, {"name": "description", "content": "Configurações — Gym Spotter, gestão de academias."}, {"property": "og:title", "content": "Configurações · Academia | Gym Spotter"}, {"property": "og:description", "content": "Configurações — Gym Spotter, gestão de academias."}, {"property": "og:type", "content": "website"}, {"name": "twitter:card", "content": "summary"}] }) });

const saasPlans: { code: SaasPlan; name: string; amount: string }[] = [
  { code: "starter", name: "Start", amount: "R$ 97" },
  { code: "pro", name: "Pro", amount: "R$ 197" },
  { code: "premium", name: "Elite", amount: "R$ 397" },
];

function Config() {
  const { tenant, refetch } = useTenant();
  const a = tenant?.academy;
  const openBilling = useServerFn(openStripeBilling);
  const [billing, setBilling] = useState<SaasPlan | "manage" | null>(null);
  const aba = useRouterState({ select: s => new URLSearchParams(s.location.searchStr).get("aba") });
  const [tab, setTab] = useState(aba === "cobranca" ? "cobranca" : "academia");
  const [name, setName] = useState(a?.name ?? "");
  const { data: slugRow } = useQuery({
    queryKey: ["academy-slug", tenant?.academyId],
    enabled: !!tenant?.academyId,
    queryFn: async () => {
      const { data } = await supabase.from("academy").select("slug").eq("id", tenant!.academyId!).maybeSingle();
      return data;
    },
  });

  const currentPlan: SaasPlan = a?.plano === "starter" || a?.plano === "premium" ? a.plano : "pro";
  const canManage = tenant?.role === "admin";
  const startBilling = async (plan: SaasPlan, intent: "manage" | "subscribe") => {
    if (!tenant?.academyId || !canManage) return;
    setBilling(intent === "manage" ? "manage" : plan);
    try {
      const result = await openBilling({ data: { academyId: tenant.academyId, plan, intent } });
      window.location.assign(result.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível abrir a cobrança.");
      setBilling(null);
    }
  };

  const save = async () => {
    if (!tenant?.academyId) return;
    const { error } = await supabase.from("academy").update({ name }).eq("id", tenant.academyId);
    if (error) toast.error(error.message); else { toast.success("Salvo"); refetch(); }
  };

  return (
    <div>
      <PageHeader title="Configurações" />
      {slugRow?.slug && (
        <div className="mb-6 max-w-2xl">
          <div className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Link publico</div>
          <BookingLinkCard slug={slugRow.slug} />
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="academia">Academia</TabsTrigger><TabsTrigger value="equipe">Equipe</TabsTrigger><TabsTrigger value="aparencia">Aparência</TabsTrigger><TabsTrigger value="cobranca">Cobrança</TabsTrigger></TabsList>
        <TabsContent value="academia">
          <Card><CardContent className="p-6 space-y-3 max-w-lg">
            <div><Label>Nome</Label><Input value={name} onChange={(e)=>setName(e.target.value)} /></div>
            <Button onClick={save}>Salvar</Button>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="equipe"><Card><CardContent className="p-6 text-sm text-muted-foreground">Gerencie membros em <a href="/app/equipe" className="text-primary underline">/app/equipe</a>.</CardContent></Card></TabsContent>
        <TabsContent value="aparencia"><Card><CardContent className="p-6"><Label>Cor primária</Label><div className="text-sm text-muted-foreground mt-2">{a?.cor_primaria}</div></CardContent></Card></TabsContent>
        <TabsContent value="cobranca"><Card><CardContent className="p-6 space-y-4 text-sm max-w-lg">
          <div className="space-y-2">
            <div><strong>Plano atual:</strong> {saasPlans.find(plan => plan.code === a?.plano)?.name ?? a?.plano}</div>
            <div><strong>Status:</strong> {a?.status}</div>
            <div><strong>Valor mensal:</strong> {fmtBRL(a?.valor_mensal ?? 0)}</div>
            <p className="text-muted-foreground">O acesso segue a fatura paga. A página de sucesso do Checkout não libera a academia.</p>
          </div>
          {canManage ? <div className="space-y-2">
            {saasPlans.map(plan => <div key={plan.code} className="flex items-center justify-between gap-3">
              <span>{plan.name} · {plan.amount}/mês</span>
              {plan.code === currentPlan ? <span className="text-muted-foreground">Plano atual</span> : <Button type="button" variant="outline" size="sm" disabled={billing !== null} onClick={() => { void startBilling(plan.code, "subscribe"); }}>{billing === plan.code ? "Abrindo…" : `Mudar para ${plan.name}`}</Button>}
            </div>)}
            <Button type="button" disabled={billing !== null} onClick={() => { void startBilling(currentPlan, "manage"); }}>{billing === "manage" ? "Abrindo…" : "Gerenciar cartão, faturas e cancelamento"}</Button>
          </div> : <p className="text-muted-foreground">A gestão da assinatura é do administrador da academia.</p>}
        </CardContent></Card></TabsContent>
      </Tabs>
    </div>
  );
}