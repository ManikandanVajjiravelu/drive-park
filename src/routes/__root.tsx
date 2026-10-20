import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "sonner";
import { ThemeProvider } from "../components/ThemeProvider";
import { ThemeMetaColor } from "../components/ThemeToggle";

import { RouteError, RouteNotFound } from "../components/RouteError";

const NotFoundComponent = () => (
  <div className="min-h-screen">
    <RouteNotFound />
  </div>
);
const ErrorComponent = (props: { error: unknown; reset: () => void }) => (
  <div className="min-h-screen">
    <RouteError {...props} />
  </div>
);

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Usop — Find & rent parking" },
      {
        name: "description",
        content:
          "Usop is a two-sided parking marketplace: drivers find nearby spots, landowners rent their space.",
      },
      { name: "theme-color", content: "#443A78", media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: "#1B1730", media: "(prefers-color-scheme: dark)" },
      { property: "og:title", content: "Usop — Find & rent parking" },
      { property: "og:description", content: "Find nearby parking or rent out your space." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/favicon.png", type: "image/png", sizes: "64x64" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeMetaColor />
        <Outlet />
        <Toaster position="top-center" richColors />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
