// routes/facebook.js

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const qs = require('qs');

const router = express.Router();

const FB_VER = 'v21.0';
const FB_AUTH_BASE = 'https://www.facebook.com';
const FB_GRAPH = 'https://graph.facebook.com';

// Ask only what you need for review; you can add more later
const FB_SCOPES = [
  'pages_show_list',        // to list pages
  'pages_manage_posts',     // to publish to pages
  'pages_read_engagement',  // to read engagement
  'publish_video'
].join(',');

// -------------------------
// Token refresh (Facebook doesn’t support real refresh tokens)
// -------------------------
router.get('/facebook/refresh', (req, res) => {
  req.session.lastResult = {
    title: 'Facebook Token Refresh',
    error: 'Facebook user tokens do not support refresh. Please re-login if expired.'
  };
  res.redirect('/result');
});

// -------------------------
// Logout & unlink Facebook
// -------------------------
router.get('/logout/facebook', (req, res) => {
  req.tokens.fb = undefined;
  req.session.lastResult = {
    title: 'Facebook Logout',
    payload: 'Disconnected from Facebook.'
  };
  res.redirect('/result');
});

// -------------------------
// Step 1: Send user to Facebook OAuth
// -------------------------
router.get('/auth/facebook', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.fbState = state;

  const url =
    `${FB_AUTH_BASE}/${FB_VER}/dialog/oauth?` +
    qs.stringify({
      client_id: process.env.FB_APP_ID,
      redirect_uri: process.env.FB_REDIRECT_URI,
      state,
      scope: FB_SCOPES,
      response_type: 'code'
    });

  res.redirect(url);
});

// -------------------------
// Step 2: OAuth callback → exchange code for token
// -------------------------
router.get('/callback/facebook', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      req.session.lastResult = {
        title: 'Facebook OAuth Error',
        error: 'Missing code parameter from Facebook.'
      };
      return res.redirect('/result');
    }

    if (!state || state !== req.session.fbState) {
      req.session.lastResult = {
        title: 'Facebook OAuth Error',
        error: 'Invalid or missing state parameter.'
      };
      return res.redirect('/result');
    }

    let tokenResp;
    try {
      tokenResp = await axios.get(`${FB_GRAPH}/${FB_VER}/oauth/access_token`, {
        params: {
          client_id: process.env.FB_APP_ID,
          client_secret: process.env.FB_APP_SECRET,
          redirect_uri: process.env.FB_REDIRECT_URI,
          code
        }
      });
    } catch (tokenErr) {
      req.session.lastResult = {
        title: 'Facebook OAuth Error',
        error: tokenErr.response?.data?.error?.message || tokenErr.message || 'Failed to exchange code for token.'
      };
      return res.redirect('/result');
    }

    req.tokens.fb = {
      user_access_token: tokenResp.data.access_token,
      obtained_at: new Date().toISOString()
    };

    let pages;
    try {
      pages = await axios.get(`${FB_GRAPH}/${FB_VER}/me/accounts`, {
        params: { access_token: req.tokens.fb.user_access_token }
      });
    } catch (pagesErr) {
      req.session.lastResult = {
        title: 'Facebook OAuth Error',
        error: pagesErr.response?.data?.error?.message || pagesErr.message || 'Failed to fetch Facebook pages.'
      };
      return res.redirect('/result');
    }

    req.session.lastResult = {
      title: 'Facebook: Your Pages',
      payload: pages.data,
      token: req.tokens.fb.user_access_token
    };
    res.redirect('/result');
  } catch (err) {
    console.error('FB callback error:', err.response?.data || err.message);
    req.session.lastResult = {
      title: 'Facebook OAuth Error',
      error: err.response?.data?.error?.message || err.message || 'Facebook OAuth failed.'
    };
    res.redirect('/result');
  }
});

// -------------------------
// Get Page Access Token
// -------------------------
router.get('/facebook/page-token/:pageId', async (req, res) => {
  try {
    const { pageId } = req.params;
    const userToken = req.tokens.fb?.user_access_token;
    if (!userToken) return res.status(400).send('Login with Facebook first');

    const pages = await axios.get(`${FB_GRAPH}/${FB_VER}/me/accounts`, {
      params: { access_token: userToken }
    });

    const page = pages.data.data.find(p => p.id === pageId);
    if (!page) return res.status(404).send('Page not found or not managed by you');

    req.tokens.fb.page_access_token = page.access_token;

    req.session.lastResult = {
      title: `Facebook: Page Token for ${pageId}`,
      payload: { pageId, page_name: page.name, page_access_token: page.access_token }
    };
    res.redirect('/result');
  } catch (err) {
    console.error('FB page-token error:', err.response?.data || err.message);
    res.status(500).send('Unable to fetch page token.');
  }
});

// -------------------------
// Post a message to a Page
// -------------------------
router.post('/facebook/page-post/:pageId', async (req, res) => {
  try {
    const { pageId } = req.params;
    const message =
      req.body?.message || 'Test post from OAuth demo (for access verification).';

    let pageToken = req.tokens.fb?.page_access_token;
    if (!pageToken) {
      const pages = await axios.get(`${FB_GRAPH}/${FB_VER}/me/accounts`, {
        params: { access_token: req.tokens.fb?.user_access_token }
      });
      const page = pages.data.data.find(p => p.id === pageId);
      if (!page) return res.status(404).send('Page not found');
      pageToken = page.access_token;
      req.tokens.fb.page_access_token = pageToken;
    }

    const postResp = await axios.post(
      `${FB_GRAPH}/${FB_VER}/${pageId}/feed`,
      qs.stringify({ message }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        params: { access_token: pageToken }
      }
    );

    req.session.lastResult = {
      title: 'Facebook: Page Post Result',
      payload: postResp.data
    };
    res.redirect('/result');
  } catch (err) {
    console.error('FB page-post error:', err.response?.data || err.message);
    res.status(500).send('Page post failed.');
  }
});

module.exports = router;
