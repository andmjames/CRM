// Thin API layer. All calls hit /api/* which Netlify redirects to functions.
const TOKEN = process.env.REACT_APP_ACCESS_TOKEN || '';

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-access-token': TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  overview: () => call('overview'),
  getLead: (id) => call(`get-lead?id=${encodeURIComponent(id)}`),
  createLead: (lead) => call('create-lead', { method: 'POST', body: lead }),
  updateLead: (patch) => call('update-lead', { method: 'POST', body: patch }),
  deleteLead: (id) => call('delete-lead', { method: 'POST', body: { id } }),
  importLeads: (campaign_id, rows) => call('import-leads', { method: 'POST', body: { campaign_id, rows } }),
  updateAction: (patch) => call('update-action', { method: 'POST', body: patch }),
  upcoming: () => call('upcoming'),
  getCampaigns: () => call('campaigns'),
  createCampaign: (c) => call('campaigns', { method: 'POST', body: c }),
  updateCampaign: (c) => call('campaigns', { method: 'PUT', body: c }),
  deleteCampaign: (id) => call('campaigns', { method: 'DELETE', body: { id } }),
  getSettings: () => call('settings'),
  saveSettings: (s) => call('settings', { method: 'POST', body: s }),
  // Reply Playbook
  gmailAuthUrl: () => call('gmail-auth-start'),
  playbookStatus: () => call('playbook-control'),
  playbookStart: (months, replies_only) => call('playbook-control', { method: 'POST', body: { action: 'start', months, replies_only } }),
  playbookControl: (action, id) => call('playbook-control', { method: 'POST', body: { action, id } }),
  playbookRules: () => call('playbook-rules'),
  playbookRuleAction: (body) => call('playbook-rules', { method: 'POST', body }),
  emailInstructions: () => call('email-instructions'),
  saveEmailInstructions: (scope, instructions) => call('email-instructions', { method: 'POST', body: { scope, instructions } }),
  // Shop for Leads (Apollo.io)
  health: () => call('health'),
  apolloSearch: (body) => call('apollo-search', { method: 'POST', body }),
  apolloImport: (campaign_id, people) => call('apollo-import', { method: 'POST', body: { campaign_id, people } }),
};
