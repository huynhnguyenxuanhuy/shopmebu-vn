/* ============================================
   SHOPMEBU.VN – Main JavaScript
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

  // ===== ACTIVE NAV LINK =====
  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav-link').forEach(link => {
    if (link.getAttribute('href') === currentPath) {
      link.classList.add('active');
    }
  });

  // ===== MOBILE NAV DRAWER =====
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileNavDrawer = document.getElementById('mobileNavDrawer');
  const mobileNavClose = document.getElementById('mobileNavClose');
  const mobileNavOverlay = document.getElementById('mobileNavOverlay');

  function openMobileNav() {
    if (mobileNavDrawer) {
      mobileNavDrawer.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }
  function closeMobileNav() {
    if (mobileNavDrawer) {
      mobileNavDrawer.classList.remove('open');
      document.body.style.overflow = '';
    }
  }
  if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', openMobileNav);
  if (mobileNavClose) mobileNavClose.addEventListener('click', closeMobileNav);
  if (mobileNavOverlay) mobileNavOverlay.addEventListener('click', closeMobileNav);

  // Close on Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMobileNav();
  });

  // ===== USER MENU: CLICK TO OPEN =====
  const userMenus = document.querySelectorAll('.user-menu');
  if (userMenus.length) {
    const closeUserMenus = () => {
      userMenus.forEach(menu => menu.classList.remove('open'));
    };
    userMenus.forEach(userMenu => {
      if (userMenu.dataset.bound === '1') return;
      userMenu.dataset.bound = '1';
      const userToggle = userMenu.querySelector('.user-toggle');
      const dropdown = userMenu.querySelector('.dropdown-menu-custom');
      if (!userToggle) return;
      userToggle.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const isOpen = userMenu.classList.contains('open');
        closeUserMenus();
        userMenu.classList.toggle('open', !isOpen);
      });
      if (dropdown) dropdown.addEventListener('click', e => e.stopPropagation());
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.user-menu')) closeUserMenus();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeUserMenus();
    });
  }

  // ===== SEARCH: CLOSE ON ESC =====
  const searchInput = document.querySelector('.search-wrap input');
  if (searchInput) {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') searchInput.blur();
    });
  }

  // ===== LIVE ONLINE COUNTER (polling mỗi 30s) =====
  async function updateOnlineCount() {
    try {
      const res = await fetch('/api/stats/online');
      if (res.ok) {
        const data = await res.json();
        const el = document.getElementById('footer-online');
        if (el) el.textContent = data.online;
      }
    } catch (_) {}
  }
  setInterval(updateOnlineCount, 30000);

  // ===== NOTIFICATION FLASH =====
  const flash = document.getElementById('flash-message');
  if (flash) {
    setTimeout(() => {
      flash.style.opacity = '0';
      flash.style.transition = 'opacity .5s';
      setTimeout(() => flash.remove(), 500);
    }, 3500);
  }

  // ===== CONFIRM: NÚT XÓA NGUY HIỂM =====
  document.querySelectorAll('[data-confirm]').forEach(btn => {
    btn.addEventListener('click', e => {
      if (!confirm(btn.dataset.confirm)) e.preventDefault();
    });
  });

  // ===== FORMAT SỐ TIỀN: tự động thêm dấu chấm =====
  document.querySelectorAll('.format-currency').forEach(el => {
    const n = parseInt(el.textContent.replace(/\D/g,''), 10);
    if (!isNaN(n)) el.textContent = n.toLocaleString('vi-VN') + 'đ';
  });

});
