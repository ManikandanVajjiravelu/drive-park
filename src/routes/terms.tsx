import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  component: Terms,
});

function Terms() {
  return (
    <div className="mobile-shell">
      <div className="px-6 pt-10 pb-8 space-y-6">
        <div>
          <Link to="/" className="text-sm font-semibold text-muted-foreground">
            ← Back
          </Link>
          <h1 className="mt-4 text-3xl font-black">Terms of Service</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The rules for using Usop as a driver or a landowner.
          </p>
        </div>

        <Section title="A marketplace">
          Usop is a marketplace that connects drivers looking for parking with landowners who
          have space to rent. We are not the owner or operator of any listed space.
        </Section>

        <Section title="Landowner responsibility">
          Landowners are responsible for their own listings — including the accuracy of the
          address, availability, pricing and access instructions they publish.
        </Section>

        <Section title="Refunds">
          Refunds follow the cancellation policy shown on each slot at the time of booking.
          Please check the policy before you reserve.
        </Section>

        <Section title="Governing law">
          These terms are governed by the laws of India, and any disputes are subject to the
          jurisdiction of Indian courts.
        </Section>

        <div className="pt-4">
          <Link
            to="/privacy"
            className="block w-full rounded-2xl border-2 border-foreground/10 py-4 text-center font-semibold"
          >
            Read our Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-muted p-4">
      <h2 className="font-bold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
