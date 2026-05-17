import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronRight } from "lucide-react";
import { api } from "../api.js";
import { translations } from "../i18n.js";

function renderGuideContent(content = "") {
  const lines = String(content).split(/\r?\n/);
  const nodes = [];
  let listItems = [];
  const imagePattern = /^!\[(.*?)\]\((https?:\/\/[^\s)]+)\)$/i;

  function flushList() {
    if (!listItems.length) return;
    nodes.push(
      <ul key={`list-${nodes.length}`} className="guideArticleList">
        {listItems.map((item, index) => <li key={index}>{item}</li>)}
      </ul>
    );
    listItems = [];
  }

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }
    if (line.startsWith("# ")) {
      flushList();
      nodes.push(<h2 key={index}>{line.slice(2)}</h2>);
      return;
    }
    if (line.startsWith("## ")) {
      flushList();
      nodes.push(<h3 key={index}>{line.slice(3)}</h3>);
      return;
    }
    const imageMatch = line.match(imagePattern);
    if (imageMatch) {
      flushList();
      nodes.push(
        <figure className="guideImage" key={index}>
          <img src={imageMatch[2]} alt={imageMatch[1] || "Guide image"} loading="lazy" referrerPolicy="no-referrer" />
          {imageMatch[1] && <figcaption>{imageMatch[1]}</figcaption>}
        </figure>
      );
      return;
    }
    if (line.startsWith("- ")) {
      listItems.push(line.slice(2));
      return;
    }
    flushList();
    nodes.push(<p key={index}>{line}</p>);
  });

  flushList();
  return nodes;
}

export default function Guide({ language = "vi" }) {
  const t = translations[language] || translations.vi;
  const [articles, setArticles] = useState([]);
  const [activeSlug, setActiveSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    api(`/api/guides?language=${language}`)
      .then((data) => {
        const nextArticles = data.articles || [];
        setArticles(nextArticles);
        setActiveSlug((current) => {
          if (nextArticles.some((item) => item.slug === current)) return current;
          return nextArticles[0]?.slug || "";
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [language]);

  const activeArticle = useMemo(
    () => articles.find((item) => item.slug === activeSlug) || articles[0],
    [activeSlug, articles]
  );

  return (
    <div className="stack">
      <section className="panel">
        <h2>
          <BookOpen size={20} color="var(--neon-cyan)" />
          {t.guide}
        </h2>
        <p className="muted">{t.guideIntro}</p>
      </section>

      <section className="guideLayout">
        <aside className="panel guideSidebar">
          <h3>{t.guideList}</h3>
          {loading && <p className="muted">{t.loading}</p>}
          {error && <p className="error">{error}</p>}
          {!loading && !articles.length && <p className="muted">{t.noGuides}</p>}
          <div className="guideNav">
            {articles.map((article) => (
              <button
                key={article._id}
                type="button"
                className={activeArticle?.slug === article.slug ? "active" : ""}
                onClick={() => setActiveSlug(article.slug)}
              >
                <span>{article.title}</span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        </aside>

        <article className="panel guideArticle">
          {activeArticle ? (
            <>
              <h2>{activeArticle.title}</h2>
              {activeArticle.coverImage && (
                <figure className="guideImage guideCoverImage">
                  <img src={activeArticle.coverImage} alt={activeArticle.title} loading="lazy" referrerPolicy="no-referrer" />
                </figure>
              )}
              {activeArticle.summary && <p className="guideSummary">{activeArticle.summary}</p>}
              <div className="guideArticleBody">
                {renderGuideContent(activeArticle.content)}
              </div>
            </>
          ) : (
            <p className="muted">{loading ? t.loading : t.noGuides}</p>
          )}
        </article>
      </section>
    </div>
  );
}
