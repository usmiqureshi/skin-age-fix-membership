/* Shared auth + helpers for every /members/ page.
   Requires the Netlify Identity widget to be loaded first.

   Responsibilities:
   - Gate the page: redirect anyone who isn't a logged-in active-member.
   - Expose the current member to the page (name/email).
   - Provide signOut() and an authedFetch() that attaches a fresh JWT. */

(function () {
  var MEMBER_ROLE = 'active-member';

  function isActive(user) {
    return !!(user && user.app_metadata && Array.isArray(user.app_metadata.roles) &&
      user.app_metadata.roles.indexOf(MEMBER_ROLE) !== -1);
  }

  function memberName(user) {
    if (!user) return 'Member';
    var meta = user.user_metadata || {};
    if (meta.full_name) return meta.full_name;
    if (meta.name) return meta.name;
    if (user.email) return user.email.split('@')[0];
    return 'Member';
  }

  function fillMemberFields(user) {
    var name = memberName(user);
    var email = (user && user.email) || '';
    document.querySelectorAll('[data-member-name]').forEach(function (el) { el.textContent = name; });
    document.querySelectorAll('[data-member-email]').forEach(function (el) { el.textContent = email; });
    // expose globally for page scripts (diary/report key off the email)
    window.SAF = window.SAF || {};
    window.SAF.user = user;
    window.SAF.name = name;
    window.SAF.email = email;
    document.dispatchEvent(new CustomEvent('saf:member-ready', { detail: { user: user, name: name, email: email } }));
  }

  function gate(user) {
    if (!user || !isActive(user)) {
      window.location.href = '/?login=required';
      return false;
    }
    fillMemberFields(user);
    return true;
  }

  if (typeof netlifyIdentity === 'undefined') {
    // Widget failed to load — fail safe to the public page.
    window.location.href = '/?login=required';
    return;
  }

  netlifyIdentity.on('init', gate);
  netlifyIdentity.on('login', function (user) { netlifyIdentity.close(); gate(user); });
  netlifyIdentity.on('logout', function () { window.location.href = '/'; });
  netlifyIdentity.init();

  window.signOut = function () { netlifyIdentity.logout(); };

  // Fetch wrapper that attaches a current (auto-refreshed) Identity JWT.
  window.authedFetch = function (url, options) {
    options = options || {};
    var user = netlifyIdentity.currentUser();
    if (!user) return Promise.reject(new Error('Not authenticated'));
    return user.jwt().then(function (token) {
      var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
      headers.Authorization = 'Bearer ' + token;
      return fetch(url, Object.assign({}, options, { headers: headers }));
    });
  };
})();
