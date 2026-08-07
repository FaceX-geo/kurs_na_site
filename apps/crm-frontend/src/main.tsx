import "@fontsource-variable/onest";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import "@/design/tokens.css";
import "@/styles/global.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("CRM root element is missing");
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
