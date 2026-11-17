import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Dumbbell, Users, DollarSign, Calendar, UserPlus, BarChart, Globe, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { rememberSaasPlan } from "@/lib/stripe";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({ meta: [
    { title: "Gym Spotter — A gestão da sua academia, em um só lugar" },
    { name: "description", content: "Organize alunos, check-ins, planos, financeiro, agenda e equipe com o Gym Spotter." },
    { property: "og:title", content: "Gym Spotter — Gestão de academias" },
    { property: "og:description", content: "Organize alunos, check-ins, planos, financeiro, agenda e equipe com o Gym Spotter." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ]}),
});

const recursos = [
  { icon: Users, t: "Alunos e check-ins", d: "Cadastre alunos e acompanhe os registros de presença." },
  { icon: DollarSign, t: "Planos e financeiro", d: "Organize planos, receitas, despesas e registros de inadimplência." },
  { icon: Calendar, t: "Agenda e equipe", d: "Consulte a agenda de aulas e organize os profissionais da academia." },
  { icon: UserPlus, t: "Leads", d: "Acompanhe os cadastros recebidos pelo link público da academia e atualize o status de cada contato." },
  { icon: BarChart, t: "Relatórios", d: "Consulte informações sobre faturamento, retenção, modalidades, horários e evolução de alunos. A tela também oferece exportação em PDF." },
  { icon: Globe, t: "Link público da academia", d: "Apresente os planos disponíveis e receba solicitações de aula experimental." },
];

const planos: { n: string; code: "starter" | "pro" | "premium"; p: string; d: string; destaque?: boolean; f: string[] }[] = [
  { n: "Start", code: "starter", p: "97", d: "Ideal para estúdios.", f: ["Gestão de até 50 alunos", "Agenda"] },
  { n: "Pro", code: "pro", p: "197", d: "O mais popular", destaque: true, f: ["Alunos ilimitados", "Financeiro completo", "Suporte prioritário"] },
  { n: "Elite", code: "premium", p: "397", d: "Para redes de academias.", f: ["Múltiplas unidades", "Relatórios avançados"] },
];

const passos = [
  { t: "Acesse ou crie sua conta", d: "Entre pelo Gym Spotter para acessar o sistema." },
  { t: "Organize a operação", d: "Use as áreas de alunos, check-ins, planos, financeiro, agenda e equipe." },
  { t: "Acompanhe os registros", d: "Consulte relatórios e acompanhe os contatos recebidos pelo link público da academia." },
];

const faq = [
  { q: "O que é o Gym Spotter?", a: "É um sistema para organizar a gestão diária de academias, com áreas para alunos, check-ins, planos, financeiro, agenda, equipe, leads e relatórios." },
  { q: "Que informações posso organizar?", a: "O sistema inclui cadastro de alunos, registros de check-in, planos, lançamentos financeiros, agenda de aulas e profissionais da equipe." },
  { q: "Como recebo contatos interessados?", a: "O link público da academia permite apresentar planos e receber solicitações de aula experimental. Os cadastros aparecem na área de Leads." },
  { q: "Posso ver uma demonstração?", a: "Sim. Use ‘Ver demonstração’ para abrir /demo/dashboard." },
  { q: "Onde acesso ou crio uma conta?", a: "Pelo botão ‘Acessar ou criar conta’, que leva a /entrar." },
];

function Ctas() {
  return (
    <div className="flex flex-col sm:flex-row justify-center gap-3">
      <Button asChild size="lg" className="h-12 px-7 font-bold"><Link to="/entrar">Acessar ou criar conta <ArrowRight className="h-4 w-4 ml-1" /></Link></Button>
      <Button asChild size="lg" variant="outline" className="h-12 px-7 font-bold"><Link to="/demo/dashboard">Ver demonstração</Link></Button>
    </div>
  );
}

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 shrink-0">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Dumbbell className="h-5 w-5" /></span>
      <span className="text-lg font-black tracking-tight text-foreground">Gym Spotter</span>
    </Link>
  );
}

