import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { QueryProvider } from "./app/providers/QueryProvider";
import { ErrorBoundary } from "./app/ErrorBoundary";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryProvider>
      <ErrorBoundary><App /></ErrorBoundary>
    </QueryProvider>
  </StrictMode>
);

