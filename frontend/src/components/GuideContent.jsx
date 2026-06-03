import React from "react";

export function renderGuideContent(content = "") {
  const lines = String(content).split(/\r?\n/);
  const nodes = [];
  let listItems = [];
  const imagePattern = /^!\[(.*?)\]\((https?:\/\/[^\s)]+)\)$/i;
  const youtubePattern = /^@\[youtube\]\((https?:\/\/[^\s)]+)\)$/i;

  function youtubeEmbedUrl(value) {
    try {
      const url = new URL(value);
      let videoId = "";
      if (url.hostname === "youtu.be") {
        videoId = url.pathname.split("/").filter(Boolean)[0] || "";
      } else if (/(\.|^)youtube\.com$/i.test(url.hostname)) {
        if (url.pathname.startsWith("/watch")) videoId = url.searchParams.get("v") || "";
        if (url.pathname.startsWith("/shorts/")) videoId = url.pathname.split("/").filter(Boolean)[1] || "";
        if (url.pathname.startsWith("/embed/")) videoId = url.pathname.split("/").filter(Boolean)[1] || "";
      }
      if (!/^[\w-]{6,20}$/.test(videoId)) return "";
      return `https://www.youtube-nocookie.com/embed/${videoId}`;
    } catch {
      return "";
    }
  }

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
    const youtubeMatch = line.match(youtubePattern);
    if (youtubeMatch) {
      flushList();
      const embedUrl = youtubeEmbedUrl(youtubeMatch[1]);
      if (embedUrl) {
        nodes.push(
          <div className="guideVideo" key={index}>
            <iframe
              src={embedUrl}
              title="YouTube video"
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        );
      }
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

export default function GuideContent({ content = "" }) {
  return renderGuideContent(content);
}
