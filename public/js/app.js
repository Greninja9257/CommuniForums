// CommuniForums - Client-Side JavaScript
window.richEditors = window.richEditors || {};

function escapeHtmlText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function markdownToHtml(markdown) {
  let html = escapeHtmlText(markdown || '');
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/^- (.*)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function htmlToMarkdown(container) {
  function walk(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    const children = Array.from(node.childNodes).map(walk).join('');
    if (tag === 'strong' || tag === 'b') return `**${children}**`;
    if (tag === 'em' || tag === 'i') return `*${children}*`;
    if (tag === 'code') return `\`${children}\``;
    if (tag === 'a') return `[${children}](${node.getAttribute('href') || ''})`;
    if (tag === 'h1') return `# ${children}\n\n`;
    if (tag === 'h2') return `## ${children}\n\n`;
    if (tag === 'h3') return `### ${children}\n\n`;
    if (tag === 'blockquote') return `> ${children}\n\n`;
    if (tag === 'li') return `- ${children}\n`;
    if (tag === 'ul' || tag === 'ol') return `${children}\n`;
    if (tag === 'br') return '\n';
    if (tag === 'div' || tag === 'p') return `${children}\n`;
    return children;
  }

  return Array.from(container.childNodes).map(walk).join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function initRichEditors() {
  const textareas = document.querySelectorAll('textarea[data-rich-editor]');
  textareas.forEach((textarea) => {
    if (textarea.dataset.richInit === '1') return;
    textarea.dataset.richInit = '1';

    const wrapper = document.createElement('div');
    wrapper.className = 'rich-editor';

    const controls = document.createElement('div');
    controls.className = 'rich-editor-controls';
    controls.innerHTML = `
      <div class="rich-editor-modes">
        <button type="button" class="btn btn-sm btn-primary" data-mode="visual">Visual</button>
        <button type="button" class="btn btn-sm" data-mode="markdown">Markdown</button>
      </div>
      <div class="rich-editor-toolbar">
        <button type="button" class="btn btn-sm" data-cmd="bold"><strong>B</strong></button>
        <button type="button" class="btn btn-sm" data-cmd="italic"><em>I</em></button>
        <button type="button" class="btn btn-sm" data-cmd="insertUnorderedList">List</button>
        <button type="button" class="btn btn-sm" data-cmd="formatBlock" data-value="blockquote">Quote</button>
        <button type="button" class="btn btn-sm" data-cmd="createLink">Link</button>
        <button type="button" class="btn btn-sm" data-cmd="removeFormat">Clear</button>
      </div>
    `;

    const visual = document.createElement('div');
    visual.className = 'rich-editor-visual';
    visual.contentEditable = 'true';
    visual.innerHTML = markdownToHtml(textarea.value || '');

    textarea.parentNode.insertBefore(wrapper, textarea);
    wrapper.appendChild(controls);
    wrapper.appendChild(visual);
    wrapper.appendChild(textarea);

    let mode = 'visual';
    textarea.classList.add('rich-editor-markdown-hidden');

    const autoResizeMarkdown = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(220, textarea.scrollHeight)}px`;
    };
    textarea.addEventListener('input', autoResizeMarkdown);
    autoResizeMarkdown();

    const setMode = (nextMode) => {
      mode = nextMode;
      const visualBtn = controls.querySelector('[data-mode="visual"]');
      const mdBtn = controls.querySelector('[data-mode="markdown"]');
      if (mode === 'visual') {
        textarea.classList.add('rich-editor-markdown-hidden');
        controls.querySelector('.rich-editor-toolbar').style.display = 'flex';
        visual.style.display = 'block';
        visualBtn.classList.add('btn-primary');
        mdBtn.classList.remove('btn-primary');
      } else {
        textarea.value = htmlToMarkdown(visual);
        textarea.classList.remove('rich-editor-markdown-hidden');
        controls.querySelector('.rich-editor-toolbar').style.display = 'none';
        visual.style.display = 'none';
        mdBtn.classList.add('btn-primary');
        visualBtn.classList.remove('btn-primary');
        autoResizeMarkdown();
      }
    };

    controls.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    controls.querySelectorAll('.rich-editor-toolbar [data-cmd]').forEach((btn) => {
      btn.addEventListener('click', () => {
        visual.focus();
        const cmd = btn.dataset.cmd;
        if (cmd === 'createLink') {
          const url = prompt('Enter URL');
          if (url) document.execCommand('createLink', false, url);
          return;
        }
        if (cmd === 'formatBlock') {
          document.execCommand('formatBlock', false, btn.dataset.value || 'p');
          return;
        }
        document.execCommand(cmd, false, null);
      });
    });

    function normalizePlainText(text) {
      return String(text || '').replace(/\r\n/g, '\n');
    }

    function insertTextAtCursor(text) {
      const normalized = normalizePlainText(text);
      if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
        document.execCommand('insertText', false, normalized);
        return;
      }
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      selection.deleteFromDocument();
      selection.getRangeAt(0).insertNode(document.createTextNode(normalized));
    }

    function insertHtmlAtCursor(html) {
      if (document.queryCommandSupported && document.queryCommandSupported('insertHTML')) {
        document.execCommand('insertHTML', false, html);
        return;
      }
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      range.insertNode(tpl.content);
    }

    function sanitizePastedHtml(rawHtml) {
      const allowedTags = new Set([
        'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
        'code', 'pre', 'blockquote',
        'ul', 'ol', 'li',
        'h1', 'h2', 'h3', 'h4',
        'a'
      ]);
      const blockedTags = new Set([
        'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math',
        'meta', 'link', 'form', 'input', 'button', 'textarea', 'select'
      ]);

      const parser = new DOMParser();
      const doc = parser.parseFromString(rawHtml, 'text/html');

      const cleanNode = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          return document.createTextNode(node.nodeValue || '');
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return document.createDocumentFragment();
        }

        const tag = node.tagName.toLowerCase();
        if (blockedTags.has(tag)) {
          return document.createDocumentFragment();
        }

        const children = Array.from(node.childNodes).map(cleanNode);

        if (!allowedTags.has(tag)) {
          const fragment = document.createDocumentFragment();
          children.forEach((child) => fragment.appendChild(child));
          return fragment;
        }

        const el = document.createElement(tag);
        if (tag === 'a') {
          const href = String(node.getAttribute('href') || '').trim();
          if (/^(https?:\/\/|mailto:)/i.test(href)) {
            el.setAttribute('href', href);
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
          }
        }
        children.forEach((child) => el.appendChild(child));
        return el;
      };

      const wrapper = document.createElement('div');
      Array.from(doc.body.childNodes).forEach((node) => {
        wrapper.appendChild(cleanNode(node));
      });
      return wrapper.innerHTML;
    }

    // Keep useful formatting, strip unsafe/invalid external markup.
    visual.addEventListener('paste', (e) => {
      e.preventDefault();
      const clipboard = e.clipboardData || window.clipboardData;
      const html = clipboard ? (clipboard.getData('text/html') || '') : '';
      const text = clipboard ? (clipboard.getData('text/plain') || '') : '';

      if (html) {
        const sanitizedHtml = sanitizePastedHtml(html).trim();
        if (sanitizedHtml) {
          insertHtmlAtCursor(sanitizedHtml);
          return;
        }
      }
      insertTextAtCursor(text);
    });

    const form = textarea.closest('form');
    if (form) {
      form.addEventListener('submit', () => {
        textarea.value = mode === 'visual' ? htmlToMarkdown(visual) : textarea.value;
      });
    }

    window.richEditors[textarea.id] = {
      appendMarkdown(md) {
        if (mode === 'visual') {
          visual.innerHTML += markdownToHtml(md || '');
        } else {
          textarea.value += md;
        }
      }
    };
  });
}

// ---- User Menu Toggle ----
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('user-menu-toggle');
  const dropdown = document.getElementById('user-dropdown');
  if (toggle && dropdown) {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('show');
    });
    document.addEventListener('click', () => dropdown.classList.remove('show'));
  }

  // Mobile nav toggle
  const mobileToggle = document.getElementById('mobile-toggle');
  const mainNav = document.querySelector('.main-nav');
  if (mobileToggle && mainNav) {
    mobileToggle.addEventListener('click', () => mainNav.classList.toggle('show'));
  }

  // Poll notification count every 30 seconds
  setInterval(updateNotificationCount, 30000);
  initRichEditors();
});

// ---- Thank Post ----
async function thankPost(evt, postId) {
  try {
    const res = await fetch(`/forums/post/${postId}/thank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (res.ok) {
      const btn = (evt && evt.currentTarget) || (evt && evt.target && evt.target.closest('.btn-thank')) || null;
      if (!btn) return;
      btn.classList.toggle('active', data.thanked);
      const countEl = btn.querySelector('.thank-count');
      if (countEl) countEl.textContent = data.count;
    } else {
      showToast(data.error || 'Error', 'error');
    }
  } catch (err) {
    showToast('Something went wrong', 'error');
  }
}

async function toggleSavePost(postId, btnEl) {
  try {
    const res = await fetch(`/forums/post/${postId}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Could not save post', 'error');
      return;
    }
    if (btnEl) {
      btnEl.classList.toggle('active', data.saved);
      btnEl.textContent = data.saved ? 'Saved' : 'Save';
    }
    showToast(data.saved ? 'Post saved' : 'Post unsaved', 'success');
  } catch (err) {
    showToast('Something went wrong', 'error');
  }
}

async function toggleThreadSubscription(threadId, btnEl) {
  try {
    const res = await fetch(`/forums/thread/${threadId}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Could not update follow status', 'error');
      return;
    }
    if (btnEl) {
      btnEl.classList.toggle('btn-primary', data.subscribed);
      btnEl.textContent = data.subscribed ? 'Subscribed' : 'Follow Thread';
    }
    showToast(data.subscribed ? 'Thread followed' : 'Thread unfollowed', 'success');
  } catch (err) {
    showToast('Something went wrong', 'error');
  }
}

// ---- Report Post ----
let currentReportPostId = null;

function reportPost(postId) {
  currentReportPostId = postId;
  openModal('report-modal');
}

document.addEventListener('DOMContentLoaded', () => {
  const reportForm = document.getElementById('report-form');
  if (reportForm) {
    reportForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const reason = reportForm.querySelector('textarea[name="reason"]').value.trim();
      const category = reportForm.querySelector('select[name="category"]')?.value || 'general';
      if (!reason || reason.length < 5) {
        showToast('Please provide a reason (min 5 characters)', 'error');
        return;
      }
      try {
        const res = await fetch(`/forums/post/${currentReportPostId}/report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason, category })
        });
        const data = await res.json();
        if (res.ok) {
          closeModal('report-modal');
          reportForm.reset();
          showToast('Report submitted. Thank you!', 'success');
        } else {
          showToast(data.error || 'Error', 'error');
        }
      } catch (err) {
        showToast('Something went wrong', 'error');
      }
    });
  }
});

// ---- Edit Post ----
function editPost(postId) {
  const postCard = document.getElementById(`post-${postId}`);
  if (!postCard) return;
  const contentEl = postCard.querySelector('.post-content');
  const form = document.getElementById(`post-edit-${postId}`);
  const editBtn = postCard.querySelector(`.btn-edit-post[data-post-id="${postId}"]`);
  if (!contentEl || !form) return;

  const isOpen = form.classList.contains('show');
  if (isOpen) {
    form.classList.remove('show');
    contentEl.classList.remove('is-hidden');
    if (editBtn) editBtn.textContent = 'Edit';
    return;
  }

  form.classList.add('show');
  contentEl.classList.add('is-hidden');
  if (editBtn) editBtn.textContent = 'Close';

  const textarea = form.querySelector('textarea[name="content"]');
  if (textarea) {
    if (!textarea.dataset.original) textarea.dataset.original = textarea.value;
    textarea.focus();
    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.value.length;
  }
}

function cancelEditPost(postId) {
  const form = document.getElementById(`post-edit-${postId}`);
  if (!form) return;
  const textarea = form.querySelector('textarea[name="content"]');
  if (textarea && textarea.dataset.original !== undefined) {
    textarea.value = textarea.dataset.original;
  }
  editPost(postId);
}

// ---- Quote Post ----
function decodeBase64(value) {
  if (!value) return '';
  try {
    const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    try {
      return atob(value);
    } catch (err) {
      return '';
    }
  }
}

function quotePost(author, content) {
  if (author && author.dataset) {
    const el = author;
    author = decodeBase64(el.dataset.author || '');
    content = decodeBase64(el.dataset.content || '');
  }
  const replyBox = document.getElementById('reply-content');
  if (!replyBox) return;
  const parsed = typeof content === 'string' ? content : JSON.stringify(content);
  const quote = `> **${author} wrote:**\n> ${parsed.replace(/\n/g, '\n> ')}\n\n`;
  const editor = window.richEditors?.[replyBox.id];
  if (editor && typeof editor.appendMarkdown === 'function') {
    editor.appendMarkdown(quote);
  } else {
    replyBox.value += quote;
    replyBox.focus();
  }
  replyBox.scrollIntoView({ behavior: 'smooth' });
}

// ---- Notification Count ----
async function updateNotificationCount() {
  try {
    const res = await fetch('/notifications/count');
    if (res.ok) {
      const data = await res.json();
      const badge = document.getElementById('notif-count');
      if (data.count > 0) {
        if (badge) {
          badge.textContent = data.count;
          badge.style.display = '';
        } else {
          const bell = document.getElementById('notif-bell');
          if (bell) {
            const span = document.createElement('span');
            span.className = 'badge-count';
            span.id = 'notif-count';
            span.textContent = data.count;
            bell.appendChild(span);
          }
        }
      } else if (badge) {
        badge.style.display = 'none';
      }
    }
  } catch (e) { /* silently fail */ }
}

// ---- Mark Notification Read ----
async function markNotifRead(id, btn) {
  try {
    await fetch(`/notifications/read/${id}`, { method: 'POST' });
    const item = btn.closest('.notification-item');
    if (item) item.classList.remove('unread');
    btn.remove();
    updateNotificationCount();
  } catch (e) { /* silently fail */ }
}

// ---- Modal Helpers ----
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('show');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('show');
}

// Close modals on backdrop click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal') && e.target.classList.contains('show')) {
    e.target.classList.remove('show');
  }
});

// Close modals on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show'));
  }
});

// ---- Admin: Ban Modal ----
function showBanModal(userId, username) {
  document.getElementById('ban-username').textContent = username;
  document.getElementById('ban-form').action = `/admin/users/${userId}/ban`;
  openModal('ban-modal');
}

// ---- Admin: Edit Category ----
function editCategory(id, name, desc, icon, order) {
  document.getElementById('edit-cat-name').value = name;
  document.getElementById('edit-cat-desc').value = desc;
  document.getElementById('edit-cat-icon').value = icon;
  document.getElementById('edit-cat-order').value = order;
  document.getElementById('edit-cat-form').action = `/admin/categories/${id}/edit`;
  openModal('edit-cat-modal');
}

// ---- API Key Generation ----
document.addEventListener('DOMContentLoaded', () => {
  const apiForm = document.getElementById('api-key-form');
  if (apiForm) {
    apiForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('key-name').value.trim();
      if (!name) return;
      try {
        const res = await fetch('/api/v1/keys/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (res.ok) {
          document.getElementById('api-key-value').textContent = data.key;
          document.getElementById('api-key-result').style.display = 'block';
          apiForm.reset();
        } else {
          showToast(data.error || 'Error generating key', 'error');
        }
      } catch (err) {
        showToast('Something went wrong', 'error');
      }
    });
  }
});

// ---- Toast Notifications ----
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; padding: 12px 24px;
    background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6'};
    color: white; border-radius: 8px; font-size: 0.9rem; z-index: 9999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15); animation: slideIn 0.3s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Add animation keyframes
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
`;
document.head.appendChild(style);
