export function articleTranslations(article = {}) {
  const translations = Object.fromEntries(["vi", "en"].map((language) => [language, {
    title: article.translations?.[language]?.title || "",
    summary: article.translations?.[language]?.summary || "",
    content: article.translations?.[language]?.content || ""
  }]));
  const originalLanguage = article.language === "en" ? "en" : "vi";
  if (!translationComplete(translations[originalLanguage]) && translationComplete(article)) {
    translations[originalLanguage] = {
      title: article.title, summary: article.summary || "", content: article.content
    };
  }
  return translations;
}

export function translationComplete(translation) {
  return Boolean(translation?.title?.trim() && translation?.content?.trim());
}
