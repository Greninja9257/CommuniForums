// CommuniForums - Client-Side JavaScript

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
      if (!reason || reason.length < 5) {
        showToast('Please provide a reason (min 5 characters)', 'error');
        return;
      }
      try {
        const res = await fetch(`/forums/post/${currentReportPostId}/report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason })
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
  replyBox.value += quote;
  replyBox.focus();
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
