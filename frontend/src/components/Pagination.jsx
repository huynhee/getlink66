import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

function buildPageItems(currentPage, totalPages) {
  const total = Math.max(1, Number(totalPages) || 1);
  const current = Math.min(total, Math.max(1, Number(currentPage) || 1));
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((page) => pages.add(page));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((page) => pages.add(page));

  const ordered = Array.from(pages)
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);

  return ordered.flatMap((page, index) => {
    if (!index || page - ordered[index - 1] === 1) return [page];
    return [`gap-${ordered[index - 1]}-${page}`, page];
  });
}

export default function Pagination({
  page = 1,
  totalPages = 1,
  onPageChange,
  loading = false,
  language = "vi",
}) {
  const safeTotalPages = Math.max(1, Number(totalPages) || 1);
  const safePage = Math.min(safeTotalPages, Math.max(1, Number(page) || 1));
  const [jumpPage, setJumpPage] = useState(String(safePage));
  const pageItems = useMemo(
    () => buildPageItems(safePage, safeTotalPages),
    [safePage, safeTotalPages],
  );
  const isVi = language !== "en";

  useEffect(() => {
    setJumpPage(String(safePage));
  }, [safePage]);

  function changePage(nextPage) {
    const normalized = Math.min(safeTotalPages, Math.max(1, Number(nextPage) || 1));
    if (!loading && normalized !== safePage) onPageChange?.(normalized);
  }

  function submitJump(event) {
    event.preventDefault();
    changePage(jumpPage);
  }

  return (
    <nav className="appPagination" aria-label={isVi ? "Phân trang" : "Pagination"}>
      <div className="appPaginationPages">
        <button
          type="button"
          className="appPaginationArrow"
          disabled={safePage <= 1 || loading}
          onClick={() => changePage(safePage - 1)}
          aria-label={isVi ? "Trang trước" : "Previous page"}
        >
          <ChevronLeft size={16} />
        </button>
        {pageItems.map((item) => (
          typeof item === "number" ? (
            <button
              type="button"
              key={item}
              className={item === safePage ? "active" : ""}
              disabled={loading}
              onClick={() => changePage(item)}
              aria-current={item === safePage ? "page" : undefined}
              aria-label={`${isVi ? "Trang" : "Page"} ${item}`}
            >
              {item}
            </button>
          ) : (
            <span className="appPaginationGap" key={item} aria-hidden="true">...</span>
          )
        ))}
        <button
          type="button"
          className="appPaginationArrow"
          disabled={safePage >= safeTotalPages || loading}
          onClick={() => changePage(safePage + 1)}
          aria-label={isVi ? "Trang sau" : "Next page"}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <form className="appPaginationJump" onSubmit={submitJump}>
        <label htmlFor={`pagination-jump-${safeTotalPages}`}>
          {isVi ? "Đến trang" : "Go to"}
        </label>
        <input
          id={`pagination-jump-${safeTotalPages}`}
          type="number"
          min="1"
          max={safeTotalPages}
          value={jumpPage}
          onChange={(event) => setJumpPage(event.target.value)}
          aria-label={isVi ? "Nhập số trang" : "Enter page number"}
        />
        <span>{isVi ? "trang" : "page"}</span>
      </form>
    </nav>
  );
}
