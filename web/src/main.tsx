import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./tokens.css";
import "./screens.css";

const Gallery = import.meta.env.DEV && location.search === "?ui" ? lazy(() => import("./Gallery.tsx")) : null;

createRoot(document.getElementById("root")!).render(
  Gallery ? (
    <Suspense>
      <Gallery />
    </Suspense>
  ) : (
    <App />
  ),
);
