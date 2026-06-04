import React from "react";
import { createRoot } from "react-dom/client";
import { StandaloneNewsHubApp } from "./StandaloneNewsHubApp";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StandaloneNewsHubApp />
  </React.StrictMode>
);
