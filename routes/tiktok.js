// routes/tiktok.js

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const qs = require('qs');

const router = express.Router();

// TikTok OAuth constants
const TT_AUTH = 'https://www.tiktok.com/v2/auth/authorize/';
const TT_TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';
const TT_PROFILE = 'https://open.tiktokapis.com/v2/user/info/';

// Request minimal user data (add more scopes if needed)
const TT_SCOPES = [
  'user.info.basic',   // Get user profile info
  'video.upload',      // Upload videos
  'video.publish'         // Publish videos
].join(',');

// -------------------------
// Step 1: TikTok OAuth login
// -------------------------
router.get('/auth/tiktok', (req, res) => {
  // Reset session state
  req.session.ttState = undefined;
  req.session.ttCodeVerifier = undefined;

  const state = crypto.randomBytes(16).toString('hex');
  req.session.ttState = state;

  // PKCE: generate verifier + challenge
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

// -------------------------
// Step 2: OAuth callback
// -------------------------
router.get('/auth/tiktok/callback', async (req, res) => {
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

    // Exchange code for token
    let tokenResp;
    try {
      tokenResp = await axios.post(
        TT_TOKEN,
        qs.stringify({
          client_key: process.env.TT_CLIENT_KEY,
          client_secret: process.env.TT_CLIENT_SECRET,
          code: code,
          grant_type: 'authorization_code',
          redirect_uri: process.env.TT_REDIRECT_URI,
          code_verifier
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const logId = tokenResp.headers['x-tt-logid'];
        console.log('TikTok token response:', tokenResp.data);
        console.log('TikTok log ID (success):', logId);
    } catch (tokenErr) {
      req.session.lastResult = {
        title: 'TikTok OAuth Error',
        error:
          tokenErr.response?.data?.error_description ||
          tokenErr.response?.data?.message ||
          tokenErr.message ||
          'Failed to exchange code for token.'
      };
      return res.redirect('/result');
      }
      
    req.tokens = req.tokens || {};
    req.tokens.tt = {
      access_token: tokenResp.data.access_token,
      refresh_token: tokenResp.data.refresh_token,
      obtained_at: new Date().toISOString()
    };

    req.session.lastResult = {
      title: 'TikTok: Access Token',
      payload: {
        access_token: tokenResp.data.access_token,
        refresh_token: tokenResp.data.refresh_token,
        expires_in: tokenResp.data.expires_in
      }
    };
    res.redirect('/result');
  } catch (err) {
    console.error('TikTok callback error:', err.response?.data || err.message);
    req.session.lastResult = {
      title: 'TikTok OAuth Error',
      error:
        err.response?.data?.error_description ||
        err.response?.data?.message ||
        err.message ||
        'TikTok OAuth failed.'
    };
    res.redirect('/result');
  }
});

// -------------------------
// Step 3: Fetch user profile
// -------------------------
router.get('/tiktok/profile', async (req, res) => {
  try {
    const accessToken = req.tokens.tt?.access_token;
    if (!accessToken) {
      return res.status(400).send('Login with TikTok first.');
    }

    const profileResp = await axios.get(TT_PROFILE, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { fields: 'open_id,union_id,avatar_url,display_name' }
    });

    req.session.lastResult = {
      title: 'TikTok: User Profile',
      payload: profileResp.data
    };
    res.redirect('/result');
  } catch (err) {
    console.error('TikTok profile error:', err.response?.data || err.message);
    res.status(500).send('Failed to fetch TikTok profile.');
  }
});

module.exports = router;
