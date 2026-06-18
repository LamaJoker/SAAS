// Pricing tab toggle
document.querySelectorAll('.lp-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lp-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('tab-sub').style.display  = tab === 'sub'  ? '' : 'none';
    document.getElementById('tab-pack').style.display = tab === 'pack' ? '' : 'none';
  });
});

// Smooth scroll on anchor links
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
});
