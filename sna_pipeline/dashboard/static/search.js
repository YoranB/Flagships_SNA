(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DashboardSearch = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const FIELD_CONFIG = [
    ['keywords', 5, 'Keyword match'],
    ['summary', 3, 'Summary match'],
    ['proposalTitleTheme', 2, 'Proposal title/theme match'],
    ['proposalSummary', 1, 'Proposal text match'],
    ['department', 1, 'Department match'],
  ];

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function queryTokens(query) {
    return [...new Set(normalizeText(query).split(/\s+/).filter(Boolean))];
  }

  function scoreDocument(document, query) {
    const normalizedQuery = normalizeText(query);
    const tokens = queryTokens(query);
    if (!normalizedQuery || !tokens.length) return { textScore: 0, reasons: [] };

    let textScore = 0;
    const reasons = [];
    for (const [field, weight, reason] of FIELD_CONFIG) {
      const text = normalizeText(document?.[field]);
      if (!text) continue;
      const matchedTokens = tokens.filter(token => text.includes(token)).length;
      if (!matchedTokens) continue;
      let fieldScore = weight * matchedTokens;
      if (text.includes(normalizedQuery)) fieldScore *= 2;
      textScore += fieldScore;
      reasons.push(reason);
    }
    return { textScore, reasons };
  }

  function rank(items, query, documentForItem) {
    const matches = items.map(item => ({
      item,
      ...scoreDocument(documentForItem(item), query),
    })).filter(match => match.textScore > 0);

    const maxBetweenness = Math.max(0, ...matches.map(match => Number(match.item.betweenness || 0)));
    const maxWeighted = Math.max(0, ...matches.map(match => Math.log1p(Number(match.item.weighted_degree || 0))));
    const maxFlagships = Math.max(0, ...matches.map(match => Math.log1p(Number(match.item.n_flagships || 0))));

    for (const match of matches) {
      const betweenness = maxBetweenness ? Number(match.item.betweenness || 0) / maxBetweenness : 0;
      const weighted = maxWeighted ? Math.log1p(Number(match.item.weighted_degree || 0)) / maxWeighted : 0;
      const flagships = maxFlagships ? Math.log1p(Number(match.item.n_flagships || 0)) / maxFlagships : 0;
      match.networkPosition = Math.min(1, 0.5 * betweenness + 0.3 * weighted + 0.2 * flagships);
      match.score = match.textScore * (1 + 0.2 * match.networkPosition);
    }

    return matches.sort((left, right) =>
      right.score - left.score ||
      right.textScore - left.textScore ||
      String(left.item.name || '').localeCompare(String(right.item.name || ''))
    );
  }

  return { FIELD_CONFIG, normalizeText, queryTokens, scoreDocument, rank };
}));
