const assert = require('assert');
const search = require('../sna_pipeline/dashboard/static/search.js');

const document = {
  keywords: 'Artificial Intelligence; Data Science',
  summary: 'Uses AI for clinical prevention and epidemiology.',
  proposalTitleTheme: 'Prevention platform',
  proposalSummary: 'A population health project.',
  department: 'Epidemiology',
};

assert.deepStrictEqual(search.queryTokens('Data science data'), ['data', 'science']);
assert.strictEqual(search.scoreDocument(document, 'not-present').textScore, 0);

const keyword = search.scoreDocument(document, 'data science');
assert.strictEqual(keyword.textScore, 20, 'two keyword tokens with exact phrase must be doubled');
assert.deepStrictEqual(keyword.reasons, ['Keyword match']);

const epidemiology = search.scoreDocument(document, 'epidemiology');
assert(epidemiology.reasons.includes('Summary match'));
assert(epidemiology.reasons.includes('Department match'));

const ranked = search.rank([
  { name: 'Text First', betweenness: 0, weighted_degree: 0, n_flagships: 0, doc: { keywords: 'AI AI' } },
  { name: 'Network First', betweenness: 1, weighted_degree: 100, n_flagships: 10, doc: { department: 'AI' } },
], 'AI', item => item.doc);

assert.strictEqual(ranked[0].item.name, 'Text First', 'text relevance must dominate network position');
for (const match of ranked) {
  assert(match.networkPosition >= 0 && match.networkPosition <= 1);
  assert(match.score <= match.textScore * 1.2 + Number.EPSILON, 'network multiplier must be capped at 20%');
}

console.log('dashboard search tests passed');
