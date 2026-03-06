const { getCapabilities } = require('../utils/trust');

function requireCapability(capability, options = {}) {
  return (req, res, next) => {
    const user = res.locals.currentUser;
    if (!user) {
      return res.redirect('/auth/login?redirect=' + encodeURIComponent(req.originalUrl));
    }

    const capabilities = getCapabilities(user);
    if (capabilities[capability]) {
      return next();
    }

    const message = options.message || 'Your trust level does not currently allow this action.';
    if (options.json) {
      return res.status(403).json({ error: message });
    }

    req.flash('error', message);
    return res.redirect(options.redirectTo || '/');
  };
}

module.exports = { requireCapability };
