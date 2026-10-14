import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { parseProjectPath } from "../shared/urls";
import { ProjectPage } from "./components/ProjectPage";
import { Home } from "./components/Home";
import { usePathname } from "./lib/router";

function App() {
  const path = usePathname();
  // /p/<name>/<uuid>[/docs[/<documentId>]]; the name is cosmetic and ignored.
  const route = parseProjectPath(path);
  if (route) {
    // Keyed by project only, so switching tabs keeps the live connection.
    return <ProjectPage key={route.id} projectId={route.id} view={route.view} />;
  }
  return <Home />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