function Landing() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground antialiased">
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between gap-3 px-4">
          <Logo />
          <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-muted-foreground">
            <a href="#recursos" className="hover:text-primary">Recursos</a>
            <a href="#como-funciona" className="hover:text-primary">Como funciona</a>
            <a href="#faq" className="hover:text-primary">Perguntas frequentes</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm"><Link to="/entrar">Entrar</Link></Button>
            <Button asChild size="sm" className="hidden sm:inline-flex font-bold"><Link to="/entrar">Acessar ou criar conta</Link></Button>
          </div>
        </div>
      </header>

      <section className="border-b border-border">
        <div className="container mx-auto px-4 py-20 md:py-28 text-center max-w-4xl">
          <h1 className="text-4xl md:text-6xl font-black tracking-tight leading-tight">
            A gestão da sua academia, <span className="text-primary">em um só lugar.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">Organize alunos, check-ins, planos, financeiro, agenda e equipe com o Gym Spotter.</p>
          <div className="mt-9"><Ctas /></div>
        </div>
      </section>

      <section id="recursos" className="container mx-auto px-4 py-20 scroll-mt-16">
        <h2 className="text-3xl md:text-4xl font-black text-center mb-12">Recursos</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recursos.map(r => (
            <div key={r.t} className="rounded-xl border border-border bg-card p-6 transition hover:border-primary/60">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15"><r.icon className="h-5 w-5 text-primary" /></div>
              <h3 className="font-bold text-lg">{r.t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{r.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="planos" className="border-t border-border py-20 scroll-mt-16">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl md:text-4xl font-black text-center mb-12">Planos e Preços</h2>
          <div className="grid gap-6 md:grid-cols-3 max-w-5xl mx-auto items-stretch">
            {planos.map(pl => (
              <div key={pl.n} className={`relative flex flex-col rounded-xl border bg-card p-6 ${pl.destaque ? "border-primary border-2 shadow-lg shadow-primary/20 md:-translate-y-2" : "border-border"}`}>
                {pl.destaque && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-black uppercase tracking-wide text-primary-foreground whitespace-nowrap">O mais popular</span>}
                <h3 className="text-xl font-black">{pl.n}</h3>
                {!pl.destaque && <p className="mt-1 text-sm text-muted-foreground">{pl.d}</p>}
                <div className="mt-4 flex items-baseline gap-1">
                  <span className={`text-4xl font-black ${pl.destaque ? "text-primary" : ""}`}>R$ {pl.p}</span>
                  <span className="text-muted-foreground">/mês</span>
                </div>
                <ul className="mt-6 space-y-2 flex-1">
                  {pl.f.map(x => (
                    <li key={x} className="flex items-start gap-2 text-sm"><Check className="h-4 w-4 mt-0.5 shrink-0 text-primary" />{x}</li>
                  ))}
                </ul>
                <Button asChild variant={pl.destaque ? "default" : "outline"} className="mt-6 w-full font-bold"><a href={`/entrar?plano=${pl.code}`} onClick={() => rememberSaasPlan(pl.code)}>Assinar Agora</a></Button>
              </div>
            ))}
          </div>
          <p className="mt-10 text-center text-muted-foreground">Teste grátis por 7 dias. Sem taxas de instalação.</p>
        </div>
      </section>

      <section id="como-funciona" className="border-y border-border bg-card/40 py-20 scroll-mt-16">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl md:text-4xl font-black text-center mb-12">Como funciona</h2>
          <ol className="grid gap-6 md:grid-cols-3 max-w-5xl mx-auto">
            {passos.map((p, i) => (
              <li key={p.t} className="rounded-xl border border-border bg-card p-6">
                <div className="text-4xl font-black text-primary">{i + 1}</div>
                <h3 className="mt-2 font-bold text-lg">{p.t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{p.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="faq" className="container mx-auto px-4 py-20 max-w-3xl scroll-mt-16">
        <h2 className="text-3xl md:text-4xl font-black text-center mb-10">Perguntas frequentes</h2>
        <Accordion type="single" collapsible>
          {faq.map((f, i) => (
            <AccordionItem key={f.q} value={`f-${i}`} className="border-border">
              <AccordionTrigger className="text-left font-bold hover:no-underline">{f.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      <section className="border-t border-border bg-card/40 py-20">
        <div className="container mx-auto px-4 text-center max-w-3xl">
          <h2 className="text-3xl md:text-4xl font-black">Conheça o Gym Spotter na prática.</h2>
          <p className="mt-3 mb-8 text-muted-foreground">Acesse o sistema ou explore a demonstração para conhecer as áreas de gestão.</p>
          <Ctas />
        </div>
      </section>

      <footer className="border-t border-border py-8">
        <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <Logo />
          <span>Gym Spotter © 2026</span>
        </div>
      </footer>
    </div>
  );
}
