import { createFileRoute, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Dumbbell } from "lucide-react";
import { useTenant } from "@/lib/tenant-context";
import { firstAccessDestination } from "@/lib/access-destination";
import { currentSaasPlan, rememberSaasPlan } from "@/lib/stripe";

export const Route = createFileRoute("/entrar")({ component: Entrar, head: () => ({ meta: [
  { title: "Entrar — Gym Spotter" },
  { name: "description", content: "Acesse sua academia ou a administração do Gym Spotter." },
  { property: "og:title", content: "Entrar — Gym Spotter" },
  { property: "og:description", content: "Acesso seguro ao Gym Spotter." },
  { property: "og:type", content: "website" },
  { name: "twitter:card", content: "summary" },
] }) });

function Entrar() {
  const { user, loading, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const requestedPlan = useRouterState({ select: s => {
    const value = new URLSearchParams(s.location.searchStr).get("plano");
    return value === "starter" || value === "pro" || value === "premium" ? value : undefined;
  } });
  const plano = requestedPlan ?? currentSaasPlan();
  const { tenant, loading: tenantLoading, error: tenantError, refetch } = useTenant();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmationPending, setConfirmationPending] = useState(false);

  useEffect(() => {
    const destination = firstAccessDestination({ authenticated: !!user, authLoading: loading, tenantLoading, tenantError, tenant });
    if (!destination) return;
    if (plano) rememberSaasPlan(plano);
    navigate({ to: destination, replace: true });
  }, [user, loading, tenantLoading, tenantError, tenant, navigate, plano]);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) toast.error(error.message);
  };

  const onSignup = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const { error, signedIn } = await signUp(email, password);
    setBusy(false);
    if (error) toast.error(error.message);
    else if (signedIn) toast.success("Conta criada. Acesso confirmado.");
    else { setConfirmationPending(true); toast.success("Confira seu email para confirmar o cadastro."); }
  };

  const onGoogle = async () => {
    setBusy(true);
    const host = window.location.hostname;
    const local = host === "localhost" || host === "127.0.0.1";
    const redirectUri = local
      ? `http://127.0.0.1:${window.location.port || "80"}/iframe-oauth/callback`
      : `${window.location.origin}/entrar`;
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: redirectUri });
    if (result.error) { toast.error(result.error.message ?? "Falha no login com Google"); setBusy(false); return; }
    if (result.redirected) return;
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary">
            <Dumbbell className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold">Gym Spotter</span>
        </div>
        <Card>
          <CardContent className="p-6">
            {tenantError && <div className="mb-4 space-y-2">
              <p role="alert" className="text-sm text-destructive">Não foi possível verificar seu acesso. Tente novamente.</p>
              <Button type="button" variant="outline" disabled={tenantLoading} onClick={() => { void refetch(); }}>Tentar novamente</Button>
            </div>}
            {confirmationPending && <p role="status" className="mb-4 text-sm text-muted-foreground">Confira sua caixa de entrada e confirme o cadastro pelo link enviado.</p>}
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Entrar</TabsTrigger>
                <TabsTrigger value="signup">Criar conta</TabsTrigger>
              </TabsList>
              <TabsContent value="login">
                <form onSubmit={onLogin} className="space-y-3 mt-4">
                  <div><Label htmlFor="login-email">Email</Label><Input id="login-email" autoComplete="email" type="email" value={email} onChange={(e)=>setEmail(e.target.value)} required /></div>
                  <div><Label htmlFor="login-password">Senha</Label><Input id="login-password" autoComplete="current-password" type="password" value={password} onChange={(e)=>setPassword(e.target.value)} required /></div>
                  <Button type="submit" className="w-full" disabled={busy}>Entrar</Button>
                  <div className="text-center"><Link to="/esqueci-senha" className="text-sm text-muted-foreground hover:text-primary">Esqueci a senha</Link></div>
                </form>
              </TabsContent>
              <TabsContent value="signup">
                <form onSubmit={onSignup} className="space-y-3 mt-4">
                  <div><Label htmlFor="signup-email">Email</Label><Input id="signup-email" autoComplete="email" type="email" value={email} onChange={(e)=>setEmail(e.target.value)} required /></div>
                  <div><Label htmlFor="signup-password">Senha</Label><Input id="signup-password" autoComplete="new-password" type="password" minLength={6} value={password} onChange={(e)=>setPassword(e.target.value)} required /></div>
                  <Button type="submit" className="w-full" disabled={busy}>Criar conta</Button>
                </form>
              </TabsContent>
            </Tabs>
            <div className="my-4 flex items-center gap-3">
              <Separator className="flex-1" /><span className="text-xs text-muted-foreground">ou</span><Separator className="flex-1" />
            </div>
            <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={onGoogle}>
              Continuar com Google
            </Button>
          </CardContent>
        </Card>
        <div className="text-center mt-4">
          <Link to="/" className="text-sm text-muted-foreground hover:text-primary">← Voltar</Link>
        </div>
      </div>
    </div>
  );
}