// server.js
// Small Express app serving OAuth for Facebook, Instagram, TikTok.
// Tokens are stored in session for demo purposes.

require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');

const app = express();

// Basic Express config
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// Session (demo only; swap to a persistent store in production)
app.use(
  session({
    secret: 'change-this-demo-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { httpOnly: true }
  })
);

// In-memory store for simplicity (per-process)
const store = {
  // sessionId => { fb: {...}, ig: {...}, tt: {...} }
};
app.use((req, _res, next) => {
  if (!store[req.sessionID]) store[req.sessionID] = {};
  req.tokens = store[req.sessionID];
  next();
});

// Routes
const facebookRoutes = require('./routes/facebook');
const instagramRoutes = require('./routes/instagram');
const tiktokRoutes = require('./routes/tiktok');

app.use(facebookRoutes);
app.use(instagramRoutes);
app.use(tiktokRoutes);

// Home
app.get('/', (req, res) => {
  res.render('index', {
    fb: req.tokens.fb || null,
    ig: req.tokens.ig || null,
    tt: req.tokens.tt || null
  });
});

// Result viewer (used by routes to show fetched data)
app.get('/result', (req, res) => {
  const { title, payload } = req.session.lastResult || {
    title: 'No result',
    payload: {}
  };
  res.render('result', { title, payload });
});

const port = process.env.PORT || 3000;
app.listen(port, () =>
  console.log(`Server running on http://localhost:${port}`)
);
