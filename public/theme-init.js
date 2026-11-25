// Applies the remembered colour theme before the app's first paint (no white flash in night mode).
// Written by src/theme/appearance.ts; a separate file because the security policy forbids inline scripts.
;(function () {
  try {
    var s = JSON.parse(localStorage.getItem('chef-appearance') || 'null')
    if (!s || !s.vars) return
    var mode = s.mode === 'system' ? (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : s.resolved
    if (mode !== s.resolved) return // the system flipped since last time: the app sets it properly in a moment
    var r = document.documentElement
    for (var k in s.vars) r.style.setProperty(k, s.vars[k])
    r.dataset.theme = s.theme
    r.dataset.mode = mode
    r.style.colorScheme = mode
  } catch {
    // no stored theme or storage blocked: the app applies its default
  }
})()
