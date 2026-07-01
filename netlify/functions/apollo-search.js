// apollo-search.js — "Shop for Leads" search. Free (no Apollo credits, no emails).
const { json, requireAuth, safe } = require('./_lib/core');
const { supabase } = require('./_lib/supabase');
const apollo = require('./_lib/apollo');

function arr(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

const _handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!requireAuth(event)) return json(401, { error: 'unauthorized' });
  if (!apollo.connected()) return json(400, { code: 'apollo_not_connected', error: 'Apollo is not connected. Add APOLLO_API_KEY in Netlify, then redeploy.' });

  let p; try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }

  const criteria = {
    titles: arr(p.titles),
    locations: arr(p.locations),
    company_names: arr(p.company_name),
    org_domains: arr(p.org_domains),
    include_similar_titles: !!p.include_similar_titles,
    per_page: 100,
  };
  const page = Math.max(1, parseInt(p.page, 10) || 1);

  let data;
  try { data = await apollo.searchPeople(criteria, page); }
  catch (e) { return json(502, { error: e.message || 'Apollo search failed' }); }

  const raw = (data.people || []);

  // Drop anyone we've already acted on (imported, or skipped as duplicate/
  // suppressed/no-email) so the same contact never appears — or gets imported — twice.
  const ids = raw.map((x) => x.id).filter(Boolean);
  let seenSet = new Set();
  if (ids.length) {
    const { data: seenRows } = await supabase
      .from('prospect_seen').select('apollo_person_id').in('apollo_person_id', ids);
    seenSet = new Set((seenRows || []).map((r) => r.apollo_person_id));
  }

  const people = raw.filter((x) => !seenSet.has(x.id)).map((x) => {
    const org = x.organization || {};
    const last = x.last_name || x.last_name_obfuscated || '';
    return {
      apollo_id: x.id,
      first_name: x.first_name || '',
      last_name: last,
      last_obfuscated: !x.last_name && !!x.last_name_obfuscated,
      title: x.title || '',
      company: org.name || x.organization_name || '',
      domain: org.primary_domain || org.website_url || '',
      city: x.city || '',
      state: x.state || '',
      country: x.country || '',
      linkedin_url: x.linkedin_url || '',
      has_email: x.has_email !== undefined ? !!x.has_email : true,
    };
  });

  const pg = data.pagination || {};
  return json(200, {
    people,
    pagination: {
      page: pg.page || page,
      per_page: pg.per_page || criteria.per_page,
      total_entries: pg.total_entries || 0,
      total_pages: pg.total_pages || 0,
    },
  });
};

exports.handler = safe(_handler);
