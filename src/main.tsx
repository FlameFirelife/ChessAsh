import React from "react";
import { createRoot } from "react-dom/client";
import { LanguageProvider } from "./i18n";
import App from "./App";
import "./styles.css";
import "./refinements.css";
import "./playful.css";
import "./review-layout.css";
import './safe-area.css';
import './mobile-review.css';
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider><App /></LanguageProvider>
  </React.StrictMode>,
);
