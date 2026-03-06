const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 400,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: 'Too many requests. Please slow down and try again shortly.'
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: 'Too many authentication attempts. Please wait and try again.'
});

const writeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 90,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: 'You are doing that too quickly. Please wait a moment.'
});

function csrfOriginProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const origin = req.get('origin');
  const referer = req.get('referer');
  const host = req.get('host');

  if (!origin && !referer) return next();

  const matchesHost = (value) => {
    try {
      const url = new URL(value);
      return url.host === host;
    } catch (err) {
      return false;
    }
  };

  if ((origin && !matchesHost(origin)) || (referer && !matchesHost(referer))) {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'Cross-site request blocked for security reasons.'
    });
  }

  return next();
}

function configureSecurity(app) {
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));
  app.use(globalLimiter);
  app.use(csrfOriginProtection);
}

module.exports = {
  authLimiter,
  configureSecurity,
  writeLimiter
};
