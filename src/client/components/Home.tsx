import { useState } from "react";
import { ArrowRight, Plus, Search, Upload, X } from "lucide-react";
import { projectPath } from "../../shared/urls";
import { navigate } from "../lib/router";
import { forgetProject, rememberProject, useRecentProjects } from "../lib/recent";
import { pickJsonFile, uploadProject } from "../lib/files";
import { Logo, ThemeToggle, timeAgo } from "./ui";

export function Home() {
  const recent = useRecentProjects();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const filtered = query
    ? recent.filter((p) => `${p.title} ${p.id}`.toLowerCase().includes(query.toLowerCase()))
    : recent;

  const importNew = async () => {
    setError(null);
    try {
      const file = await pickJsonFile();
      if (!file) return;
      setImporting(true);
      const id = crypto.randomUUID();
      const doc = await uploadProject(id, file.data);
      rememberProject(id, doc.title);
      navigate(projectPath(id, doc.title));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="home">
      <header className="topbar">
        <a href="/" className="brand" onClick={(e) => e.preventDefault()}>
          <Logo />
          <span>Kanban</span>
        </a>
        <div className="topbar-actions">
          <ThemeToggle />
        </div>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <h1>Shared boards, no sign-up.</h1>
          <p>Create a project and share the link. Anyone who has it can view and edit in real time.</p>
          <div className="home-actions">
            <button type="button" className="btn btn-primary" onClick={() => navigate(`/p/${crypto.randomUUID()}`)}>
              <Plus size={16} />
              New project
            </button>
            <button type="button" className="btn" onClick={importNew} disabled={importing}>
              <Upload size={15} />
              {importing ? "Importing…" : "Import JSON"}
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
        </section>

        <section className="recent">
          <div className="recent-header">
            <h2>Recent projects</h2>
            {recent.length > 5 && (
              <label className="search">
                <Search size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter"
                  aria-label="Filter recent projects"
                />
              </label>
            )}
          </div>

          {recent.length === 0 ? (
            <div className="recent-empty">
              Projects you open in this browser will show up here. They're stored locally — keep the link to get back to
              a project from another device.
            </div>
          ) : filtered.length === 0 ? (
            <div className="recent-empty">No projects match “{query}”.</div>
          ) : (
            <ul className="recent-list">
              {filtered.map((p) => (
                <li key={p.id}>
                  <a
                    href={projectPath(p.id, p.title)}
                    className="recent-item"
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                      e.preventDefault();
                      navigate(projectPath(p.id, p.title));
                    }}
                  >
                    <span className="recent-title">{p.title || "Untitled project"}</span>
                    <span className="recent-meta">
                      <code>{p.id.slice(0, 8)}</code>
                      <span>{timeAgo(p.visitedAt)}</span>
                    </span>
                    <ArrowRight size={15} className="recent-arrow" />
                  </a>
                  <button
                    type="button"
                    className="icon-btn recent-remove"
                    title="Remove from history"
                    aria-label={`Remove ${p.title || "project"} from history`}
                    onClick={() => forgetProject(p.id)}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
