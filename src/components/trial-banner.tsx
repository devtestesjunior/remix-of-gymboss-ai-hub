import { differenceInDays, parseISO } from "date-fns";
import { useTenant } from "@/lib/tenant-context";
import { openStripeBilling } from "@/lib/stripe.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

export function TrialBanner() {
  const { tenant } = useTenant();
  const openBilling = useServerFn(openStripeBilling);
  if (!tenant?.academy) return null;
  const a = tenant.academy;
  const plan = a.plano === "starter" || a.plano === "premium" ? a.plano : "pro";
  const subscribe = () => {
    if (!tenant.academyId) return;
    void openBilling({ data: { academyId: tenant.academyId, plan, intent: "subscribe" } })
      .then(({ url }) => { window.location.assign(url); })
      .catch(() => { toast.error("Não foi possível abrir a cobrança."); });
  };

  if (a.status === "blocked") {
    return (
      <div className="bg-destructive text-destructive-foreground px-4 py-2 text-sm text-center">
        Sua academia está suspensa. <button type="button" className="underline font-medium" onClick={subscribe}>Regularizar cobrança</button>
      </div>
    );
  }

  if (a.status === "trial" && a.trial_ate) {
    const days = differenceInDays(parseISO(a.trial_ate), new Date());
    if (days <= 3 && days >= 0) {
      return (
        <div className="bg-yellow-400 text-yellow-950 px-4 py-2 text-sm text-center">
          Seu trial termina em {days} {days === 1 ? "dia" : "dias"}. <button type="button" className="underline font-medium" onClick={subscribe}>Assinar plano</button>
        </div>
      );
    }
    if (days < 0) {
      return (
        <div className="bg-orange-500 text-white px-4 py-2 text-sm text-center">
          Trial expirado. <button type="button" className="underline font-medium" onClick={subscribe}>Assinar para continuar</button>
        </div>
      );
    }
  }
  return null;
}