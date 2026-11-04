import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useProfile, useNotifications } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { ValidatedField } from "@/components/ValidatedField";
import {
  nameSchema,
  phoneSchema,
  formatName,
  formatDigits,
  normalizePhone,
  validate,
} from "@/lib/validation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  LogOut,
  Car,
  ChevronRight,
  Bell,
  BadgeCheck,
  ShieldCheck,
  Clock,
  Heart,
  Wallet,
  LifeBuoy,
  Palette,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { data: profile } = useProfile();
  const { data: notifs = [] } = useNotifications();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [reqBusy, setReqBusy] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setPhone(normalizePhone(profile.phone));
    }
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const channel = supabase
        .channel("profile-notifs")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
          () => qc.invalidateQueries({ queryKey: ["notifications"] }),
        )
        .subscribe();
      if (cancelled) supabase.removeChannel(channel);
      return () => supabase.removeChannel(channel);
    })();
    return () => {
      cancelled = true;
    };
  }, [qc]);

  async function save() {
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ name, phone }).eq("id", profile!.id);
    if (error) toast.error(error.message);
    else toast.success("Saved");
    setSaving(false);
  }

  async function requestVerification() {
    setReqBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ verification_status: "pending" })
      .eq("id", profile!.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Verification requested");
      qc.invalidateQueries({ queryKey: ["profile"] });
    }
    setReqBusy(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (!profile) return null;
  const unread = notifs.filter((n) => !n.read).length;
  const vs = profile.verification_status;

  return (
    <div className="pb-24">
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-black">Profile</h1>
            <div className="mt-2 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-bold uppercase">
                {profile.role}
              </span>
              {profile.verified && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-xs font-bold">
                  <BadgeCheck className="w-3.5 h-3.5" />
                  Verified
                </span>
              )}
            </div>
          </div>
          <Link
            to="/notifications"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
            className="relative w-10 h-10 rounded-full bg-white/10 grid place-items-center"
          >
            <Bell className="w-5 h-5" />
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black grid place-items-center">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>
        </div>
      </div>

      <div className="px-5 py-4 space-y-4">
        <ValidatedField
          label="Name"
          value={name}
          onChange={setName}
          schema={nameSchema}
          format={formatName}
        />
        <ValidatedField
          label="Phone"
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={(v) => setPhone(formatDigits(v, 10))}
          formatOnBlur={(v) => formatDigits(v, 10)}
          schema={phoneSchema}
        />
        <button
          disabled={
            saving || validate(nameSchema, name) !== null || validate(phoneSchema, phone) !== null
          }
          onClick={save}
          className="w-full rounded-2xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-60"
        >
          Save
        </button>

        {profile.role === "landowner" && (
          <div className="rounded-2xl border border-border p-4">
            <h2 className="flex items-center gap-2 font-bold">
              <ShieldCheck className="w-4 h-4 text-primary" />
              Host verification
            </h2>
            {vs === "approved" ? (
              <div className="mt-2 text-sm text-muted-foreground flex items-center gap-1">
                <BadgeCheck className="w-4 h-4 text-primary" />
                Your account is verified. A badge is shown on your slots.
              </div>
            ) : vs === "pending" ? (
              <div className="mt-2 text-sm text-muted-foreground flex items-center gap-1">
                <Clock className="w-4 h-4" />
                Under review — we'll notify you.
              </div>
            ) : (
              <>
                <div className="mt-1 text-xs text-muted-foreground">
                  Verified hosts get a badge on every slot, which increases driver trust and
                  bookings.
                  {vs === "rejected" && " Your last request was declined — you can re-apply."}
                </div>
                <button
                  disabled={reqBusy}
                  onClick={requestVerification}
                  className="mt-3 w-full rounded-xl bg-foreground text-background py-2.5 text-sm font-bold disabled:opacity-60"
                >
                  Request verification
                </button>
              </>
            )}
          </div>
        )}

        <h2 className="sr-only">Account & support</h2>
        <div className="rounded-2xl bg-card border border-border divide-y divide-border overflow-hidden">
          {profile.role === "driver" && (
            <>
              <Row to="/vehicles" icon={<Car className="w-4 h-4" />} label="My Garage" />
              <Row to="/saved" icon={<Heart className="w-4 h-4" />} label="Saved spots" />
            </>
          )}
          <Row to="/wallet" icon={<Wallet className="w-4 h-4" />} label="Wallet & payments" />
          <Row to="/help" icon={<LifeBuoy className="w-4 h-4" />} label="Help & support" />
        </div>

        <div className="rounded-2xl bg-card border border-border p-4 space-y-3">
          <h2 className="flex items-center gap-2 font-bold">
            <Palette className="w-4 h-4 text-primary" />
            Appearance
          </h2>
          <ThemeToggle />
        </div>

        <button
          onClick={signOut}
          className="w-full rounded-2xl bg-foreground text-background py-3 font-semibold flex items-center justify-center gap-2"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}

function Row({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to} className="w-full py-3 px-4 flex items-center justify-between font-semibold">
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <ChevronRight className="w-4 h-4 text-muted-foreground" />
    </Link>
  );
}
