// Google OAuth redirect target. Exchanges the code for tokens and stores the
// refresh token so the miner can read sent mail from a cron. Public by necessity
// (Google redirects the browser here); only a valid code for our client works.
const gmail = require('./_lib/gmail');

function page(msg) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui,-apple-system,sans-serif;padding:40px;max-width:520px;margin:0 auto;color:#111"><h2>PMI CRM</h2><p style="font-size:16px;line-height:1.5">${msg}</p></body></html>`,
  };
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  if (q.error) return page(`Authorization was cancelled (${q.error}).`);
  if (!q.code) return page('Missing authorization code.');
  try {
    const email = await gmail.storeTokensFromCode(q.code);
    return page(`Gmail connected for <b>${email || 'your account'}</b>. You can close this tab and return to the CRM.`);
  } catch (e) {
    return page(`Could not connect Gmail: ${e.message}`);
  }
};
