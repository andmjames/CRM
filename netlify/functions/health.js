// health.js — dependency-free diagnostic. Reports whether each env var is present
// (true/false only — never the actual values). Hit /api/health to check config.
exports.handler = async () => {
  const present = (k) => Boolean(process.env[k] && String(process.env[k]).trim());
  const body = {
    ok: present('SUPABASE_URL') && present('SUPABASE_SERVICE_ROLE_KEY'),
    env: {
      SUPABASE_URL: present('SUPABASE_URL'),
      SUPABASE_SERVICE_ROLE_KEY: present('SUPABASE_SERVICE_ROLE_KEY'),
      FRONT_API_TOKEN: present('FRONT_API_TOKEN'),
      FRONT_AUTHOR_ID: present('FRONT_AUTHOR_ID'),
      ANTHROPIC_API_KEY: present('ANTHROPIC_API_KEY'),
      APP_ACCESS_TOKEN: present('APP_ACCESS_TOKEN'),
      APOLLO_API_KEY: present('APOLLO_API_KEY'),
    },
    node: process.version,
    time: new Date().toISOString(),
  };
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body, null, 2),
  };
};
