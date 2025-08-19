// routes/instagram.js

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const qs = require('qs');

const router = express.Router();

// Facebook/Instagram Graph API constants
const FB_VER = 'v21.0';
const FB_AUTH_BASE = 'https://www.facebook.com';
const FB_GRAPH = 'https://graph.facebook.com';

// Scopes required for Instagram Graph API
const IG_SCOPES = [
  'instagram_basic',      // required to access Instagram accounts
  'pages_show_list',      // needed to fetch linked Pages
  'business_management',  // required for mapping Page -> IG account
  'ads_management',       // optional, often required for IG business
  'pages_manage_posts'    // posting to IG via linked Pages
].join(',');

// -------------------------
// Step 1: Start OAuth
// -------------------------
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

// -------------------------
// Step 2: Callback → User token → Find IG Business Accounts
// -------------------------
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

    // Exchange code → token
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
        error:
          tokenErr.response?.data?.error?.message ||
          tokenErr.message ||
          'Failed to exchange code for token.'
      };
      return res.redirect('/result');
    }

    req.tokens.ig = {
      user_access_token: tokenResp.data.access_token,
      obtained_at: new Date().toISOString()
    };

    // Get Pages the user manages
    let pages;
    try {
      pages = await axios.get(`${FB_GRAPH}/${FB_VER}/me/accounts`, {
        params: {
          access_token: req.tokens.ig.user_access_token,
          fields: 'id,name'
        }
      });
    } catch (pagesErr) {
      req.session.lastResult = {
        title: 'Instagram OAuth Error',
        error:
          pagesErr.response?.data?.error?.message ||
          pagesErr.message ||
          'Failed to fetch Facebook pages.'
      };
      return res.redirect('/result');
    }

    // For each page, check linked IG Business Account
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
          error:
            pageInfoErr.response?.data?.error?.message ||
            pageInfoErr.message ||
            'Failed to fetch IG business account.'
        });
      }
    }

    req.session.lastResult = {
      title: 'Instagram: Linked IG Business Accounts',
      payload: results,
      token: req.tokens.ig.user_access_token
    };
    res.redirect('/result');
  } catch (err) {
    console.error('IG callback error:', err.response?.data || err.message);
    req.session.lastResult = {
      title: 'Instagram OAuth Error',
      error:
        err.response?.data?.error?.message ||
        err.message ||
        'Instagram Auth failed.'
    };
    res.redirect('/result');
  }
});

// -------------------------
// Post to Instagram Business Account
// -------------------------
// 2-step publishing: upload container → publish
router.post('/instagram/post/:igUserId', async (req, res) => {
  try {
    const { igUserId } = req.params;
    const { imageUrl, caption } = req.body;
    const userToken = req.tokens.ig?.user_access_token;

    if (!userToken) {
      return res.status(400).send('Login with Instagram first');
    }

    // Step 1: Create media container
    const mediaResp = await axios.post(
      `${FB_GRAPH}/${FB_VER}/${igUserId}/media`,
      qs.stringify({
        image_url: imageUrl,
        caption: caption || 'Test post from OAuth demo'
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        params: { access_token: userToken }
      }
    );

    // Step 2: Publish the media
    const publishResp = await axios.post(
      `${FB_GRAPH}/${FB_VER}/${igUserId}/media_publish`,
      qs.stringify({ creation_id: mediaResp.data.id }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        params: { access_token: userToken }
      }
    );

    req.session.lastResult = {
      title: 'Instagram: Post Result',
      payload: publishResp.data
    };
    res.redirect('/result');
  } catch (err) {
    console.error('IG post error:', err.response?.data || err.message);
    res.status(500).send('Instagram post failed.');
  }
});

module.exports = router;
