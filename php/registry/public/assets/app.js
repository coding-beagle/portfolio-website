/*
 * The registry's management UI.
 *
 * Vanilla, build-free, and a client of exactly the same API the `nt` command
 * line tool uses — there is no privileged path for the browser. If something
 * can be done here it can be scripted, and vice versa.
 *
 * State lives in one object and every change re-renders from it. At this size
 * that is simpler to follow than any amount of incremental DOM updating, and
 * it makes "what is on screen" a pure function of "what do we know".
 */

(function () {
  'use strict';

  var API = '/api';

  // The token is deliberately in sessionStorage, not localStorage: this page
  // manages release artifacts, and a token that survives closing the tab is a
  // token left behind on whatever machine you happened to use.
  var STORE_KEY = 'registry.token';

  var state = {
    token: sessionStorage.getItem(STORE_KEY) || null,
    health: null,
    repos: null,
    openRepo: null,     // repo name, or null for the list
    detail: null,       // the open repo's versions
    tokens: null,       // token list, when that panel is open
    notice: null,       // {kind, text}
    busy: false,
  };

  var app = document.getElementById('app');

  // --- talking to the API ----------------------------------------------

  /**
   * One API call. Resolves with the parsed body, or rejects with an Error
   * carrying `code` and `payload` from the error envelope, so callers can
   * switch on the code rather than matching on message text.
   */
  function call(method, path, options) {
    options = options || {};
    var headers = {};
    if (state.token) headers.Authorization = 'Bearer ' + state.token;

    var body;
    if (options.json) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.form) {
      body = options.form; // fetch sets the multipart boundary itself
    } else if (method === 'POST') {
      // A POST always carries a body, even where the endpoint ignores it.
      // Shared hosts commonly run a WAF that rejects bodyless POSTs before PHP
      // ever sees them — this one answers with a 403 HTML page — which would
      // break logging out in production and nowhere else.
      headers['Content-Type'] = 'application/json';
      body = '{}';
    }

    return fetch(API + path, { method: method, headers: headers, body: body })
      .then(function (response) {
        // An expired or revoked token should drop straight back to the login
        // screen rather than showing a wall of 401s on every panel.
        if (response.status === 401 && state.token) {
          signOut('That session has expired. Log in again.');
          throw new Error('unauthorised');
        }
        if (response.status === 204) return {};
        return response.json().then(function (payload) {
          if (response.ok) return payload;
          var error = new Error((payload.error && payload.error.message) || 'Request failed');
          error.code = (payload.error && payload.error.code) || 'error';
          error.payload = payload.error || {};
          throw error;
        });
      });
  }

  /**
   * Downloading needs the token in a header, so a plain <a href> cannot do it.
   * The bytes come back as a blob and are handed to a synthetic anchor.
   */
  function download(repo, version, platform, filename) {
    var url = API + '/repos/' + encodeURIComponent(repo)
      + '/versions/' + encodeURIComponent(version)
      + '/download?platform=' + encodeURIComponent(platform);

    setBusy(true);
    fetch(url, { headers: { Authorization: 'Bearer ' + state.token } })
      .then(function (response) {
        if (!response.ok) throw new Error('That download failed (HTTP ' + response.status + ').');
        return response.blob();
      })
      .then(function (blob) {
        var href = URL.createObjectURL(blob);
        var anchor = document.createElement('a');
        anchor.href = href;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        // Freed on the next tick: revoking immediately races the download in
        // some browsers and produces an empty file.
        setTimeout(function () { URL.revokeObjectURL(href); }, 1000);
        setBusy(false);
      })
      .catch(function (error) { fail(error); });
  }

  // --- state helpers ----------------------------------------------------

  function setBusy(busy) { state.busy = busy; render(); }
  function notify(kind, text) { state.notice = { kind: kind, text: text }; render(); }
  function fail(error) { state.busy = false; notify('error', error.message); }

  function signOut(message) {
    state.token = null;
    state.repos = null;
    state.detail = null;
    state.openRepo = null;
    state.tokens = null;
    sessionStorage.removeItem(STORE_KEY);
    state.notice = message ? { kind: 'error', text: message } : null;
    render();
  }

  function refresh() {
    return Promise.all([
      call('GET', '/health').then(function (h) { state.health = h; }),
      call('GET', '/repos').then(function (r) { state.repos = r.repos; }),
    ]).then(render).catch(fail);
  }

  function openRepo(name) {
    setBusy(true);
    call('GET', '/repos/' + encodeURIComponent(name))
      .then(function (data) {
        state.openRepo = name;
        state.detail = data;
        state.tokens = null;
        state.busy = false;
        state.notice = null;
        render();
      })
      .catch(fail);
  }

  function reopen() {
    return state.openRepo ? openRepo(state.openRepo) : refresh();
  }

  // --- rendering --------------------------------------------------------

  /** Builds an element. Text is set via textContent, never innerHTML. */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      if (key === 'class') node.className = attrs[key];
      else if (key === 'text') node.textContent = attrs[key];
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), attrs[key]);
      else if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function bytes(n) {
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function when(seconds) {
    if (!seconds) return '';
    return new Date(seconds * 1000).toLocaleString();
  }

  function render() {
    app.textContent = '';
    if (!state.token) {
      app.appendChild(loginView());
      return;
    }
    app.appendChild(headerBar());
    if (state.notice) app.appendChild(noticeView());
    if (state.health && !state.health.acceptingWrites) {
      app.appendChild(el('div', {
        class: 'notice warn',
        text: 'Read-only mode is on. Downloads work; uploads and deletes are refused.',
      }));
    }
    if (state.tokens) app.appendChild(tokensView());
    else if (state.openRepo) app.appendChild(repoView());
    else app.appendChild(reposView());
  }

  function noticeView() {
    return el('div', { class: 'notice ' + state.notice.kind, text: state.notice.text });
  }

  function headerBar() {
    return el('header', { class: 'bar' }, [
      el('h1', {
        text: 'Registry',
        style: 'cursor:pointer',
        onclick: function () { state.openRepo = null; state.tokens = null; refresh(); },
      }),
      el('span', { class: 'host', text: location.host }),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'link',
        text: 'tokens',
        onclick: function () {
          setBusy(true);
          call('GET', '/auth/tokens')
            .then(function (data) { state.tokens = data; state.busy = false; render(); })
            .catch(fail);
        },
      }),
      el('button', {
        class: 'link',
        text: 'log out',
        onclick: function () { call('POST', '/auth/logout').catch(function () {}); signOut(null); },
      }),
    ]);
  }

  // --- login ------------------------------------------------------------

  function loginView() {
    var password = el('input', { type: 'password', autofocus: 'autofocus', autocomplete: 'current-password' });

    function submit(event) {
      event.preventDefault();
      if (!password.value) return;
      setBusy(true);
      call('POST', '/auth/login', {
        json: { password: password.value, label: 'browser · ' + navigator.platform },
      })
        .then(function (data) {
          state.token = data.token;
          sessionStorage.setItem(STORE_KEY, data.token);
          state.busy = false;
          state.notice = null;
          refresh();
        })
        .catch(function (error) { password.value = ''; fail(error); });
    }

    return el('div', { class: 'login' }, [
      el('h1', { text: 'Registry', style: 'font-size:20px;margin:0 0 4px' }),
      el('p', { class: 'muted small', text: location.host, style: 'margin:0 0 20px' }),
      state.notice ? noticeView() : null,
      el('form', { class: 'panel', onsubmit: submit }, [
        el('div', { class: 'field' }, [el('label', { text: 'Password' }), password]),
        el('button', {
          class: 'primary',
          type: 'submit',
          text: state.busy ? 'Checking…' : 'Log in',
          disabled: state.busy ? 'disabled' : null,
          style: 'width:100%',
        }),
      ]),
      el('p', { class: 'muted small', style: 'text-align:center;margin-top:16px' },
        ['Or from a terminal: ', el('code', { text: 'nt auth login' })]),
    ]);
  }

  // --- repo list --------------------------------------------------------

  function reposView() {
    var name = el('input', { placeholder: 'my-app', maxlength: '64' });
    var description = el('input', { placeholder: 'What it is (optional)', maxlength: '500' });

    function create(event) {
      event.preventDefault();
      if (!name.value.trim()) return;
      setBusy(true);
      call('POST', '/repos', { json: { name: name.value.trim(), description: description.value.trim() } })
        .then(function () {
          name.value = '';
          description.value = '';
          state.busy = false;
          state.notice = null;
          refresh();
        })
        .catch(fail);
    }

    var list = el('div', { class: 'panel' }, [el('h2', { text: 'Repositories' })]);

    if (state.repos === null) {
      list.appendChild(el('div', { class: 'empty', text: 'Loading…' }));
    } else if (state.repos.length === 0) {
      list.appendChild(el('div', { class: 'empty', text: 'Nothing here yet. Create a repository below.' }));
    } else {
      state.repos.forEach(function (repo) {
        list.appendChild(el('div', {
          class: 'repo',
          onclick: function () { openRepo(repo.name); },
        }, [
          el('div', { class: 'grow' }, [
            el('div', { class: 'name', text: repo.name }),
            el('div', { class: 'meta', text: repo.description || '—' }),
          ]),
          repo.latest ? el('span', { class: 'tag latest', text: repo.latest }) : null,
          repo.latestPrerelease ? el('span', { class: 'tag pre', text: repo.latestPrerelease }) : null,
          el('span', {
            class: 'meta',
            text: repo.versionCount + (repo.versionCount === 1 ? ' version' : ' versions')
              + ' · ' + bytes(repo.bytesUsed),
          }),
        ]));
      });
    }

    return el('div', {}, [
      list,
      el('form', { class: 'panel', onsubmit: create }, [
        el('h2', { text: 'New repository' }),
        el('div', { class: 'row' }, [
          el('div', { class: 'field' }, [el('label', { text: 'Name' }), name]),
          el('div', { class: 'field' }, [el('label', { text: 'Description' }), description]),
        ]),
        el('p', { class: 'muted small', style: 'margin:0 0 12px' },
          ['Lower case letters, digits, dot, dash and underscore.']),
        el('button', { class: 'primary', type: 'submit', text: 'Create', disabled: state.busy ? 'disabled' : null }),
      ]),
    ]);
  }

  // --- one repo ---------------------------------------------------------

  function repoView() {
    var repo = state.detail.repo;
    var versions = state.detail.versions;

    var panel = el('div', { class: 'panel' }, [
      el('div', { style: 'display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px' }, [
        el('button', { class: 'link', text: '← all repositories', onclick: function () {
          state.openRepo = null; state.detail = null; refresh();
        } }),
        el('span', { class: 'spacer', style: 'flex:1' }),
        el('button', {
          class: 'link danger',
          text: 'delete repository',
          onclick: function () {
            if (!confirm('Delete "' + repo.name + '" and every release in it? This cannot be undone.')) return;
            setBusy(true);
            call('DELETE', '/repos/' + encodeURIComponent(repo.name))
              .then(function () {
                state.openRepo = null;
                state.detail = null;
                state.busy = false;
                notify('good', 'Deleted "' + repo.name + '".');
                refresh();
              })
              .catch(fail);
          },
        }),
      ]),
      el('h2', { text: repo.name, style: 'font-family:var(--mono);font-size:17px;margin-bottom:4px' }),
      el('p', { class: 'muted small', style: 'margin:0 0 6px', text: repo.description || 'No description.' }),
      el('p', { class: 'muted small', style: 'margin:0',
        text: repo.versionCount + ' version(s) · ' + bytes(repo.bytesUsed) + ' · updated ' + when(repo.updatedAt) }),
    ]);

    var releases = el('div', { class: 'panel' }, [el('h2', { text: 'Releases' })]);
    if (versions.length === 0) {
      releases.appendChild(el('div', { class: 'empty', text: 'No releases yet. Upload one below.' }));
    } else {
      versions.forEach(function (version) {
        releases.appendChild(versionView(repo, version));
      });
    }

    return el('div', {}, [panel, releases, uploadView(repo)]);
  }

  function versionView(repo, version) {
    var node = el('div', { class: 'version' }, [
      el('div', { class: 'head' }, [
        el('span', { class: 'num', text: version.version }),
        version.prerelease
          ? el('span', { class: 'tag pre', text: 'prerelease' })
          : (repo.latest === version.version ? el('span', { class: 'tag latest', text: 'latest' }) : null),
        el('span', { class: 'muted small', text: when(version.createdAt) }),
        el('span', { style: 'flex:1' }),
        el('button', {
          class: 'link danger',
          text: 'delete release',
          onclick: function () {
            if (!confirm('Delete ' + repo.name + ' ' + version.version + '?')) return;
            setBusy(true);
            call('DELETE', '/repos/' + encodeURIComponent(repo.name)
              + '/versions/' + encodeURIComponent(version.version))
              .then(function () { state.busy = false; reopen(); })
              .catch(fail);
          },
        }),
      ]),
    ]);

    if (version.notes) node.appendChild(el('div', { class: 'notes', text: version.notes }));

    version.artifacts.forEach(function (artifact) {
      node.appendChild(el('div', { class: 'artifact' }, [
        el('span', { class: 'tag', text: artifact.platform }),
        el('span', { class: 'grow' }, [
          el('div', { class: 'file', text: artifact.filename }),
          el('div', { class: 'sha', text: 'sha256 ' + artifact.sha256 }),
        ]),
        el('span', { class: 'muted', text: bytes(artifact.size) }),
        el('button', {
          class: 'link',
          text: 'download',
          onclick: function () {
            download(repo.name, version.version, artifact.platform, artifact.filename);
          },
        }),
        el('button', {
          class: 'link danger',
          text: 'remove',
          onclick: function () {
            if (!confirm('Remove the ' + artifact.platform + ' build of ' + version.version + '?')) return;
            setBusy(true);
            call('DELETE', '/repos/' + encodeURIComponent(repo.name)
              + '/versions/' + encodeURIComponent(version.version)
              + '/artifacts/' + encodeURIComponent(artifact.platform))
              .then(function () { state.busy = false; reopen(); })
              .catch(fail);
          },
        }),
      ]));
    });

    return node;
  }

  function uploadView(repo) {
    var file = el('input', { type: 'file' });
    var version = el('input', { placeholder: '1.0.0' });
    var platform = el('input', { placeholder: 'any' });
    var notes = el('textarea', { rows: '2', placeholder: 'What changed (optional)' });
    var progress = el('span', { class: 'muted small' });

    function submit(event) {
      event.preventDefault();
      if (!file.files.length) return notify('error', 'Choose a file to upload.');
      if (!version.value.trim()) return notify('error', 'Give the release a version, such as 1.0.0.');

      var form = new FormData();
      form.append('file', file.files[0]);
      form.append('platform', platform.value.trim() || 'any');
      form.append('notes', notes.value.trim());

      setBusy(true);
      progress.textContent = 'Uploading ' + bytes(file.files[0].size) + '…';

      call('POST', '/repos/' + encodeURIComponent(repo.name)
        + '/versions/' + encodeURIComponent(version.value.trim()) + '/artifacts', { form: form })
        .then(function (result) {
          file.value = '';
          notes.value = '';
          progress.textContent = '';
          state.busy = false;
          notify('good', (result.replaced ? 'Replaced ' : 'Uploaded ')
            + repo.name + ' ' + result.version + ' (' + result.platform + ').');
          reopen();
        })
        .catch(function (error) { progress.textContent = ''; fail(error); });
    }

    return el('form', { class: 'panel', onsubmit: submit }, [
      el('h2', { text: 'Upload a build' }),
      el('div', { class: 'field' }, [el('label', { text: 'File' }), file]),
      el('div', { class: 'row' }, [
        el('div', { class: 'field' }, [el('label', { text: 'Version' }), version]),
        el('div', { class: 'field' }, [el('label', { text: 'Platform' }), platform]),
      ]),
      el('p', { class: 'muted small', style: 'margin:-4px 0 12px' }, [
        'One build per platform per version — uploading the same platform again replaces it. ',
        'Leave the platform blank for a single-build release.',
      ]),
      el('div', { class: 'field' }, [el('label', { text: 'Release notes' }), notes]),
      el('div', { style: 'display:flex;align-items:center;gap:12px' }, [
        el('button', {
          class: 'primary', type: 'submit',
          text: state.busy ? 'Working…' : 'Upload',
          disabled: state.busy ? 'disabled' : null,
        }),
        progress,
      ]),
    ]);
  }

  // --- tokens -----------------------------------------------------------

  function tokensView() {
    var panel = el('div', { class: 'panel' }, [
      el('div', { style: 'display:flex;align-items:baseline;gap:12px;margin-bottom:14px' }, [
        el('button', { class: 'link', text: '← back', onclick: function () {
          state.tokens = null; render();
        } }),
      ]),
      el('h2', { text: 'Active tokens' }),
      el('p', { class: 'muted small', style: 'margin:-8px 0 14px' }, [
        'Every ', el('code', { text: 'nt auth login' }),
        ' and every browser session holds one. Revoking one takes effect immediately.',
      ]),
    ]);

    state.tokens.tokens.forEach(function (token) {
      var mine = token.id === state.tokens.you;
      panel.appendChild(el('div', { class: 'token' }, [
        el('span', { class: 'grow' }, [
          el('div', { text: (token.label || 'unlabelled') + (mine ? ' — this session' : '') }),
          el('div', { class: 'muted small',
            text: 'last used ' + when(token.lastSeenAt) + ' · expires ' + when(token.expiresAt) }),
        ]),
        el('button', {
          class: 'link danger',
          text: mine ? 'log out' : 'revoke',
          onclick: function () {
            if (!confirm(mine ? 'Log out of this session?' : 'Revoke "' + (token.label || 'this token') + '"?')) return;
            setBusy(true);
            call('DELETE', '/auth/tokens/' + token.id)
              .then(function () {
                if (mine) return signOut(null);
                state.busy = false;
                return call('GET', '/auth/tokens').then(function (data) { state.tokens = data; render(); });
              })
              .catch(fail);
          },
        }),
      ]));
    });

    panel.appendChild(el('div', { style: 'margin-top:16px' }, [
      el('button', {
        class: 'link danger',
        text: 'revoke every token',
        onclick: function () {
          if (!confirm('Revoke every token, including this one? Everything will have to log in again.')) return;
          call('DELETE', '/auth/tokens')
            .then(function () { signOut('Every token was revoked.'); })
            .catch(fail);
        },
      }),
    ]));

    return panel;
  }

  // --- go ---------------------------------------------------------------

  render();
  if (state.token) refresh();
  else call('GET', '/health').then(function (h) { state.health = h; }).catch(function () {});
})();
