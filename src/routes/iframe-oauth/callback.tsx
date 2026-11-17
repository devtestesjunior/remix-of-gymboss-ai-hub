import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/iframe-oauth/callback")({
  component: OAuthCallback,
  head: () => ({ meta: [{ title: "Conectando — Gym Spotter" }] }),
});

function readOAuthValue(key: string) {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  return hash.get(key) ?? query.get(key);
}

function OAuthCallback() {
  const [message, setMessage] = useState("Conectando sua conta Google…");

  useEffect(() => {
    const accessToken = readOAuthValue("access_token");
    const refreshToken = readOAuthValue("refresh_token");
    const error = readOAuthValue("error_description") ?? readOAuthValue("error");
    if (error || !accessToken || !refreshToken) {
      setMessage(error || "O Google não devolveu a sessão para este computador.");
      return;
    }
    void supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error: sessionError }) => {
      if (sessionError) {
        setMessage(sessionError.message);
        return;
      }
      window.location.replace("/entrar");
    });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
