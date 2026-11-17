-- SOURCE-ONLY: not registered in Drizzle's journal and NOT applied to the shared backend.
-- Apply through the managed migration tool only after separate deployment authorization.
CREATE TABLE public.stripe_customer (
 academy_id uuid PRIMARY KEY REFERENCES public.academy(id), customer_id text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (customer_id ~ '^cus_[A-Za-z0-9]+$')
);
GRANT SELECT ON public.stripe_customer TO authenticated;
GRANT ALL ON public.stripe_customer TO service_role;
ALTER TABLE public.stripe_customer ENABLE ROW LEVEL SECURITY;
CREATE POLICY stripe_customer_master_read ON public.stripe_customer FOR SELECT TO authenticated USING (public.is_super_admin());

CREATE TABLE public.stripe_subscription (
 id text PRIMARY KEY, academy_id uuid REFERENCES public.academy(id), customer_id text,
 customer_email text NOT NULL, price_id text, plan public.academy_plan,
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','active','late','canceled','revoked')),
 access_until timestamptz, verified boolean NOT NULL DEFAULT false, manual_binding boolean NOT NULL DEFAULT false,
 reviewed_by uuid, reviewed_at timestamptz, last_paid_until timestamptz, livemode boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (NOT verified OR (academy_id IS NOT NULL AND plan IS NOT NULL)),
 CHECK (id ~ '^sub_[A-Za-z0-9]+$'), CHECK (length(customer_email) BETWEEN 3 AND 254)
);
GRANT SELECT ON public.stripe_subscription TO authenticated;
GRANT ALL ON public.stripe_subscription TO service_role;
ALTER TABLE public.stripe_subscription ENABLE ROW LEVEL SECURITY;
CREATE POLICY stripe_subscription_master_read ON public.stripe_subscription FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE UNIQUE INDEX stripe_one_verified_subscription ON public.stripe_subscription(academy_id) WHERE verified;

CREATE TABLE public.stripe_invoice (
 id text PRIMARY KEY, subscription_id text REFERENCES public.stripe_subscription(id), charge_id text,
 status text, amount integer, currency text, period_end timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (id ~ '^in_[A-Za-z0-9]+$'), CHECK (amount IS NULL OR amount >= 0)
);
GRANT SELECT ON public.stripe_invoice TO authenticated;
GRANT ALL ON public.stripe_invoice TO service_role;
ALTER TABLE public.stripe_invoice ENABLE ROW LEVEL SECURITY;
CREATE POLICY stripe_invoice_master_read ON public.stripe_invoice FOR SELECT TO authenticated USING (public.is_super_admin());

CREATE TABLE public.stripe_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity text NOT NULL UNIQUE, event_type text NOT NULL,
 subscription_id text REFERENCES public.stripe_subscription(id), customer_email text, price_id text,
 plan public.academy_plan, access_until timestamptz, invoice_id text, charge_id text, invoice_status text,
 amount integer, currency text, reason text, livemode boolean NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','applied','ignored')),
 received_at timestamptz NOT NULL DEFAULT now(), applied_at timestamptz,
 CHECK (identity ~ '^evt_[A-Za-z0-9]+$'), CHECK (length(event_type) BETWEEN 1 AND 80)
);
GRANT SELECT ON public.stripe_event TO authenticated;
GRANT ALL ON public.stripe_event TO service_role;
ALTER TABLE public.stripe_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY stripe_event_master_read ON public.stripe_event FOR SELECT TO authenticated USING (public.is_super_admin());

CREATE FUNCTION public.stripe_candidates(p_email text) RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT a.id FROM public.academy a WHERE lower(btrim(a.owner_email))=lower(btrim(p_email))
 UNION SELECT u.academy_id FROM public.academy_user u WHERE lower(btrim(u.email))=lower(btrim(p_email)) AND u.role IN ('owner','admin') AND u.ativo;
