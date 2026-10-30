export const GUIDE_LANGUAGES = ["vi", "en"];
export const GUIDE_TEXT_LIMITS = { title: 160, summary: 500, content: 20000 };

export function hasGuideTranslation(translation) {
  return Boolean(translation?.title?.trim() && translation?.content?.trim());
}

export function guideTranslations(article = {}) {
  const translations = {};
  for (const language of GUIDE_LANGUAGES) {
    const source = article.translations?.[language];
    translations[language] = Object.fromEntries(
      Object.keys(GUIDE_TEXT_LIMITS).map((key) => [key, String(source?.[key] || "")])
    );
  }
  // Legacy articles stay editable without a database migration.
  const originalLanguage = article.language === "en" ? "en" : "vi";
  if (!hasGuideTranslation(translations[originalLanguage]) && hasGuideTranslation(article)) {
    for (const key of Object.keys(GUIDE_TEXT_LIMITS)) {
      translations[originalLanguage][key] = String(article[key] || "");
    }
  }
  return translations;
}

export function localizeGuide(article, language) {
  const translations = guideTranslations(article);
  const availableLanguages = GUIDE_LANGUAGES.filter((key) => hasGuideTranslation(translations[key]));
  const contentLanguage = availableLanguages.includes(language) ? language
    : availableLanguages.includes(article.language) ? article.language : availableLanguages[0];
  const { translations: _translations, ...shared } = article;
  return { ...shared, ...translations[contentLanguage], language: contentLanguage, availableLanguages };
}
