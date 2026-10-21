import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  component: Privacy,
});

function Privacy() {
  return (
    <div className="mobile-shell">
      <div className="px-6 pt-10 pb-8 space-y-6">
        <div>
          <Link to="/" className="text-sm font-semibold text-muted-foreground">
            ← Back
          </Link>
          <h1 className="mt-4 text-3xl font-black">Privacy Policy</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            How Usop collects, uses and protects your data.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Last updated: October 2026</p>
        </div>

        <Section title="What we collect">
          We collect your name, phone number, email address, approximate location, vehicle details
          and booking history so we can match you with parking spaces and keep your reservations
          working.
        </Section>

        <Section title="Payments">
          Payments are processed by Razorpay. We never store your card details — card data goes
          directly to Razorpay and stays with them.
        </Section>

        <Section title="Where data is stored">
          Your data is stored securely in Supabase, our database and authentication provider.
        </Section>

        <Section title="Your location">
          The exact address of a parking space is shown to a driver only after a booking is fully
          paid. Before that, only an approximate area is shown.
        </Section>

        <Section title="How long we keep data">
          Account data is kept while your account is active. Booking and payment records are kept
          for as long as the law requires.
        </Section>

        <Section title="Deleting your data">
          You can request deletion of your account and personal data at any time by emailing
          support@usop.in. We will remove your data within a reasonable period, except where we are
          required to keep records by law.
        </Section>

        <div className="pt-4">
          <Link
            to="/terms"
            className="block w-full rounded-2xl border-2 border-foreground/10 py-4 text-center font-semibold"
          >
            Read our Terms
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
