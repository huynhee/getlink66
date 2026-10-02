export function marketplacePriceLabels(settings = {}) {
  const label = (value) => {
    const price = Number(value);
    return Number.isSafeInteger(price) && price > 0 ? String(price) : "...";
  };
  return {
    model: label(settings.marketplaceModelCreditPrice),
    scene: label(settings.marketplaceSceneCreditPrice),
  };
}
