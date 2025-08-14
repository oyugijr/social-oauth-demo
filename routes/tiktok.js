// routes/tiktok.js
// TikTok OAuth + basic user.info fetch (scopes: user.info.basic).
// Upload/publish can be added later (video.upload, video.publish).

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const qs = require('qs');

const router = express.Router();

const TT_AUTH = 'https://www.tiktok.com/v2/auth/authorize/';
const TT_TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';
const TT_API = 'https://open.tiktokapis.com/v2';

// request only what you can demo first; add video scopes later
const TT_SCOPES = ['user.info.basic'].join(' ');

// Step 1: send to TikTok OAuth
router.get('/auth/tiktok', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.ttState = state;

  // PKCE: generate code_verifier and code_challenge
  const code_verifier = crypto.randomBytes(32).toString('base64url');
  req.session.ttCodeVerifier = code_verifier;
  const code_challenge = crypto
    .createHash('sha256')
    .update(code_verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const url =
    `${TT_AUTH}?` +
    qs.stringify({
      client_key: process.env.TT_CLIENT_KEY,
      redirect_uri: process.env.TT_REDIRECT_URI,
      response_type: 'code',
      scope: TT_SCOPES,
      state,
      code_challenge,
      code_challenge_method: 'S256'
    });

  res.redirect(url);
});

// Step 2: callback → exchange code for tokens → fetch basic profile
router.get('/callback/tiktok', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) {
      req.session.lastResult = {
        title: 'TikTok OAuth Error',
        error: 'Missing code parameter from TikTok.'
      };
      return res.redirect('/result');
    }
    if (!state || state !== req.session.ttState) {
      req.session.lastResult = {
        title: 'TikTok OAuth Error',
        error: 'Invalid or missing state parameter.'
      };
      return res.redirect('/result');
    }

    const code_verifier = req.session.ttCodeVerifier;
    if (!code_verifier) {
      req.session.lastResult = {
        title: 'TikTok OAuth Error',
        error: 'Missing PKCE code_verifier in session.'
      };
      return res.redirect('/result');
    }

    let tokenResp;
    try {
      tokenResp = await axios.post(
        TT_TOKEN,
        qs.stringify({
          client_key: process.env.TT_CLIENT_KEY,
          client_secret: process.env.TT_CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: process.env.TT_REDIRECT_URI,
          code_verifier
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
    } catch (tokenErr) {
      req.session.lastResult = {
        title: 'TikTok OAuth Error',
        error: tokenErr.response?.data?.error?.message || tokenErr.message || 'Failed to exchange code for token.'
      };
      return res.redirect('/result');
    }

    req.tokens.tt = {
      access_token: tokenResp.data.access_token,
      refresh_token: tokenResp.data.refresh_token,
      obtained_at: new Date().toISOString()
    };

    let me;
    try {
      me = await axios.get(`${TT_API}/user/info/`, {
        headers: { Authorization: `Bearer ${req.tokens.tt.access_token}` },
        params: { fields: 'open_id,union_id,avatar_url,display_name' }
      });
    } catch (meErr) {
      req.session.lastResult = {
        title: 'TikTok OAuth Error',
        error: meErr.response?.data?.error?.message || meErr.message || 'Failed to fetch TikTok user info.'
      };
      return res.redirect('/result');
    }

    req.session.lastResult = {
      title: 'TikTok: User Info',
      payload: me.data,
      token: req.tokens.tt.access_token
    };
    res.redirect('/result');
  } catch (err) {
    console.error('TikTok callback error:', err.response?.data || err.message);
    req.session.lastResult = {
      title: 'TikTok OAuth Error',
      error: err.response?.data?.error?.message || err.message || 'TikTok OAuth failed.'
    };
    res.redirect('/result');
  }
});

module.exports = router;