$$;
REVOKE ALL ON FUNCTION public.stripe_candidates(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_candidates(text) TO service_role;

CREATE FUNCTION public.stripe_apply_event(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.stripe_event; s public.stripe_subscription; deadline timestamptz; next_state text; next_plan public.academy_plan;
BEGIN
 SELECT * INTO e FROM public.stripe_event WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR e.state<>'pending' OR e.reason IS NOT NULL THEN RETURN; END IF;
 SELECT * INTO s FROM public.stripe_subscription WHERE id=e.subscription_id FOR UPDATE;
 IF NOT FOUND OR NOT s.verified THEN RETURN; END IF;
 IF s.state='revoked' THEN
   UPDATE public.stripe_event SET state='ignored',reason='terminal_revocation' WHERE id=e.id; RETURN;
 END IF;
 IF e.event_type IN ('charge_refunded','charge_disputed') THEN
   deadline:=now(); next_state:='revoked'; next_plan:=s.plan;
 ELSIF e.event_type='invoice_paid' THEN
   IF e.access_until IS NULL OR e.plan IS NULL THEN RETURN; END IF;
   IF s.last_paid_until IS NOT NULL AND e.access_until<=s.last_paid_until THEN
     UPDATE public.stripe_event SET state='ignored',reason='stale_period' WHERE id=e.id; RETURN;
   END IF;
   deadline:=greatest(s.access_until,e.access_until); next_state:='active'; next_plan:=e.plan;
 ELSIF e.event_type='invoice_payment_failed' THEN
   deadline:=s.access_until; next_state:=CASE WHEN s.state='canceled' THEN 'canceled' ELSE 'late' END; next_plan:=s.plan;
 ELSIF e.event_type='subscription_canceled' THEN
   deadline:=CASE WHEN s.access_until IS NULL THEN e.access_until WHEN e.access_until IS NULL THEN s.access_until ELSE least(s.access_until,e.access_until) END;
   next_state:='canceled'; next_plan:=s.plan;
 ELSE
   UPDATE public.stripe_event SET state='ignored',reason='binding_only' WHERE id=e.id; RETURN;
 END IF;
 UPDATE public.stripe_subscription SET state=next_state,access_until=deadline,plan=next_plan,
   price_id=CASE WHEN e.event_type='invoice_paid' AND e.price_id IS NOT NULL THEN e.price_id ELSE price_id END,
   last_paid_until=CASE WHEN e.event_type='invoice_paid' THEN e.access_until ELSE last_paid_until END,
   updated_at=now() WHERE id=s.id;
 UPDATE public.academy SET plano=next_plan,
   status=CASE WHEN deadline>now() AND next_state<>'revoked' THEN 'active'::public.academy_status ELSE 'blocked'::public.academy_status END,
   updated_at=now() WHERE id=s.academy_id AND next_plan IS NOT NULL;
 UPDATE public.stripe_event SET state='applied',applied_at=now() WHERE id=e.id;
END;
$$;
REVOKE ALL ON FUNCTION public.stripe_apply_event(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_apply_event(uuid) TO service_role;

CREATE FUNCTION public.stripe_process_event(p_event jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid text:=p_event->>'subscription_id'; mail text:=p_event->>'customer_email'; academy uuid:=nullif(p_event->>'academy_id','')::uuid;
 eid uuid; candidates uuid[]; target uuid; s public.stripe_subscription; reason text:=p_event->>'reason'; plan public.academy_plan:=NULL;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(sid,p_event->>'invoice_id',p_event->>'charge_id',p_event->>'identity'),0));
 IF EXISTS(SELECT 1 FROM public.stripe_event WHERE identity=p_event->>'identity') THEN RETURN jsonb_build_object('duplicate',true); END IF;
 IF p_event->>'plan' IN ('starter','pro','premium') THEN plan:=(p_event->>'plan')::public.academy_plan; END IF;
 IF sid IS NULL AND coalesce(p_event->>'invoice_id','')<>'' THEN
   SELECT i.subscription_id INTO sid FROM public.stripe_invoice i WHERE i.id=p_event->>'invoice_id';
 END IF;
 IF sid IS NULL AND coalesce(p_event->>'charge_id','')<>'' THEN
   SELECT i.subscription_id INTO sid FROM public.stripe_invoice i WHERE i.charge_id=p_event->>'charge_id' LIMIT 1;
 END IF;
 IF sid IS NOT NULL AND mail IS NULL THEN
   SELECT customer_email INTO mail FROM public.stripe_subscription WHERE id=sid;
 END IF;
 IF sid IS NOT NULL AND mail IS NOT NULL THEN
   IF academy IS NOT NULL THEN
     IF EXISTS(SELECT 1 FROM public.academy WHERE id=academy) THEN target:=academy; ELSE reason:=coalesce(reason,'missing_academy'); END IF;
   ELSIF reason IS NULL THEN
     SELECT array_agg(c) INTO candidates FROM public.stripe_candidates(mail) c;
     target:=CASE WHEN coalesce(cardinality(candidates),0)=1 THEN candidates[1] ELSE NULL END;
     IF target IS NULL THEN reason:=CASE WHEN coalesce(cardinality(candidates),0)>1 THEN 'ambiguous_tenant' ELSE 'no_tenant' END; END IF;
   END IF;
   INSERT INTO public.stripe_subscription(id,academy_id,customer_id,customer_email,price_id,plan,livemode)
   VALUES(sid,target,p_event->>'customer_id',mail,p_event->>'price_id',plan,(p_event->>'livemode')::boolean)
   ON CONFLICT(id) DO NOTHING;
   SELECT * INTO s FROM public.stripe_subscription WHERE id=sid FOR UPDATE;
   IF s.livemode IS DISTINCT FROM (p_event->>'livemode')::boolean THEN reason:='mode_mismatch';
   ELSIF s.verified AND academy IS NOT NULL AND academy IS DISTINCT FROM s.academy_id THEN reason:='tenant_changed';
   ELSIF NOT s.verified AND reason IS NULL AND p_event->>'event_type'='invoice_paid' AND target IS NOT NULL AND plan IS NOT NULL THEN
     UPDATE public.stripe_subscription SET verified=false,updated_at=now()
      WHERE academy_id=target AND verified AND id<>sid AND (state='revoked' OR (state='canceled' AND (access_until IS NULL OR access_until<=now())));
     IF NOT EXISTS(SELECT 1 FROM public.stripe_subscription other WHERE other.academy_id=target AND other.verified) THEN
       UPDATE public.stripe_subscription SET academy_id=target,plan=plan,verified=true,manual_binding=false,customer_id=coalesce(s.customer_id,p_event->>'customer_id'),updated_at=now() WHERE id=s.id;
     ELSE reason:='academy_already_associated'; END IF;
   END IF;
   IF p_event->>'customer_id' IS NOT NULL THEN
     UPDATE public.stripe_subscription SET customer_id=coalesce(customer_id,p_event->>'customer_id'),updated_at=now() WHERE id=sid;
   END IF;
 ELSIF reason IS NULL THEN reason:=CASE WHEN sid IS NULL THEN 'unresolved_charge' ELSE 'incomplete_subscription' END IF;
 END IF;
 IF p_event->>'event_type'='checkout_completed' AND reason IS NULL THEN reason:='binding_only'; END IF;
 IF reason='unknown_price' AND sid IS NOT NULL AND EXISTS(SELECT 1 FROM public.stripe_subscription WHERE id=sid AND plan IS NOT NULL AND price_id=p_event->>'price_id') THEN
   reason:=NULL; SELECT s2.plan INTO plan FROM public.stripe_subscription s2 WHERE s2.id=sid;
 END IF;
 IF sid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.stripe_subscription WHERE id=sid) THEN
   sid:=NULL; reason:=coalesce(reason,'incomplete_subscription');
 END IF;
 INSERT INTO public.stripe_event(identity,event_type,subscription_id,customer_email,price_id,plan,access_until,invoice_id,charge_id,invoice_status,amount,currency,reason,livemode)
 VALUES(p_event->>'identity',p_event->>'event_type',sid,mail,p_event->>'price_id',plan,nullif(p_event->>'access_until','')::timestamptz,nullif(p_event->>'invoice_id',''),nullif(p_event->>'charge_id',''),p_event->>'invoice_status',CASE WHEN p_event->>'amount' ~ '^[0-9]+$' THEN (p_event->>'amount')::integer ELSE NULL END,p_event->>'currency',reason,(p_event->>'livemode')::boolean)
 RETURNING id INTO eid;
 IF coalesce(p_event->>'invoice_id','')<>'' AND sid IS NOT NULL THEN
   INSERT INTO public.stripe_invoice(id,subscription_id,charge_id,status,amount,currency,period_end)
   VALUES(p_event->>'invoice_id',sid,nullif(p_event->>'charge_id',''),p_event->>'invoice_status',CASE WHEN p_event->>'amount' ~ '^[0-9]+$' THEN (p_event->>'amount')::integer ELSE NULL END,p_event->>'currency',nullif(p_event->>'access_until','')::timestamptz)
   ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,charge_id=coalesce(public.stripe_invoice.charge_id,EXCLUDED.charge_id),amount=coalesce(EXCLUDED.amount,public.stripe_invoice.amount);
 END IF;
 PERFORM public.stripe_apply_event(eid);
 RETURN jsonb_build_object('accepted',true);
END;
$$;
REVOKE ALL ON FUNCTION public.stripe_process_event(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_process_event(jsonb) TO service_role;

CREATE FUNCTION public.stripe_resolve(p_subscription text,p_academy uuid,p_actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.stripe_subscription; e record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND role='super_admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_subscription,0));
 SELECT * INTO s FROM public.stripe_subscription WHERE id=p_subscription FOR UPDATE;
 IF NOT FOUND OR s.verified OR s.plan IS NULL THEN RAISE EXCEPTION 'Subscription unavailable'; END IF;
 PERFORM 1 FROM public.academy WHERE id=p_academy FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Academy unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.stripe_subscription WHERE academy_id=p_academy AND verified) THEN RAISE EXCEPTION 'Academy already associated'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stripe_event WHERE subscription_id=s.id AND reason IN ('no_tenant','ambiguous_tenant','missing_academy')) THEN RAISE EXCEPTION 'No eligible event'; END IF;
 UPDATE public.stripe_subscription SET academy_id=p_academy,verified=true,manual_binding=true,reviewed_by=p_actor,reviewed_at=now(),updated_at=now() WHERE id=s.id;
 UPDATE public.stripe_event SET reason=NULL WHERE subscription_id=s.id AND reason IN ('no_tenant','ambiguous_tenant','missing_academy');
 FOR e IN SELECT id FROM public.stripe_event WHERE subscription_id=s.id AND state='pending' AND reason IS NULL ORDER BY CASE WHEN event_type='invoice_paid' THEN 0 WHEN event_type='invoice_payment_failed' THEN 1 WHEN event_type='subscription_canceled' THEN 2 ELSE 3 END,access_until NULLS LAST,received_at LOOP
   PERFORM public.stripe_apply_event(e.id);
 END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.stripe_resolve(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_resolve(text,uuid,uuid) TO service_role;

CREATE FUNCTION public.stripe_bind_customer(p_academy uuid,p_customer text,p_actor uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing text;
BEGIN
 IF p_customer !~ '^cus_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'Invalid customer'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_actor AND academy_id=p_academy AND role='admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM public.stripe_customer WHERE customer_id=p_customer AND academy_id<>p_academy) THEN RAISE EXCEPTION 'Customer already bound'; END IF;
 INSERT INTO public.stripe_customer(academy_id,customer_id) VALUES(p_academy,p_customer) ON CONFLICT(academy_id) DO NOTHING;
 SELECT customer_id INTO existing FROM public.stripe_customer WHERE academy_id=p_academy;
 RETURN existing;
END;
$$;
REVOKE ALL ON FUNCTION public.stripe_bind_customer(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_bind_customer(uuid,text,uuid) TO service_role;

CREATE FUNCTION public.stripe_access_allowed(p_academy uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_super_admin() OR NOT EXISTS(SELECT 1 FROM public.stripe_subscription s WHERE s.academy_id=p_academy AND s.verified)
 OR EXISTS(SELECT 1 FROM public.stripe_subscription s WHERE s.academy_id=p_academy AND s.verified AND s.state<>'revoked' AND s.access_until>now());
$$;
REVOKE ALL ON FUNCTION public.stripe_access_allowed(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stripe_access_allowed(uuid) TO authenticated,service_role;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['student','plan','schedule','team_member','checkin','financial','lead'] LOOP
  EXECUTE format('CREATE POLICY stripe_paid_access ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.stripe_access_allowed(academy_id)) WITH CHECK (public.stripe_access_allowed(academy_id))',t);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.stripe_protect_billing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE caller_role text := pg_catalog.current_setting('role', true); subscription_owner text;
BEGIN
 IF NEW.plano IS NOT DISTINCT FROM OLD.plano AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 IF caller_role IS NULL OR caller_role = 'none' THEN caller_role := session_user; END IF;
 SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO subscription_owner FROM pg_catalog.pg_class AS c WHERE c.oid = 'public.stripe_subscription'::regclass;
 IF caller_role = 'service_role' OR caller_role = subscription_owner OR (caller_role = 'authenticated' AND auth.uid() IS NOT NULL AND public.is_super_admin()) THEN RETURN NEW; END IF;
 IF EXISTS (SELECT 1 FROM public.stripe_subscription AS s WHERE s.verified AND (s.academy_id = OLD.id OR s.academy_id = NEW.id)) THEN
   RAISE EXCEPTION 'Billing fields are managed by subscriptions' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.stripe_protect_billing() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_protect_billing() TO service_role;
CREATE TRIGGER stripe_billing_fields BEFORE UPDATE ON public.academy FOR EACH ROW EXECUTE FUNCTION public.stripe_protect_billing();
COMMENT ON TABLE public.stripe_event IS 'Normalized signed Stripe fields only. No raw payload, signatures, card data or contact fields except customer email. Access changes come from invoice, cancellation, refund and dispute events.';
