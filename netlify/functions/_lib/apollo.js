// Apollo.io API client. Two operations power "Shop for Leads":
//   1. searchPeople  — net-new prospect search. FREE (no credits), returns NO email.
//   2. enrichPerson  — reveal a person's work email. COSTS 1 credit per person.
// Auth is the X-Api-Key header (requires a master key). Search params must be
// sent in the URL query string, not the body.
const BASE = 'https://api.apollo.io/api/v1';

function connected() { return Boolean(process.env.APOLLO_API_KEY && String(process.env.APOLLO_API_KEY).trim()); }
function apolloKey() {
  const k = process.env.APOLLO_API_KEY;
  if (!k) throw new Error('APOLLO_API_KEY is not set');
  return k.trim();
}

function qs(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      v.filter((x) => x !== undefined && x !== null && String(x).trim() !== '')
        .forEach((x) => parts.push(`${encodeURIComponent(k)}[]=${encodeURIComponent(String(x).trim())}`));
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.join('&');
}

async function apolloFetch(path, { method = 'POST', query, body } = {}) {
  const url = `${BASE}${path}${query ? `?${query}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      'X-Api-Key': apolloKey(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    let msg = (data && (data.message || data.error)) || `Apollo error ${res.status}`;
    if (typeof msg !== 'string') msg = `Apollo error ${res.status}`;
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return data;
}

// People search — net-new prospects. No credits consumed; no emails returned.
async function searchPeople(criteria = {}, page = 1) {
  const query = qs({
    person_titles: criteria.titles,
    person_seniorities: criteria.seniorities,
    person_locations: criteria.locations,
    organization_locations: criteria.org_locations,
    organization_num_employees_ranges: criteria.employee_ranges,
    q_organization_domains_list: criteria.org_domains,
    q_organization_keyword_tags: criteria.org_keywords,
    q_keywords: criteria.keywords,
    include_similar_titles: criteria.include_similar_titles ? 'true' : undefined,
    page,
    per_page: criteria.per_page || 25,
  });
  return apolloFetch('/mixed_people/api_search', { query });
}

// Enrich one person (by Apollo id, or name + domain) to reveal the work email.
// Consumes 1 Apollo credit when a match with data is returned.
async function enrichPerson({ id, first_name, last_name, organization_name, domain }) {
  const body = {};
  if (id) body.id = id;
  if (first_name) body.first_name = first_name;
  if (last_name) body.last_name = last_name;
  if (organization_name) body.organization_name = organization_name;
  if (domain) body.domain = domain;
  return apolloFetch('/people/match', { body });
}

module.exports = { connected, searchPeople, enrichPerson };
