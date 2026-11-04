import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMySupport } from "@/lib/queries";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, LifeBuoy, Mail } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const Route = createFileRoute("/_authenticated/help")({
  component: HelpPage,
});

const FAQS = [
  {
    q: "How do bookings work?",
    a: "Pick a slot on the map, choose a start time, duration and rate (hourly/daily/monthly), and tap Reserve. You'll get a QR code and the full address unlocks instantly.",
  },
  {
    q: "Can I cancel a booking?",
    a: "Yes — go to My Bookings › Upcoming and tap Cancel. Refund depends on the slot's cancellation policy (Flexible / Moderate / Strict).",
  },
  {
    q: "How do I extend a live session?",
    a: "On an active booking, use +15/+30/+60 min to extend. Cost is prorated at the booking's rate.",
  },
  {
    q: "How do I list my own parking spot?",
    a: "Sign up as a Landowner, then tap the + on the My Slots tab. Pin the location, set your rates and photos.",
  },
  {
    q: "How do I contact my host?",
    a: "Once your booking is confirmed, open the booking to Message or Call the host.",
  },
  {
    q: "Are payments real?",
    a: "Payments are processed securely via Razorpay (UPI and Cards). Cards saved in Wallet are stored locally for demo purposes.",
  },
  {
    q: "What is host verification?",
    a: "Landowners can request verification from Profile. A Verified badge appears on their slots once approved.",
  },
];

function HelpPage() {
  const navigate = useNavigate();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: tickets = [] } = useMySupport();
  const qc = useQueryClient();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) {
      toast.error("Fill in both fields");
      return;
    }
    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Not signed in");
      setBusy(false);
      return;
    }
    const { error } = await supabase.from("support_requests").insert({
      user_id: user.id,
      subject: subject.trim(),
      message: message.trim(),
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Message sent — we'll reply by email");
      setSubject("");
      setMessage("");
      qc.invalidateQueries({ queryKey: ["my-support"] });
    }
    setBusy(false);
  }

  return (
    <div className="pb-24">
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-5 flex items-center gap-3">
        <button
          aria-label="Back to profile"
          onClick={() => navigate({ to: "/profile" })}
          className="w-10 h-10 rounded-full bg-white/10 grid place-items-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-black">Help & support</h1>
          <p className="text-xs text-white/60 mt-0.5">We usually reply within a day.</p>
        </div>
      </div>

      <div className="px-4 py-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
          <LifeBuoy className="w-4 h-4" />
          FAQ
        </h2>
        <Accordion
          type="single"
          collapsible
          defaultValue="faq-0"
          className="rounded-2xl bg-card border border-border overflow-hidden divide-y divide-border"
        >
          {FAQS.map((f, i) => (
            <AccordionItem key={i} value={`faq-${i}`} className="border-0">
              <AccordionTrigger className="px-4 py-3 text-sm font-semibold hover:no-underline">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-3 text-sm text-muted-foreground">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <h2 className="mt-6 text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
          <Mail className="w-4 h-4" />
          Contact support
        </h2>
        <form onSubmit={submit} className="rounded-2xl bg-card border border-border p-4 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground uppercase">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={120}
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground uppercase">
              How can we help?
            </span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              maxLength={2000}
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 resize-none"
            />
          </label>
          <button
            disabled={busy}
            className="w-full rounded-2xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send message"}
          </button>
        </form>

        {tickets.length > 0 && (
          <>
            <h2 className="mt-6 text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Your tickets
            </h2>
            <div className="space-y-2">
              {tickets.map((t) => (
                <div key={t.id} className="rounded-xl bg-card border border-border p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-sm truncate">{t.subject}</div>
                    <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded-full bg-muted">
                      {t.status}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.message}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {new Date(t.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
