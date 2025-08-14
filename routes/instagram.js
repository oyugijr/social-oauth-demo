// routes/instagram.js
// Instagram via Graph API: login through Meta OAuth, then show linked IG business account.
// Keep it simple for review; posting requires extra setup/permissions.

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const qs = require('qs');

const router = express.Router();

const FB_VER = 'v21.0';
const FB_AUTH_BASE = 'https://www.facebook.com';
const FB_GRAPH = 'https://graph.facebook.com';

// For IG basic info + mapping Pages -> IG business account
const IG_SCOPES = [
  'pages_show_list',
  'instagram_basic'
  // add 'instagram_content_publish' later if you plan to publish
].join(',');

// Step 1: start OAuth (Meta)
router.get('/auth/instagram', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.igState = state;

  const url =
    `${FB_AUTH_BASE}/${FB_VER}/dialog/oauth?` +
    qs.stringify({
      client_id: process.env.IG_APP_ID,
      redirect_uri: process.env.IG_REDIRECT_URI,
      state,
      scope: IG_SCOPES,
      response_type: 'code'
    });
  res.redirect(url);
});

// Step 2: callback → user token → list Pages → map to IG business account
router.get('/callback/instagram', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) {
      req.session.lastResult = {
        title: 'Instagram OAuth Error',
        error: 'Missing code parameter from Instagram.'
      };
      return res.redirect('/result');
    }
    if (!state || state !== req.session.igState) {
      req.session.lastResult = {
        title: 'Instagram OAuth Error',
        error: 'Invalid or missing state parameter.'
      };
      return res.redirect('/result');
    }

    let tokenResp;
    try {
      tokenResp = await axios.get(`${FB_GRAPH}/${FB_VER}/oauth/access_token`, {
        params: {
          client_id: process.env.IG_APP_ID,
          client_secret: process.env.IG_APP_SECRET,
          redirect_uri: process.env.IG_REDIRECT_URI,
          code
        }
      });
    } catch (tokenErr) {
      req.session.lastResult = {
        title: 'Instagram OAuth Error',
        error: tokenErr.response?.data?.error?.message || tokenErr.message || 'Failed to exchange code for token.'
      };
      return res.redirect('/result');
    }

    req.tokens.ig = {
      user_access_token: tokenResp.data.access_token,
      obtained_at: new Date().toISOString()
    };

    let pages;
    try {
      pages = await axios.get(`${FB_GRAPH}/${FB_VER}/me/accounts`, {
        params: { access_token: req.tokens.ig.user_access_token, fields: 'id,name' }
      });
    } catch (pagesErr) {
      req.session.lastResult = {
        title: 'Instagram OAuth Error',
        error: pagesErr.response?.data?.error?.message || pagesErr.message || 'Failed to fetch Facebook pages.'
      };
      return res.redirect('/result');
    }

    // For each page, try to find linked IG Business Account
    const results = [];
    for (const p of pages.data.data) {
      try {
        const pageInfo = await axios.get(`${FB_GRAPH}/${FB_VER}/${p.id}`, {
          params: {
            fields: 'name,instagram_business_account{id,username}',
            access_token: req.tokens.ig.user_access_token
          }
        });
        results.push(pageInfo.data);
      } catch (pageInfoErr) {
        results.push({
          id: p.id,
          name: p.name,
          error: pageInfoErr.response?.data?.error?.message || pageInfoErr.message || 'Failed to fetch IG business account.'
        });
      }
    }

    req.session.lastResult = {
      title: 'Instagram: Linked IG Business Accounts (via Pages)',
      payload: results,
      token: req.tokens.ig.user_access_token
    };
    res.redirect('/result');
  } catch (err) {
    console.error('IG callback error:', err.response?.data || err.message);
    req.session.lastResult = {
      title: 'Instagram OAuth Error',
      error: err.response?.data?.error?.message || err.message || 'Instagram Auth failed.'
    };
    res.redirect('/result');
  }
});

module.exports = router;
