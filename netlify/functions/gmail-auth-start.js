// Returns the Google consent URL for connecting Gmail (read-only) to the miner.
const { json, requireAuth, safe } = require('./_lib/core');
const gmail = require('./_lib/gmail');

const _handler = async (event) => {
  if (!requireAuth(event)) return json(401, { error: 'unauthorized' });
  if (!process.env.GOOGLE_CLIENT_ID) return json(400, { error: 'GOOGLE_CLIENT_ID not set' });
  return json(200, { url: gmail.consentUrl() });
};

exports.handler = safe(_handler);
