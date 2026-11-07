import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { QueryProvider } from "./app/providers/QueryProvider";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { LocaleProvider } from "./shared/i18n/locale";
import "./styles.css";

createRoot(document.getElementById("root")!, {
  // Boundaries report fixed reason codes without React's default raw-error log.
  onCaughtError: () => {},
}).render(
  <StrictMode>
    <QueryProvider>
      <LocaleProvider><ErrorBoundary><App /></ErrorBoundary></LocaleProvider>
    </QueryProvider>
  </StrictMode>
);

