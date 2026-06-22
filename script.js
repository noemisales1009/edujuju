import { supabase } from './supabase.js'

// ============================================
// ESTADO GLOBAL
// ============================================
let currentUser = null

// ============================================
// AUTH — escuta mudanças de sessão
// ============================================
supabase.auth.onAuthStateChange(async (event, session) => {
  if (session?.user) {
    currentUser = session.user
    // TOKEN_REFRESHED: só atualiza o usuário, não reinicia a UI
    if (event === 'TOKEN_REFRESHED') return
    const meta = currentUser.user_metadata || {}
    if (event === 'SIGNED_IN') {
      supabase.from('registro_acesso').insert({ user_id: currentUser.id })
        .then(({ error }) => { if (error) console.warn('[Auth] registro_acesso:', error) })
    }
    // Salva dados do perfil — nunca sobrescreve access_level nem apaga campo já preenchido
    supabase.from('users')
      .select('name, sector, role, access_level')
      .eq('id', currentUser.id)
      .maybeSingle()
      .then(({ data: existing }) => {
        const payload = { id: currentUser.id, email: currentUser.email }
        if (!existing?.access_level) payload.access_level = 'geral'
        // name, sector e role: usa o valor do banco se já existir, senão usa o do cadastro
        payload.name   = existing?.name   || meta.name   || null
        payload.sector = existing?.sector || meta.sector || null
        payload.role   = existing?.role   || meta.role   || null
        return supabase.from('users').upsert(payload, { onConflict: 'id' })
      })
      .then(({ error } = {}) => { if (error) console.warn('[Auth] upsert users:', error) })
    applyCachedProfile(currentUser.id)
    showApp()
    try { await loadProfile() } catch (e) { console.warn('[Auth] loadProfile error:', e) }
    logAudit('login', 'Entrou na plataforma')
  } else {
    currentUser = null
    showLoginScreen()
  }
})

function showApp() {
  document.getElementById('loginScreen').style.display = 'none'
  document.getElementById('appShell').style.display = ''
  setTimeout(() => { loadHome?.() }, 0)
}

async function logAudit(acao, detalhe = '', extra = {}) {
  if (!currentUser) return
  await supabase.from('audit_log').insert({
    user_id: currentUser.id,
    user_name: currentUser.user_metadata?.name || currentUser.email || '',
    acao,
    detalhe,
    extra: Object.keys(extra).length ? extra : null
  })
}

function showLoginScreen() {
  document.getElementById('loginScreen').style.display = 'flex'
  document.getElementById('appShell').style.display = 'none'
  // Reseta o formulário e o botão de login
  const loginBtn = document.getElementById('loginBtn')
  if (loginBtn) { loginBtn.textContent = 'Entrar'; loginBtn.disabled = false }
  const loginForm = document.getElementById('loginForm')
  if (loginForm) loginForm.reset()
}

// ============================================
// FORMULÁRIO DE LOGIN
// ============================================
document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault()
  const email    = document.getElementById('loginEmail').value.trim()
  const password = document.getElementById('loginPassword').value
  const errorEl  = document.getElementById('loginError')
  const btn      = document.getElementById('loginBtn')

  setLoading(btn, true, 'Entrando...')
  errorEl.textContent = ''
  errorEl.className   = 'form-msg'

  console.log('[Login] chamando signInWithPassword...')
  let loginResult
  try {
    loginResult = await Promise.race([
      supabase.auth.signInWithPassword({ email, password }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Supabase não respondeu em 10s.')), 10000))
    ])
  } catch (e) {
    console.error('[Login] erro:', e)
    errorEl.textContent = e.message
    setLoading(btn, false, 'Entrar')
    return
  }

  console.log('[Login] resultado:', loginResult)
  const { error } = loginResult

  if (error) {
    const msg = error.message?.toLowerCase() || ''
    if (msg.includes('email not confirmed'))
      errorEl.textContent = 'Confirme seu email antes de entrar. Verifique sua caixa de entrada.'
    else if (msg.includes('invalid login'))
      errorEl.textContent = 'Email ou senha incorretos.'
    else
      errorEl.textContent = error.message || 'Erro ao fazer login. Tente novamente.'
    setLoading(btn, false, 'Entrar')
  } else {
    btn.textContent = 'Abrindo app...'
    // onAuthStateChange cuida do redirecionamento
  }
})

// ============================================
// FORMULÁRIO DE CADASTRO
// ============================================
document.getElementById('registerForm').addEventListener('submit', async e => {
  e.preventDefault()
  const name     = document.getElementById('regName').value.trim()
  const setor    = document.getElementById('regSetor').value
  const funcao   = document.getElementById('regFuncao').value
  const email    = document.getElementById('regEmail').value.trim()
  const password = document.getElementById('regPassword').value
  const errorEl  = document.getElementById('regError')
  const btn      = document.getElementById('regBtn')

  if (!name) {
    errorEl.textContent = 'Preencha seu nome completo.'
    return
  }
  if (!setor || !funcao) {
    errorEl.textContent = 'Selecione seu setor e sua função.'
    return
  }
  if (!email) {
    errorEl.textContent = 'Preencha seu email.'
    return
  }
  if (!password) {
    errorEl.textContent = 'Preencha sua senha.'
    return
  }
  if (password.length < 6) {
    errorEl.textContent = 'A senha deve ter no mínimo 6 caracteres.'
    return
  }

  setLoading(btn, true, 'Criando conta...')
  errorEl.textContent = ''
  errorEl.className   = 'form-msg'

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, sector: setor, role: funcao } }
  })

  if (error) {
    const msg = error.message?.toLowerCase() || ''
    if (msg.includes('already registered') || msg.includes('already been registered'))
      errorEl.textContent = 'Este email já possui uma conta cadastrada.'
    else if (msg.includes('password'))
      errorEl.textContent = 'A senha deve ter no mínimo 6 caracteres.'
    else if (msg.includes('invalid email'))
      errorEl.textContent = 'Email inválido.'
    else
      errorEl.textContent = 'Erro ao criar conta. Tente novamente.'
    setLoading(btn, false, 'Criar Conta')
    return
  }

  // Garante que sector e role ficam salvos mesmo se o trigger criar a linha antes do onAuthStateChange
  if (data?.user?.id) {
    supabase.from('users').upsert(
      { id: data.user.id, email, name, sector: setor, role: funcao, access_level: 'geral' },
      { onConflict: 'id', ignoreDuplicates: false }
    ).then(({ error: e }) => { if (e) console.warn('[Cadastro] upsert users:', e) })
  }

  errorEl.className   = 'form-msg success'
  errorEl.textContent = '✓ Conta criada com sucesso!'
  setLoading(btn, false, 'Criar Conta')
})

// ============================================
// TABS (Login / Cadastro)
// ============================================
document.getElementById('tabLogin').addEventListener('click',    () => switchTab('login'))
document.getElementById('tabRegister').addEventListener('click', () => switchTab('register'))
document.getElementById('goRegister').addEventListener('click',  e => { e.preventDefault(); switchTab('register') })
document.getElementById('goLogin').addEventListener('click',     e => { e.preventDefault(); switchTab('login') })

function switchTab(tab) {
  const isLogin = tab === 'login'
  document.getElementById('loginForm').style.display    = isLogin ? 'flex' : 'none'
  document.getElementById('registerForm').style.display = isLogin ? 'none' : 'flex'
  document.getElementById('tabLogin').classList.toggle('tab-active',    isLogin)
  document.getElementById('tabRegister').classList.toggle('tab-active', !isLogin)
  if (!isLogin) {
    document.getElementById('registerForm').reset()
    document.getElementById('regError').textContent = ''
  }
}

// ============================================
// LOGOUT
// ============================================
async function doLogout(e) {
  if (e) e.preventDefault()
  if (currentUser) {
    try { localStorage.removeItem('eduflow-profile-' + currentUser.id) } catch {}
  }
  await supabase.auth.signOut()
}
document.querySelectorAll('.settings-logout').forEach(btn => btn.addEventListener('click', doLogout))

// ============================================
// PERFIL — carrega dados do Supabase
// ============================================
function applyProfileToUI(profile, email) {
  const displayName = profile.name || email?.split('@')[0] || ''
  const roleLabel   = profile.access_level === 'super' ? 'Super Admin' : profile.access_level === 'adm' ? 'Administrador' : (profile.role || 'Colaborador')

  document.querySelectorAll('.perfil-name').forEach(el => el.textContent = displayName)
  document.querySelectorAll('.perfil-role').forEach(el => el.textContent = roleLabel)
  document.querySelectorAll('.sidebar-name').forEach(el => el.textContent = displayName)
  document.querySelectorAll('.sidebar-role').forEach(el => el.textContent = roleLabel)

  if (profile.foto) {
    document.querySelectorAll('.user-avatar img, .perfil-avatar-wrap img, .sidebar-avatar img')
      .forEach(img => { img.src = profile.foto })
  }

  const sectorEl = document.getElementById('perfilSector')
  if (sectorEl && profile.sector) sectorEl.textContent = profile.sector

  const isSuper = profile.access_level === 'super'
  const isAdmin = profile.access_level === 'adm' || isSuper
  document.querySelectorAll('[data-page="admin"]').forEach(el => {
    if (!isAdmin) { el.style.display = 'none'; return }
    const tag = el.tagName.toLowerCase()
    el.style.display = (tag === 'a' || tag === 'button') ? 'flex' : ''
  })
  const controleAcesso = document.getElementById('controleAcessoSection')
  if (controleAcesso) controleAcesso.style.display = isSuper ? '' : 'none'
  const gerarPdfWrap = document.getElementById('btnGerarPDFWrap')
  if (gerarPdfWrap) gerarPdfWrap.style.display = isAdmin ? 'flex' : 'none'
  const auditSection = document.getElementById('auditLogSection')
  if (auditSection) auditSection.style.display = isSuper ? '' : 'none'
  const resetSection = document.getElementById('resetProgressoSection')
  if (resetSection) resetSection.style.display = isAdmin ? '' : 'none'
}

function applyCachedProfile(userId) {
  try {
    const cached = localStorage.getItem('eduflow-profile-' + userId)
    if (cached) { window._currentProfile = JSON.parse(cached); applyProfileToUI(window._currentProfile, currentUser?.email) }
  } catch {}
}

async function loadProfile() {
  const result = await Promise.race([
    supabase.from('users').select('*').eq('id', currentUser.id).maybeSingle(),
    new Promise(resolve => setTimeout(() => resolve({ data: null }), 5000))
  ])
  const profile = result?.data

  if (!profile) return

  window._currentProfile = profile
  try { localStorage.setItem('eduflow-profile-' + currentUser.id, JSON.stringify(profile)) } catch {}

  applyProfileToUI(profile, currentUser.email)
}

// ============================================
// UTILITÁRIO
// ============================================
function setLoading(btn, loading, text) {
  btn.disabled    = loading
  btn.textContent = text
  btn.style.opacity = loading ? '0.7' : '1'
}

// ============================================
// TEMA CLARO / ESCURO
// ============================================
const html        = document.documentElement
const themeToggle = document.getElementById('themeToggle')
const themeIcon   = document.getElementById('themeIcon')

const savedTheme = localStorage.getItem('eduflow-theme') || 'light'
applyTheme(savedTheme)

themeToggle.addEventListener('click', () => {
  applyTheme(html.dataset.theme === 'dark' ? 'light' : 'dark')
})

function applyTheme(theme) {
  html.dataset.theme        = theme
  themeIcon.textContent     = theme === 'dark' ? 'light_mode' : 'dark_mode'
  localStorage.setItem('eduflow-theme', theme)
}

// ============================================
// NAVEGAÇÃO ENTRE PÁGINAS
// ============================================
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))

  const target = document.getElementById('page-' + pageId)
  if (target) target.classList.add('active')

  document.querySelectorAll('.nav-item[data-page]').forEach(el =>
    el.classList.toggle('active', el.dataset.page === pageId)
  )
  document.querySelectorAll('.bnav-item[data-page]').forEach(el =>
    el.classList.toggle('active', el.dataset.page === pageId)
  )

  closeSidebar()
  window.scrollTo({ top: 0, behavior: 'instant' })
}

// Links de navegação
document.querySelectorAll('[data-page]').forEach(el => {
  el.addEventListener('click', e => { e.preventDefault(); window.showPage(el.dataset.page) })
})

// Expõe para os onclick do HTML
window.showPage = showPage

// ============================================
// SIDEBAR MOBILE
// ============================================
const sidebar        = document.getElementById('sidebar')
const sidebarOverlay = document.getElementById('sidebarOverlay')
const menuBtn        = document.getElementById('menuBtn')

const COLLAPSED_KEY = 'eduflow-sidebar-collapsed'
if (localStorage.getItem(COLLAPSED_KEY) === '1') sidebar?.classList.add('collapsed')

if (menuBtn) menuBtn.addEventListener('click', () => {
  const isNowCollapsed = sidebar.classList.toggle('collapsed')
  localStorage.setItem(COLLAPSED_KEY, isNowCollapsed ? '1' : '0')
})
if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar)
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar() })

function openSidebar() {
  sidebar.classList.add('open')
  sidebarOverlay.classList.add('visible')
  document.body.style.overflow = 'hidden'
}
function closeSidebar() {
  sidebar.classList.remove('open')
  sidebarOverlay.classList.remove('visible')
  document.body.style.overflow = ''
}

// Botão interno da sidebar (se existir) também funciona
const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn')
if (sidebarCollapseBtn) {
  sidebarCollapseBtn.addEventListener('click', () => {
    const isNowCollapsed = sidebar.classList.toggle('collapsed')
    localStorage.setItem(COLLAPSED_KEY, isNowCollapsed ? '1' : '0')
  })
}

// ============================================
// SALA DE AULA — conteúdo dinâmico
// ============================================
let salaVideos         = []
let salaItems          = []  // todos os tipos na ordem da trilha
let currentVideoId     = null
let _currentVideoTitle = ''
let _catalogItems      = []
let quizResolved     = false
let _currentQuestion = null
let _quizQuestions   = []
let _quizIndex       = 0
let _answeredMap     = {}

const confirmBtn   = document.getElementById('confirmQuiz')
const quizFeedback = document.getElementById('quizFeedback')

if (confirmBtn) confirmBtn.addEventListener('click', handleQuiz)

async function loadSalaDeAula() {
  const [{ data: seq }, { data: todasRespostas }] = await Promise.all([
    supabase.from('trilha_conteudo').select('item_id, tipo, tem_questoes').order('trilha_id', { ascending: true }).order('ordem', { ascending: true }),
    currentUser
      ? supabase.from('respostas').select('question_id, is_correct, chosen_index').eq('user_id', currentUser.id)
      : Promise.resolve({ data: [] })
  ])

  let videos = []
  if (seq?.length) {
    const videoIds = seq.filter(s => s.tipo === 'video').map(s => s.item_id)
    const avIds    = seq.filter(s => s.tipo === 'avaliacao').map(s => s.item_id)

    const [{ data: vids }, { data: avs }] = await Promise.all([
      videoIds.length ? supabase.from('videos').select('id, title, description, youtube_url, topics, ordem, texto_aula').in('id', videoIds).eq('visivel', true) : Promise.resolve({ data: [] }),
      avIds.length    ? supabase.from('avaliacoes').select('id, titulo, descricao, imagem_url, topics').in('id', avIds).eq('visivel', true) : Promise.resolve({ data: [] }),
    ])

    const vidMap = Object.fromEntries((vids || []).map(v => [v.id, { ...v, _tipo: 'video' }]))
    const avMap  = Object.fromEntries((avs  || []).map(a => [a.id, { ...a, _tipo: 'avaliacao' }]))

    // Monta lista na ordem da trilha_conteudo
    salaItems = seq.map(s => {
      let base = null
      if (s.tipo === 'video')     base = vidMap[s.item_id]
      if (s.tipo === 'avaliacao') base = avMap[s.item_id]
      if (!base) return null
      return { ...base, _tem_questoes: s.tem_questoes !== false }
    }).filter(Boolean)

    videos = salaItems.filter(i => i._tipo === 'video')
  } else {
    const { data: vids } = await supabase
      .from('videos')
      .select('id, title, description, youtube_url, topics, ordem, texto_aula')
      .eq('visivel', true)
      .order('ordem', { ascending: true })
    videos = (vids || []).map(v => ({ ...v, _tipo: 'video' }))
    salaItems = videos
  }
  salaVideos = videos

  const emptyEl  = document.getElementById('salaEmpty')
  const playerEl = document.getElementById('videoPlayer')
  const infoEl   = document.getElementById('lessonInfoCard')
  const quizEl   = document.getElementById('salaQuizCard')

  if (!salaVideos.length) {
    if (emptyEl)  emptyEl.style.display  = ''
    if (playerEl) playerEl.style.display = 'none'
    if (infoEl)   infoEl.style.display   = 'none'
    if (quizEl)   quizEl.style.display   = 'none'
    document.getElementById('salaModuleList').innerHTML =
      '<li class="module-item"><span style="color:var(--outline);font-size:.875rem">Sem vídeos ainda</span></li>'
    return
  }

  if (emptyEl)  emptyEl.style.display  = 'none'
  if (playerEl) playerEl.style.display = ''
  if (infoEl)   infoEl.style.display   = ''

  const idx   = salaVideos.findIndex(v => v.id === currentVideoId)
  const video = salaVideos[idx >= 0 ? idx : 0]
  currentVideoId = video.id
  await renderSalaVideo(video, todasRespostas || [])
  updateGradeCard()
}

async function updateGradeCard() {
  if (!currentUser || !salaVideos.length) return

  // Descobre a trilha do vídeo atual
  const currentVideo = salaVideos.find(v => v.id === currentVideoId) || salaVideos[0]
  const trilhaNome   = currentVideo.topics?.trim() || currentVideo.title
  const trilhaIds    = salaVideos
    .filter(v => (v.topics?.trim() || v.title) === trilhaNome)
    .map(v => v.id)

  // Atualiza título do card
  const titleEl = document.getElementById('gradeCardTitle')
  if (titleEl) titleEl.textContent = trilhaNome || 'Desempenho na Trilha'

  // Busca notas da view para os vídeos desta trilha
  const { data: notasData } = await supabase
    .from('v_desempenho_usuario_trilha')
    .select('nota_pct')
    .eq('user_id', currentUser.id)
    .in('video_id', trilhaIds)

  let pct = 0
  let hasData = false

  if (notasData?.length) {
    const notas = notasData.map(r => Number(r.nota_pct)).filter(n => !isNaN(n))
    if (notas.length) {
      pct = Math.round(notas.reduce((s, n) => s + n, 0) / notas.length)
      hasData = true
    }
  }

  if (!hasData) {
    // Fallback: progresso local (aulas concluídas desta trilha)
    const completed = trilhaIds.filter(id => getVideoProgress(id) === 'completed').length
    pct = Math.round(completed / trilhaIds.length * 100)
  }

  const label = pct >= 80 ? 'Excelente'
              : pct >= 60 ? 'Bom'
              : pct >= 30 ? 'Em Progresso'
              : pct > 0   ? 'Em Andamento'
              : 'Aguardando'

  const dashoffset = Math.round(264 * (1 - pct / 100))
  const arcColor   = pct >= 60 ? 'var(--secondary)'
                   : pct >= 30 ? '#f59e0b'
                   : pct >  0  ? 'var(--error)'
                   : 'var(--surface-high)'

  const gradeValue      = document.getElementById('gradeValue')
  const gradeStatusText = document.getElementById('gradeStatusText')
  const gradeArc        = document.getElementById('gradeArc')

  if (gradeValue)      { gradeValue.textContent = pct + '%'; gradeValue.style.color = arcColor }
  if (gradeStatusText) gradeStatusText.textContent = label
  if (gradeArc)        { gradeArc.setAttribute('stroke-dashoffset', dashoffset); gradeArc.style.stroke = arcColor }
}

async function saveQuizResult(questionId, isCorrect, chosenIndex) {
  if (!currentUser) return
  try {
    await supabase.from('respostas').upsert(
      { user_id: currentUser.id, question_id: questionId, is_correct: isCorrect, chosen_index: chosenIndex },
      { onConflict: 'user_id,question_id' }
    )
  } catch (_) { /* erro silencioso */ }
}

async function renderSalaVideo(video, cachedRespostas = null) {
  const idx      = salaVideos.findIndex(v => v.id === video.id)
  const embedUrl = ytEmbedUrl(video.youtube_url)
  const vidId    = ytVideoId(video.youtube_url)
  const thumbUrl = vidId ? `https://img.youtube.com/vi/${vidId}/maxresdefault.jpg` : null

  const frame    = document.getElementById('salaYoutubeFrame')
  const bg       = document.getElementById('videoBg')
  const grad     = document.getElementById('videoGrad')
  const playBtn  = document.getElementById('videoPlayBtn')
  const controls = document.querySelector('.video-controls')
  const playerEl = document.getElementById('videoPlayer')

  // Atualiza info da aula primeiro (independente do player)
  const titleEl  = document.getElementById('lessonTitle')
  const descEl   = document.getElementById('lessonDesc')
  const numberEl = document.getElementById('lessonNumber')
  if (titleEl)  titleEl.textContent  = video.title       || ''
  if (descEl)   descEl.textContent   = video.description || ''
  if (numberEl) numberEl.textContent = `Aula ${idx + 1} de ${salaVideos.length}`

  // Aula já concluída — oculta player e quiz, mostra card de conclusão
  if (getVideoProgress(video.id) === 'completed') {
    if (playerEl) playerEl.style.display = 'none'
    if (frame)    frame.src = ''
    renderTextoAula(null)
    const quizCard = document.getElementById('salaQuizCard')
    if (quizCard) quizCard.style.display = 'none'
    const ww = document.getElementById('videoWatchedWrap')
    if (ww) ww.style.display = 'none'
    document.getElementById('conclusaoAulaCard')?.remove()
    renderConclusaoCard(video.id)
    quizResolved = true
    const _salaIdx2  = salaItems.findIndex(it => it._tipo === 'video' && it.id === video.id)
    const nextItem2  = _salaIdx2 >= 0 ? (salaItems[_salaIdx2 + 1] || null) : null
    const nextCard2  = document.getElementById('nextCard')
    if (nextItem2 && nextCard2) {
      const _isAv2 = nextItem2._tipo === 'avaliacao'
      nextCard2.style.display = ''
      const nt = document.getElementById('nextTitle')
      const nd = document.getElementById('nextDesc')
      const nb = document.getElementById('nextBtn')
      if (nt) nt.textContent = _isAv2 ? nextItem2.titulo : nextItem2.title
      if (nd) nd.textContent = _isAv2 ? (nextItem2.descricao || '') : (nextItem2.description || '')
      if (nb) {
        nb.innerHTML = `${_isAv2 ? 'Ir para Avaliação' : 'Ir para Próxima Aula'} <span class="material-symbols-outlined">arrow_forward</span>`
        nb.onclick = _isAv2
          ? () => window.abrirAvaliacaoSala(nextItem2.id)
          : () => { currentVideoId = nextItem2.id; renderSalaVideo(nextItem2) }
      }
    } else if (nextCard2) {
      nextCard2.style.display = 'none'
    }
    renderModuleList(video.id)
    updateNextBtnState()
    return
  }

  // Restaura player para aula não concluída
  if (playerEl) playerEl.style.display = ''
  document.getElementById('conclusaoAulaCard')?.remove()

  // Configura player
  if (frame && embedUrl) {
    frame.src           = embedUrl
    frame.style.display = ''
    if (bg)       bg.style.display       = 'none'
    if (grad)     grad.style.display     = 'none'
    if (playBtn)  playBtn.style.display  = 'none'
    if (controls) controls.style.display = 'none'
  } else {
    if (frame)    frame.style.display    = 'none'
    if (bg)       { bg.style.display = ''; bg.style.backgroundImage = thumbUrl ? `url('${thumbUrl}')` : '' }
    if (grad)     grad.style.display     = ''
    if (playBtn)  playBtn.style.display  = ''
    if (controls) controls.style.display = ''
  }

  await renderSalaQuiz(video.id, cachedRespostas)
  renderModuleList(video.id)

  const _salaIdx  = salaItems.findIndex(it => it._tipo === 'video' && it.id === video.id)
  const nextItem  = _salaIdx >= 0 ? (salaItems[_salaIdx + 1] || null) : null
  const nextCard  = document.getElementById('nextCard')
  if (nextItem && nextCard) {
    const _isAv = nextItem._tipo === 'avaliacao'
    nextCard.style.display = ''
    const nextTitle = document.getElementById('nextTitle')
    const nextDesc  = document.getElementById('nextDesc')
    const nextBtn   = document.getElementById('nextBtn')
    if (nextTitle) nextTitle.textContent = _isAv ? nextItem.titulo : nextItem.title
    if (nextDesc)  nextDesc.textContent  = _isAv ? (nextItem.descricao || '') : (nextItem.description || '')
    if (nextBtn) {
      nextBtn.innerHTML = `${_isAv ? 'Ir para Avaliação' : 'Ir para Próxima Aula'} <span class="material-symbols-outlined">arrow_forward</span>`
      nextBtn.onclick = _isAv
        ? () => window.abrirAvaliacaoSala(nextItem.id)
        : () => { currentVideoId = nextItem.id; renderSalaVideo(nextItem) }
    }
  } else if (nextCard) {
    nextCard.style.display = 'none'
  }

  updateNextBtnState()
}

function renderTextoAula(texto) {
  let el = document.getElementById('textoAulaCard')
  if (!texto) { if (el) el.remove(); return }
  if (!el) {
    el = document.createElement('div')
    el.id = 'textoAulaCard'
    el.className = 'surface-card'
    el.style.cssText = 'margin-top:1rem;line-height:1.7;white-space:pre-wrap'
    const quizCard = document.getElementById('salaQuizCard')
    quizCard?.insertAdjacentElement('afterend', el)
  }
  el.innerHTML = `<h3 style="font-size:1rem;margin-bottom:0.75rem">Leitura da Aula</h3><p style="color:var(--text-secondary)">${escHtml(texto)}</p>`
}

function renderConclusaoCard(videoId) {
  document.getElementById('conclusaoAulaCard')?.remove()
  const el = document.createElement('div')
  el.id = 'conclusaoAulaCard'
  el.className = 'surface-card'
  el.style.cssText = 'margin-top:1rem;display:flex;align-items:center;gap:0.75rem;padding:1rem 1.25rem'
  el.innerHTML = `
    <span class="material-symbols-outlined icon-filled" style="color:var(--secondary);font-size:1.75rem;flex-shrink:0">check_circle</span>
    <div>
      <div style="font-weight:600;color:var(--secondary)">Aula concluída</div>
      <div style="font-size:0.8rem;color:var(--on-surface-var)">Você já completou esta aula.</div>
    </div>`
  const quizCard = document.getElementById('salaQuizCard')
  quizCard?.insertAdjacentElement('afterend', el)
}

function renderConcluirSemQuizBtn(videoId) {
  document.getElementById('conclusaoAulaCard')?.remove()
  const el = document.createElement('div')
  el.id = 'conclusaoAulaCard'
  el.className = 'surface-card'
  el.style.cssText = 'margin-top:1rem'
  el.innerHTML = `
    <button class="btn-primary" style="width:100%;padding:0.875rem;gap:0.5rem" id="btnConcluirSemQuiz">
      <span class="material-symbols-outlined icon-filled">check_circle</span>
      Marcar como Concluído
    </button>`
  const quizCard = document.getElementById('salaQuizCard')
  quizCard?.insertAdjacentElement('afterend', el)
  document.getElementById('btnConcluirSemQuiz').addEventListener('click', () => {
    setVideoProgress(videoId, 'completed')
    setTimeout(() => checkTrilhaConcluidaEConfetti(videoId), 400)
    renderConclusaoCard(videoId)
    updateNextBtnState()
  })
}

function updateNextBtnState() {
  const nextBtn  = document.getElementById('nextBtn')
  if (!nextBtn) return
  const quizCard = document.getElementById('salaQuizCard')
  const hasQuiz  = quizCard && quizCard.style.display !== 'none'
  const blocked  = hasQuiz && !quizResolved
  nextBtn.disabled     = blocked
  nextBtn.style.opacity = blocked ? '0.45' : ''
  nextBtn.style.cursor  = blocked ? 'not-allowed' : ''
  nextBtn.title         = blocked ? 'Responda o quiz para avançar' : ''
}

async function renderSalaQuiz(videoId, cachedRespostas = null) {
  const quizCard = document.getElementById('salaQuizCard')
  _quizQuestions  = []
  _quizIndex      = 0
  _answeredMap    = {}

  // Remove card de conclusão se existir de uma aula anterior
  document.getElementById('conclusaoAulaCard')?.remove()

  // Se o item está configurado como "sem questões", conclui direto sem buscar quiz
  const _itemAtual = salaItems.find(it => it._tipo === 'video' && it.id === videoId)
  if (_itemAtual && _itemAtual._tem_questoes === false) {
    quizCard.style.display = 'none'
    const watchedWrap = document.getElementById('videoWatchedWrap')
    const watchedBtn  = document.getElementById('videoWatchedBtn')
    renderTextoAula(_itemAtual?.texto_aula || null)
    if (getVideoProgress(videoId) === 'completed') {
      if (watchedWrap) watchedWrap.style.display = 'none'
      renderConclusaoCard(videoId)
      updateNextBtnState()
      return
    }
    if (watchedWrap) watchedWrap.style.display = ''
    if (watchedBtn) {
      watchedBtn.textContent = 'Marcar como concluído'
      watchedBtn.onclick = () => {
        setVideoWatched(videoId)
        watchedWrap.style.display = 'none'
        setVideoProgress(videoId, 'completed')
        setTimeout(() => checkTrilhaConcluidaEConfetti(videoId), 400)
        renderConclusaoCard(videoId)
        updateNextBtnState()
      }
    }
    updateNextBtnState()
    return
  }

  // Busca questões e respostas em paralelo (quando não há cache)
  const [{ data: questions }, respostasResult] = await Promise.all([
    supabase.from('questoes_sala_de_aula').select('*').eq('video_id', videoId).order('created_at', { ascending: true }),
    cachedRespostas !== null
      ? Promise.resolve({ data: cachedRespostas })
      : currentUser
        ? supabase.from('respostas').select('question_id, is_correct, chosen_index').eq('user_id', currentUser.id)
        : Promise.resolve({ data: [] })
  ])

  const temQuiz     = questions?.length > 0
  const jaAssistiu  = getVideoWatched(videoId) || getVideoProgress(videoId) === 'completed'
  const watchedWrap = document.getElementById('videoWatchedWrap')
  const watchedBtn  = document.getElementById('videoWatchedBtn')
  const video       = salaVideos.find(v => v.id === videoId)

  if (!temQuiz) {
    quizCard.style.display = 'none'
    renderTextoAula(video?.texto_aula || null)
    if (getVideoProgress(videoId) === 'completed') {
      if (watchedWrap) watchedWrap.style.display = 'none'
      renderConclusaoCard(videoId)
      return
    }
    // Sem quiz: botão confirma e conclui diretamente
    if (watchedWrap) watchedWrap.style.display = ''
    if (watchedBtn) {
      watchedBtn.onclick = () => {
        setVideoWatched(videoId)
        watchedWrap.style.display = 'none'
        setVideoProgress(videoId, 'completed')
        setTimeout(() => checkTrilhaConcluidaEConfetti(videoId), 400)
        renderConclusaoCard(videoId)
        updateNextBtnState()
      }
    }
    updateNextBtnState()
    return
  }

  renderTextoAula(null)
  _quizQuestions = questions

  if (!jaAssistiu) {
    quizCard.style.display = 'none'
    if (watchedWrap) watchedWrap.style.display = ''
    if (watchedBtn) {
      watchedBtn.onclick = () => {
        setVideoWatched(videoId)
        renderSalaQuiz(videoId, respostasResult?.data || [])
      }
    }
    updateNextBtnState()
    return
  }

  if (watchedWrap) watchedWrap.style.display = 'none'
  quizCard.style.display = ''

  if (currentUser) {
    const allRespostas = respostasResult?.data || []
    const qIds = new Set(questions.map(q => q.id))
    allRespostas.filter(r => qIds.has(r.question_id)).forEach(r => { _answeredMap[r.question_id] = r })
  }

  // Começa na primeira pergunta ainda não respondida
  const firstUnanswered = questions.findIndex(q => !_answeredMap[q.id])
  _quizIndex = firstUnanswered === -1 ? 0 : firstUnanswered

  // Todas as perguntas já respondidas no banco — bloqueia aula (sincroniza entre dispositivos)
  if (firstUnanswered === -1) {
    setVideoProgress(videoId, 'completed')
    quizCard.style.display = 'none'
    const playerEl = document.getElementById('videoPlayer')
    if (playerEl) playerEl.style.display = 'none'
    const frame = document.getElementById('salaYoutubeFrame')
    if (frame) frame.src = ''
    renderConclusaoCard(videoId)
    quizResolved = true
    updateNextBtnState()
    return
  }

  showQuizQuestion(_quizIndex)
}

function showQuizQuestion(index) {
  const q = _quizQuestions[index]
  if (!q) return
  _currentQuestion = q
  _quizIndex       = index
  quizResolved     = false

  confirmBtn.textContent    = 'Confirmar Resposta'
  quizFeedback.textContent  = ''
  quizFeedback.className    = 'quiz-feedback'

  const counterEl = document.getElementById('quizCounter')
  if (counterEl) {
    const total = _quizQuestions.length
    if (total > 1) {
      counterEl.textContent  = `Pergunta ${index + 1} de ${total}`
      counterEl.style.display = ''
    } else {
      counterEl.style.display = 'none'
    }
  }

  document.getElementById('quizQuestion').textContent = q.question
  document.getElementById('quizOptions').innerHTML = [q.option_a, q.option_b, q.option_c, q.option_d]
    .map((text, i) => `
      <label class="quiz-opt">
        <input type="radio" name="salaQuiz" value="${i}">
        <span>${escHtml(text)}</span>
      </label>`).join('')

  const resposta = _answeredMap[q.id]
  if (resposta) {
    quizResolved = true
    document.querySelectorAll('.quiz-opt').forEach((opt, i) => {
      opt.classList.add('disabled')
      const input = opt.querySelector('input')
      if (input) input.disabled = true
      if (i === q.correct_index) opt.classList.add('correct')
      if (i === resposta.chosen_index && !resposta.is_correct) opt.classList.add('wrong')
      if (i === resposta.chosen_index && resposta.is_correct) {
        const radio = opt.querySelector('input')
        if (radio) radio.checked = true
      }
    })
    const justif = q.justification ? `<br><br><span style="display:inline-flex;align-items:flex-start;gap:0.4rem"><span class="material-symbols-outlined" style="font-size:1rem;flex-shrink:0;margin-top:0.1rem">lightbulb</span><em>${escHtml(q.justification)}</em></span>` : ''
    quizFeedback.className = resposta.is_correct ? 'quiz-feedback ok' : 'quiz-feedback err'
    quizFeedback.innerHTML = resposta.is_correct
      ? `<strong>✓ Você já respondeu corretamente.</strong>${justif}`
      : `<strong>✗ Você já respondeu esta pergunta.</strong> A correta está marcada em verde.${justif}`
    setQuizBtnLabel()
    updateNextBtnState()
  }
}

function setQuizBtnLabel() {
  const hasMore    = _quizIndex < _quizQuestions.length - 1
  const curSalaIdx = salaItems.findIndex(it => it._tipo === 'video' && it.id === currentVideoId)
  const isLastItem = curSalaIdx < 0 || curSalaIdx >= salaItems.length - 1
  if (hasMore)          confirmBtn.textContent = 'Próxima Pergunta →'
  else if (!isLastItem) confirmBtn.textContent = 'Próxima Aula →'
  else                  confirmBtn.textContent = 'Concluir Trilha →'
}

function isItemDone(item) {
  if (!item) return false
  return item._tipo === 'avaliacao'
    ? getAvaliacaoProgress(item.id) === 'completed'
    : getVideoProgress(item.id) === 'completed'
}

function renderModuleList(currentId) {
  const list = document.getElementById('salaModuleList')
  if (!list) return
  list.innerHTML = salaItems.map((item, i) => {
    const isAv        = item._tipo === 'avaliacao'
    const isCurrent   = !isAv && item.id === currentId
    const isDone      = isItemDone(item)
    // Libera se: é o primeiro, ou o anterior está concluído, ou o próprio já está concluído
    const anteriorOk  = i === 0 || isItemDone(salaItems[i - 1])
    const canNavigate = isCurrent || isDone || anteriorOk
    const title  = isAv ? item.titulo : item.title
    const icon   = isDone
      ? (isAv ? 'assignment_turned_in' : 'check_circle')
      : isCurrent ? 'play_circle'
      : canNavigate ? (isAv ? 'assignment' : 'play_circle')
      : 'lock'
    const cls    = isCurrent ? 'item-current' : isDone ? 'item-done' : canNavigate ? '' : 'item-locked'
    const color  = isDone ? 'color:var(--primary)' : isAv && canNavigate ? 'color:var(--secondary)' : ''
    const action = canNavigate
      ? (isAv ? `window.abrirAvaliacaoSala(${item.id})` : `window.playSalaVideo(${item.id})`)
      : ''
    return `<li class="module-item ${cls}"
      style="cursor:${canNavigate ? 'pointer' : 'default'}"
      ${action ? `onclick="${action}"` : ''}>
      <span class="material-symbols-outlined" style="${color}">${icon}</span>
      <span>${i + 1}. ${escHtml(title)}</span>
      ${isCurrent ? '<span class="pulse-dot"></span>' : ''}
    </li>`
  }).join('')
}

window.abrirAvaliacaoSala = async function(id) {
  const { data: av } = await supabase.from('avaliacoes').select('*').eq('id', id).single()
  if (av) openAvaliacao(av)
}

window.playSalaVideo = async function(id) {
  const video = salaVideos.find(v => v.id === id)
  if (!video) return
  currentVideoId = video.id
  let cachedRespostas = null
  if (currentUser) {
    const { data } = await supabase.from('respostas').select('question_id, is_correct, chosen_index').eq('user_id', currentUser.id)
    cachedRespostas = data || []
  }
  await renderSalaVideo(video, cachedRespostas)
  updateGradeCard()
}

async function handleQuiz() {
  if (!confirmBtn || !quizFeedback) return

  if (quizResolved) {
    // Avança para próxima pergunta ou próxima aula
    if (_quizIndex < _quizQuestions.length - 1) {
      showQuizQuestion(_quizIndex + 1)
    } else {
      const _curIdx = salaItems.findIndex(it => it._tipo === 'video' && it.id === currentVideoId)
      const _nextIt = _curIdx >= 0 ? (salaItems[_curIdx + 1] || null) : null
      if (_nextIt?._tipo === 'avaliacao') {
        window.abrirAvaliacaoSala(_nextIt.id)
      } else if (_nextIt) {
        currentVideoId = _nextIt.id; await renderSalaVideo(_nextIt)
      } else {
        window.showPage('catalogo')
      }
    }
    return
  }

  const selected = document.querySelector('input[name="salaQuiz"]:checked')
  if (!selected) {
    quizFeedback.className   = 'quiz-feedback err'
    quizFeedback.textContent = 'Selecione uma opção antes de confirmar.'
    return
  }

  const chosenLabel = selected.closest('.quiz-opt')
  const chosenIndex = parseInt(selected.value)
  const isCorrect   = chosenIndex === _currentQuestion?.correct_index

  document.querySelectorAll('.quiz-opt').forEach((opt, i) => {
    opt.classList.add('disabled')
    const input = opt.querySelector('input')
    if (input) input.disabled = true
    if (i === _currentQuestion?.correct_index) opt.classList.add('correct')
  })

  const justif = _currentQuestion?.justification
    ? `<br><br><span style="display:inline-flex;align-items:flex-start;gap:0.4rem"><span class="material-symbols-outlined" style="font-size:1rem;flex-shrink:0;margin-top:0.1rem">lightbulb</span><em>${escHtml(_currentQuestion.justification)}</em></span>`
    : ''

  if (!isCorrect) {
    chosenLabel.classList.remove('correct')
    chosenLabel.classList.add('wrong')
    quizFeedback.className = 'quiz-feedback err'
    quizFeedback.innerHTML = `<strong>✗ Resposta incorreta.</strong> A correta está marcada em verde.${justif}`
  } else {
    quizFeedback.className = 'quiz-feedback ok'
    quizFeedback.innerHTML = `<strong>✓ Correto!</strong>${justif}`
  }

  // Marca progresso da aula apenas ao responder a última pergunta (certa ou errada)
  if (_quizIndex >= _quizQuestions.length - 1) {
    setVideoProgress(currentVideoId, 'completed')
    setTimeout(() => checkTrilhaConcluidaEConfetti(currentVideoId), 400)
  }

  if (_currentQuestion) {
    _answeredMap[_currentQuestion.id] = { question_id: _currentQuestion.id, is_correct: isCorrect, chosen_index: chosenIndex }
    await saveQuizResult(_currentQuestion.id, isCorrect, chosenIndex)
    updateGradeCard()
  }

  quizResolved = true
  setQuizBtnLabel()
  updateNextBtnState()
}

// ============================================
// PLAYER DE VÍDEO (simulado — fallback sem YouTube)
// ============================================
const videoPlayBtn  = document.getElementById('videoPlayBtn')
const videoPlayIcon = document.getElementById('videoPlayIcon')
const videoCtrlIcon = document.getElementById('videoCtrlIcon')
const videoSeekFill = document.getElementById('videoSeekFill')
const videoTime     = document.getElementById('videoTime')

let isPlaying     = false
let progressPct   = 0
let progressTimer = null

if (videoPlayBtn) videoPlayBtn.addEventListener('click', togglePlay)

function togglePlay() {
  isPlaying = !isPlaying
  updatePlayIcon()
  if (isPlaying) {
    progressTimer = setInterval(tickProgress, 500)
  } else {
    clearInterval(progressTimer)
  }
}

function updatePlayIcon() {
  const icon = isPlaying ? 'pause' : 'play_arrow'
  if (videoPlayIcon) videoPlayIcon.textContent = icon
  if (videoCtrlIcon) videoCtrlIcon.textContent = icon
}

function tickProgress() {
  if (progressPct >= 100) {
    clearInterval(progressTimer)
    isPlaying = false
    updatePlayIcon()
    return
  }
  progressPct += 0.5
  if (videoSeekFill) videoSeekFill.style.width = progressPct + '%'

  const totalSec  = 12 * 60 + 45
  const currentSc = Math.floor((progressPct / 100) * totalSec)
  const m = Math.floor(currentSc / 60).toString().padStart(2, '0')
  const s = (currentSc % 60).toString().padStart(2, '0')
  if (videoTime) videoTime.textContent = `${m}:${s} / 12:45`
}

// ============================================
// ACESSIBILIDADE — cards com teclado
// ============================================
document.querySelectorAll('.card[tabindex="0"]').forEach(card => {
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click() }
  })
})

// ============================================
// ADMIN — Abas
// ============================================
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => switchAdminTab(tab.dataset.tab))
})

function switchAdminTab(tabName) {
  document.querySelectorAll('.admin-tab').forEach(t =>
    t.classList.toggle('admin-tab-active', t.dataset.tab === tabName)
  )
  document.querySelectorAll('.admin-tab-pane').forEach(p =>
    p.classList.toggle('active', p.id === 'tab-' + tabName)
  )
  if (tabName === 'videos')            loadVideos()
  if (tabName === 'perguntas')         loadQuestions()
  if (tabName === 'relatorios')        loadReports()
  if (tabName === 'documentos-admin')  loadAdminDocs()
  if (tabName === 'artigos')           loadAdminArtigos()
  if (tabName === 'avaliacoes')        loadAdminAvaliacoes()
  if (tabName === 'trilhas')           loadAdminTrilhas()
}

// Carrega dados ao entrar em páginas específicas
const _baseShowPage = window.showPage
window.showPage = function(pageId) {
  _baseShowPage(pageId)
  if (pageId === 'admin') {
    loadQuestions()
    loadVideos()
    loadReports()
  }
  if (pageId === 'home')       loadHome()
  if (pageId === 'sala')       loadSalaDeAula()
  if (pageId === 'catalogo')   loadCatalogo()
  if (pageId === 'documentos') loadDocumentos()
  if (pageId === 'perfil')     loadPerfilConquistas()
}

// ============================================
// PERFIL — Conquistas por trilha
// ============================================
const LEVEL_ICONS = {
  gold:    'emoji_events',
  silver:  'workspace_premium',
  bronze:  'military_tech',
  started: 'rocket_launch',
  locked:  'lock',
}

async function loadPerfilConquistas() {
  const grid = document.getElementById('achievementsGrid')
  if (!grid || !currentUser) return

  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:1rem"><span class="material-symbols-outlined" style="animation:spin 1s linear infinite;color:var(--primary)">progress_activity</span></div>'

  const [{ data: videos }, { data: notasRaw }] = await Promise.all([
    supabase.from('videos').select('id, title, topics, duracao_seg').eq('visivel', true).order('ordem', { ascending: true }),
    supabase.from('v_desempenho_usuario_trilha').select('video_id, nota_pct').eq('user_id', currentUser.id)
  ])

  if (!videos?.length) {
    grid.innerHTML = '<p style="color:var(--on-surface-var);font-size:0.875rem;grid-column:1/-1">Nenhuma trilha disponível.</p>'
    return
  }

  // Mapa de nota por video_id
  const notaMap = {}
  for (const r of (notasRaw || [])) notaMap[r.video_id] = Number(r.nota_pct)

  // Agrupa por topics
  const trilhaMap = {}
  for (const v of videos) {
    const key = v.topics?.trim() || v.title
    if (!trilhaMap[key]) trilhaMap[key] = []
    trilhaMap[key].push(v.id)
  }

  const trilhas = Object.entries(trilhaMap)
  let desbloqueadas = 0

  const cards = trilhas.map(([nome, ids], i) => {
    const total      = ids.length
    const concluidos = ids.filter(id => getVideoProgress(id) === 'completed').length

    // Vídeos com nota (respondeu quiz, mesmo sem marcar como concluído no local)
    const idsComNota = ids.filter(id => notaMap[id] !== undefined)
    const notas      = idsComNota.map(id => notaMap[id])
    const avgNota    = notas.length ? Math.round(notas.reduce((s, n) => s + n, 0) / notas.length) : null

    // Progresso: conta vídeo como feito se concluído no local OU se tem nota
    const engajados = new Set([
      ...ids.filter(id => getVideoProgress(id) === 'completed'),
      ...idsComNota
    ])
    const engajadosCount = engajados.size
    const progPct = Math.round(engajadosCount / total * 100)

    const allDone = concluidos === total

    // Nível: allDone → medalha por nota | tem engajamento → em progresso | nada → bloqueado
    let level = 'locked'
    if (allDone) {
      desbloqueadas++
      if      (avgNota === null || avgNota >= 90) level = 'gold'
      else if (avgNota >= 70)                     level = 'silver'
      else                                        level = 'bronze'
    } else if (engajadosCount > 0) {
      level = 'started'
    }

    const badgeIcon = `<span class="material-symbols-outlined icon-filled">${LEVEL_ICONS[level]}</span>`

    // Nota só aparece se tem dado real; senão mostra progresso em aulas
    const notaLabel = avgNota !== null
      ? `${avgNota}%`
      : `${engajadosCount}/${total} aulas`

    const levelLabel = level === 'gold'    ? '🥇 Ouro'
                     : level === 'silver'  ? '🥈 Prata'
                     : level === 'bronze'  ? '🥉 Bronze'
                     : level === 'started' ? 'Em progresso'
                     : 'Bloqueado'

    return `
      <div class="ach-card ${level}">
        <div class="ach-badge ${level}">${badgeIcon}</div>
        <div class="ach-name">${escHtml(nome)}</div>
        <span class="ach-nota ${avgNota !== null ? level : 'none'}">${notaLabel}</span>
        <div class="ach-prog-wrap">
          <div class="ach-prog-label">
            <span>${levelLabel}</span>
            <span>${concluidos}/${total}</span>
          </div>
          <div class="ach-prog-bar">
            <div class="ach-prog-fill ${level}" style="width:${progPct}%"></div>
          </div>
        </div>
      </div>`
  })

  // Atualiza stat cards de progresso
  const totalSeg = videos
    .filter(v => getVideoProgress(v.id) === 'completed')
    .reduce((sum, v) => sum + (v.duracao_seg || 0), 0)
  const totalMin = Math.floor(totalSeg / 60)
  const horas     = Math.floor(totalMin / 60)
  const mins      = totalMin % 60
  const horasText = horas > 0
    ? `${horas}h${mins > 0 ? mins + 'm' : ''}`
    : (mins > 0 ? `${mins}m` : '0m')

  const notaVals = (notasRaw || []).map(r => Number(r.nota_pct)).filter(n => !isNaN(n))
  const avgGeral = notaVals.length
    ? Math.round(notaVals.reduce((s, n) => s + n, 0) / notaVals.length)
    : null

  const elCert  = document.getElementById('statCert')
  const elHoras = document.getElementById('statHoras')
  const elAvg   = document.getElementById('statAvg')
  if (elCert)  elCert.textContent  = desbloqueadas
  if (elHoras) elHoras.textContent = horasText
  if (elAvg)   elAvg.textContent   = avgGeral !== null ? avgGeral + '%' : '—'

  // Atualiza contador no header
  const counter = document.getElementById('achievementsCounter')
  if (counter) counter.textContent = `${desbloqueadas} de ${trilhas.length}`

  grid.innerHTML = cards.join('')

  // ── Conquistas Especiais ──
  const specialGrid = document.getElementById('achievementsSpecialGrid')
  if (!specialGrid) return

  // Dados resumidos para as condições
  const trilhasInfo = trilhas.map(([, ids]) => {
    const total      = ids.length
    const concluidos = ids.filter(id => getVideoProgress(id) === 'completed').length
    const notas      = ids.map(id => notaMap[id]).filter(n => n !== undefined)
    const avgNota    = notas.length ? Math.round(notas.reduce((s, n) => s + n, 0) / notas.length) : null
    return { total, concluidos, allDone: concluidos === total, avgNota }
  })
  const totalTrilhas   = trilhasInfo.length
  const concluidasInfo = trilhasInfo.filter(t => t.allDone)

  const SPECIALS = [
    {
      id: 'first_step',
      name: 'Primeiro Passo',
      desc: 'Concluiu a 1ª trilha',
      icon: 'flag',
      unlocked: concluidasInfo.length >= 1,
    },
    {
      id: 'always_gold',
      name: 'Sempre Ouro',
      desc: 'Ouro em todas as trilhas concluídas (≥ 90%)',
      icon: 'workspace_premium',
      unlocked: concluidasInfo.length >= 1 &&
                concluidasInfo.every(t => t.avgNota === null || t.avgNota >= 90),
    },
    {
      id: 'perfectionist',
      name: 'Perfecionista',
      desc: 'Nota 100% em alguma trilha',
      icon: 'star',
      unlocked: trilhasInfo.some(t => t.avgNota === 100),
    },
    {
      id: 'champion',
      name: 'Campeão',
      desc: 'Concluiu todas as trilhas disponíveis',
      icon: 'emoji_events',
      unlocked: totalTrilhas > 0 && concluidasInfo.length === totalTrilhas,
    },
    {
      id: 'on_fire',
      name: 'Em Chamas',
      desc: 'Ouro em 3 ou mais trilhas',
      icon: 'local_fire_department',
      unlocked: concluidasInfo.filter(t => t.avgNota === null || t.avgNota >= 90).length >= 3,
    },
    {
      id: 'no_mistakes',
      name: 'Sem Erros',
      desc: 'Acertou tudo em alguma aula',
      icon: 'gpp_good',
      unlocked: (notasRaw || []).some(r => Number(r.nota_pct) === 100),
    },
  ]

  const unlockedSpecials = SPECIALS.filter(s => s.unlocked).length
  const scCounter = document.getElementById('achievementsSpecialCounter')
  if (scCounter) scCounter.textContent = `${unlockedSpecials} de ${SPECIALS.length}`

  specialGrid.innerHTML = SPECIALS.map(s => {
    const badgeCls = s.unlocked ? 'special-unlocked' : 'special-locked'
    const cardCls  = s.unlocked ? 'special unlocked' : 'special locked'
    const notaEl   = s.unlocked
      ? `<span class="ach-nota special">Desbloqueado</span>`
      : `<span class="ach-nota none">Bloqueado</span>`
    return `
      <div class="ach-card ${cardCls}">
        <div class="ach-badge ${badgeCls}">
          <span class="material-symbols-outlined icon-filled">${s.icon}</span>
        </div>
        <div class="ach-name">${escHtml(s.name)}</div>
        ${notaEl}
        <div class="ach-prog-wrap">
          <div class="ach-prog-label"><span style="font-size:0.6rem;line-height:1.4">${escHtml(s.desc)}</span></div>
        </div>
      </div>`
  }).join('')

  // ── Artigos ──
  const artigosGrid = document.getElementById('artigosGrid')
  const artigosCounter = document.getElementById('artigosCounter')
  if (artigosGrid) {
    const [{ data: artigos }, { data: progArtigos }] = await Promise.all([
      supabase.from('artigos').select('id, titulo, topics').eq('visivel', true).order('ordem', { ascending: true }),
      supabase.from('progresso_usuario').select('item_id').eq('user_id', currentUser.id).eq('item_tipo', 'artigo').eq('concluido', true)
    ])
    const lidos = new Set((progArtigos || []).map(p => p.item_id))
    const total = (artigos || []).length
    const concluidosA = (artigos || []).filter(a => lidos.has(String(a.id))).length
    if (artigosCounter) artigosCounter.textContent = `${concluidosA} de ${total}`
    if (!total) {
      artigosGrid.innerHTML = '<p style="font-size:0.8rem;color:var(--text-secondary);grid-column:1/-1">Nenhum artigo disponível.</p>'
    } else {
      artigosGrid.innerHTML = (artigos || []).map(a => {
        const done = lidos.has(String(a.id))
        const level = done ? 'gold' : 'locked'
        const icon = done ? 'menu_book' : 'lock'
        return `
          <div class="ach-card ${level}">
            <div class="ach-badge ${level}"><span class="material-symbols-outlined icon-filled">${icon}</span></div>
            <div class="ach-name">${escHtml(a.titulo || '—')}</div>
            <span class="ach-nota ${done ? level : 'none'}">${done ? 'Lido ✓' : 'Não lido'}</span>
            <div class="ach-prog-wrap">
              <div class="ach-prog-label"><span>${escHtml(a.topics || '—')}</span></div>
            </div>
          </div>`
      }).join('')
    }
  }

  // ── Avaliações ──
  const avaliacoesGrid = document.getElementById('avaliacoesGrid')
  const avaliacoesCounter = document.getElementById('avaliacoesCounter')
  if (avaliacoesGrid) {
    const [{ data: avaliacoes }, { data: progAv }] = await Promise.all([
      supabase.from('avaliacoes').select('id, titulo, topics').eq('visivel', true).order('ordem', { ascending: true }),
      supabase.from('progresso_usuario').select('item_id, nota_pct').eq('user_id', currentUser.id).eq('item_tipo', 'avaliacao').eq('concluido', true)
    ])
    const notaAvMap = {}
    for (const p of (progAv || [])) notaAvMap[p.item_id] = Number(p.nota_pct)
    const total = (avaliacoes || []).length
    const concluidosAv = (avaliacoes || []).filter(a => notaAvMap[String(a.id)] !== undefined).length
    if (avaliacoesCounter) avaliacoesCounter.textContent = `${concluidosAv} de ${total}`
    if (!total) {
      avaliacoesGrid.innerHTML = '<p style="font-size:0.8rem;color:var(--text-secondary);grid-column:1/-1">Nenhuma avaliação disponível.</p>'
    } else {
      avaliacoesGrid.innerHTML = (avaliacoes || []).map(a => {
        const nota = notaAvMap[String(a.id)]
        const done = nota !== undefined
        const level = !done ? 'locked' : nota >= 90 ? 'gold' : nota >= 70 ? 'silver' : 'bronze'
        const icon  = !done ? 'lock' : 'assignment_turned_in'
        const label = !done ? 'Não realizada' : nota >= 90 ? '🥇 Ouro' : nota >= 70 ? '🥈 Prata' : '🥉 Bronze'
        return `
          <div class="ach-card ${level}">
            <div class="ach-badge ${level}"><span class="material-symbols-outlined icon-filled">${icon}</span></div>
            <div class="ach-name">${escHtml(a.titulo || '—')}</div>
            <span class="ach-nota ${done ? level : 'none'}">${done ? nota + '%' : '—'}</span>
            <div class="ach-prog-wrap">
              <div class="ach-prog-label"><span>${label}</span><span>${escHtml(a.topics || '—')}</span></div>
            </div>
          </div>`
      }).join('')
    }
  }

}

// ============================================
// DOCUMENTOS — viewer + admin
// ============================================

// PDF.js worker
function initPDFWorker() {
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  }
}
initPDFWorker()

async function loadDocumentos() {
  const grid = document.getElementById('docsGrid')
  grid.innerHTML = '<div class="list-empty" style="grid-column:1/-1"><span class="material-symbols-outlined">hourglass_empty</span><p>Carregando...</p></div>'

  const { data: docs, error } = await supabase
    .from('documentos')
    .select('*')
    .order('created_at', { ascending: false })

  if (error || !docs?.length) {
    grid.innerHTML = '<div class="list-empty" style="grid-column:1/-1"><span class="material-symbols-outlined">description</span><p>Nenhum documento disponível ainda.</p></div>'
    return
  }

  grid.innerHTML = ''
  docs.forEach(doc => {
    const card = document.createElement('article')
    card.className = 'card'
    card.style.cursor = 'pointer'

    const thumbId = `thumb-${doc.id}`
    const thumbContent = doc.thumbnail_url
      ? `<img src="${doc.thumbnail_url}" alt="${escHtml(doc.title)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block">`
      : `<span class="material-symbols-outlined" style="font-size:4rem;color:var(--primary);opacity:0.7">picture_as_pdf</span>`
    card.innerHTML = `
      <div class="card-img" id="${thumbId}" style="background:linear-gradient(135deg,#f5f0ff,#e8e0ff);display:flex;align-items:center;justify-content:center;min-height:160px;overflow:hidden;padding:0">
        ${thumbContent}
      </div>
      <div class="card-body">
        <div class="card-meta">
          <span class="badge badge-progress">PDF</span>
          ${doc.category ? `<span class="badge badge-neutral">${escHtml(doc.category)}</span>` : ''}
          ${doc.topics ? `<span style="font-size:0.7rem;color:var(--text-secondary)">${escHtml(doc.topics)}</span>` : ''}
        </div>
        <h2 class="card-title">${escHtml(doc.title)}</h2>
        ${doc.description ? `<p class="card-desc">${escHtml(doc.description)}</p>` : ''}
        <button class="btn-primary" style="margin-top:0.75rem;width:100%;display:flex;align-items:center;justify-content:center;gap:0.4rem">
          <span class="material-symbols-outlined" style="font-size:1rem">auto_stories</span>
          Abrir Documento
        </button>
      </div>`
    card.addEventListener('click', () => openFlipbook(doc.file_url, doc.title))
    grid.appendChild(card)

  })
}

async function openFlipbook(fileUrl, title) {
  const modal    = document.getElementById('modalFlipbook')
  const container = document.getElementById('flipbookContainer')
  const loading  = document.getElementById('flipbookLoading')
  const titleEl  = document.getElementById('flipbookTitle')
  const pageInfo = document.getElementById('flipPageInfo')

  titleEl.textContent = title
  loading.style.display = 'flex'
  container.style.display = 'none'
  container.innerHTML = ''
  pageInfo.textContent = ''
  modal.classList.add('open')

  pageInfo.textContent = ''
  document.getElementById('flipPrev').style.display = 'none'
  document.getElementById('flipNext').style.display = 'none'

  // Mostra loading com progresso
  loading.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:1.25rem;padding:2rem">
      <div class="pdf-spinner"></div>
      <p id="flipLoadMsg" style="margin:0;font-size:0.95rem;color:rgba(255,255,255,0.8)">Baixando documento...</p>
      <div style="width:220px;height:6px;background:rgba(255,255,255,0.15);border-radius:99px;overflow:hidden">
        <div id="flipProgressBar" style="height:100%;width:0%;background:var(--primary);border-radius:99px;transition:width 0.3s ease"></div>
      </div>
      <span id="flipProgressPct" style="font-size:1.1rem;font-weight:700;color:var(--primary)">0%</span>
    </div>`
  loading.style.display = 'flex'

  try {
    const response = await fetch(fileUrl)
    if (!response.ok) throw new Error('Falha ao baixar o arquivo.')

    const contentLength = response.headers.get('Content-Length')
    const total = contentLength ? parseInt(contentLength) : 0
    let loaded = 0
    const chunks = []
    const reader = response.body.getReader()
    const bar = document.getElementById('flipProgressBar')
    const pct = document.getElementById('flipProgressPct')
    const msg = document.getElementById('flipLoadMsg')

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.length
      if (total) {
        const p = Math.round(loaded / total * 100)
        if (bar) bar.style.width = p + '%'
        if (pct) pct.textContent = p + '%'
      } else {
        const kb = Math.round(loaded / 1024)
        if (msg) msg.textContent = `Baixando... ${kb} KB`
      }
    }

    if (msg) msg.textContent = 'Abrindo documento...'
    if (bar) bar.style.width = '100%'
    if (pct) pct.textContent = '100%'

    if (msg) msg.textContent = 'Preparando visualização...'

    const blob = new Blob(chunks, { type: 'application/pdf' })
    const arrayBuffer = await blob.arrayBuffer()

    initPDFWorker()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const numPages = pdf.numPages
    const isMobile = window.innerWidth < 768
    const firstPage = await pdf.getPage(1)
    const flipNav = document.getElementById('flipNav')

    {
      // Todas as telas: uma página por vez com navegação
      const DPR = Math.min(window.devicePixelRatio || 1, 2)
      const availW = isMobile ? window.innerWidth - 16 : Math.min(window.innerWidth - 48, 900)
      const vpRef = firstPage.getViewport({ scale: 1 })
      const SCALE = (availW / vpRef.width) * DPR

      let currentPageNum = 1
      const canvas = document.createElement('canvas')
      canvas.style.cssText = `width:100%;max-width:${availW}px;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.6);display:block`
      container.style.cssText = `display:flex;flex-direction:column;align-items:center;width:100%`
      container.appendChild(canvas)

      let isRendering = false
      async function renderPage(num) {
        if (isRendering) return
        isRendering = true
        const page = await pdf.getPage(num)
        const viewport = page.getViewport({ scale: SCALE })
        canvas.width = viewport.width
        canvas.height = viewport.height
        await page.render({ canvasContext: canvas.getContext('2d', { willReadFrequently: true }), viewport }).promise
        pageInfo.textContent = `Página ${num} de ${numPages}`
        isRendering = false
      }

      if (msg) msg.textContent = 'Preparando...'
      await renderPage(1)

      flipNav.style.display = 'flex'
      document.getElementById('flipPrev').style.display = ''
      document.getElementById('flipNext').style.display = ''
      document.getElementById('flipPrev').onclick = async () => {
        if (currentPageNum > 1) { currentPageNum--; await renderPage(currentPageNum) }
      }
      document.getElementById('flipNext').onclick = async () => {
        if (currentPageNum < numPages) { currentPageNum++; await renderPage(currentPageNum) }
      }

      loading.style.display = 'none'
      container.style.display = 'flex'
    }
  } catch (err) {
    document.getElementById('flipNav').style.display = 'none'
    loading.style.display = 'flex'
    const isSafeUrl = typeof fileUrl === 'string' && fileUrl.startsWith('https://')
    loading.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:1rem">
        <span class="material-symbols-outlined" style="font-size:2rem;color:#ff6b6b">error</span>
        <span style="color:#ff6b6b;font-size:0.9rem">Erro ao carregar o documento.</span>
        ${isSafeUrl ? `<a href="${escHtml(fileUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);font-size:0.875rem;text-decoration:underline">Abrir PDF diretamente ↗</a>` : ''}
      </div>`
    console.error('[Flipbook]', err)
  }
}

document.getElementById('closeFlipbook').addEventListener('click', closeFlipbookModal)

function closeFlipbookModal() {
  document.getElementById('modalFlipbook').classList.remove('open')
  const container = document.getElementById('flipbookContainer')
  const loading   = document.getElementById('flipbookLoading')
  container.innerHTML = ''
  container.style.display = 'none'
  loading.innerHTML = '<div class="spinner"></div><p>Carregando documento...</p>'
  loading.style.display = 'flex'
  document.getElementById('flipPageInfo').textContent = ''
  document.getElementById('flipPrev').style.display = ''
  document.getElementById('flipNext').style.display = ''
}

// Admin docs
async function loadAdminDocs() {
  const listEl = document.getElementById('docsList')
  listEl.innerHTML = '<div class="list-empty"><p>Carregando...</p></div>'

  const { data: docs } = await supabase.from('documentos').select('*').order('created_at', { ascending: false })
  const count = docs?.length || 0
  document.getElementById('docsCount').textContent = `${count} documento${count !== 1 ? 's' : ''}`

  if (!count) {
    listEl.innerHTML = `<div class="list-empty"><span class="material-symbols-outlined">description</span><p>Nenhum documento cadastrado ainda.</p></div>`
    return
  }

  listEl.innerHTML = ''
  docs.forEach(doc => {
    const div = document.createElement('div')
    div.className = 'admin-list-item'
    div.innerHTML = `
      <div class="ali-thumb" style="background:var(--primary-soft);color:var(--primary)">
        <span class="material-symbols-outlined">picture_as_pdf</span>
      </div>
      <div class="ali-info">
        <div class="ali-meta">
          <span class="badge badge-progress">PDF</span>
          ${doc.category ? `<span class="badge badge-neutral">${escHtml(doc.category)}</span>` : ''}
        </div>
        <h4 class="ali-title">${escHtml(doc.title)}</h4>
        ${doc.description ? `<p class="ali-desc">${escHtml(doc.description)}</p>` : ''}
      </div>
      <div class="ali-actions">
        <button class="btn-icon" title="Editar" data-doc-id="${doc.id}" data-action="edit">
          <span class="material-symbols-outlined">edit</span>
        </button>
        <button class="btn-icon btn-danger" title="Excluir" data-doc-id="${doc.id}" data-action="delete">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>`
    div.querySelector('[data-action="edit"]').addEventListener('click', () => {
      editDoc(doc.id, doc.title, doc.description || '', doc.category || '', doc.topics || '')
    })
    div.querySelector('[data-action="delete"]').addEventListener('click', () => {
      deleteDoc(doc.id, doc.file_name || '')
    })
    listEl.appendChild(div)
  })
}

document.getElementById('btnAddDoc').addEventListener('click', () => {
  const modal = document.getElementById('modalDoc')
  modal._editId = null
  modal.querySelector('h2.modal-title').textContent = 'Novo Documento'
  document.getElementById('saveDocBtn').textContent = 'Enviar Documento'
  document.getElementById('docFile').closest('.form-group').style.display = ''
  document.getElementById('formDoc').reset()
  document.getElementById('docError').textContent = ''
  fillTrilhaDropdown('docTopics', 'docTopicsNova', '')
  modal.classList.add('open')
})
document.getElementById('closeModalDoc').addEventListener('click', () => document.getElementById('modalDoc').classList.remove('open'))
document.getElementById('cancelDoc').addEventListener('click',     () => document.getElementById('modalDoc').classList.remove('open'))

document.getElementById('formDoc').addEventListener('submit', async e => {
  e.preventDefault()
  const btn     = e.target.querySelector('[type="submit"]')
  const errorEl = document.getElementById('docError')
  const title   = document.getElementById('docTitle').value.trim()
  const desc    = document.getElementById('docDesc').value.trim()
  const cat     = document.getElementById('docCategory').value.trim()
  const topics  = getTrilhaValue('docTopics', 'docTopicsNova')
  const modal   = document.getElementById('modalDoc')
  const editId  = modal._editId || null

  if (editId) {
    setLoading(btn, true, 'Salvando...')
    errorEl.textContent = ''
    const { error: dbErr } = await supabase.from('documentos').update({
      title, description: desc || null, category: cat || null, topics: topics || null
    }).eq('id', editId)
    setLoading(btn, false, 'Salvar Alterações')
    if (dbErr) { errorEl.textContent = 'Erro ao salvar: ' + dbErr.message; return }
    modal.classList.remove('open')
    loadAdminDocs()
    loadDocumentos()
    return
  }

  const file = document.getElementById('docFile').files[0]
  if (!file) { errorEl.textContent = 'Selecione um arquivo PDF.'; return }
  if (file.type !== 'application/pdf') { errorEl.textContent = 'Somente arquivos PDF são aceitos.'; return }

  setLoading(btn, true, 'Enviando...')
  errorEl.textContent = ''

  const safeName = file.name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_')
  const fileName = `${Date.now()}_${safeName}`
  const { data: uploaded, error: upErr } = await supabase.storage
    .from('documentos')
    .upload(fileName, file, { contentType: 'application/pdf' })

  if (upErr) {
    errorEl.textContent = 'Erro no upload: ' + upErr.message
    setLoading(btn, false, 'Enviar Documento')
    return
  }

  const { data: { publicUrl } } = supabase.storage.from('documentos').getPublicUrl(fileName)

  // Gera thumbnail da primeira página e salva no storage
  let thumbUrl = null
  try {
    initPDFWorker()
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 0.8 })
    const canvas = document.createElement('canvas')
    canvas.width  = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d', { willReadFrequently: true }), viewport }).promise
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85))
    const thumbName = `thumb_${fileName.replace(/\.pdf$/i, '')}.jpg`
    const { error: thumbErr } = await supabase.storage.from('documentos').upload(thumbName, blob, { contentType: 'image/jpeg' })
    if (!thumbErr) {
      const { data: { publicUrl: tUrl } } = supabase.storage.from('documentos').getPublicUrl(thumbName)
      thumbUrl = tUrl
    }
  } catch (_) {}

  const { error: dbErr } = await supabase.from('documentos').insert({
    title,
    description: desc || null,
    category: cat || null,
    topics: topics || null,
    file_url: publicUrl,
    file_name: fileName,
    thumbnail_url: thumbUrl
  })

  setLoading(btn, false, 'Enviar Documento')

  if (dbErr) {
    errorEl.textContent = 'Erro ao salvar: ' + dbErr.message
  } else {
    document.getElementById('modalDoc').classList.remove('open')
    loadAdminDocs()
  }
})

async function deleteDoc(id, fileName) {
  if (!confirm('Excluir este documento?')) return
  if (fileName) await supabase.storage.from('documentos').remove([fileName])
  await supabase.from('documentos').delete().eq('id', id)
  loadAdminDocs()
}
window.deleteDoc = deleteDoc

function editDoc(id, title, description, category, topics) {
  const modal   = document.getElementById('modalDoc')
  const titleEl = modal.querySelector('h2.modal-title')
  const fileGrp = document.getElementById('docFile').closest('.form-group')
  const saveBtn = document.getElementById('saveDocBtn')

  document.getElementById('docTitle').value    = title
  document.getElementById('docDesc').value     = description
  document.getElementById('docCategory').value = category
  document.getElementById('docError').textContent = ''
  fillTrilhaDropdown('docTopics', 'docTopicsNova', topics || '')

  titleEl.textContent  = 'Editar Documento'
  saveBtn.textContent  = 'Salvar Alterações'
  fileGrp.style.display = 'none'

  modal._editId = id
  modal.classList.add('open')
}
window.editDoc = editDoc

// ============================================
// CATÁLOGO — carrega vídeos do Supabase
// ============================================
let _reorderMode = false
let _catalogTemSequencia = false

document.getElementById('btnReordenarCatalogo')?.addEventListener('click', () => {
  if (!_reorderMode && _catalogTemSequencia) {
    alert('A ordem do catálogo segue a Sequência da Trilha.\nPara reordenar, use Admin → Trilhas → ícone de sequência.')
    return
  }
  _reorderMode = !_reorderMode
  const label = document.getElementById('btnReordenarLabel')
  const btn   = document.getElementById('btnReordenarCatalogo')
  if (label) label.textContent = _reorderMode ? 'Concluir' : 'Reordenar'
  if (btn) { btn.style.background = _reorderMode ? 'var(--primary)' : 'transparent'; btn.style.color = _reorderMode ? '#fff' : 'var(--primary)' }
  loadCatalogo()
})

async function moverItemCatalogo(item, direcao) {
  const tabela = item._tipo === 'video' ? 'videos' : item._tipo === 'artigo' ? 'artigos' : 'avaliacoes'
  const lista  = _catalogItems.filter(i => i._tipo === item._tipo).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
  const idx    = lista.findIndex(i => String(i.id) === String(item.id))
  const outro  = lista[idx + direcao]
  if (!outro) return
  await Promise.all([
    supabase.from(tabela).update({ ordem: outro.ordem ?? (idx + direcao) }).eq('id', item.id),
    supabase.from(tabela).update({ ordem: item.ordem ?? idx }).eq('id', outro.id)
  ])
  loadCatalogo()
}
window.moverItemCatalogo = moverItemCatalogo

async function loadCatalogo() {
  const grid = document.getElementById('catalogoGrid')
  grid.innerHTML = '<div class="list-empty" style="grid-column:1/-1"><span class="material-symbols-outlined">hourglass_empty</span><p>Carregando vídeos...</p></div>'

  // Busca sequência definida no admin (trilha_conteudo) + detalhes de cada tipo
  const { data: seq } = await supabase
    .from('trilha_conteudo')
    .select('tipo, item_id, obrigatorio')
    .order('trilha_id', { ascending: true })
    .order('ordem', { ascending: true })

  _catalogTemSequencia = !!seq?.length

  // Fallback: se não há sequência, busca diretamente das tabelas
  if (!seq?.length) {
    const [{ data: videos, error }, { data: artigos }, { data: avaliacoes }] = await Promise.all([
      supabase.from('videos').select('id, title, topics, youtube_url, description, ordem').eq('visivel', true).order('ordem', { ascending: true }),
      supabase.from('artigos').select('id, titulo, descricao, imagem_url, conteudo, conteudo_blocos, topics, ordem').eq('visivel', true).order('ordem', { ascending: true }),
      supabase.from('avaliacoes').select('id, titulo, descricao, imagem_url, topics, ordem').eq('visivel', true).order('ordem', { ascending: true })
    ])
    const allItems = [
      ...(videos || []).map(v => ({ ...v, _tipo: 'video' })),
      ...(artigos || []).map(a => ({ ...a, _tipo: 'artigo' })),
      ...(avaliacoes || []).map(a => ({ ...a, _tipo: 'avaliacao' }))
    ]
    if (error || !allItems.length) {
      grid.innerHTML = '<div class="list-empty" style="grid-column:1/-1"><span class="material-symbols-outlined">play_circle</span><p>Nenhum conteúdo disponível ainda.</p></div>'
      return
    }
    grid.innerHTML = ''
    _catalogItems = allItems
  } else {
    // Busca detalhes de cada tipo em paralelo
    const videoIds  = seq.filter(s => s.tipo === 'video').map(s => s.item_id)
    const artigoIds = seq.filter(s => s.tipo === 'artigo').map(s => s.item_id)
    const avIds     = seq.filter(s => s.tipo === 'avaliacao').map(s => s.item_id)

    const [{ data: videos }, { data: artigos }, { data: avaliacoes }] = await Promise.all([
      videoIds.length  ? supabase.from('videos').select('id, title, topics, youtube_url, description, ordem').in('id', videoIds).eq('visivel', true)    : Promise.resolve({ data: [] }),
      artigoIds.length ? supabase.from('artigos').select('id, titulo, descricao, imagem_url, conteudo, conteudo_blocos, topics, ordem').in('id', artigoIds).eq('visivel', true) : Promise.resolve({ data: [] }),
      avIds.length     ? supabase.from('avaliacoes').select('id, titulo, descricao, imagem_url, topics, ordem').in('id', avIds).eq('visivel', true)       : Promise.resolve({ data: [] }),
    ])

    const videoMap  = Object.fromEntries((videos || []).map(v => [v.id, v]))
    const artigoMap = Object.fromEntries((artigos || []).map(a => [a.id, a]))
    const avMap     = Object.fromEntries((avaliacoes || []).map(a => [a.id, a]))

    // Monta lista na ordem da trilha_conteudo (pula documentos e itens não visíveis)
    const allItems = seq
      .filter(s => s.tipo !== 'documento')
      .map(s => {
        const item = s.tipo === 'video' ? videoMap[s.item_id]
                   : s.tipo === 'artigo' ? artigoMap[s.item_id]
                   : avMap[s.item_id]
        if (!item) return null
        return { ...item, _tipo: s.tipo }
      })
      .filter(Boolean)

    if (!allItems.length) {
      grid.innerHTML = '<div class="list-empty" style="grid-column:1/-1"><span class="material-symbols-outlined">play_circle</span><p>Nenhum conteúdo disponível ainda.</p></div>'
      return
    }

    grid.innerHTML = ''
    _catalogItems = allItems
  }
  _catalogItems.forEach(v => {
    const isArtigo    = v._tipo === 'artigo'
    const isAvaliacao = v._tipo === 'avaliacao'
    const isVideo     = v._tipo === 'video'
    const vid      = isVideo ? ytVideoId(v.youtube_url) : null
    const thumb    = vid ? `https://img.youtube.com/vi/${vid}/mqdefault.jpg` : (v.imagem_url || null)
    const progress    = isVideo ? getVideoProgress(v.id) : isArtigo ? getArtigoProgress(v.id) : getAvaliacaoProgress(v.id)
    const isConcluido = progress === 'completed'
    const badgeCls = isConcluido ? 'badge-tag' : progress === 'started' ? 'badge-progress' : 'badge-neutral'
    const badgeTxt = isConcluido    ? 'Concluído'
                   : isAvaliacao    ? 'Avaliação'
                   : isArtigo       ? 'Leitura'
                   : progress === 'started' ? 'Em Andamento'
                   : 'Disponível'
    const pct      = progress === 'completed' ? 100 : progress === 'started' ? 50 : 0
    const cardIcon = isAvaliacao ? 'assignment' : isArtigo ? 'article' : 'play_circle'
    const overlayIcon = isAvaliacao ? 'assignment' : isArtigo ? 'menu_book' : 'play_arrow'
    const title    = isVideo ? v.title : v.titulo
    const desc     = isVideo ? v.description : v.descricao

    const article = document.createElement('article')
    article.className = 'card'
    article.setAttribute('role', 'button')
    article.setAttribute('tabindex', '0')
    article.innerHTML = `
      <div class="card-img">
        ${thumb
          ? `<img src="${escHtml(thumb)}" alt="${escHtml(title)}" loading="lazy">`
          : `<img src="assets/Design_sem_nome_(14).png" alt="${escHtml(title)}" loading="lazy" style="width:100%;height:100%;object-fit:cover">`}
        ${isConcluido ? `<div class="card-done-overlay"><span class="material-symbols-outlined icon-filled">check_circle</span></div>` : ''}
        <div class="card-play-overlay">
          <div class="card-play-circle"><span class="material-symbols-outlined">${overlayIcon}</span></div>
        </div>
      </div>
      <div class="card-body">
        <div class="card-meta">
          <span class="badge ${isVideo ? badgeCls : 'badge-neutral'}">${badgeTxt}</span>
          ${v.topics ? `<span style="font-size:0.75rem;color:var(--text-secondary)">${escHtml(v.topics)}</span>` : ''}
        </div>
        <h2 class="card-title">${escHtml(title)}</h2>
        ${desc ? `<p class="card-desc">${escHtml(desc)}</p>` : ''}
        ${isVideo ? `<div class="progress-bar"><div class="progress-fill${isConcluido ? ' done' : ''}" style="width:${pct}%"></div></div>` : ''}
      </div>`
    if (_reorderMode) {
      const isAdmin = currentUser && ['adm','super'].includes(window._currentProfile?.access_level)
      if (isAdmin) {
        const overlay = document.createElement('div')
        overlay.style.cssText = 'position:absolute;top:0.5rem;right:0.5rem;display:flex;flex-direction:column;gap:0.25rem;z-index:10'
        overlay.innerHTML = `
          <button onclick="event.stopPropagation();moverItemCatalogo(${JSON.stringify(v).replace(/"/g,'&quot;')},-1)"
            style="width:2rem;height:2rem;border-radius:50%;background:var(--primary);color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.2)">
            <span class="material-symbols-outlined" style="font-size:1rem">arrow_upward</span>
          </button>
          <button onclick="event.stopPropagation();moverItemCatalogo(${JSON.stringify(v).replace(/"/g,'&quot;')},1)"
            style="width:2rem;height:2rem;border-radius:50%;background:var(--primary);color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.2)">
            <span class="material-symbols-outlined" style="font-size:1rem">arrow_downward</span>
          </button>`
        article.style.position = 'relative'
        article.appendChild(overlay)
        article.style.outline = '2px dashed var(--primary)'
      }
    } else {
      const handler = isAvaliacao ? () => openAvaliacao(v) : isArtigo ? () => openArtigo(v) : () => openVideoSala(v)
      article.addEventListener('click', handler)
      article.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler() } })
    }
    grid.appendChild(article)
  })
}

function getArtigoProgress(id) {
  if (!currentUser) return null
  return localStorage.getItem(`eduflow-artigo-${currentUser.id}-${id}`) || null
}
function setArtigoProgress(id, status, titulo = '') {
  if (!currentUser) return
  localStorage.setItem(`eduflow-artigo-${currentUser.id}-${id}`, status)
  if (status === 'completed') {
    supabase.from('progresso_usuario').upsert(
      { user_id: currentUser.id, item_id: String(id), item_tipo: 'artigo', concluido: true },
      { onConflict: 'user_id,item_id,item_tipo' }
    ).then(({ error }) => {
      if (error) console.error('[Progresso] Erro ao salvar artigo concluído:', error)
    })
    logAudit('artigo_lido', titulo || `Artigo ID: ${id}`)
  }
}

function blocksToHtml(blocks = []) {
  return blocks.map(b => {
    switch (b.type) {
      case 'header': {
        const htxt = DOMPurify.sanitize(b.data.text || '', {ALLOWED_TAGS:['b','i','u','strong','em','mark','code','a','br'],ALLOWED_ATTR:['href','target']})
        return `<h${b.data.level}>${htxt}</h${b.data.level}>`
      }
      case 'paragraph': {
        const ptxt = DOMPurify.sanitize(b.data.text || '', {ALLOWED_TAGS:['b','i','u','strong','em','mark','code','a','br'],ALLOWED_ATTR:['href','target']})
        return `<p>${ptxt}</p>`
      }
      case 'list': {
        const tag   = b.data.style === 'ordered' ? 'ol' : 'ul'
        const items = b.data.items.map(i => {
          const raw = typeof i === 'string' ? i : (i.content || '')
          return `<li>${DOMPurify.sanitize(raw, {ALLOWED_TAGS:['b','i','u','strong','em','mark','code','a','br'],ALLOWED_ATTR:['href','target']})}</li>`
        }).join('')
        return `<${tag}>${items}</${tag}>`
      }
      case 'image': {
        const url     = b.data.file?.url || b.data.url || ''
        const caption = b.data.caption || ''
        return `<figure><img src="${escHtml(url)}" alt="${escHtml(caption)}">${caption ? `<figcaption>${escHtml(caption)}</figcaption>` : ''}</figure>`
      }
      case 'delimiter':
        return '<hr>'
      default:
        return ''
    }
  }).join('')
}

async function openArtigo(artigo) {
  document.getElementById('artigoTituloEl').textContent    = artigo.titulo || ''
  document.getElementById('artigoDescricaoEl').textContent = artigo.descricao || ''
  const conteudoEl = document.getElementById('artigoConteudoEl')
  if (artigo.conteudo_blocos?.blocks?.length) {
    conteudoEl.innerHTML = blocksToHtml(artigo.conteudo_blocos.blocks)
  } else if (artigo.conteudo) {
    conteudoEl.innerHTML = `<p style="white-space:pre-wrap">${escHtml(artigo.conteudo)}</p>`
  } else {
    conteudoEl.innerHTML = ''
  }
  document.getElementById('artigoPageTopics').textContent = artigo.topics || ''
  const imgWrap = document.getElementById('artigoImagemWrap')
  const imgEl   = document.getElementById('artigoImagemEl')
  if (artigo.imagem_url) { imgEl.src = artigo.imagem_url; imgWrap.style.display = '' }
  else imgWrap.style.display = 'none'

  const concluirBtn = document.getElementById('artigoConcluirBtn')
  const proximoWrap = document.getElementById('artigoProximoWrap')
  const proximoBtn  = document.getElementById('artigoProximoBtn')
  const proximoTit  = document.getElementById('artigoProximoTitulo')
  const quizWrap    = document.getElementById('artigoQuizWrap')
  const quizCard    = document.getElementById('artigoQuizCard')
  const jaConcluido = getArtigoProgress(artigo.id) === 'completed'

  function mostrarProximo() {
    const idx    = _catalogItems.findIndex(c => c._tipo === 'artigo' && c.id === artigo.id)
    const proximo = _catalogItems[idx + 1]
    if (proximo) {
      proximoTit.textContent = proximo._tipo === 'artigo' ? proximo.titulo : proximo.title
      proximoWrap.style.display = ''
      proximoBtn.onclick = () => proximo._tipo === 'artigo' ? openArtigo(proximo) : openVideoSala(proximo)
    } else proximoWrap.style.display = 'none'
  }

  function marcarConcluido() {
    setArtigoProgress(artigo.id, 'completed', artigo.titulo || artigo.title || '')
    concluirBtn.innerHTML = '<span class="material-symbols-outlined">check_circle</span> Concluído!'
    concluirBtn.disabled = true; concluirBtn.style.opacity = '0.7'
    mostrarProximo()
  }

  // Carrega perguntas do artigo
  const { data: questoes } = await supabase.from('questoes_sala_de_aula')
    .select('*').eq('artigo_id', artigo.id).order('created_at', { ascending: true })

  if (questoes?.length) {
    quizWrap.style.display = ''
    concluirBtn.style.display = 'none'
    if (jaConcluido) {
      quizCard.innerHTML = `<div style="text-align:center;padding:1.5rem;color:var(--success)"><span class="material-symbols-outlined icon-filled" style="font-size:2.5rem">check_circle</span><p style="font-weight:700;margin-top:0.5rem">Já concluído!</p></div>`
      mostrarProximo()
    } else {
      let qIdx = 0
      const answeredMap = {}
      function renderQ() {
        const q = questoes[qIdx]
        quizCard.innerHTML = `
          <p style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:0.75rem">Pergunta ${qIdx+1} de ${questoes.length}</p>
          <p style="font-weight:600;margin-bottom:1rem">${escHtml(q.question)}</p>
          <div class="quiz-options" id="aqOptions">
            ${[q.option_a, q.option_b, q.option_c, q.option_d]
              .map((opt, oi) => ({ opt, oi }))
              .filter(({ opt }) => opt)
              .map(({ opt, oi }) => `
              <label class="quiz-option" data-oi="${oi}">
                <input type="radio" name="artigo-quiz" value="${oi}">
                <span>${escHtml(opt)}</span>
              </label>`).join('')}
          </div>
          <div class="quiz-feedback" id="aqFeedback"></div>
          <button class="btn-primary" id="aqConfirm" style="margin-top:1rem;width:100%">Confirmar Resposta</button>`

        document.getElementById('aqConfirm').addEventListener('click', () => {
          const chosen = quizCard.querySelector('input[name="artigo-quiz"]:checked')
          if (!chosen) return
          const oi = +chosen.value
          const isCorrect = oi === (q.correct_index ?? 0)
          answeredMap[q.id] = isCorrect
          quizCard.querySelectorAll('.quiz-option').forEach(l => { l.style.pointerEvents = 'none' })
          quizCard.querySelector(`.quiz-option[data-oi="${q.correct_index ?? 0}"]`)?.classList.add('correct')
          if (!isCorrect) quizCard.querySelector(`.quiz-option[data-oi="${oi}"]`)?.classList.add('wrong')
          const fb = document.getElementById('aqFeedback')
          fb.className = `quiz-feedback ${isCorrect ? 'ok' : 'err'}`
          fb.innerHTML = isCorrect ? '<strong>✓ Correto!</strong>' : '<strong>✗ Incorreta.</strong> A correta está em verde.'
          document.getElementById('aqConfirm').textContent = qIdx < questoes.length - 1 ? 'Próxima' : 'Concluir'
          document.getElementById('aqConfirm').onclick = () => {
            if (qIdx < questoes.length - 1) { qIdx++; renderQ() }
            else { marcarConcluido(); quizWrap.style.display = 'none'; concluirBtn.style.display = '' }
          }
        })
      }
      renderQ()
    }
  } else {
    quizWrap.style.display = 'none'
    concluirBtn.style.display = ''
    if (jaConcluido) {
      concluirBtn.innerHTML = '<span class="material-symbols-outlined">check_circle</span> Concluído!'
      concluirBtn.disabled = true; concluirBtn.style.opacity = '0.7'
      mostrarProximo()
    } else {
      concluirBtn.innerHTML = '<span class="material-symbols-outlined">check_circle</span> Marcar como Concluído'
      concluirBtn.disabled = false; concluirBtn.style.opacity = ''
      proximoWrap.style.display = 'none'
      concluirBtn.onclick = marcarConcluido
    }
  }

  window.showPage('artigo')
}

function getVideoProgress(videoId) {
  if (!currentUser) return null
  return localStorage.getItem(`eduflow-prog-${currentUser.id}-${videoId}`) || null
}

function setVideoProgress(videoId, status) {
  if (!currentUser) return
  localStorage.setItem(`eduflow-prog-${currentUser.id}-${videoId}`, status)
  if (status === 'completed') {
    supabase.from('progresso_usuario').upsert(
      { user_id: currentUser.id, item_id: String(videoId), item_tipo: 'video', concluido: true },
      { onConflict: 'user_id,item_id,item_tipo' }
    ).then(({ error }) => {
      if (error) console.error('[Progresso] Erro ao salvar vídeo concluído:', error)
    })
    logAudit('video_concluido', _currentVideoTitle || `Vídeo ID: ${videoId}`)
  }
}

function getVideoWatched(videoId) {
  if (!currentUser) return false
  return localStorage.getItem(`eduflow-watched-${currentUser.id}-${videoId}`) === '1'
}

function setVideoWatched(videoId) {
  if (!currentUser) return
  localStorage.setItem(`eduflow-watched-${currentUser.id}-${videoId}`, '1')
}

function openVideoSala(video) {
  currentVideoId = video.id
  _currentVideoTitle = video.title || ''
  if (getVideoProgress(video.id) !== 'completed') setVideoProgress(video.id, 'started')
  window.showPage('sala')
}
window.loadCatalogo = loadCatalogo

// ============================================
// AVALIAÇÕES — Admin CRUD
// ============================================
let editingAvaliacaoId  = null
let _avaliacaoImagemUrl = null
let _avaliacaoQuestoes  = []

async function loadAdminAvaliacoes() {
  const listEl = document.getElementById('avaliacoesList')
  if (!listEl) return
  listEl.innerHTML = '<div class="list-empty"><p>Carregando...</p></div>'
  const { data, error } = await supabase.from('avaliacoes').select('*').order('ordem', { ascending: true })
  const count = data?.length || 0
  const countEl = document.getElementById('avaliacoesCount')
  if (countEl) countEl.textContent = `${count} avaliação${count !== 1 ? 'ões' : ''}`
  if (error || !count) {
    listEl.innerHTML = '<div class="list-empty"><span class="material-symbols-outlined">assignment</span><p>Nenhuma avaliação cadastrada ainda.</p></div>'
    return
  }
  listEl.innerHTML = ''
  data.forEach((a, i) => listEl.appendChild(renderAvaliacaoAdminCard(a, i, data.length)))
}

function renderAvaliacaoAdminCard(a, idx, total) {
  const oculto = a.visivel === false
  const div = document.createElement('div')
  div.className = 'admin-list-item'
  div.style.opacity = oculto ? '0.55' : '1'
  div.innerHTML = `
    <div class="ali-thumb ali-thumb-video" style="${a.imagem_url ? `background:url('${escHtml(a.imagem_url)}') center/contain no-repeat;background-color:var(--surface-dim)` : `background:url('assets/Design_sem_nome_(14).png') center/cover no-repeat`}">
    </div>
    <div class="ali-info">
      <div class="ali-meta">
        <span class="badge badge-tag"><span class="material-symbols-outlined">assignment</span>Avaliação</span>
        ${a.topics ? `<span class="ali-extra">${escHtml(a.topics)}</span>` : ''}
        ${oculto ? '<span class="ali-extra" style="color:#ff6b6b">● Oculto</span>' : ''}
      </div>
      <h4 class="ali-title">${escHtml(a.titulo)}</h4>
      ${a.descricao ? `<p class="ali-desc">${escHtml(a.descricao)}</p>` : ''}
    </div>
    <div class="ali-actions" style="flex-direction:column;gap:0.25rem">
      <div style="display:flex;gap:0.25rem">
        <button class="btn-icon" title="Mover para cima" ${idx === 0 ? 'disabled' : ''} onclick="moveAvaliacao(${a.id}, -1)">
          <span class="material-symbols-outlined">arrow_upward</span>
        </button>
        <button class="btn-icon" title="Mover para baixo" ${idx === total - 1 ? 'disabled' : ''} onclick="moveAvaliacao(${a.id}, 1)">
          <span class="material-symbols-outlined">arrow_downward</span>
        </button>
      </div>
      <div style="display:flex;gap:0.25rem">
        <button class="btn-icon" title="Editar" onclick="editAvaliacao(${a.id})">
          <span class="material-symbols-outlined">edit</span>
        </button>
        <button class="btn-icon btn-danger" title="Excluir" onclick="deleteAvaliacao(${a.id})">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    </div>`
  return div
}

async function moveAvaliacao(id, direction) {
  const { data } = await supabase.from('avaliacoes').select('id, ordem').order('ordem', { ascending: true })
  if (!data) return
  const idx  = data.findIndex(a => a.id === id)
  const swap = data[idx + direction]
  if (!swap) return
  // Fallback posicional quando ordem é null ou duplicada (registros antigos sem ordem)
  let ordemAtual = data[idx].ordem ?? idx
  let ordemSwap  = swap.ordem ?? (idx + direction)
  if (ordemAtual === ordemSwap) { ordemAtual = idx; ordemSwap = idx + direction }
  await Promise.all([
    supabase.from('avaliacoes').update({ ordem: ordemSwap }).eq('id', id),
    supabase.from('avaliacoes').update({ ordem: ordemAtual }).eq('id', swap.id)
  ])
  loadAdminAvaliacoes()
}
window.moveAvaliacao = moveAvaliacao

async function deleteAvaliacao(id) {
  if (!confirm('Tem certeza que deseja excluir esta avaliação?')) return
  await supabase.from('avaliacoes').delete().eq('id', id)
  loadAdminAvaliacoes()
}
window.deleteAvaliacao = deleteAvaliacao

async function editAvaliacao(id) {
  const { data } = await supabase.from('avaliacoes').select('*').eq('id', id).single()
  if (data) openAvaliacaoModal(data)
}
window.editAvaliacao = editAvaliacao

function renderAvaliacaoQList() {
  const listEl = document.getElementById('avaliacaoQList')
  if (!listEl) return
  if (!_avaliacaoQuestoes.length) {
    listEl.innerHTML = '<p style="font-size:0.8rem;color:var(--text-secondary);padding:0.25rem 0">Nenhuma pergunta adicionada.</p>'
    return
  }
  listEl.innerHTML = _avaliacaoQuestoes.map((q, qi) => `
    <div class="artigo-q-card surface-card" style="padding:0.75rem;gap:0.5rem;display:flex;flex-direction:column" data-qi="${qi}">
      <div style="display:flex;align-items:flex-start;gap:0.5rem">
        <span style="font-size:0.7rem;font-weight:700;color:var(--primary);padding-top:0.6rem;flex-shrink:0">Q${qi+1}</span>
        <textarea class="av-q-enunciado" rows="2" placeholder="Texto da pergunta..." style="flex:1;resize:vertical;padding:0.4rem 0.5rem;font-size:0.85rem;border:1px solid var(--outline-var);border-radius:var(--r-sm);background:var(--input-bg);color:var(--on-surface)">${escHtml(q.enunciado || '')}</textarea>
        <button type="button" class="btn-icon av-q-del" data-qi="${qi}" style="color:var(--error);flex-shrink:0">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
      <div style="display:flex;flex-direction:column;gap:0.3rem;padding-left:1.5rem">
        ${[0,1,2,3].map(oi => `
          <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.8rem;cursor:pointer">
            <input type="radio" name="avq-correct-${qi}" value="${oi}" ${(q.correct_index ?? 0) === oi ? 'checked' : ''} style="cursor:pointer">
            <input type="text" class="av-q-opt" data-qi="${qi}" data-oi="${oi}"
              placeholder="Opção ${oi+1}" value="${escHtml(q.options?.[oi] || '')}"
              style="flex:1;padding:0.3rem 0.5rem;font-size:0.8rem;border:1px solid var(--outline-var);border-radius:var(--r-sm);background:var(--input-bg);color:var(--on-surface)">
          </label>`).join('')}
      </div>
    </div>`).join('')

  listEl.querySelectorAll('.av-q-del').forEach(btn =>
    btn.addEventListener('click', () => { _avaliacaoQuestoes.splice(+btn.dataset.qi, 1); renderAvaliacaoQList() }))
  listEl.querySelectorAll('.av-q-enunciado').forEach(ta =>
    ta.addEventListener('input', () => { _avaliacaoQuestoes[+ta.closest('[data-qi]').dataset.qi].enunciado = ta.value }))
  listEl.querySelectorAll('.av-q-opt').forEach(inp =>
    inp.addEventListener('input', () => { _avaliacaoQuestoes[+inp.dataset.qi].options[+inp.dataset.oi] = inp.value }))
  listEl.querySelectorAll('input[type="radio"]').forEach(r =>
    r.addEventListener('change', () => { _avaliacaoQuestoes[+r.name.replace('avq-correct-','')].correct_index = +r.value }))
}

document.getElementById('btnAddAvaliacaoQ')?.addEventListener('click', () => {
  _avaliacaoQuestoes.push({ id: null, enunciado: '', options: ['','','',''], correct_index: 0 })
  renderAvaliacaoQList()
})

async function openAvaliacaoModal(av = null) {
  editingAvaliacaoId  = null
  _avaliacaoImagemUrl = null
  _avaliacaoQuestoes  = []
  document.getElementById('formAvaliacao').reset()
  document.getElementById('avaliacaoError').textContent = ''
  document.getElementById('avaliacaoImagemPreview').style.display = 'none'
  document.getElementById('modalAvaliacaoTitle').textContent  = av ? 'Editar Avaliação' : 'Nova Avaliação'
  document.getElementById('saveAvaliacaoBtn').textContent     = av ? 'Salvar Alterações' : 'Salvar Avaliação'
  fillTrilhaDropdown('avaliacaoTopics', 'avaliacaoTopicsNova', av?.topics || '')
  if (av) {
    editingAvaliacaoId  = av.id
    _avaliacaoImagemUrl = av.imagem_url || null
    document.getElementById('avaliacaoTitulo').value    = av.titulo || ''
    document.getElementById('avaliacaoDescricao').value = av.descricao || ''
    document.getElementById('avaliacaoCategoria').value = av.categoria || ''
    document.getElementById('avaliacaoVisivel').checked = av.visivel !== false
    if (av.imagem_url) {
      const preview = document.getElementById('avaliacaoImagemPreview')
      preview.src = av.imagem_url; preview.style.display = ''
      document.getElementById('avaliacaoImagemLabelText').textContent = 'Imagem atual (clique para trocar)'
    }
    const { data: qs } = await supabase.from('questoes_avaliacao')
      .select('*').eq('avaliacao_id', av.id).order('ordem', { ascending: true })
    _avaliacaoQuestoes = (qs || []).map(q => ({
      id: q.id, enunciado: q.question,
      options: [q.option_a || '', q.option_b || '', q.option_c || '', q.option_d || ''],
      correct_index: q.correct_index ?? 0
    }))
  }
  renderAvaliacaoQList()
  document.getElementById('modalAvaliacao').classList.add('open')
}

function closeAvaliacaoModal() {
  document.getElementById('modalAvaliacao').classList.remove('open')
}

document.getElementById('btnAddAvaliacao')?.addEventListener('click', () => openAvaliacaoModal())
document.getElementById('closeModalAvaliacao')?.addEventListener('click', closeAvaliacaoModal)
document.getElementById('cancelAvaliacao')?.addEventListener('click', closeAvaliacaoModal)

document.getElementById('avaliacaoImagemFile')?.addEventListener('change', e => {
  const file = e.target.files[0]
  const preview = document.getElementById('avaliacaoImagemPreview')
  if (file) {
    const reader = new FileReader()
    reader.onload = ev => { preview.src = ev.target.result; preview.style.display = '' }
    reader.readAsDataURL(file)
    document.getElementById('avaliacaoImagemLabelText').textContent = file.name
  } else {
    preview.style.display = 'none'
    document.getElementById('avaliacaoImagemLabelText').textContent = 'Clique para escolher uma imagem'
  }
})

document.getElementById('formAvaliacao')?.addEventListener('submit', async e => {
  e.preventDefault()
  const btn       = e.target.querySelector('[type="submit"]')
  const errorEl   = document.getElementById('avaliacaoError')
  const titulo    = document.getElementById('avaliacaoTitulo').value.trim()
  const descricao = document.getElementById('avaliacaoDescricao').value.trim()
  const topics    = getTrilhaValue('avaliacaoTopics', 'avaliacaoTopicsNova')
  const categoria = document.getElementById('avaliacaoCategoria').value.trim()
  const visivel   = document.getElementById('avaliacaoVisivel').checked
  const file      = document.getElementById('avaliacaoImagemFile').files[0]
  if (!titulo) { errorEl.textContent = 'Preencha o título.'; return }
  const idxSemCorreta = _avaliacaoQuestoes.findIndex(q =>
    q.enunciado?.trim() && q.options?.filter(o => o?.trim()).length >= 2 && !q.options[q.correct_index ?? 0]?.trim())
  if (idxSemCorreta !== -1) { errorEl.textContent = `Pergunta ${idxSemCorreta + 1}: a alternativa marcada como correta está vazia.`; return }
  setLoading(btn, true, 'Salvando...')
  errorEl.textContent = ''
  let imagemUrl = _avaliacaoImagemUrl
  if (file) {
    const ext = file.name.split('.').pop()
    const path = `avaliacoes/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('imagens').upload(path, file, { upsert: true })
    if (upErr) { errorEl.textContent = 'Erro ao enviar imagem: ' + upErr.message; setLoading(btn, false, editingAvaliacaoId ? 'Salvar Alterações' : 'Salvar Avaliação'); return }
    const { data: urlData } = supabase.storage.from('imagens').getPublicUrl(path)
    imagemUrl = urlData.publicUrl
  }
  const payload = { titulo, descricao: descricao || null, topics: topics || null, categoria: categoria || null, imagem_url: imagemUrl || null, visivel }
  let savedId = editingAvaliacaoId
  if (editingAvaliacaoId) {
    const { error } = await supabase.from('avaliacoes').update(payload).eq('id', editingAvaliacaoId)
    if (error) { errorEl.textContent = 'Erro: ' + error.message; setLoading(btn, false, 'Salvar Alterações'); return }
  } else {
    const { data: inserted, error } = await supabase.from('avaliacoes').insert(payload).select('id').single()
    if (error) { errorEl.textContent = 'Erro: ' + error.message; setLoading(btn, false, 'Salvar Avaliação'); return }
    savedId = inserted.id
  }
  await supabase.from('questoes_avaliacao').delete().eq('avaliacao_id', savedId)
  const pergsValidas = _avaliacaoQuestoes.filter(q => q.enunciado?.trim() && q.options?.filter(o => o?.trim()).length >= 2)
  if (pergsValidas.length) {
    await supabase.from('questoes_avaliacao').insert(
      pergsValidas.map((q, i) => ({
        avaliacao_id: savedId, question: q.enunciado,
        option_a: q.options[0] || '', option_b: q.options[1] || '',
        option_c: q.options[2] || '', option_d: q.options[3] || '',
        correct_index: q.correct_index ?? 0, ordem: i + 1
      }))
    )
  }
  setLoading(btn, false, editingAvaliacaoId ? 'Salvar Alterações' : 'Salvar Avaliação')
  closeAvaliacaoModal()
  loadAdminAvaliacoes()
})

// ============================================
// AVALIAÇÕES — Viewer (aluno faz a prova)
// ============================================

function _avProximoBtnHtml(avId) {
  const idx  = salaItems.findIndex(it => it._tipo === 'avaliacao' && it.id === avId)
  const next = idx >= 0 ? (salaItems[idx + 1] || null) : null
  if (next) {
    const label = next._tipo === 'avaliacao' ? 'Ir para Avaliação' : 'Ir para Próxima Aula'
    return { html: `<button class="btn-primary" id="avNextBtn" style="margin-top:1.5rem;display:inline-flex;align-items:center;gap:0.5rem">${escHtml(label)} <span class="material-symbols-outlined">arrow_forward</span></button>`, next }
  }
  if (salaItems.length > 0) {
    return { html: `<button class="btn-outline" id="avVoltarBtn" style="margin-top:1.5rem">← Voltar para Sala de Aula</button>`, next: null }
  }
  return { html: '', next: null }
}

function _avAnexarProximo({ next }) {
  if (next) {
    document.getElementById('avNextBtn')?.addEventListener('click', () => {
      if (next._tipo === 'avaliacao') { window.abrirAvaliacaoSala(next.id) }
      else { window.showPage('sala'); const v = salaVideos.find(v => v.id === next.id); if (v) { currentVideoId = v.id; renderSalaVideo(v) } }
    })
  } else {
    document.getElementById('avVoltarBtn')?.addEventListener('click', () => { window.showPage('sala'); renderModuleList(currentVideoId) })
  }
}

function getAvaliacaoProgress(id) {
  if (!currentUser) return null
  return localStorage.getItem(`eduflow-av-${currentUser.id}-${id}`) || null
}

async function openAvaliacao(av) {
  document.getElementById('avaliacaoTituloEl').textContent    = av.titulo || ''
  document.getElementById('avaliacaoDescricaoEl').textContent = av.descricao || ''
  document.getElementById('avaliacaoPageTopics').textContent  = av.topics || ''
  const imgWrap = document.getElementById('avaliacaoImagemWrap')
  const imgEl   = document.getElementById('avaliacaoImagemEl')
  if (av.imagem_url) { imgEl.src = av.imagem_url; imgWrap.style.display = '' }
  else imgWrap.style.display = 'none'

  window.showPage('avaliacao')

  const conteudo    = document.getElementById('avaliacaoConteudo')
  const jaConcluido = getAvaliacaoProgress(av.id) === 'completed'

  if (jaConcluido) {
    // Verifica se tem nota salva no banco
    const { data: progRow } = await supabase
      .from('progresso_usuario')
      .select('nota_pct')
      .eq('user_id', currentUser.id)
      .eq('item_id', av.id)
      .eq('item_tipo', 'avaliacao')
      .maybeSingle()

    const notaSalva = progRow?.nota_pct
    if (notaSalva !== null && notaSalva !== undefined) {
      // Tem nota — mostra resultado sem refazer
      const cor = notaSalva >= 70 ? 'var(--success)' : notaSalva >= 50 ? 'var(--warning)' : 'var(--error)'
      const { html: proxHtml, next: proxItem } = _avProximoBtnHtml(av.id)
      conteudo.innerHTML = `<div style="text-align:center;padding:2rem">
        <span class="material-symbols-outlined icon-filled" style="font-size:3rem;color:${cor}">check_circle</span>
        <p style="font-weight:700;font-size:1.1rem;margin-top:0.5rem;color:var(--on-surface)">Avaliação concluída!</p>
        <p style="font-size:2rem;font-weight:800;color:${cor};margin:0.5rem 0">${notaSalva}%</p>
        <p style="color:var(--text-secondary);font-size:0.85rem">${notaSalva >= 70 ? 'Parabéns! Ótimo desempenho.' : notaSalva >= 50 ? 'Bom esforço! Continue estudando.' : 'Continue se dedicando!'}</p>
        ${proxHtml}
      </div>`
      _avAnexarProximo({ next: proxItem })
      return
    }
    // Sem nota salva — permite refazer para registrar
    conteudo.innerHTML = `<div style="text-align:center;padding:1.5rem;color:var(--text-secondary)">
      <span class="material-symbols-outlined" style="font-size:2rem">assignment_return</span>
      <p style="margin:0.5rem 0;font-weight:600;color:var(--on-surface)">Sua nota ainda não foi registrada.</p>
      <p style="font-size:0.85rem;margin-bottom:1rem">Refaça a avaliação para que sua nota apareça nos relatórios.</p>
      <button class="btn-primary" id="btnRefazerAv" style="padding:0.6rem 1.5rem">Refazer Avaliação</button>
    </div>`
    document.getElementById('btnRefazerAv').onclick = async () => {
      localStorage.removeItem(`eduflow-av-${currentUser.id}-${av.id}`)
      await supabase.from('progresso_usuario')
        .update({ concluido: false })
        .eq('user_id', currentUser.id).eq('item_id', String(av.id)).eq('item_tipo', 'avaliacao')
      openAvaliacao(av)
    }
    return
  }

  const { data: questoes } = await supabase.from('questoes_avaliacao')
    .select('*').eq('avaliacao_id', av.id).order('ordem', { ascending: true })

  if (!questoes?.length) {
    conteudo.innerHTML = '<p style="color:var(--text-secondary);text-align:center">Esta avaliação ainda não tem perguntas.</p>'
    return
  }

  let qIdx = 0
  let acertos = 0
  const respostas = {}

  function renderQ() {
    const q = questoes[qIdx]
    conteudo.innerHTML = `
      <div class="quiz-card">
        <p style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:0.75rem">Pergunta ${qIdx+1} de ${questoes.length}</p>
        <p style="font-weight:600;margin-bottom:1rem">${escHtml(q.question)}</p>
        <div class="quiz-options" id="avOptions">
          ${[q.option_a, q.option_b, q.option_c, q.option_d]
            .map((opt, oi) => ({ opt, oi }))
            .filter(({ opt }) => opt)
            .map(({ opt, oi }) => `
            <label class="quiz-option" data-oi="${oi}">
              <input type="radio" name="av-quiz" value="${oi}">
              <span>${escHtml(opt)}</span>
            </label>`).join('')}
        </div>
        <div class="quiz-feedback" id="avFeedback"></div>
        <button class="btn-primary" id="avConfirm" style="margin-top:1rem;width:100%">Confirmar Resposta</button>
      </div>`

    const btn = document.getElementById('avConfirm')
    btn.onclick = () => {
      const chosen = conteudo.querySelector('input[name="av-quiz"]:checked')
      if (!chosen) return
      const oi = +chosen.value
      const isCorrect = oi === (q.correct_index ?? 0)
      if (isCorrect) acertos++
      respostas[q.id] = isCorrect
      conteudo.querySelectorAll('.quiz-option').forEach(l => { l.style.pointerEvents = 'none' })
      conteudo.querySelector(`.quiz-option[data-oi="${q.correct_index ?? 0}"]`)?.classList.add('correct')
      if (!isCorrect) conteudo.querySelector(`.quiz-option[data-oi="${oi}"]`)?.classList.add('wrong')
      const fb = document.getElementById('avFeedback')
      fb.className = `quiz-feedback ${isCorrect ? 'ok' : 'err'}`
      fb.innerHTML = isCorrect ? '<strong>✓ Correto!</strong>' : '<strong>✗ Incorreta.</strong> A correta está em verde.'
      btn.textContent = qIdx < questoes.length - 1 ? 'Próxima ›' : 'Ver Resultado'
      btn.onclick = () => {
        if (qIdx < questoes.length - 1) {
          qIdx++
          renderQ()
          document.querySelector('#page-avaliacao .main-content, #page-avaliacao')?.scrollTo({ top: 0, behavior: 'smooth' })
        } else {
          mostrarResultado()
        }
      }
    }
  }

  async function mostrarResultado() {
    const pct = Math.round((acertos / questoes.length) * 100)
    localStorage.setItem(`eduflow-av-${currentUser.id}-${av.id}`, 'completed')
    // Usa String(av.id) para compatibilidade com item_id text/uuid no banco
    const { data: savedData, error: errUpsert } = await supabase.from('progresso_usuario').upsert(
      { user_id: currentUser.id, item_id: String(av.id), item_tipo: 'avaliacao', concluido: true, nota_pct: pct },
      { onConflict: 'user_id,item_id,item_tipo' }
    ).select()
    if (errUpsert) {
      console.error('[Avaliação] Erro ao salvar nota:', errUpsert)
    } else {
      console.log('[Avaliação] Nota salva com sucesso:', pct + '%', savedData)
      logAudit('avaliacao_concluida', av.titulo || `Avaliação ID: ${av.id}`, { nota_pct: pct })
    }
    const { html: proxHtml2, next: proxItem2 } = _avProximoBtnHtml(av.id)
    conteudo.innerHTML = `
      <div style="text-align:center;padding:2rem">
        <span class="material-symbols-outlined icon-filled" style="font-size:3rem;color:${pct >= 70 ? 'var(--success)' : 'var(--warning)'}">
          ${pct >= 70 ? 'emoji_events' : 'info'}
        </span>
        <p style="font-size:1.6rem;font-weight:700;margin:0.75rem 0 0.25rem">${pct}%</p>
        <p style="color:var(--text-secondary)">${acertos} de ${questoes.length} ${questoes.length !== 1 ? 'perguntas corretas' : 'pergunta correta'}</p>
        <p style="margin-top:1rem;font-weight:600;color:${pct >= 70 ? 'var(--success)' : 'var(--error)'}">
          ${pct >= 70 ? 'Parabéns! Avaliação concluída com sucesso.' : 'Avaliação concluída. Continue estudando!'}
        </p>
        ${proxHtml2}
      </div>`
    _avAnexarProximo({ next: proxItem2 })
  }

  renderQ()
}
window.openAvaliacao = openAvaliacao

// ============================================
// ADMIN — Fechar modal clicando fora
// ============================================
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      overlay.classList.remove('open')
      if (overlay.id === 'modalFlipbook') closeFlipbookModal()
    }
  })
})

// ============================================
// ADMIN — ARTIGOS
// ============================================
async function loadAdminArtigos() {
  const listEl = document.getElementById('artigosList')
  listEl.innerHTML = '<div class="list-empty"><p>Carregando...</p></div>'

  const { data: artigos, error } = await supabase
    .from('artigos').select('*').order('ordem', { ascending: true })

  const count = artigos?.length || 0
  document.getElementById('artigosCount').textContent = `${count} artigo${count !== 1 ? 's' : ''}`

  if (error || !count) {
    listEl.innerHTML = `<div class="list-empty"><span class="material-symbols-outlined">article</span><p>Nenhum artigo cadastrado ainda.</p></div>`
    return
  }

  listEl.innerHTML = ''
  artigos.forEach((a, i) => listEl.appendChild(renderArtigoAdminCard(a, i, artigos.length)))
}

function renderArtigoAdminCard(a, idx, total) {
  const oculto = a.visivel === false
  const div = document.createElement('div')
  div.className = 'admin-list-item'
  div.style.opacity = oculto ? '0.55' : '1'
  div.innerHTML = `
    <div class="ali-thumb ali-thumb-video" style="${a.imagem_url ? `background:url('${escHtml(a.imagem_url)}') center/contain no-repeat;background-color:var(--surface-dim)` : `background:url('assets/Design_sem_nome_(14).png') center/cover no-repeat`}">
    </div>
    <div class="ali-info">
      <div class="ali-meta">
        <span class="badge badge-tag"><span class="material-symbols-outlined">article</span>Artigo</span>
        ${a.topics ? `<span class="ali-extra">${escHtml(a.topics)}</span>` : ''}
        ${oculto ? '<span class="ali-extra" style="color:#ff6b6b">● Oculto</span>' : ''}
      </div>
      <h4 class="ali-title">${escHtml(a.titulo)}</h4>
      ${a.descricao ? `<p class="ali-desc">${escHtml(a.descricao)}</p>` : ''}
    </div>
    <div class="ali-actions" style="flex-direction:column;gap:0.25rem">
      <div style="display:flex;gap:0.25rem">
        <button class="btn-icon" title="Mover para cima" ${idx === 0 ? 'disabled' : ''} onclick="moveArtigo(${a.id}, -1)">
          <span class="material-symbols-outlined">arrow_upward</span>
        </button>
        <button class="btn-icon" title="Mover para baixo" ${idx === total - 1 ? 'disabled' : ''} onclick="moveArtigo(${a.id}, 1)">
          <span class="material-symbols-outlined">arrow_downward</span>
        </button>
      </div>
      <div style="display:flex;gap:0.25rem">
        <button class="btn-icon" title="Editar" onclick="editArtigo(${a.id})">
          <span class="material-symbols-outlined">edit</span>
        </button>
        <button class="btn-icon btn-danger" title="Excluir" onclick="deleteArtigo(${a.id})">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    </div>`
  return div
}

async function moveArtigo(id, direction) {
  const { data: artigos } = await supabase.from('artigos').select('id, ordem').order('ordem', { ascending: true })
  if (!artigos) return
  const idx  = artigos.findIndex(a => a.id === id)
  const swap = artigos[idx + direction]
  if (!swap) return
  // Fallback posicional quando ordem é null ou duplicada (registros antigos sem ordem)
  let ordemAtual = artigos[idx].ordem ?? idx
  let ordemSwap  = swap.ordem ?? (idx + direction)
  if (ordemAtual === ordemSwap) { ordemAtual = idx; ordemSwap = idx + direction }
  await Promise.all([
    supabase.from('artigos').update({ ordem: ordemSwap }).eq('id', id),
    supabase.from('artigos').update({ ordem: ordemAtual }).eq('id', swap.id)
  ])
  loadAdminArtigos()
}
window.moveArtigo = moveArtigo

async function deleteArtigo(id) {
  if (!confirm('Tem certeza que deseja excluir este artigo?')) return
  await supabase.from('artigos').delete().eq('id', id)
  loadAdminArtigos()
}
window.deleteArtigo = deleteArtigo

async function editArtigo(id) {
  const { data } = await supabase.from('artigos').select('*').eq('id', id).single()
  if (data) openArtigoModal(data)
}
window.editArtigo = editArtigo

let editingArtigoId  = null
let _artigoImagemUrl = null
let _artigoQuestoes  = []

document.getElementById('btnAddArtigo').addEventListener('click', () => openArtigoModal())
document.getElementById('closeModalArtigo').addEventListener('click', closeArtigoModal)
document.getElementById('cancelArtigo').addEventListener('click', closeArtigoModal)

document.getElementById('artigoImagemFile').addEventListener('change', e => {
  const file    = e.target.files[0]
  const preview = document.getElementById('artigoImagemPreview')
  const label   = document.getElementById('artigoImagemLabelText')
  if (file) {
    preview.src           = URL.createObjectURL(file)
    preview.style.display = ''
    if (label) label.textContent = file.name
  } else {
    preview.style.display = 'none'
    if (label) label.textContent = 'Clique para escolher uma imagem'
  }
})

let _artigoEditor = null
let _videosSortable = null

function renderArtigoQList() {
  const listEl = document.getElementById('artigoQList')
  if (!listEl) return
  if (!_artigoQuestoes.length) {
    listEl.innerHTML = '<p style="font-size:0.8rem;color:var(--text-secondary);padding:0.25rem 0">Nenhuma pergunta adicionada.</p>'
    return
  }
  listEl.innerHTML = _artigoQuestoes.map((q, qi) => `
    <div class="artigo-q-card surface-card" style="padding:0.75rem;gap:0.5rem;display:flex;flex-direction:column" data-qi="${qi}">
      <div style="display:flex;align-items:flex-start;gap:0.5rem">
        <span style="font-size:0.7rem;font-weight:700;color:var(--primary);padding-top:0.6rem;flex-shrink:0">Q${qi+1}</span>
        <textarea class="artigo-q-enunciado" rows="2" placeholder="Texto da pergunta..." style="flex:1;resize:vertical;padding:0.4rem 0.5rem;font-size:0.85rem;border:1px solid var(--outline-var);border-radius:var(--r-sm);background:var(--input-bg);color:var(--on-surface)">${escHtml(q.enunciado || '')}</textarea>
        <button type="button" class="btn-icon artigo-q-del" data-qi="${qi}" style="color:var(--error);flex-shrink:0">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
      <div style="display:flex;flex-direction:column;gap:0.3rem;padding-left:1.5rem">
        ${[0,1,2,3].map(oi => `
          <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.8rem;cursor:pointer">
            <input type="radio" name="aq-correct-${qi}" value="${oi}" ${(q.correct_index ?? 0) === oi ? 'checked' : ''} style="cursor:pointer">
            <input type="text" class="artigo-q-opt" data-qi="${qi}" data-oi="${oi}"
              placeholder="Opção ${oi+1}" value="${escHtml(q.options?.[oi] || '')}"
              style="flex:1;padding:0.3rem 0.5rem;font-size:0.8rem;border:1px solid var(--outline-var);border-radius:var(--r-sm);background:var(--input-bg);color:var(--on-surface)">
          </label>`).join('')}
      </div>
    </div>`).join('')

  listEl.querySelectorAll('.artigo-q-del').forEach(btn =>
    btn.addEventListener('click', () => { _artigoQuestoes.splice(+btn.dataset.qi, 1); renderArtigoQList() }))
  listEl.querySelectorAll('.artigo-q-enunciado').forEach(ta =>
    ta.addEventListener('input', () => { _artigoQuestoes[+ta.closest('[data-qi]').dataset.qi].enunciado = ta.value }))
  listEl.querySelectorAll('.artigo-q-opt').forEach(inp =>
    inp.addEventListener('input', () => { _artigoQuestoes[+inp.dataset.qi].options[+inp.dataset.oi] = inp.value }))
  listEl.querySelectorAll('input[type="radio"]').forEach(r =>
    r.addEventListener('change', () => { _artigoQuestoes[+r.name.replace('aq-correct-','')].correct_index = +r.value }))
}

document.getElementById('btnAddArtigoQ')?.addEventListener('click', () => {
  _artigoQuestoes.push({ id: null, enunciado: '', options: ['','','',''], correct_index: 0 })
  renderArtigoQList()
})

async function openArtigoModal(artigo = null) {
  editingArtigoId  = null
  _artigoImagemUrl = null
  _artigoQuestoes  = []
  document.getElementById('formArtigo').reset()
  document.getElementById('artigoError').textContent     = ''
  document.getElementById('artigoImagemPreview').style.display = 'none'
  document.getElementById('modalArtigoTitle').textContent  = artigo ? 'Editar Artigo' : 'Novo Artigo'
  document.getElementById('saveArtigoBtn').textContent     = artigo ? 'Salvar Alterações' : 'Salvar Artigo'
  fillTrilhaDropdown('artigoTopics', 'artigoTopicsNova', artigo?.topics || '')

  if (artigo) {
    editingArtigoId  = artigo.id
    _artigoImagemUrl = artigo.imagem_url || null
    document.getElementById('artigoTitulo').value    = artigo.titulo || ''
    document.getElementById('artigoDescricao').value = artigo.descricao || ''
    document.getElementById('artigoCategoria').value = artigo.categoria || ''
    document.getElementById('artigoVisivel').checked = artigo.visivel !== false
    const labelText = document.getElementById('artigoImagemLabelText')
    if (artigo.imagem_url) {
      const preview = document.getElementById('artigoImagemPreview')
      preview.src           = artigo.imagem_url
      preview.style.display = ''
      if (labelText) labelText.textContent = 'Imagem atual (clique para trocar)'
    } else {
      if (labelText) labelText.textContent = 'Clique para escolher uma imagem'
    }
    // Carrega perguntas existentes
    const { data: qs } = await supabase.from('questoes_sala_de_aula')
      .select('*').eq('artigo_id', artigo.id).order('created_at', { ascending: true })
    _artigoQuestoes = (qs || []).map(q => ({
      id: q.id,
      enunciado: q.question,
      options: [q.option_a || '', q.option_b || '', q.option_c || '', q.option_d || ''],
      correct_index: q.correct_index ?? 0
    }))
  }
  renderArtigoQList()

  // Destrói editor anterior se existir
  if (_artigoEditor) { try { await _artigoEditor.destroy() } catch (_) {} _artigoEditor = null }

  const initialData = artigo?.conteudo_blocos || {
    blocks: artigo?.conteudo
      ? [{ type: 'paragraph', data: { text: artigo.conteudo } }]
      : []
  }

  // Abre o modal antes de inicializar o editor — EditorJS precisa do container visível
  document.getElementById('modalArtigo').classList.add('open')
  await new Promise(r => requestAnimationFrame(r))

  _artigoEditor = new EditorJS({
    holder: 'artigoEditor',
    placeholder: 'Escreva o conteúdo aqui... Selecione texto para formatar.',
    data: initialData,
    tools: {
      header:     { class: window.Header,     inlineToolbar: true, config: { levels: [2, 3, 4], defaultLevel: 2 } },
      list:       { class: window.List || window.EditorjsList, inlineToolbar: true },
      image: {
        class: window.ImageTool,
        config: {
          uploader: {
            async uploadByFile(file) {
              const ext  = file.name.split('.').pop()
              const path = `artigos/${Date.now()}.${ext}`
              const { error } = await supabase.storage.from('imagens').upload(path, file, { upsert: true })
              if (error) return { success: 0 }
              const { data } = supabase.storage.from('imagens').getPublicUrl(path)
              return { success: 1, file: { url: data.publicUrl } }
            }
          }
        }
      },
      delimiter:  { class: window.Delimiter },
      Marker:     { class: window.Marker },
      underline:  { class: window.Underline },
      inlineCode: { class: window.InlineCode },
    },
  })
}

async function closeArtigoModal() {
  document.getElementById('modalArtigo').classList.remove('open')
  if (_artigoEditor) { try { await _artigoEditor.destroy() } catch (_) {} _artigoEditor = null }
}

document.getElementById('formArtigo').addEventListener('submit', async e => {
  e.preventDefault()
  const btn       = e.target.querySelector('[type="submit"]')
  const errorEl   = document.getElementById('artigoError')
  const titulo    = document.getElementById('artigoTitulo').value.trim()
  const descricao = document.getElementById('artigoDescricao').value.trim()
  const topics    = getTrilhaValue('artigoTopics', 'artigoTopicsNova')
  const categoria = document.getElementById('artigoCategoria').value.trim()
  const visivel   = document.getElementById('artigoVisivel').checked
  const fileInput = document.getElementById('artigoImagemFile')
  const file      = fileInput.files[0]

  // Salva blocos do Editor.js
  let conteudoBlocos = null
  let conteudo = ''
  if (_artigoEditor) {
    try {
      const saved = await _artigoEditor.save()
      conteudoBlocos = saved
      conteudo = saved.blocks.map(b => b.data?.text || b.data?.caption || '').filter(Boolean).join('\n')
    } catch (_) {}
  }

  if (!titulo) { errorEl.textContent = 'Preencha o título.'; return }
  const idxSemCorreta = _artigoQuestoes.findIndex(q =>
    q.enunciado?.trim() && q.options?.filter(o => o?.trim()).length >= 2 && !q.options[q.correct_index ?? 0]?.trim())
  if (idxSemCorreta !== -1) { errorEl.textContent = `Pergunta ${idxSemCorreta + 1}: a alternativa marcada como correta está vazia.`; return }

  setLoading(btn, true, 'Salvando...')
  errorEl.textContent = ''

  let imagemUrl = _artigoImagemUrl
  if (file) {
    const ext  = file.name.split('.').pop()
    const path = `artigos/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('imagens').upload(path, file, { upsert: true })
    if (upErr) {
      errorEl.textContent = 'Erro ao enviar imagem: ' + upErr.message
      setLoading(btn, false, editingArtigoId ? 'Salvar Alterações' : 'Salvar Artigo')
      return
    }
    const { data: urlData } = supabase.storage.from('imagens').getPublicUrl(path)
    imagemUrl = urlData.publicUrl
  }

  const payload = { titulo, descricao: descricao || null, topics: topics || null, categoria: categoria || null, imagem_url: imagemUrl || null, conteudo, conteudo_blocos: conteudoBlocos, visivel }

  let savedId = editingArtigoId
  if (editingArtigoId) {
    const { error } = await supabase.from('artigos').update(payload).eq('id', editingArtigoId)
    if (error) { errorEl.textContent = 'Erro: ' + error.message; setLoading(btn, false, 'Salvar Alterações'); return }
  } else {
    const { data: inserted, error } = await supabase.from('artigos').insert(payload).select('id').single()
    if (error) { errorEl.textContent = 'Erro: ' + error.message; setLoading(btn, false, 'Salvar Artigo'); return }
    savedId = inserted.id
  }

  // Salva perguntas
  await supabase.from('questoes_sala_de_aula').delete().eq('artigo_id', savedId)
  const pergsValidas = _artigoQuestoes.filter(q => q.enunciado?.trim() && q.options?.filter(o => o?.trim()).length >= 2)
  if (pergsValidas.length) {
    await supabase.from('questoes_sala_de_aula').insert(
      pergsValidas.map((q, i) => ({
        artigo_id: savedId, video_id: null,
        question: q.enunciado,
        option_a: q.options[0] || '', option_b: q.options[1] || '',
        option_c: q.options[2] || '', option_d: q.options[3] || '',
        correct_index: q.correct_index ?? 0, ordem: i + 1
      }))
    )
  }

  setLoading(btn, false, editingArtigoId ? 'Salvar Alterações' : 'Salvar Artigo')
  closeArtigoModal()
  loadAdminArtigos()
})

// ============================================
// ADMIN — VÍDEOS
// ============================================
async function loadVideos() {
  const listEl = document.getElementById('videosList')
  listEl.innerHTML = '<div class="list-empty" style="grid-column:1/-1"><p>Carregando...</p></div>'

  const { data: videos, error } = await supabase
    .from('videos')
    .select('*')
    .order('ordem', { ascending: true })

  const count = videos?.length || 0
  document.getElementById('videosCount').textContent =
    `${count} vídeo${count !== 1 ? 's' : ''}`

  if (error || !count) {
    listEl.innerHTML = `
      <div class="list-empty">
        <span class="material-symbols-outlined">play_circle</span>
        <p>Nenhum vídeo cadastrado ainda.</p>
      </div>`
    return
  }

  listEl.innerHTML = ''
  videos.forEach(v => listEl.appendChild(renderVideoCard(v)))
  populateVideoSelect(videos)

  if (window.Sortable) {
    if (_videosSortable) { _videosSortable.destroy(); _videosSortable = null }
    _videosSortable = Sortable.create(listEl, {
      handle: '.drag-handle',
      animation: 150,
      onEnd: async ({ oldIndex, newIndex }) => {
        if (oldIndex === newIndex) return
        const items = [...listEl.querySelectorAll('[data-id]')]
        await Promise.all(
          items.map((el, i) => supabase.from('videos').update({ ordem: i }).eq('id', el.dataset.id))
        )
      }
    })
  }
}

function renderVideoCard(v) {
  const vid      = ytVideoId(v.youtube_url)
  const thumbUrl = vid ? `https://img.youtube.com/vi/${vid}/mqdefault.jpg` : null
  const oculto   = v.visivel === false

  const div = document.createElement('div')
  div.className = 'admin-list-item'
  div.dataset.id = v.id
  div.style.opacity = oculto ? '0.55' : '1'
  div.innerHTML = `
    <span class="drag-handle material-symbols-outlined" title="Arrastar para reordenar">drag_indicator</span>
    <div class="ali-thumb ${thumbUrl ? '' : 'ali-thumb-video'}">
      ${thumbUrl
        ? `<img src="${thumbUrl}" alt="${escHtml(v.title)}" loading="lazy">
           <div class="ali-play-overlay"><span class="material-symbols-outlined icon-filled">play_circle</span></div>`
        : `<span class="material-symbols-outlined">play_circle</span>`}
    </div>
    <div class="ali-info">
      <div class="ali-meta">
        <span class="badge badge-tag"><span class="material-symbols-outlined">videocam</span>Vídeo</span>
        ${v.topics ? `<span class="ali-extra">${escHtml(v.topics)}</span>` : ''}
        ${oculto ? '<span class="ali-extra" style="color:#ff6b6b">● Oculto</span>' : ''}
      </div>
      <h4 class="ali-title">${escHtml(v.title)}</h4>
      ${v.description ? `<p class="ali-desc">${escHtml(v.description)}</p>` : ''}
    </div>
    <div class="ali-actions">
      <button class="btn-icon" title="Editar" onclick="editVideo('${v.id}')">
        <span class="material-symbols-outlined">edit</span>
      </button>
      <button class="btn-icon btn-danger" title="Excluir" onclick="deleteVideo('${v.id}')">
        <span class="material-symbols-outlined">delete</span>
      </button>
    </div>`
  return div
}


function populateVideoSelect(videos) {
  const sel = document.getElementById('qVideoId')
  if (!sel) return
  const current = sel.value
  sel.innerHTML = '<option value="">Nenhum</option>'
  videos.forEach(v => {
    const opt = document.createElement('option')
    opt.value = v.id
    opt.textContent = v.title
    sel.appendChild(opt)
  })
  if (current) sel.value = current
}

async function deleteVideo(id) {
  if (!confirm('Tem certeza que deseja excluir este vídeo?')) return
  await supabase.from('videos').delete().eq('id', id)
  loadVideos()
}
window.deleteVideo = deleteVideo

async function editVideo(id) {
  const { data } = await supabase.from('videos').select('*').eq('id', id).single()
  if (data) openVideoModal(data)
}
window.editVideo = editVideo

// Modal Vídeo
let editingVideoId = null

document.getElementById('btnAddVideo').addEventListener('click', () => openVideoModal())
document.getElementById('closeModalVideo').addEventListener('click', closeVideoModal)
document.getElementById('cancelVideo').addEventListener('click', closeVideoModal)

function openVideoModal(video = null) {
  editingVideoId = null
  document.getElementById('formVideo').reset()
  document.getElementById('ytPreview').className = 'yt-preview'
  document.getElementById('ytPreview').innerHTML = ''
  document.getElementById('videoError').textContent = ''
  document.getElementById('saveVideoBtn') && (document.getElementById('saveVideoBtn').textContent = video ? 'Salvar Alterações' : 'Salvar Vídeo')

  fillTrilhaDropdown('videoTopics', 'videoTopicsNova', video?.topics || '')

  if (video) {
    editingVideoId = video.id
    document.getElementById('videoTitle').value      = video.title || ''
    document.getElementById('videoDesc').value       = video.description || ''
    document.getElementById('videoUrl').value        = video.youtube_url || ''
    document.getElementById('videoDuracaoMin').value = video.duracao_seg ? Math.floor(video.duracao_seg / 60) : ''
    document.getElementById('videoDuracaoSeg').value = video.duracao_seg ? video.duracao_seg % 60 : ''
    document.getElementById('videoTextoAula').value  = video.texto_aula || ''
    document.getElementById('videoCategoria').value  = video.categoria || ''
    document.getElementById('videoVisivel').checked  = video.visivel !== false

    const embedUrl = ytEmbedUrl(video.youtube_url)
    if (embedUrl) {
      const preview = document.getElementById('ytPreview')
      preview.className = 'yt-preview show'
      preview.innerHTML = `<iframe src="${embedUrl}" allowfullscreen></iframe>`
    }
  }

  document.getElementById('modalVideo').classList.add('open')
}
function closeVideoModal() {
  document.getElementById('modalVideo').classList.remove('open')
}

document.getElementById('videoUrl').addEventListener('input', e => {
  const embedUrl = ytEmbedUrl(e.target.value)
  const preview  = document.getElementById('ytPreview')
  if (embedUrl) {
    preview.className = 'yt-preview show'
    preview.innerHTML = `<iframe src="${embedUrl}" allowfullscreen></iframe>`
  } else {
    preview.className = 'yt-preview'
    preview.innerHTML = ''
  }
})

document.getElementById('formVideo').addEventListener('submit', async e => {
  e.preventDefault()
  const btn      = e.target.querySelector('[type="submit"]')
  const errorEl  = document.getElementById('videoError')
  const title      = document.getElementById('videoTitle').value.trim()
  const desc       = document.getElementById('videoDesc').value.trim()
  const url        = document.getElementById('videoUrl').value.trim()
  const duracaoMin = parseInt(document.getElementById('videoDuracaoMin').value) || 0
  const duracaoSeg = parseInt(document.getElementById('videoDuracaoSeg').value) || 0
  const duracao    = (duracaoMin * 60 + duracaoSeg) || null
  const topics     = getTrilhaValue('videoTopics', 'videoTopicsNova')
  const categoria  = document.getElementById('videoCategoria').value.trim()
  const textoAula  = document.getElementById('videoTextoAula').value.trim()
  const visivel    = document.getElementById('videoVisivel').checked

  if (!title || !url) {
    errorEl.textContent = 'Preencha o título e o link do YouTube.'
    return
  }

  setLoading(btn, true, 'Salvando...')
  errorEl.textContent = ''

  const payload = { title, description: desc || null, youtube_url: url, duracao_seg: duracao, topics: topics || null, categoria: categoria || null, texto_aula: textoAula || null, visivel }

  let result
  try {
    result = await Promise.race([
      editingVideoId
        ? supabase.from('videos').update(payload).eq('id', editingVideoId)
        : supabase.from('videos').insert(payload),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout: Supabase não respondeu em 8s. Verifique se o projeto está ativo.')), 8000))
    ])
  } catch (e) {
    errorEl.textContent = e.message
    setLoading(btn, false, 'Salvar Vídeo')
    return
  }

  setLoading(btn, false, 'Salvar Vídeo')

  if (result.error) {
    errorEl.textContent = result.error.message?.includes('does not exist')
      ? 'A tabela de vídeos ainda não foi criada no banco de dados.'
      : 'Erro: ' + result.error.message
  } else {
    closeVideoModal()
    loadVideos()
  }
})

// ============================================
// ADMIN — PERGUNTAS
// ============================================
let _allQuestions = []
let _questionsVideoMap = {}
let _questionsModuloMap = {}
let _questionsVideoOrder = []

async function loadQuestions() {
  const listEl = document.getElementById('questionsList')
  listEl.innerHTML = '<div class="list-empty"><p>Carregando...</p></div>'

  const [{ data: questions, error }, { data: videos }] = await Promise.all([
    supabase.from('questoes_sala_de_aula').select('*').order('created_at', { ascending: false }),
    supabase.from('videos').select('id, title, categoria').order('ordem', { ascending: true })
  ])

  if (error) {
    listEl.innerHTML = `
      <div class="list-empty">
        <span class="material-symbols-outlined">error</span>
        <p style="color:var(--error)">Erro ao carregar perguntas: ${escHtml(error.message)}</p>
      </div>`
    document.getElementById('questionsCount').textContent = '0 perguntas'
    return
  }

  _allQuestions = questions || []
  _questionsVideoMap = {}
  _questionsModuloMap = {}
  _questionsVideoOrder = (videos || []).map(v => String(v.id))
  videos?.forEach(v => {
    _questionsVideoMap[v.id] = v.title
    _questionsModuloMap[v.id] = v.categoria || ''
  })

  // Popula filtro de módulo
  const moduloEl = document.getElementById('filterQuizModulo')
  const currentModulo = moduloEl.value
  const modulos = [...new Set(videos?.map(v => v.categoria).filter(Boolean) || [])]
  moduloEl.innerHTML = '<option value="">Todos os módulos</option>'
  modulos.forEach(m => {
    const opt = document.createElement('option')
    opt.value = m
    opt.textContent = m
    if (m === currentModulo) opt.selected = true
    moduloEl.appendChild(opt)
  })

  // Popula filtro de trilha
  const filterEl = document.getElementById('filterQuizVideo')
  const currentFilter = filterEl.value
  filterEl.innerHTML = '<option value="">Todas as trilhas</option>'
  videos?.forEach(v => {
    const opt = document.createElement('option')
    opt.value = v.id
    opt.textContent = v.title
    if (String(v.id) === currentFilter) opt.selected = true
    filterEl.appendChild(opt)
  })

  renderQuestionsList()
}

function renderQuestionsList() {
  const listEl = document.getElementById('questionsList')
  const videoId = document.getElementById('filterQuizVideo').value
  const modulo  = document.getElementById('filterQuizModulo').value

  let filtered = _allQuestions
  if (modulo)  filtered = filtered.filter(q => _questionsModuloMap[q.video_id] === modulo)
  if (videoId) filtered = filtered.filter(q => String(q.video_id) === String(videoId))

  const count = filtered.length
  document.getElementById('questionsCount').textContent =
    `${count} pergunta${count !== 1 ? 's' : ''}`

  if (!count) {
    listEl.innerHTML = `
      <div class="list-empty">
        <span class="material-symbols-outlined">quiz</span>
        <p>${videoId || modulo ? 'Nenhuma pergunta neste filtro.' : 'Nenhuma pergunta cadastrada ainda.'}</p>
      </div>`
    return
  }

  listEl.innerHTML = ''

  // Agrupa as perguntas por trilha (na ordem das trilhas), como accordions
  const grupos = {}
  for (const q of filtered) {
    const k = String(q.video_id || 'sem-trilha')
    if (!grupos[k]) grupos[k] = []
    grupos[k].push(q)
  }
  const ordem = [..._questionsVideoOrder.filter(id => grupos[id]), ...Object.keys(grupos).filter(k => !_questionsVideoOrder.includes(k))]

  ordem.forEach(vid => {
    const qs = grupos[vid]
    const titulo = _questionsVideoMap[vid] || 'Sem trilha'
    const modulo = _questionsModuloMap[vid] || ''

    const wrap = document.createElement('div')
    wrap.className = 'qgroup'
    wrap.innerHTML = `
      <button class="qgroup-header" type="button">
        <span class="material-symbols-outlined icon-filled" style="color:var(--primary);font-size:1.2rem;flex-shrink:0">play_circle</span>
        <span class="qgroup-title">${escHtml(titulo)}${modulo ? ` <span class="qgroup-mod">· ${escHtml(modulo)}</span>` : ''}</span>
        <span class="qgroup-count">${qs.length} pergunta${qs.length !== 1 ? 's' : ''}</span>
        <span class="material-symbols-outlined qgroup-chevron">expand_more</span>
      </button>
      <div class="qgroup-body" style="display:none"></div>`

    const body = wrap.querySelector('.qgroup-body')
    qs.forEach(q => body.appendChild(renderQuestionCard(q, _questionsVideoMap, _questionsModuloMap)))

    wrap.querySelector('.qgroup-header').addEventListener('click', () => {
      const aberto = body.style.display !== 'none'
      body.style.display = aberto ? 'none' : ''
      wrap.querySelector('.qgroup-chevron').textContent = aberto ? 'expand_more' : 'expand_less'
      wrap.classList.toggle('qgroup-open', !aberto)
    })

    listEl.appendChild(wrap)
  })
}

function renderQuestionCard(q, videoMap = {}, moduloMap = {}) {
  const opts = [
    { l: 'A', t: q.option_a },
    { l: 'B', t: q.option_b },
    { l: 'C', t: q.option_c },
    { l: 'D', t: q.option_d },
  ]

  const div = document.createElement('div')
  div.className = 'admin-list-item ali-collapsible'
  div.innerHTML = `
    <div class="ali-thumb ali-thumb-quiz">
      <span class="material-symbols-outlined">quiz</span>
    </div>
    <div class="ali-info">
      <div class="ali-meta">
        <span class="badge badge-progress">Pergunta</span>
        ${moduloMap[q.video_id] ? `<span class="badge badge-neutral"><span class="material-symbols-outlined" style="font-size:0.8rem">folder</span>${escHtml(moduloMap[q.video_id])}</span>` : ''}
        ${videoMap[q.video_id] ? `<span class="badge badge-tag"><span class="material-symbols-outlined">play_circle</span>${escHtml(videoMap[q.video_id])}</span>` : ''}
      </div>
      <h4 class="ali-title">${escHtml(q.question)}</h4>
      <div class="ali-body" style="display:none">
        <div class="ali-opts-row">
          ${opts.map((o, i) => `
            <span class="ali-opt-chip ${q.correct_index === i ? 'ali-opt-correct' : ''}">
              <span class="opt-letter">${o.l}</span>
              <span>${escHtml(o.t)}</span>
              ${q.correct_index === i
                ? '<span class="material-symbols-outlined icon-filled" style="color:var(--secondary);font-size:0.875rem;margin-left:auto;flex-shrink:0">check_circle</span>'
                : ''}
            </span>`).join('')}
        </div>
        ${q.justification
          ? `<p class="ali-justif"><span class="material-symbols-outlined" style="font-size:0.875rem;flex-shrink:0">lightbulb</span>${escHtml(q.justification)}</p>`
          : ''}
      </div>
    </div>
    <div class="ali-actions">
      <button class="btn-icon" title="Editar" onclick="editQuestion(${q.id})">
        <span class="material-symbols-outlined">edit</span>
      </button>
      <button class="btn-icon btn-danger" title="Excluir" onclick="deleteQuestion(${q.id})">
        <span class="material-symbols-outlined">delete</span>
      </button>
      <button class="btn-icon ali-expand-btn" title="Ver alternativas">
        <span class="material-symbols-outlined">expand_more</span>
      </button>
    </div>`

  // Clique no cartão (ou na setinha) expande/recolhe as alternativas;
  // editar e excluir continuam funcionando sem expandir
  div.addEventListener('click', e => {
    if (e.target.closest('.btn-icon') && !e.target.closest('.ali-expand-btn')) return
    const body = div.querySelector('.ali-body')
    const icon = div.querySelector('.ali-expand-btn .material-symbols-outlined')
    const aberto = body.style.display !== 'none'
    body.style.display = aberto ? 'none' : ''
    if (icon) icon.textContent = aberto ? 'expand_more' : 'expand_less'
    div.classList.toggle('ali-open', !aberto)
  })
  return div
}

async function deleteQuestion(id) {
  if (!confirm('Tem certeza que deseja excluir esta pergunta?')) return
  await supabase.from('questoes_sala_de_aula').delete().eq('id', id)
  loadQuestions()
}
window.deleteQuestion = deleteQuestion

// Modal Pergunta
let selectedAnswer = ''
let editingQuestionId = null

document.getElementById('btnAddQuiz').addEventListener('click', () => openQuizModal())
document.getElementById('filterQuizVideo')?.addEventListener('change', renderQuestionsList)
document.getElementById('filterQuizModulo')?.addEventListener('change', () => {
  document.getElementById('filterQuizVideo').value = ''
  renderQuestionsList()
})
document.getElementById('closeModalQuiz').addEventListener('click', closeQuizModal)
document.getElementById('cancelQuiz').addEventListener('click', closeQuizModal)

document.querySelectorAll('.correct-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.correct-btn').forEach(b => b.classList.remove('selected'))
    btn.classList.add('selected')
    selectedAnswer = btn.dataset.answer
    document.getElementById('qCorrect').value = selectedAnswer
  })
})

async function openQuizModal(question = null) {
  document.getElementById('formQuiz').reset()
  document.getElementById('quizError').textContent = ''
  document.getElementById('saveQuizBtn').textContent = question ? 'Salvar Alterações' : 'Salvar Pergunta'
  selectedAnswer = ''
  editingQuestionId = null
  document.querySelectorAll('.correct-btn').forEach(b => b.classList.remove('selected'))
  document.getElementById('qCorrect').value = ''

  const { data: videos } = await supabase.from('videos').select('id, title')
  if (videos) populateVideoSelect(videos)

  if (question) {
    editingQuestionId = question.id
    document.getElementById('qPergunta').value      = question.question || ''
    document.getElementById('qOptA').value          = question.option_a || ''
    document.getElementById('qOptB').value          = question.option_b || ''
    document.getElementById('qOptC').value          = question.option_c || ''
    document.getElementById('qOptD').value          = question.option_d || ''
    document.getElementById('qCategoria').value     = question.category || ''
    document.getElementById('qJustificativa').value = question.justification || ''
    document.getElementById('qVideoId').value       = question.video_id || ''

    const letters = ['A', 'B', 'C', 'D']
    selectedAnswer = letters[question.correct_index] || ''
    document.getElementById('qCorrect').value = selectedAnswer
    document.querySelectorAll('.correct-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.answer === selectedAnswer)
    })
  }

  document.getElementById('modalQuiz').classList.add('open')
}

async function editQuestion(id) {
  const { data } = await supabase.from('questoes_sala_de_aula').select('*').eq('id', id).single()
  if (data) openQuizModal(data)
}
window.editQuestion = editQuestion
function closeQuizModal() {
  document.getElementById('modalQuiz').classList.remove('open')
}

document.getElementById('formQuiz').addEventListener('submit', async e => {
  e.preventDefault()
  const btn       = e.target.querySelector('[type="submit"]')
  const errorEl   = document.getElementById('quizError')
  const pergunta  = document.getElementById('qPergunta').value.trim()
  const optA      = document.getElementById('qOptA').value.trim()
  const optB      = document.getElementById('qOptB').value.trim()
  const optC      = document.getElementById('qOptC').value.trim()
  const optD      = document.getElementById('qOptD').value.trim()
  const correct   = selectedAnswer
  const categoria = document.getElementById('qCategoria').value.trim()
  const videoId   = document.getElementById('qVideoId').value || null
  const justif    = document.getElementById('qJustificativa').value.trim()

  if (!pergunta || !optA || !optB || !optC || !optD || !correct) {
    errorEl.textContent = 'Preencha todos os campos e selecione a resposta correta.'
    return
  }

  setLoading(btn, true, 'Salvando...')
  errorEl.textContent = ''

  const answerMap = { A: 0, B: 1, C: 2, D: 3 }
  const payload = {
    question: pergunta,
    option_a: optA, option_b: optB, option_c: optC, option_d: optD,
    correct_index: answerMap[correct],
    category: categoria || null,
    video_id: videoId ? parseInt(videoId) : null,
    justification: justif || null
  }

  const { error } = editingQuestionId
    ? await supabase.from('questoes_sala_de_aula').update(payload).eq('id', editingQuestionId)
    : await supabase.from('questoes_sala_de_aula').insert(payload)

  setLoading(btn, false, 'Salvar Pergunta')

  if (error) {
    errorEl.textContent = error.message?.includes('does not exist')
      ? 'A tabela de perguntas ainda não foi criada no banco de dados.'
      : 'Erro: ' + error.message
  } else {
    closeQuizModal()
    loadQuestions()
  }
})

// ============================================
// ADMIN — RELATÓRIOS
// ============================================
async function loadReports() {
  const grid = document.getElementById('reportsGrid')
  grid.innerHTML = '<div class="list-empty" style="grid-column:1/-1"><p>Carregando...</p></div>'

  const [
    { count: cTrilhas },
    { count: cVideos },
    { count: cQuestions },
    { count: cUsers },
    { data: porUsuarioTrilha },
    { data: porSetorTrilha },
    { data: trilhas },
    { data: principais_duvidas },
    { data: avaliacoesDb },
    { data: notasAvaliacao },
    { data: questoesAvRows }
  ] = await Promise.all([
    supabase.from('trilhas').select('*', { count: 'exact', head: true }),
    supabase.from('videos').select('*', { count: 'exact', head: true }),
    supabase.from('questoes_sala_de_aula').select('*', { count: 'exact', head: true }),
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('v_desempenho_usuario_trilha').select('*'),
    supabase.from('v_desempenho_setor_trilha').select('*'),
    supabase.from('videos').select('id, title, topics').order('ordem', { ascending: true }),
    supabase.from('v_principais_duvidas').select('*').order('pct_erro', { ascending: false }).limit(30),
    supabase.from('avaliacoes').select('id, titulo, topics').eq('visivel', true).order('ordem', { ascending: true }),
    supabase.from('v_desempenho_usuario_avaliacao').select('user_id, avaliacao_id, nota_pct'),
    supabase.from('questoes_avaliacao').select('avaliacao_id')
  ])

  // Perguntas = questões dos quizzes (sala de aula) + questões das avaliações
  const cQuestoesTotal = (cQuestions || 0) + (questoesAvRows || []).length

  const thS = 'text-align:left;padding:0.5rem 0.75rem;border-bottom:2px solid var(--border);color:var(--text-secondary);font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap'
  const tdS = 'padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);font-size:0.8rem;color:var(--text-primary)'
  const thC = 'text-align:center;padding:0.5rem 0.5rem;border-bottom:2px solid var(--border);color:var(--text-secondary);font-size:0.65rem;font-weight:600;text-transform:uppercase;max-width:90px;word-break:break-word;line-height:1.3'
  const tdC = 'text-align:center;padding:0.5rem 0.5rem;border-bottom:1px solid var(--border);font-size:0.78rem'

  const notaBadge = pct => {
    if (pct === null || pct === undefined) return `<span style="color:var(--text-secondary);font-size:0.75rem">—</span>`
    const n = Number(pct)
    const [bg, color] = n >= 70 ? ['#e8f5e9','#2e7d32'] : n >= 50 ? ['#fff8e1','#f57f17'] : ['#ffebee','#c62828']
    return `<span style="padding:0.15rem 0.45rem;border-radius:999px;font-size:0.75rem;font-weight:700;background:${bg};color:${color}">${n}%</span>`
  }

  const barra = pct => {
    const n = Number(pct) || 0
    const fill = n >= 70 ? '#43a047' : n >= 50 ? '#fbc02d' : '#e53935'
    return `<div class="resp-bar" style="display:flex;align-items:center;gap:0.4rem;min-width:120px">
      <div style="flex:1;height:5px;border-radius:3px;background:var(--border);overflow:hidden">
        <div style="height:100%;width:${n}%;background:${fill};border-radius:3px"></div>
      </div>
      ${notaBadge(n)}
    </div>`
  }

  let _accId = 0
  const tabelaCard = (icon, titulo, conteudo) => {
    const id = `acc-rpt-${_accId++}`
    return `
    <div style="grid-column:1/-1;background:var(--card-bg);border-radius:var(--radius);border:1px solid var(--border);box-shadow:var(--shadow-sm)">
      <button onclick="(function(btn){const b=document.getElementById('${id}');const open=b.style.display!=='none';b.style.display=open?'none':'block';btn.querySelector('.rpt-chevron').textContent=open?'expand_more':'expand_less';})(this)"
        style="width:100%;display:flex;align-items:center;gap:0.5rem;padding:0.875rem 1rem;background:var(--surface);border:none;cursor:pointer;text-align:left;border-radius:var(--radius)">
        <span class="material-symbols-outlined" style="color:var(--primary);font-size:1.1rem;flex-shrink:0">${icon}</span>
        <span style="font-size:0.82rem;font-weight:600;color:var(--text-primary);flex:1;line-height:1.3">${titulo}</span>
        <span class="material-symbols-outlined rpt-chevron" style="color:var(--text-secondary);font-size:1.1rem;flex-shrink:0">expand_more</span>
      </button>
      <div id="${id}" style="display:none">
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:thin;scrollbar-color:var(--primary) var(--border)">
          ${conteudo}
        </div>
      </div>
    </div>`
  }

  const semDados = cols => `<table class="resp-table" style="width:100%;border-collapse:collapse">
    <tbody><tr><td colspan="${cols}" style="${tdS};text-align:center;padding:2rem">
      <span style="color:var(--text-secondary);font-size:0.875rem">Sem dados ainda — aguardando respostas dos alunos</span>
    </td></tr></tbody></table>`

  // ── RANKING INDIVIDUAL POR TRILHA (tabela pivô) ──
  // Só mostra colunas de vídeos onde ao menos um usuário respondeu questões
  const _videoIdsComDados = new Set(
    (porUsuarioTrilha || []).filter(r => Number(r.total_respondidas) > 0).map(r => String(r.video_id))
  )
  const trilhaList = _videoIdsComDados.size > 0
    ? (trilhas || []).filter(t => _videoIdsComDados.has(String(t.id)))
    : (trilhas || [])
  const userMap = {}
  for (const row of (porUsuarioTrilha || [])) {
    if (!userMap[row.user_id]) {
      userMap[row.user_id] = { name: row.name, email: row.email, sector: row.sector, role: row.role, trilhas: {} }
    }
    userMap[row.user_id].trilhas[row.video_id] = { nota: row.nota_pct, respondidas: Number(row.total_respondidas), acertos: Number(row.acertos) || 0 }
  }

  const usersArr = Object.values(userMap)
  usersArr.sort((a, b) => {
    const avgFn = u => {
      const notas = trilhaList.map(t => u.trilhas[t.id]?.nota).filter(n => n !== null && n !== undefined)
      return notas.length ? notas.reduce((s, n) => s + Number(n), 0) / notas.length : -1
    }
    return avgFn(b) - avgFn(a)
  })

  const medals = ['🥇','🥈','🥉']
  const rankHeaders = trilhaList.map(t => `<th style="${thC}" title="${escHtml(t.title)}">${escHtml(t.title.substring(0, 22))}</th>`).join('')
  const rankRows = usersArr.length ? usersArr.map((u, i) => {
    const rank = i < 3 ? `<span style="font-size:1rem">${medals[i]}</span>`
      : `<span style="display:inline-flex;align-items:center;justify-content:center;width:1.4rem;height:1.4rem;border-radius:50%;background:var(--border);font-size:0.72rem;font-weight:700;color:var(--text-secondary)">${i+1}</span>`

    const trilhaCols = trilhaList.map(t => {
      const d = u.trilhas[t.id]
      if (!d) return `<td style="${tdC}">—</td>`
      if (d.nota !== null && d.nota !== undefined) return `<td style="${tdC}">${notaBadge(d.nota)}</td>`
      if (d.respondidas > 0) {
        const parcial = Math.round((d.acertos / d.respondidas) * 100)
        return `<td style="${tdC}">${notaBadge(parcial)}<div style="font-size:0.62rem;color:#f57f17;margin-top:0.2rem">em andamento · ${d.acertos} de ${d.respondidas}</div></td>`
      }
      return `<td style="${tdC}"><span style="font-size:0.7rem;color:var(--text-secondary)">Não iniciado</span></td>`
    }).join('')

    const notas = trilhaList.map(t => u.trilhas[t.id]?.nota).filter(n => n !== null && n !== undefined)
    const media = notas.length ? Math.round(notas.reduce((s, n) => s + Number(n), 0) / notas.length) : null

    return `<tr style="transition:background 0.15s" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background=''">
      <td style="${tdS};width:2rem;text-align:center">${rank}</td>
      <td style="${tdS}">
        <span style="font-weight:500">${escHtml(u.name || u.email || '—')}</span>
        <div style="font-size:0.7rem;color:var(--text-secondary)">${escHtml(u.sector || '')} ${u.role ? '· ' + escHtml(u.role) : ''}</div>
      </td>
      ${trilhaCols}
      <td style="${tdC};font-weight:700">${notaBadge(media)}</td>
    </tr>`
  }).join('') : null

  const rankTable = `<table class="resp-table" style="width:100%;border-collapse:collapse">
    <thead style="background:var(--surface)"><tr>
      <th style="${thS}">#</th>
      <th style="${thS}">Nome</th>
      ${rankHeaders}
      <th style="${thC}">Média Geral</th>
    </tr></thead>
    <tbody>${rankRows || `<tr><td colspan="${3 + trilhaList.length}" style="${tdS};text-align:center;padding:2rem"><span style="color:var(--text-secondary)">Sem dados ainda</span></td></tr>`}</tbody>
  </table>`

  // ── DESEMPENHO POR SETOR POR TRILHA ──
  const setorMap = {}
  for (const row of (porSetorTrilha || [])) {
    const s = row.sector || 'Não informado'
    if (!setorMap[s]) setorMap[s] = { usuarios: row.total_usuarios, trilhas: {} }
    setorMap[s].trilhas[row.video_id] = row.media_pct
  }

  const setorHeaders = trilhaList.map(t => `<th style="${thC}" title="${escHtml(t.title)}">${escHtml(t.title.substring(0, 22))}</th>`).join('')
  const setorRows = Object.entries(setorMap).map(([setor, d]) => {
    const cols = trilhaList.map(t => {
      const pct = d.trilhas[t.id]
      return `<td style="${tdC}">${pct !== null && pct !== undefined ? barra(pct) : '<span style="color:var(--text-secondary);font-size:0.75rem">—</span>'}</td>`
    }).join('')
    const notas = trilhaList.map(t => d.trilhas[t.id]).filter(n => n !== null && n !== undefined)
    const media = notas.length ? Math.round(notas.reduce((s, n) => s + Number(n), 0) / notas.length) : null
    return `<tr onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background=''">
      <td style="${tdS}"><span style="font-weight:500">${escHtml(setor || '—')}</span></td>
      ${cols}
      <td style="${tdC};font-weight:700">${notaBadge(media)}</td>
    </tr>`
  }).join('')

  const setorTable = setorRows ? `<table class="resp-table" style="width:100%;border-collapse:collapse">
    <thead style="background:var(--surface)"><tr>
      <th style="${thS}">Setor</th>
      ${setorHeaders}
      <th style="${thC}">Média Geral</th>
    </tr></thead>
    <tbody>${setorRows}</tbody>
  </table>` : semDados(2 + trilhaList.length)

  // ── NOTAS DAS AVALIAÇÕES POR USUÁRIO ──
  // notasAvaliacao: [{user_id, avaliacao_id, nota_pct}]
  // Monta mapa: user_id -> {avaliacao_id -> nota_pct}
  const avNotaMap = {}
  for (const r of (notasAvaliacao || [])) {
    if (!avNotaMap[r.user_id]) avNotaMap[r.user_id] = {}
    avNotaMap[r.user_id][String(r.avaliacao_id)] = Number(r.nota_pct)
  }
  const avList = (avaliacoesDb || [])

  // Tabela de notas de avaliação por usuário
  const avHeaders = avList.map(a => `<th style="${thC}" title="${escHtml(a.titulo)}">${escHtml(a.titulo)}</th>`).join('')
  const avUsersMap = {}
  ;(porUsuarioTrilha || []).forEach(r => {
    if (!avUsersMap[r.user_id]) avUsersMap[r.user_id] = { name: r.name, sector: r.sector }
  })
  // Adiciona users que só têm avaliação (busca o nome no banco em vez de exibir o UUID)
  const soAvUids = Object.keys(avNotaMap).filter(uid => !avUsersMap[uid])
  if (soAvUids.length) {
    const { data: soAvUsers } = await supabase.from('users').select('id, name, sector').in('id', soAvUids)
    for (const u of (soAvUsers || [])) avUsersMap[u.id] = { name: u.name || '—', sector: u.sector || '' }
    for (const uid of soAvUids) if (!avUsersMap[uid]) avUsersMap[uid] = { name: '—', sector: '' }
  }
  const avRows = Object.entries(avUsersMap).map(([uid, u]) => {
    const cols = avList.map(a => {
      const nota = avNotaMap[uid]?.[String(a.id)]
      return `<td style="${tdC}">${nota !== undefined ? barra(nota) : '<span style="color:var(--text-secondary);font-size:0.75rem">—</span>'}</td>`
    }).join('')
    const notas = avList.map(a => avNotaMap[uid]?.[String(a.id)]).filter(n => n !== undefined)
    const media = notas.length ? Math.round(notas.reduce((s, n) => s + n, 0) / notas.length) : null
    return `<tr onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background=''">
      <td style="${tdS}"><span style="font-weight:500">${escHtml(u.name || uid)}</span><div style="font-size:0.7rem;color:var(--text-secondary)">${escHtml(u.sector || '')}</div></td>
      ${cols}
      <td style="${tdC};font-weight:700">${notaBadge(media)}</td>
    </tr>`
  }).join('')

  const avTable = avRows && avList.length ? `<table class="resp-table" style="width:100%;border-collapse:collapse">
    <thead style="background:var(--surface)"><tr>
      <th style="${thS}">Aluno</th>
      ${avHeaders}
      <th style="${thC}">Média</th>
    </tr></thead>
    <tbody>${avRows}</tbody>
  </table>` : semDados(2 + avList.length)

  // ── NOTAS DOS QUIZZES POR ALUNO (respondidos após os vídeos) ──
  const quizPct = d => (d.nota !== null && d.nota !== undefined)
    ? Number(d.nota)
    : Math.round((d.acertos / d.respondidas) * 100)

  const quizHeaders = trilhaList.map(t => `<th style="${thC}" title="${escHtml(t.title)}">${escHtml(t.title.substring(0, 22))}</th>`).join('')
  const quizRows = usersArr.length ? usersArr.map(u => {
    const cols = trilhaList.map(t => {
      const d = u.trilhas[t.id]
      if (!d || !d.respondidas) return `<td style="${tdC}"><span style="font-size:0.7rem;color:var(--text-secondary)">—</span></td>`
      const completo = d.nota !== null && d.nota !== undefined
      const detalhe = completo
        ? `${d.acertos} de ${d.respondidas} acertos`
        : `em andamento · ${d.acertos} de ${d.respondidas}`
      return `<td style="${tdC}">${notaBadge(quizPct(d))}<div style="font-size:0.62rem;color:${completo ? 'var(--text-secondary)' : '#f57f17'};margin-top:0.2rem">${detalhe}</div></td>`
    }).join('')

    const pcts = trilhaList.map(t => u.trilhas[t.id]).filter(d => d && d.respondidas).map(quizPct)
    const media = pcts.length ? Math.round(pcts.reduce((s, n) => s + n, 0) / pcts.length) : null

    return `<tr onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background=''">
      <td style="${tdS}">
        <span style="font-weight:500">${escHtml(u.name || u.email || '—')}</span>
        <div style="font-size:0.7rem;color:var(--text-secondary)">${escHtml(u.sector || '')} ${u.role ? '· ' + escHtml(u.role) : ''}</div>
      </td>
      ${cols}
      <td style="${tdC};font-weight:700">${notaBadge(media)}</td>
    </tr>`
  }).join('') : null

  const quizTable = quizRows ? `<table class="resp-table" style="width:100%;border-collapse:collapse">
    <thead style="background:var(--surface)"><tr>
      <th style="${thS}">Aluno</th>
      ${quizHeaders}
      <th style="${thC}">Média</th>
    </tr></thead>
    <tbody>${quizRows}</tbody>
  </table>` : semDados(2 + trilhaList.length)

  // ── QUEM RESPONDEU OS QUIZZES ──
  const totalVideos = trilhaList.length
  const respondeuAlgo = usersArr.filter(u => Object.values(u.trilhas).some(d => d.respondidas > 0))
  const respondeuTudo = usersArr.filter(u =>
    totalVideos > 0 && trilhaList.every(t => {
      const d = u.trilhas[t.id]
      return d && d.nota !== null && d.nota !== undefined
    })
  )

  const respondeuRows = usersArr.filter(u =>
    trilhaList.some(t => (u.trilhas[t.id]?.respondidas || 0) > 0)
  ).map(u => {
    const videosCompletos = trilhaList.filter(t => {
      const d = u.trilhas[t.id]
      return d && d.nota !== null && d.nota !== undefined
    }).length
    const totalRespondidas = trilhaList.reduce((s, t) => s + (u.trilhas[t.id]?.respondidas || 0), 0)
    const totalAcertos     = trilhaList.reduce((s, t) => s + (u.trilhas[t.id]?.acertos    || 0), 0)
    const pctAcerto = totalRespondidas > 0 ? Math.round((totalAcertos / totalRespondidas) * 100) : null
    const completo  = totalVideos > 0 && videosCompletos === totalVideos

    const statusBadge = completo
      ? `<span style="padding:0.15rem 0.5rem;border-radius:999px;font-size:0.72rem;font-weight:700;background:#e8f5e9;color:#2e7d32">✅ Respondeu tudo</span>`
      : totalRespondidas > 0
        ? `<span style="padding:0.15rem 0.5rem;border-radius:999px;font-size:0.72rem;font-weight:700;background:#fff8e1;color:#f57f17">⏳ Incompleto (${videosCompletos}/${totalVideos} vídeos)</span>`
        : `<span style="padding:0.15rem 0.5rem;border-radius:999px;font-size:0.72rem;font-weight:700;background:#f5f5f5;color:#9e9e9e">Não iniciou</span>`

    return `<tr onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background=''">
      <td style="${tdS}">
        <span style="font-weight:500">${escHtml(u.name || u.email || '—')}</span>
        <div style="font-size:0.7rem;color:var(--text-secondary)">${escHtml(u.sector || '')} ${u.role ? '· ' + escHtml(u.role) : ''}</div>
      </td>
      <td style="${tdC}">${totalRespondidas}</td>
      <td style="${tdC}">${totalAcertos}</td>
      <td style="${tdC}">${pctAcerto !== null ? notaBadge(pctAcerto) : '—'}</td>
      <td style="${tdS}">${statusBadge}</td>
    </tr>`
  }).join('')

  const respondeuSummary = `
    <div style="display:flex;gap:1.25rem;flex-wrap:wrap;align-items:center;padding:0.75rem 1rem;background:var(--surface);border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:0.4rem;font-size:0.82rem">
        <span class="material-symbols-outlined" style="font-size:1rem;color:var(--primary)">groups</span>
        <strong>${respondeuAlgo.length}</strong>&nbsp;responderam ao menos 1 questão
      </div>
      <div style="display:flex;align-items:center;gap:0.4rem;font-size:0.82rem">
        <span class="material-symbols-outlined" style="font-size:1rem;color:#2e7d32">check_circle</span>
        <strong>${respondeuTudo.length}</strong>&nbsp;responderam tudo
      </div>
      <div style="margin-left:auto">
        <button onclick="printRespondeuTable()" style="display:inline-flex;align-items:center;gap:0.3rem;padding:0.35rem 0.8rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);color:var(--text-primary);font-size:0.78rem;font-weight:500;cursor:pointer">
          <span class="material-symbols-outlined" style="font-size:0.95rem">print</span> Imprimir
        </button>
      </div>
    </div>`

  const respondeuTable = usersArr.length ? `
    ${respondeuSummary}
    <table id="respondeuTable" class="resp-table" style="width:100%;border-collapse:collapse"
      data-respondeu-algo="${respondeuAlgo.length}"
      data-respondeu-tudo="${respondeuTudo.length}"
      data-total-alunos="${usersArr.length}">
      <thead style="background:var(--surface)"><tr>
        <th style="${thS}">Aluno</th>
        <th style="${thC}">Questões<br>Respondidas</th>
        <th style="${thC}">Acertos</th>
        <th style="${thC}">% Acerto</th>
        <th style="${thS};min-width:160px">Status</th>
      </tr></thead>
      <tbody>${respondeuRows}</tbody>
    </table>` : semDados(5)

  grid.innerHTML = `
    <div class="report-card">
      <div class="report-card-icon" style="background:var(--primary-soft);color:var(--primary)"><span class="material-symbols-outlined">conversion_path</span></div>
      <span class="report-value" style="color:var(--primary)">${cTrilhas || 0}</span>
      <span class="report-label">Trilha${(cTrilhas || 0) !== 1 ? 's' : ''}</span>
    </div>
    <div class="report-card">
      <div class="report-card-icon" style="background:var(--primary-soft);color:var(--primary)"><span class="material-symbols-outlined">play_circle</span></div>
      <span class="report-value" style="color:var(--primary)">${cVideos || 0}</span>
      <span class="report-label">Vídeos</span>
    </div>
    <div class="report-card">
      <div class="report-card-icon" style="background:var(--secondary-soft);color:var(--secondary)"><span class="material-symbols-outlined">quiz</span></div>
      <span class="report-value" style="color:var(--secondary)">${cQuestoesTotal}</span>
      <span class="report-label">Perguntas</span>
    </div>
    <div class="report-card">
      <div class="report-card-icon" style="background:rgba(126,48,0,0.08);color:#7e3000"><span class="material-symbols-outlined">group</span></div>
      <span class="report-value" style="color:#7e3000">${cUsers || 0}</span>
      <span class="report-label">Alunos</span>
    </div>
    ${tabelaCard('how_to_reg', 'Quem Respondeu os Quizzes', respondeuTable)}
    ${tabelaCard('domain', 'Desempenho por Setor — todas as trilhas', setorTable)}
    ${tabelaCard('quiz', 'Notas dos Quizzes por Aluno — respondidos após os vídeos', quizTable)}
    ${tabelaCard('assignment', 'Notas das Avaliações por Aluno', avTable)}
    ${tabelaCard('leaderboard', 'Ranking Individual — desempenho por trilha', rankTable)}
    ${tabelaCard('psychology', 'Principais Dúvidas — perguntas com maior taxa de erro', (() => {
      if (!principais_duvidas?.length) return semDados(4)

      // Agrupa por trilha mantendo ordem por pct_erro desc
      const grupos = {}
      for (const d of principais_duvidas) {
        const key = d.trilha || '—'
        if (!grupos[key]) grupos[key] = []
        grupos[key].push(d)
      }

      const thGrp = 'padding:0.6rem 0.75rem;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--primary);background:var(--primary-soft);border-bottom:1px solid var(--border)'

      const rows = Object.entries(grupos).map(([trilha, itens]) => {
        const header = `<tr><td colspan="4" style="${thGrp}">${escHtml(trilha)}</td></tr>`
        const qRows = itens.map(d => {
          const pct = Number(d.pct_erro) || 0
          const [bg, color] = pct >= 70 ? ['#ffebee','#c62828'] : pct >= 40 ? ['#fff8e1','#f57f17'] : ['#e8f5e9','#2e7d32']
          const errBadge = `<span style="padding:0.15rem 0.5rem;border-radius:999px;font-size:0.75rem;font-weight:700;background:${bg};color:${color}">${pct}%</span>`
          return `<tr>
            <td style="${tdS}">${escHtml(d.pergunta || '—')}</td>
            <td style="${tdC}">${d.total_respostas ?? '—'}</td>
            <td style="${tdC}">${d.total_erros ?? '—'}</td>
            <td style="${tdC}">${errBadge}</td>
          </tr>`
        }).join('')
        return header + qRows
      }).join('')

      return `<table class="resp-table" style="width:100%;border-collapse:collapse">
        <thead style="background:var(--surface)"><tr>
          <th style="${thS}">Pergunta</th>
          <th style="${thC}">Respostas</th>
          <th style="${thC}">Erros</th>
          <th style="${thC}">% Erro</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`
    })())}
  `
}

// Imprimir tabela "Quem Respondeu os Quizzes"
function printRespondeuTable() {
  const table = document.getElementById('respondeuTable')
  if (!table) { alert('Abra a seção "Quem Respondeu os Quizzes" antes de imprimir.'); return }

  const totalAlunos   = table.dataset.totalAlunos   || ''
  const respondeuAlgo = table.dataset.respondeuAlgo || ''
  const respondeuTudo = table.dataset.respondeuTudo || ''

  // Clona linhas da tabela com cores fixas (sem CSS variables)
  let html = table.outerHTML
    .replace(/var\(--border\)/g,        '#e5e7eb')
    .replace(/var\(--surface\)/g,       '#f9fafb')
    .replace(/var\(--text-primary\)/g,  '#111827')
    .replace(/var\(--text-secondary\)/g,'#6b7280')
    .replace(/var\(--primary\)/g,       '#14b8a6')
    .replace(/var\(--radius\)/g,        '6px')
    .replace(/var\(--bg\)/g,            '#ffffff')
    .replace(/onmouseover="[^"]*"/g, '')
    .replace(/onmouseout="[^"]*"/g,  '')

  // Injeta overlay de impressão diretamente na página (evita escalonamento do popup)
  let overlay = document.getElementById('_printRespondeuOverlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = '_printRespondeuOverlay'
    document.body.appendChild(overlay)
  }

  overlay.innerHTML = `
    <div style="font-family:Arial,sans-serif;color:#111827;padding:1.5cm">
      <p style="font-size:22pt;font-weight:700;margin:0 0 4pt">\
EduJuju — Hospital Infantil Dr. Juvêncio Mattos</p>
      <p style="font-size:16pt;font-weight:600;color:#374151;margin:0 0 4pt">Quem Respondeu os Quizzes</p>
      <p style="font-size:12pt;color:#6b7280;margin:0 0 16pt">Gerado em ${new Date().toLocaleString('pt-BR')}</p>
      <div style="display:flex;gap:2em;margin-bottom:16pt;padding:8pt 12pt;background:#f3f4f6;border-radius:6px;font-size:12pt">
        <span>👥 <strong>${respondeuAlgo}</strong> de <strong>${totalAlunos}</strong> responderam ao menos 1 questão</span>
        <span>✅ <strong>${respondeuTudo}</strong> responderam tudo</span>
      </div>
      ${html}
    </div>`

  // Injeta estilo de impressão com fonte grande e esconde o resto da página
  let style = document.getElementById('_printRespondeuStyle')
  if (!style) {
    style = document.createElement('style')
    style.id = '_printRespondeuStyle'
    document.head.appendChild(style)
  }
  style.textContent = `
    @media print {
      @page { size: A4 landscape; margin: 0; }
      body > *:not(#_printRespondeuOverlay) { display: none !important; }
      #_printRespondeuOverlay { display: block !important; }
      #_printRespondeuOverlay table { width:100%; border-collapse:collapse; font-size:12pt; }
      #_printRespondeuOverlay th   { font-size:10pt; padding:6pt 8pt; background:#f3f4f6;
                                     border-bottom:2px solid #ccc; text-transform:uppercase; color:#555; }
      #_printRespondeuOverlay td   { font-size:12pt; padding:7pt 8pt; border-bottom:1px solid #e5e7eb; }
      #_printRespondeuOverlay td div { font-size:10pt; }
      #_printRespondeuOverlay span[style*="border-radius:999px"] { font-size:10pt !important; }
      #_printRespondeuOverlay tr:nth-child(even) td { background:#f9fafb; }
    }
    #_printRespondeuOverlay { display: none; }
  `

  window.print()

  // Após impressão, remove o overlay
  window.addEventListener('afterprint', () => {
    overlay.innerHTML = ''
  }, { once: true })
}

// Marcar/desmarcar todos os chips do modal PDF
function setAllPdfChips(on) {
  document.querySelectorAll('.pdf-chip').forEach(chip => {
    const chk = document.getElementById(chip.dataset.chk)
    if (!chk) return
    chk.checked = on
    chip.classList.toggle('active', on)
  })
}
document.getElementById('pdfMarcarTodos')?.addEventListener('click', () => setAllPdfChips(true))
document.getElementById('pdfDesmarcarTodos')?.addEventListener('click', () => setAllPdfChips(false))

// Chips do modal PDF fazem toggle no checkbox oculto
document.querySelectorAll('.pdf-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const chk = document.getElementById(chip.dataset.chk)
    if (!chk) return
    chk.checked = !chk.checked
    chip.classList.toggle('active', chk.checked)
  })
})

// Abre modal de seleção do PDF
document.getElementById('btnGerarPDF')?.addEventListener('click', () => {
  document.getElementById('modalPDF').classList.add('open')
})
document.getElementById('closeModalPDF')?.addEventListener('click',  () => document.getElementById('modalPDF').classList.remove('open'))
document.getElementById('cancelModalPDF')?.addEventListener('click', () => document.getElementById('modalPDF').classList.remove('open'))

document.getElementById('confirmarPDF')?.addEventListener('click', async () => {
  // Só entram no PDF as seções marcadas no popup de seleção
  const incResumo     = document.getElementById('pdfChkResumo')?.checked ?? false
  const incSetor      = document.getElementById('pdfChkSetor')?.checked ?? false
  const incQuizzes    = document.getElementById('pdfChkQuizzes')?.checked ?? false
  const incAvaliacoes = document.getElementById('pdfChkAvaliacoes')?.checked ?? false
  const incRanking    = document.getElementById('pdfChkRanking')?.checked ?? false
  const incDuvidas    = document.getElementById('pdfChkDuvidas')?.checked ?? false

  document.getElementById('modalPDF').classList.remove('open')

  const btn = document.getElementById('btnGerarPDF')
  btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1.1rem;animation:spin 1s linear infinite">progress_activity</span> Gerando...'
  btn.disabled = true

  try {
    const [
      { count: cTrilhas },
      { count: cVideos },
      { count: cQuestions },
      { count: cUsers },
      { data: porUsuarioTrilha },
      { data: porSetorTrilha },
      { data: trilhas },
      { data: principais_duvidas },
      { data: avaliacoesDb },
      { data: notasAvaliacao },
      { data: usersDb },
      { data: questoesAvRows }
    ] = await Promise.all([
      supabase.from('trilhas').select('*', { count: 'exact', head: true }),
      supabase.from('videos').select('*', { count: 'exact', head: true }),
      supabase.from('questoes_sala_de_aula').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('v_desempenho_usuario_trilha').select('*'),
      supabase.from('v_desempenho_setor_trilha').select('*'),
      supabase.from('videos').select('id, title, topics').order('ordem', { ascending: true }),
      supabase.from('v_principais_duvidas').select('*').order('pct_erro', { ascending: false }).limit(50),
      supabase.from('avaliacoes').select('id, titulo, topics').eq('visivel', true).order('ordem', { ascending: true }),
      supabase.from('v_desempenho_usuario_avaliacao').select('user_id, avaliacao_id, nota_pct'),
      supabase.from('users').select('id, name, sector, role'),
      supabase.from('questoes_avaliacao').select('avaliacao_id')
    ])

    // Perguntas = questões dos quizzes + questões das avaliações
    const cQuestoesTotal = (cQuestions || 0) + (questoesAvRows || []).length

    const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
    const trilhaList = trilhas || []

    const esc = s => s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

    const badge = pct => {
      if (pct === null || pct === undefined) return `<span style="color:#9ca3af;font-size:0.8rem">—</span>`
      const n = Number(pct)
      const [bg, color] = n >= 70 ? ['#d1fae5','#065f46'] : n >= 50 ? ['#fef3c7','#92400e'] : ['#fee2e2','#991b1b']
      return `<span style="display:inline-block;padding:0.2rem 0.6rem;border-radius:999px;font-size:0.78rem;font-weight:700;background:${bg};color:${color}">${n}%</span>`
    }

    // ── Pivot: usuário × trilha ──
    const userMap = {}
    for (const row of (porUsuarioTrilha || [])) {
      if (!userMap[row.user_id]) userMap[row.user_id] = { name: row.name, email: row.email, sector: row.sector || 'Não informado', role: row.role, trilhas: {} }
      userMap[row.user_id].trilhas[row.video_id] = { nota: row.nota_pct, respondidas: Number(row.total_respondidas), acertos: Number(row.acertos) || 0 }
    }
    // Só entra no PDF quem respondeu ao menos uma pergunta de quiz
    const usersArr = Object.values(userMap).filter(u =>
      Object.values(u.trilhas).some(d => d.respondidas > 0)
    )
    usersArr.sort((a, b) => {
      const avg = u => { const ns = trilhaList.map(t => u.trilhas[t.id]?.nota).filter(n => n != null); return ns.length ? ns.reduce((s,n)=>s+Number(n),0)/ns.length : -1 }
      return avg(b) - avg(a)
    })

    // ── Pivot: setor × trilha ──
    const setorMap = {}
    for (const row of (porSetorTrilha || [])) {
      const s = row.sector || 'Não informado'
      if (!setorMap[s]) setorMap[s] = { trilhas: {} }
      setorMap[s].trilhas[row.video_id] = row.media_pct
    }

    const thStyle = 'padding:0.55rem 0.75rem;text-align:left;background:#f1f5f9;color:#475569;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #e2e8f0;white-space:nowrap'
    const thCStyle = 'padding:0.55rem 0.6rem;text-align:center;background:#f1f5f9;color:#475569;font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #e2e8f0;white-space:nowrap;max-width:90px'
    const tdStyle = 'padding:0.5rem 0.75rem;border-bottom:1px solid #f1f5f9;font-size:0.8rem;color:#1e293b;vertical-align:middle'
    const tdCStyle = 'padding:0.5rem 0.6rem;text-align:center;border-bottom:1px solid #f1f5f9;font-size:0.78rem;vertical-align:middle'

    // Ranking individual
    const rankHeaderCols = trilhaList.map(t => `<th style="${thCStyle}" title="${esc(t.title)}">${esc(t.topics || t.title.substring(0,14))}</th>`).join('')
    const medals = ['🥇','🥈','🥉']
    const rankBodyRows = usersArr.map((u, i) => {
      const rankNum = i < 3 ? medals[i] : `${i+1}º`
      const trilhaCols = trilhaList.map(t => {
        const d = u.trilhas[t.id]
        if (!d) return `<td style="${tdCStyle}"><span style="color:#9ca3af;font-size:0.75rem">—</span></td>`
        if (d.nota !== null && d.nota !== undefined) return `<td style="${tdCStyle}">${badge(d.nota)}</td>`
        if (d.respondidas > 0) {
          const parcial = Math.round((d.acertos / d.respondidas) * 100)
          return `<td style="${tdCStyle}">${badge(parcial)}<div style="font-size:0.62rem;color:#d97706;margin-top:0.15rem;white-space:nowrap">em andamento · ${d.acertos} de ${d.respondidas}</div></td>`
        }
        return `<td style="${tdCStyle}"><span style="color:#9ca3af;font-size:0.75rem">Não iniciado</span></td>`
      }).join('')
      const notas = trilhaList.map(t => u.trilhas[t.id]?.nota).filter(n => n != null)
      const media = notas.length ? Math.round(notas.reduce((s,n)=>s+Number(n),0)/notas.length) : null
      const rowBg = i % 2 === 0 ? '#ffffff' : '#f8fafc'
      return `<tr style="background:${rowBg}">
        <td style="${tdCStyle};font-size:0.9rem">${rankNum}</td>
        <td style="${tdStyle}">
          <div style="font-weight:600;color:#0f172a">${esc(u.name || u.email || '—')}</div>
          <div style="font-size:0.7rem;color:#64748b;margin-top:0.1rem">${esc(u.sector)}${u.role ? ' · ' + esc(u.role) : ''}</div>
        </td>
        ${trilhaCols}
        <td style="${tdCStyle}">${badge(media)}</td>
      </tr>`
    }).join('')

    // Setores
    const setorHeaderCols = trilhaList.map(t => `<th style="${thCStyle}" title="${esc(t.title)}">${esc(t.topics || t.title.substring(0,14))}</th>`).join('')
    const setorBodyRows = Object.entries(setorMap).map(([setor, d], i) => {
      const cols = trilhaList.map(t => {
        const pct = d.trilhas[t.id]
        return `<td style="${tdCStyle}">${pct != null ? badge(pct) : '<span style="color:#9ca3af;font-size:0.75rem">—</span>'}</td>`
      }).join('')
      const notas = trilhaList.map(t => d.trilhas[t.id]).filter(n => n != null)
      const media = notas.length ? Math.round(notas.reduce((s,n)=>s+Number(n),0)/notas.length) : null
      const rowBg = i % 2 === 0 ? '#ffffff' : '#f8fafc'
      return `<tr style="background:${rowBg}">
        <td style="${tdStyle};font-weight:600">${esc(setor)}</td>
        ${cols}
        <td style="${tdCStyle}">${badge(media)}</td>
      </tr>`
    }).join('')

    // Notas dos quizzes (respondidos após os vídeos) por aluno
    const quizPctPdf = d => (d.nota !== null && d.nota !== undefined) ? Number(d.nota) : Math.round((d.acertos / d.respondidas) * 100)
    const quizHeaderCols = trilhaList.map(t => `<th style="${thCStyle}" title="${esc(t.title)}">${esc(t.topics || t.title.substring(0,14))}</th>`).join('')
    const quizBodyRows = usersArr.map((u, i) => {
      const cols = trilhaList.map(t => {
        const d = u.trilhas[t.id]
        if (!d || !d.respondidas) return `<td style="${tdCStyle}"><span style="color:#9ca3af;font-size:0.75rem">—</span></td>`
        const completo = d.nota !== null && d.nota !== undefined
        const detalhe = completo ? `${d.acertos} de ${d.respondidas}` : `em andamento · ${d.acertos} de ${d.respondidas}`
        return `<td style="${tdCStyle}">${badge(quizPctPdf(d))}<div style="font-size:0.62rem;color:${completo ? '#94a3b8' : '#d97706'};margin-top:0.15rem;white-space:nowrap">${detalhe}</div></td>`
      }).join('')
      const pcts = trilhaList.map(t => u.trilhas[t.id]).filter(d => d && d.respondidas).map(quizPctPdf)
      const media = pcts.length ? Math.round(pcts.reduce((s,n)=>s+n,0)/pcts.length) : null
      const rowBg = i % 2 === 0 ? '#ffffff' : '#f8fafc'
      return `<tr style="background:${rowBg}">
        <td style="${tdStyle}">
          <div style="font-weight:600;color:#0f172a">${esc(u.name || u.email || '—')}</div>
          <div style="font-size:0.7rem;color:#64748b;margin-top:0.1rem">${esc(u.sector)}${u.role ? ' · ' + esc(u.role) : ''}</div>
        </td>
        ${cols}
        <td style="${tdCStyle}">${badge(media)}</td>
      </tr>`
    }).join('')

    // Notas das avaliações por aluno
    const userInfoMap = {}
    for (const u of (usersDb || [])) userInfoMap[u.id] = u
    const avNotaMapPdf = {}
    for (const r of (notasAvaliacao || [])) {
      if (!avNotaMapPdf[r.user_id]) avNotaMapPdf[r.user_id] = {}
      avNotaMapPdf[r.user_id][String(r.avaliacao_id)] = Number(r.nota_pct)
    }
    const avListPdf = avaliacoesDb || []
    const avHeaderCols = avListPdf.map(a => `<th style="${thCStyle}" title="${esc(a.titulo)}">${esc(a.topics || a.titulo.substring(0,14))}</th>`).join('')
    const avEntries = Object.entries(avNotaMapPdf).sort((a, b) =>
      (userInfoMap[a[0]]?.name || '').localeCompare(userInfoMap[b[0]]?.name || '')
    )
    const avBodyRows = avEntries.map(([uid, notas], i) => {
      const u = userInfoMap[uid] || {}
      const cols = avListPdf.map(a => {
        const nota = notas[String(a.id)]
        return `<td style="${tdCStyle}">${nota !== undefined ? badge(nota) : '<span style="color:#9ca3af;font-size:0.75rem">—</span>'}</td>`
      }).join('')
      const vals = avListPdf.map(a => notas[String(a.id)]).filter(n => n !== undefined)
      const media = vals.length ? Math.round(vals.reduce((s,n)=>s+n,0)/vals.length) : null
      const rowBg = i % 2 === 0 ? '#ffffff' : '#f8fafc'
      return `<tr style="background:${rowBg}">
        <td style="${tdStyle}">
          <div style="font-weight:600;color:#0f172a">${esc(u.name || uid)}</div>
          <div style="font-size:0.7rem;color:#64748b;margin-top:0.1rem">${esc(u.sector || '')}${u.role ? ' · ' + esc(u.role) : ''}</div>
        </td>
        ${cols}
        <td style="${tdCStyle}">${badge(media)}</td>
      </tr>`
    }).join('')

    const sectionCard = (title, icon, content) => `
      <div style="margin-bottom:2rem;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(15,23,42,0.06)">
        <div style="display:flex;align-items:center;gap:0.65rem;padding:0.95rem 1.25rem;background:linear-gradient(90deg,#f0fdfa 0%,#ecfdf5 60%,#ffffff 100%);border-bottom:2px solid #ccfbf1;border-left:5px solid #006a61">
          <span style="font-size:1.15rem">${icon}</span>
          <span style="font-size:0.95rem;font-weight:700;color:#134e4a;letter-spacing:-0.01em">${title}</span>
        </div>
        <div style="overflow-x:auto">${content}</div>
      </div>`

    const statCard = (icon, value, label, color, bgSoft) => `
      <div style="flex:1;min-width:140px;background:linear-gradient(160deg,#ffffff 30%,${bgSoft} 100%);border:1px solid #e2e8f0;border-radius:14px;padding:1.3rem 1rem;text-align:center;box-shadow:0 2px 10px rgba(15,23,42,0.06)">
        <div style="width:2.7rem;height:2.7rem;margin:0 auto 0.6rem;display:flex;align-items:center;justify-content:center;border-radius:50%;background:${bgSoft};font-size:1.3rem">${icon}</div>
        <div style="font-size:2.1rem;font-weight:800;color:${color};line-height:1;letter-spacing:-0.02em">${value}</div>
        <div style="font-size:0.72rem;color:#64748b;margin-top:0.35rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em">${label}</div>
      </div>`

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório EduJuju — ${today}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f8fafc; color: #1e293b; }
  .page { width: 100%; max-width: 1100px; margin: 0 auto; padding: 2rem; }
  table { width: 100%; border-collapse: collapse; }
  @media print {
    body { background: #fff; }
    .page { padding: 1cm 1.5cm; }
    .no-break { page-break-inside: avoid; }
    @page { size: A4 landscape; margin: 1cm 1.5cm; }
  }
</style>
</head>
<body>
<div class="page">
  <!-- Cabeçalho -->
  <div style="background:linear-gradient(135deg,#00524b 0%,#006a61 55%,#0f9488 100%);border-radius:16px;padding:1.6rem 2rem;display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem;box-shadow:0 4px 16px rgba(0,106,97,0.3)">
    <div>
      <div style="font-size:1.8rem;font-weight:800;color:#ffffff;letter-spacing:-0.02em">🎓 EduJuju</div>
      <div style="font-size:0.85rem;color:rgba(255,255,255,0.88);margin-top:0.25rem">Hospital Infantil Dr. Juvêncio Mattos</div>
    </div>
    <div style="text-align:right">
      <div style="display:inline-block;padding:0.3rem 0.85rem;border-radius:999px;background:rgba(255,255,255,0.18);font-size:0.72rem;font-weight:700;color:#ffffff;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.4rem">Relatório de Desempenho</div>
      <div style="font-size:0.85rem;color:rgba(255,255,255,0.88)">${today}</div>
    </div>
  </div>

  <!-- Resumo -->
  ${incResumo ? `<div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:2rem" class="no-break">
    ${statCard('🛤️', cTrilhas || 0, (cTrilhas || 0) !== 1 ? 'Trilhas' : 'Trilha', '#006a61', '#f0fdfa')}
    ${statCard('🎬', cVideos || 0, 'Vídeos', '#0f766e', '#f0fdfa')}
    ${statCard('❓', cQuestoesTotal, 'Perguntas', '#0369a1', '#f0f9ff')}
    ${statCard('👥', cUsers || 0, 'Alunos', '#15803d', '#f0fdf4')}
  </div>` : ''}

  <!-- Desempenho por Setor -->
  ${incSetor ? sectionCard('Desempenho por Setor — todas as trilhas', '🏢',
    setorBodyRows
      ? `<table><thead><tr><th style="${thStyle}">Setor</th>${setorHeaderCols}<th style="${thCStyle}">Média Geral</th></tr></thead><tbody>${setorBodyRows}</tbody></table>`
      : `<p style="padding:2rem;text-align:center;color:#9ca3af;font-size:0.875rem">Sem dados ainda — aguardando respostas dos alunos</p>`
  ) : ''}

  <!-- Notas dos Quizzes -->
  ${incQuizzes ? sectionCard('Notas dos Quizzes por Aluno — respondidos após os vídeos', '📝',
    quizBodyRows
      ? `<table><thead><tr><th style="${thStyle}">Aluno</th>${quizHeaderCols}<th style="${thCStyle}">Média</th></tr></thead><tbody>${quizBodyRows}</tbody></table>`
      : `<p style="padding:2rem;text-align:center;color:#9ca3af;font-size:0.875rem">Sem dados ainda — aguardando respostas dos alunos</p>`
  ) : ''}

  <!-- Notas das Avaliações -->
  ${incAvaliacoes ? sectionCard('Notas das Avaliações por Aluno', '📋',
    avBodyRows && avListPdf.length
      ? `<table><thead><tr><th style="${thStyle}">Aluno</th>${avHeaderCols}<th style="${thCStyle}">Média</th></tr></thead><tbody>${avBodyRows}</tbody></table>`
      : `<p style="padding:2rem;text-align:center;color:#9ca3af;font-size:0.875rem">Sem dados ainda — nenhuma avaliação concluída</p>`
  ) : ''}

  <!-- Ranking Individual -->
  ${incRanking ? sectionCard('Ranking Individual — desempenho por trilha', '🏆',
    rankBodyRows
      ? `<table><thead><tr><th style="${thCStyle}">#</th><th style="${thStyle}">Nome</th>${rankHeaderCols}<th style="${thCStyle}">Média Geral</th></tr></thead><tbody>${rankBodyRows}</tbody></table>`
      : `<p style="padding:2rem;text-align:center;color:#9ca3af;font-size:0.875rem">Sem dados ainda — aguardando respostas dos alunos</p>`
  ) : ''}

  <!-- Principais Dúvidas -->
  ${incDuvidas ? sectionCard('Principais Dúvidas — perguntas com maior taxa de erro', '🧠', (() => {
    if (!principais_duvidas?.length) return `<p style="padding:2rem;text-align:center;color:#9ca3af;font-size:0.875rem">Sem dados ainda</p>`
    const grupos = {}
    for (const d of principais_duvidas) {
      const key = d.trilha || '—'
      if (!grupos[key]) grupos[key] = []
      grupos[key].push(d)
    }
    const thGrp = 'padding:0.5rem 0.75rem;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#006a61;background:#f0fdfa;border-bottom:1px solid #e2e8f0'
    const rows = Object.entries(grupos).map(([trilha, itens]) => {
      const header = `<tr><td colspan="4" style="${thGrp}">${esc(trilha)}</td></tr>`
      const qRows = itens.map((d, i) => {
        const pct = Number(d.pct_erro) || 0
        const [bg, color] = pct >= 70 ? ['#fee2e2','#991b1b'] : pct >= 40 ? ['#fef3c7','#92400e'] : ['#d1fae5','#065f46']
        const errBadge = `<span style="display:inline-block;padding:0.15rem 0.5rem;border-radius:999px;font-size:0.73rem;font-weight:700;background:${bg};color:${color}">${pct}%</span>`
        const rowBg = i % 2 === 0 ? '#ffffff' : '#f8fafc'
        return `<tr style="background:${rowBg}">
          <td style="${tdStyle}">${esc(d.pergunta || '—')}</td>
          <td style="${tdCStyle}">${d.total_respostas ?? '—'}</td>
          <td style="${tdCStyle}">${d.total_erros ?? '—'}</td>
          <td style="${tdCStyle}">${errBadge}</td>
        </tr>`
      }).join('')
      return header + qRows
    }).join('')
    return `<table>
      <thead><tr>
        <th style="${thStyle}">Pergunta</th>
        <th style="${thCStyle}">Respostas</th>
        <th style="${thCStyle}">Erros</th>
        <th style="${thCStyle}">% Erro</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`
  })()) : ''}

  <!-- Rodapé -->
  <div style="margin-top:2.5rem;padding-top:1rem;border-top:2px solid #ccfbf1;display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:0.72rem;color:#94a3b8">💚 Gerado automaticamente pela plataforma EduJuju — Hospital Infantil Dr. Juvêncio Mattos</span>
    <span style="font-size:0.72rem;color:#94a3b8">${today}</span>
  </div>
</div>
<script>window.onload = () => { setTimeout(() => window.print(), 400) }<\/script>
</body>
</html>`

    const win = window.open('', '_blank', 'width=1200,height=850,scrollbars=yes')
    if (!win) { alert('Permita pop-ups para gerar o PDF.'); return }
    win.document.write(html)
    win.document.close()
  } finally {
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1.1rem">picture_as_pdf</span> Gerar PDF'
    btn.disabled = false
  }
})

// ============================================
// HELPERS
// ============================================
function ytVideoId(url) {
  if (!url) return ''
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v')
      if (v) return v
    }
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0]
  } catch {}
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/))([A-Za-z0-9_-]{11})/)
  return m ? m[1] : ''
}

function ytEmbedUrl(url) {
  const id = ytVideoId(url)
  return id ? `https://www.youtube.com/embed/${id}` : ''
}

// ============================================
// DROPDOWN DE TRILHAS
// ============================================
async function fillTrilhaDropdown(selectId, novaInputId, currentValue = '') {
  const sel      = document.getElementById(selectId)
  const novaInput = document.getElementById(novaInputId)
  if (!sel) return

  const [{ data: vids }, { data: arts }] = await Promise.all([
    supabase.from('videos').select('topics').not('topics', 'is', null),
    supabase.from('artigos').select('topics').not('topics', 'is', null)
  ])
  const topicsSet = new Set()
  ;(vids || []).forEach(v => v.topics?.trim() && topicsSet.add(v.topics.trim()))
  ;(arts || []).forEach(a => a.topics?.trim() && topicsSet.add(a.topics.trim()))
  const topicsList = Array.from(topicsSet).sort()

  sel.innerHTML =
    `<option value="">-- Sem trilha --</option>` +
    topicsList.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('') +
    `<option value="__nova__">✏️ Nova trilha...</option>`

  if (currentValue && topicsSet.has(currentValue)) {
    sel.value = currentValue
  } else if (currentValue) {
    sel.value = '__nova__'
    if (novaInput) { novaInput.style.display = ''; novaInput.value = currentValue }
  } else {
    sel.value = ''
  }

  sel.onchange = () => {
    if (!novaInput) return
    novaInput.style.display = sel.value === '__nova__' ? '' : 'none'
    if (sel.value !== '__nova__') novaInput.value = ''
  }
}

function getTrilhaValue(selectId, novaInputId) {
  const sel = document.getElementById(selectId)
  if (!sel) return ''
  if (sel.value === '__nova__') return (document.getElementById(novaInputId)?.value || '').trim()
  return sel.value.trim()
}

let _toastTimer = null
function showToast(msg, type = '') {
  const existing = document.querySelector('.app-toast')
  if (existing) existing.remove()
  clearTimeout(_toastTimer)
  const el = document.createElement('div')
  el.className = 'app-toast' + (type ? ' ' + type : '')
  el.textContent = msg
  document.body.appendChild(el)
  _toastTimer = setTimeout(() => el.remove(), 3500)
}

function escHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ============================================
// CONFIGURAÇÕES DO PERFIL
// ============================================
document.getElementById('btnEditPerfil').addEventListener('click', openModalPerfil)
document.getElementById('closeModalPerfil').addEventListener('click', () => document.getElementById('modalPerfil').classList.remove('open'))
document.getElementById('cancelPerfil').addEventListener('click',    () => document.getElementById('modalPerfil').classList.remove('open'))

function setFotoPreview(src) {
  const img  = document.getElementById('fotoPreview')
  const icon = document.getElementById('fotoPreviewIcon')
  if (src) {
    img.src = src
    img.style.display = ''
    icon.style.display = 'none'
  } else {
    img.style.display = 'none'
    icon.style.display = ''
  }
}

async function openModalPerfil() {
  document.getElementById('perfilError').textContent = ''
  document.getElementById('editFotoFile').value = ''
  const { data: p } = await supabase.from('users').select('name, sector, role, foto').eq('id', currentUser.id).maybeSingle()
  if (p) {
    document.getElementById('editNome').value  = p.name   || ''
    document.getElementById('editSetor').value = p.sector || ''
    document.getElementById('editRole').value  = p.role   || ''
    setFotoPreview(p.foto || '')
  } else {
    setFotoPreview('')
  }
  document.getElementById('modalPerfil').classList.add('open')
}

document.getElementById('editFotoFile').addEventListener('change', e => {
  const file = e.target.files[0]
  if (!file) return
  if (file.size > 2 * 1024 * 1024) {
    document.getElementById('perfilError').textContent = 'Arquivo muito grande. Máximo 2 MB.'
    e.target.value = ''
    return
  }
  document.getElementById('perfilError').textContent = ''
  setFotoPreview(URL.createObjectURL(file))
})

document.getElementById('formPerfil').addEventListener('submit', async e => {
  e.preventDefault()
  const btn     = e.target.querySelector('[type="submit"]')
  const errorEl = document.getElementById('perfilError')
  const name    = document.getElementById('editNome').value.trim()
  const sector  = document.getElementById('editSetor').value.trim()
  const role    = document.getElementById('editRole').value.trim()
  const file    = document.getElementById('editFotoFile').files[0]

  setLoading(btn, true, 'Salvando...')
  errorEl.textContent = ''

  let foto = null

  if (file) {
    const ext  = file.name.split('.').pop().toLowerCase()
    const path = `${currentUser.id}/avatar_${Date.now()}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { contentType: file.type })

    if (uploadErr) {
      errorEl.textContent = 'Erro ao enviar foto: ' + uploadErr.message
      setLoading(btn, false, 'Salvar')
      return
    }

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
    foto = urlData.publicUrl
  } else {
    const { data: cur } = await supabase.from('users').select('foto').eq('id', currentUser.id).maybeSingle()
    foto = cur?.foto || null
  }

  const { error } = await supabase.from('users')
    .update({ name, sector: sector || null, role: role || null, foto })
    .eq('id', currentUser.id)

  setLoading(btn, false, 'Salvar')

  if (error) {
    errorEl.textContent = 'Erro: ' + error.message
  } else {
    localStorage.removeItem('eduflow-profile-' + currentUser.id)
    document.getElementById('modalPerfil').classList.remove('open')
    await loadProfile()
  }
})

// Notificações — em breve
document.getElementById('btnNotificacoes').addEventListener('click', () => {
  alert('Configurações de notificação em breve.')
})

// ============================================
// CONFETTI — celebra conclusão de aulas/trilhas
// ============================================
function fireConfetti(big = false) {
  if (typeof window.confetti !== 'function') return
  if (big) {
    window.confetti({ particleCount: 180, spread: 100, origin: { y: 0.5 }, colors: ['#6c63ff', '#f59e0b', '#10b981', '#ef4444', '#3b82f6'] })
    setTimeout(() => window.confetti({ particleCount: 80, spread: 60, origin: { x: 0.1, y: 0.6 } }), 250)
    setTimeout(() => window.confetti({ particleCount: 80, spread: 60, origin: { x: 0.9, y: 0.6 } }), 400)
  } else {
    window.confetti({ particleCount: 80, spread: 70, origin: { y: 0.65 }, colors: ['#6c63ff', '#f59e0b', '#10b981'] })
  }
}

async function checkTrilhaConcluidaEConfetti(videoId) {
  if (!currentUser || !salaVideos.length) return

  const thisVideo = salaVideos.find(v => v.id === videoId)
  if (!thisVideo) return
  const trilhaKey = thisVideo.topics || thisVideo.title

  const trilhaVids = salaVideos.filter(v => (v.topics || v.title) === trilhaKey)
  const allDone    = trilhaVids.every(v => getVideoProgress(v.id) === 'completed')

  fireConfetti(allDone)
}

// ============================================
// SYNC — garante que localStorage reflete o banco
// ============================================
async function syncLocalProgress(userId) {
  if (!userId) return
  const { data: progressData } = await supabase
    .from('progresso_usuario')
    .select('item_id, item_tipo')
    .eq('user_id', userId)
    .eq('concluido', true)
  if (progressData) {
    const keysToRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && (
        key.startsWith(`eduflow-prog-${userId}-`) ||
        key.startsWith(`eduflow-artigo-${userId}-`) ||
        key.startsWith(`eduflow-av-${userId}-`)
      )) keysToRemove.push(key)
    }
    keysToRemove.forEach(k => localStorage.removeItem(k))
    for (const p of progressData) {
      if (p.item_tipo === 'video')      localStorage.setItem(`eduflow-prog-${userId}-${p.item_id}`, 'completed')
      else if (p.item_tipo === 'artigo') localStorage.setItem(`eduflow-artigo-${userId}-${p.item_id}`, 'completed')
      else if (p.item_tipo === 'avaliacao') localStorage.setItem(`eduflow-av-${userId}-${p.item_id}`, 'completed')
    }
  }
}

// ============================================
// HOME — carrega dados da página inicial
// ============================================
async function loadHome() {
  if (!currentUser) return
  const userId = currentUser.id
  try {

  await syncLocalProgress(userId)
  const [{ data: videos }, { data: artigos }, { data: avaliacoes }, { data: trilhasData }] = await Promise.all([
    supabase.from('videos').select('id, title, topics, categoria, youtube_url, description').eq('visivel', true).order('ordem', { ascending: true }),
    supabase.from('artigos').select('id, titulo, descricao, imagem_url, topics, categoria').eq('visivel', true).order('ordem', { ascending: true }),
    supabase.from('avaliacoes').select('id, titulo, descricao, imagem_url, topics, categoria').eq('visivel', true).order('ordem', { ascending: true }),
    supabase.from('trilhas').select('nome, imagem_url, descricao').eq('visivel', true)
  ])
  const trilhaInfoMap = {}
  for (const t of (trilhasData || [])) trilhaInfoMap[t.nome.trim().toLowerCase()] = t

  const allVideos     = videos     || []
  const allArtigos    = artigos    || []
  const allAvaliacoes = avaliacoes || []
  const allItems   = [
    ...allVideos.map(v  => ({ ...v,  _tipo: 'video'     })),
    ...allArtigos.map(a => ({ ...a,  _tipo: 'artigo'    })),
    ...allAvaliacoes.map(a => ({ ...a, _tipo: 'avaliacao' }))
  ]
  if (!_catalogItems.length) _catalogItems = allItems


  // --- Progresso geral (inclui vídeos, artigos e avaliações) ---
  const totalItems = allItems.length
  const completed  = allItems.filter(item => {
    if (item._tipo === 'video')      return getVideoProgress(item.id) === 'completed'
    if (item._tipo === 'artigo')     return getArtigoProgress(item.id) === 'completed'
    if (item._tipo === 'avaliacao')  return getAvaliacaoProgress(item.id) === 'completed'
    return false
  }).length
  const pct = totalItems ? Math.round((completed / totalItems) * 100) : 0

  const ringFill = document.getElementById('homeRingFill')
  if (ringFill) {
    const offset = 264 - (pct / 100) * 264
    ringFill.style.transition = 'stroke-dashoffset 1.2s ease'
    ringFill.style.strokeDashoffset = offset
  }
  const progPctEl = document.getElementById('homeProgPct')
  if (progPctEl) progPctEl.textContent = pct + '%'

  const homeDesc = document.getElementById('homeDesc')
  if (homeDesc) {
    if (pct === 100)     homeDesc.textContent = 'Você completou todas as trilhas! Incrível!'
    else if (pct > 0)    homeDesc.textContent = `${pct}% do caminho percorrido. Continue assim!`
    else                 homeDesc.textContent = 'Comece sua primeira trilha de aprendizado.'
  }

  // --- Continue de onde parou ---
  const progressoDoItem = i =>
    i._tipo === 'video'  ? getVideoProgress(i.id)
    : i._tipo === 'artigo' ? getArtigoProgress(i.id)
    : getAvaliacaoProgress(i.id)
  const startedItem = allItems.find(i => progressoDoItem(i) === 'started')
    || allItems.find(i => progressoDoItem(i) !== 'completed')

  const continueWrap = document.getElementById('homeContinueWrap')
  const continueCard = document.getElementById('homeContinueCard')
  if (continueWrap && continueCard) {
    if (startedItem) {
      continueWrap.style.display = ''
      const isArtigo = startedItem._tipo === 'artigo'
      const isVideo  = startedItem._tipo === 'video'
      const title    = isVideo ? startedItem.title       : startedItem.titulo
      const desc     = isVideo ? startedItem.description : startedItem.descricao
      const vid      = isVideo ? ytVideoId(startedItem.youtube_url) : null
      const thumb    = vid ? `https://img.youtube.com/vi/${vid}/mqdefault.jpg` : (startedItem.imagem_url || null)
      window._openHomeItem = (id, tipo) => {
        const item = allItems.find(i => String(i.id) === String(id) && i._tipo === tipo)
        if (!item) return
        if (tipo === 'artigo')         openArtigo(item)
        else if (tipo === 'avaliacao') openAvaliacao(item)
        else                           openVideoSala(item)
      }
      continueCard.innerHTML = `
        <div class="home-continue-thumb">
          ${thumb
            ? `<img src="${escHtml(thumb)}" alt="${escHtml(title)}" loading="lazy">`
            : `<span class="material-symbols-outlined icon-filled" style="font-size:2.5rem;color:var(--primary)">${isArtigo ? 'article' : isVideo ? 'play_circle' : 'quiz'}</span>`}
        </div>
        <div class="home-continue-info">
          <span class="badge badge-progress">${isArtigo ? 'Artigo' : isVideo ? 'Vídeo' : 'Avaliação'}</span>
          <p class="home-continue-title">${escHtml(title)}</p>
          ${desc ? `<p class="home-continue-desc">${escHtml(desc)}</p>` : ''}
        </div>
        <button class="btn-primary home-continue-btn" onclick="window._openHomeItem('${startedItem.id}','${startedItem._tipo}')">
          <span class="material-symbols-outlined" style="font-size:1rem">${isArtigo ? 'menu_book' : isVideo ? 'play_arrow' : 'quiz'}</span>
          ${isArtigo ? 'Ler' : isVideo ? 'Assistir' : 'Fazer Avaliação'}
        </button>`
    } else {
      continueWrap.style.display = 'none'
    }
  }

  // --- Trilhas mini-cards ---
  const trilhasGrid = document.getElementById('homeTrilhasGrid')
  if (trilhasGrid) {
    const trilhasMap = {}
    for (const v of allVideos) {
      const key = v.categoria?.trim() || v.topics?.trim() || v.title
      if (!trilhasMap[key]) trilhasMap[key] = []
      trilhasMap[key].push({ ...v, _tipo: 'video' })
    }
    for (const a of allArtigos) {
      const key = a.categoria?.trim() || a.topics?.trim()
      if (!key) continue
      if (!trilhasMap[key]) trilhasMap[key] = []
      trilhasMap[key].push({ ...a, _tipo: 'artigo' })
    }
    for (const a of allAvaliacoes) {
      const key = a.categoria?.trim() || a.topics?.trim()
      if (!key) continue
      if (!trilhasMap[key]) trilhasMap[key] = []
      trilhasMap[key].push({ ...a, _tipo: 'avaliacao' })
    }
    trilhasGrid.innerHTML = ''
    const trilhasEntries = Object.entries(trilhasMap)
    trilhasEntries.forEach(([trilha, itens], idx) => {
      const done  = itens.filter(i => {
        if (i._tipo === 'artigo')    return getArtigoProgress(i.id) === 'completed'
        if (i._tipo === 'avaliacao') return getAvaliacaoProgress(i.id) === 'completed'
        return getVideoProgress(i.id) === 'completed'
      }).length
      const total = itens.length
      const pctT  = total ? Math.round((done / total) * 100) : 0
      const icon      = pctT === 100 ? 'emoji_events' : pctT > 0 ? 'rocket_launch' : 'play_lesson'
      const trilhaInfo = trilhaInfoMap[trilha.trim().toLowerCase()]
      const card  = document.createElement('div')
      card.className = 'home-trilha-card surface-card'
      card.style.cursor = 'pointer'
      card.style.overflow = 'hidden'
      card.style.padding = '0'
      card.innerHTML = trilhaInfo?.imagem_url ? `
        <img src="${trilhaInfo.imagem_url}" style="width:100%;height:110px;object-fit:cover;display:block;border-radius:var(--radius) var(--radius) 0 0">
        <div style="padding:0.6rem 0.75rem">
          <p class="home-trilha-name" style="margin:0 0 0.35rem">${escHtml(trilha)}</p>
          <div class="progress-bar">
            <div class="progress-fill${pctT === 100 ? ' done' : ''}" style="width:${pctT}%"></div>
          </div>
          <small style="color:var(--text-secondary)">${done}/${total} item${total !== 1 ? 's' : ''}</small>
        </div>` : `
        <div style="padding:0.75rem">
          <div class="home-trilha-icon">
            <span class="material-symbols-outlined icon-filled" style="color:var(--primary)">${icon}</span>
          </div>
          <p class="home-trilha-name">${escHtml(trilha)}</p>
          <div class="progress-bar" style="margin-top:0.375rem">
            <div class="progress-fill${pctT === 100 ? ' done' : ''}" style="width:${pctT}%"></div>
          </div>
          <small style="color:var(--text-secondary)">${done}/${total} item${total !== 1 ? 's' : ''}</small>
        </div>`

      card.addEventListener('click', async () => {
        // Verifica se a trilha anterior foi concluída
        if (idx > 0) {
          const [prevNome, prevItens] = trilhasEntries[idx - 1]
          const prevDone = prevItens.filter(i => {
            if (i._tipo === 'artigo')    return getArtigoProgress(i.id) === 'completed'
            if (i._tipo === 'avaliacao') return getAvaliacaoProgress(i.id) === 'completed'
            return getVideoProgress(i.id) === 'completed'
          }).length
          if (prevDone < prevItens.length) {
            showToast(`⚠️ Conclua "${prevNome}" antes de continuar.`, 'warning')
            return
          }
        }
        // Abre o primeiro item não concluído (ou o primeiro, se todos concluídos)
        const nextItem = itens.find(i => {
          if (i._tipo === 'artigo')    return getArtigoProgress(i.id) !== 'completed'
          if (i._tipo === 'avaliacao') return getAvaliacaoProgress(i.id) !== 'completed'
          return getVideoProgress(i.id) !== 'completed'
        }) || itens[0]

        if (nextItem._tipo === 'video') {
          openVideoSala(nextItem)
        } else if (nextItem._tipo === 'artigo') {
          const { data } = await supabase.from('artigos').select('*').eq('id', nextItem.id).single()
          if (data) openArtigo(data)
        } else if (nextItem._tipo === 'avaliacao') {
          const { data } = await supabase.from('avaliacoes').select('*').eq('id', nextItem.id).single()
          if (data) openAvaliacao(data)
        }
      })

      trilhasGrid.appendChild(card)
    })
  }

  // --- Ranking top 5 ---
  const rankingEl = document.getElementById('homeRanking')
  if (rankingEl) {
    rankingEl.innerHTML = '<div style="padding:1rem;text-align:center"><span class="material-symbols-outlined" style="animation:spin 1s linear infinite;color:var(--primary)">progress_activity</span></div>'
    const { data: rankData } = await supabase.from('v_desempenho_usuario_trilha').select('user_id, nota_pct')
    if (rankData?.length) {
      const agg = {}
      for (const r of rankData) {
        // null = trilha não iniciada (fora da média); 0 = nota real, conta
        if (r.nota_pct === null || r.nota_pct === undefined) continue
        const pct = Number(r.nota_pct)
        if (!agg[r.user_id]) agg[r.user_id] = { sum: 0, count: 0 }
        agg[r.user_id].sum   += pct
        agg[r.user_id].count += 1
      }
      const sorted = Object.entries(agg)
        .map(([uid, { sum, count }]) => ({ uid, avg: Math.round(sum / count) }))
        .sort((a, b) => b.avg - a.avg).slice(0, 5)

      const { data: usersData } = await supabase.from('users').select('id, name, email').in('id', sorted.map(s => s.uid))
      const uMap = {}
      for (const u of (usersData || [])) uMap[u.id] = u.name || u.email?.split('@')[0] || '—'

      const medals = ['🥇', '🥈', '🥉', '4', '5']
      rankingEl.innerHTML = sorted.map((s, i) => `
        <div class="home-rank-row${currentUser && s.uid === currentUser.id ? ' home-rank-me' : ''}">
          <span class="home-rank-num">${medals[i]}</span>
          <span class="home-rank-name">${escHtml(uMap[s.uid] || '—')}</span>
          <span class="home-rank-nota">${s.avg}%</span>
        </div>`).join('')
    } else {
      rankingEl.innerHTML = '<p style="padding:1rem;color:var(--text-secondary);font-size:0.875rem">Sem dados de ranking ainda.</p>'
    }
  }

  } catch (err) {
    console.error('[loadHome] erro:', err)
    const rankingEl = document.getElementById('homeRanking')
    if (rankingEl) rankingEl.innerHTML = '<p style="padding:1rem;color:var(--text-secondary);font-size:0.875rem">Erro ao carregar dados.</p>'
  }
}

// ============================================
// CERTIFICADO — gerado pelo admin
// ============================================
async function gerarCertificado(userId, userName) {
  const nome = userName || 'Colaborador'
  const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })

  // Dados via views (a tabela respostas tem RLS e não é visível pro admin)
  const [
    { data: trilhasDb },
    { data: conteudo },
    { data: videosDb },
    { data: avaliacoesDb },
    { data: desempenho },
    { data: notasAv }
  ] = await Promise.all([
    supabase.from('trilhas').select('id, nome').eq('visivel', true).order('ordem', { ascending: true }),
    supabase.from('trilha_conteudo').select('trilha_id, item_id, tipo').order('ordem', { ascending: true }),
    supabase.from('videos').select('id, title'),
    supabase.from('avaliacoes').select('id, titulo'),
    supabase.from('v_desempenho_usuario_trilha').select('video_id, nota_pct').eq('user_id', userId),
    supabase.from('v_desempenho_usuario_avaliacao').select('avaliacao_id, nota_pct').eq('user_id', userId)
  ])

  const vidTitle = {}
  for (const v of (videosDb || [])) vidTitle[String(v.id)] = v.title
  const avTitle = {}
  for (const a of (avaliacoesDb || [])) avTitle[String(a.id)] = a.titulo
  const notaVid = {}
  for (const r of (desempenho || [])) if (r.nota_pct !== null && r.nota_pct !== undefined) notaVid[String(r.video_id)] = Math.round(Number(r.nota_pct))
  const notaAvMap = {}
  for (const r of (notasAv || [])) if (r.nota_pct !== null && r.nota_pct !== undefined) notaAvMap[String(r.avaliacao_id)] = Math.round(Number(r.nota_pct))

  // Para cada trilha, separa o que o colaborador concluiu:
  // pós-teste (nota oficial), quizzes dos vídeos e pré-testes
  const trilhasHtml = (trilhasDb || []).map(t => {
    const itens = (conteudo || []).filter(c => String(c.trilha_id) === String(t.id))
    const pre = [], quizzes = [], pos = []
    for (const c of itens) {
      const id = String(c.item_id)
      if (c.tipo === 'video' && notaVid[id] !== undefined) {
        quizzes.push({ titulo: vidTitle[id] || 'Vídeo', nota: notaVid[id] })
      } else if (c.tipo === 'avaliacao' && notaAvMap[id] !== undefined) {
        const titulo = avTitle[id] || 'Avaliação'
        const ehPre = /pr[eé]\s*-?\s*teste|\bpr[eé]\b/i.test(titulo)
        ;(ehPre ? pre : pos).push({ titulo, nota: notaAvMap[id] })
      }
    }
    if (!pre.length && !quizzes.length && !pos.length) return ''

    const grupoHtml = (label, arr, cls) => arr.length
      ? `<div class="grp"><span class="grp-lbl">${label}</span><div class="chips">${arr.map(i =>
          `<span class="chip ${cls}">✓ ${escHtml(i.titulo)} — ${i.nota}%</span>`).join('')}</div></div>`
      : ''

    const notaFinal = pos.length ? Math.round(pos.reduce((s, i) => s + i.nota, 0) / pos.length) : null

    return `<div class="trilha-box">
      <div class="trilha-nome">📚 Trilha: ${escHtml(t.nome)}${notaFinal !== null ? ` <span class="trilha-media">Nota final (pós-teste): ${notaFinal}%</span>` : ''}</div>
      ${grupoHtml('Pós-teste', pos, 'chip-pos')}
      ${grupoHtml('Quizzes dos vídeos', quizzes, '')}
      ${grupoHtml('Pré-testes', pre, 'chip-av')}
    </div>`
  }).filter(Boolean).join('')

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Certificado — ${escHtml(nome)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
@page{size:A4 landscape;margin:0}
body{font-family:'Georgia','Times New Roman',serif;width:297mm;height:210mm;overflow:hidden;background:#fff;display:flex}
.side{width:48px;background:linear-gradient(180deg,#4f46e5 0%,#7c3aed 55%,#f59e0b 100%);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.side-text{color:rgba(255,255,255,0.6);font-size:0.5rem;letter-spacing:0.22em;text-transform:uppercase;writing-mode:vertical-rl;transform:rotate(180deg);font-family:'Segoe UI',Arial,sans-serif}
.main{flex:1;display:flex;flex-direction:column}
.top-bar{height:6px;background:linear-gradient(90deg,#4f46e5,#7c3aed,#f59e0b)}
.hdr{padding:14px 40px 13px;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #ede9fe;background:#faf9ff}
.hdr-tag{font-size:0.62rem;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#7c3aed;font-family:'Segoe UI',Arial,sans-serif}
.hdr-hospital{font-size:1rem;font-weight:700;color:#1a1a2e;margin-top:2px;font-family:'Georgia',serif}
.hdr-right{display:flex;align-items:center;gap:10px}
.hdr-icon{font-size:2.4rem;line-height:1}
.hdr-badge{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-size:0.58rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:4px 12px;border-radius:20px;font-family:'Segoe UI',Arial,sans-serif;white-space:nowrap}
.body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:space-evenly;padding:16px 52px 12px;text-align:center}
.cert-top{display:flex;flex-direction:column;align-items:center;gap:4px}
.lbl{font-size:0.68rem;color:#9ca3af;letter-spacing:0.16em;text-transform:uppercase;font-family:'Segoe UI',Arial,sans-serif}
.name{font-size:2.6rem;font-weight:700;color:#1a1a2e;font-family:'Georgia',serif;line-height:1.15}
.deco{display:flex;align-items:center;gap:10px;margin:0 auto}
.deco-line{flex:1;height:1.5px;background:linear-gradient(90deg,transparent,#c4b5fd)}
.deco-star{font-size:1rem;color:#7c3aed}
.deco-line.r{background:linear-gradient(90deg,#c4b5fd,transparent)}
.stmt{font-size:0.9rem;color:#374151;line-height:1.8;max-width:500px;font-family:'Segoe UI',Arial,sans-serif}
.chips{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
.chip{background:#ede9fe;color:#5b21b6;border-radius:20px;padding:4px 14px;font-size:0.68rem;font-weight:600;font-family:'Segoe UI',Arial,sans-serif;border:1px solid #c4b5fd}
.chip-av{background:#fef3c7;color:#92400e;border-color:#fcd34d}
.chip-pos{background:#d1fae5;color:#065f46;border-color:#6ee7b7;font-size:0.74rem}
.trilha-box{display:flex;flex-direction:column;gap:7px;max-width:660px}
.trilha-nome{font-size:0.85rem;font-weight:700;color:#1a1a2e;font-family:'Segoe UI',Arial,sans-serif}
.trilha-media{display:inline-block;margin-left:6px;background:#d1fae5;color:#065f46;border-radius:20px;padding:2px 12px;font-size:0.68rem;font-weight:800;border:1px solid #6ee7b7}
.grp{display:flex;align-items:center;gap:8px;justify-content:center;flex-wrap:wrap}
.grp-lbl{font-size:0.56rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#9ca3af;font-family:'Segoe UI',Arial,sans-serif;flex-shrink:0}
.ftr{padding:10px 40px 12px;display:flex;align-items:flex-end;justify-content:space-between;border-top:1.5px solid #e5e7eb;background:#faf9ff}
.sig{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:155px}
.sig-line{width:155px;border-top:1px solid #6b7280;margin-bottom:3px}
.sig-name{font-size:0.68rem;font-weight:700;color:#1f2937;font-family:'Segoe UI',Arial,sans-serif}
.sig-role{font-size:0.58rem;color:#9ca3af;letter-spacing:0.08em;text-transform:uppercase;font-family:'Segoe UI',Arial,sans-serif}
.ftr-mid{text-align:center}
.ftr-date{font-size:0.72rem;color:#4b5563;font-family:'Segoe UI',Arial,sans-serif;font-weight:600}
.ftr-city{font-size:0.6rem;color:#9ca3af;font-family:'Segoe UI',Arial,sans-serif;margin-top:2px}
.bot-bar{height:6px;background:linear-gradient(90deg,#f59e0b,#7c3aed,#4f46e5)}
</style>
</head>
<body>
<div class="side"><span class="side-text">Hospital Infantil Dr. Juvêncio Mattos</span></div>
<div class="main">
  <div class="top-bar"></div>
  <div class="hdr">
    <div>
      <div class="hdr-tag">Plataforma EduJuju &nbsp;·&nbsp; Certificado de Conclusão</div>
      <div class="hdr-hospital">Hospital Infantil Dr. Juvêncio Mattos</div>
    </div>
    <div class="hdr-right">
      <span class="hdr-badge">Certificado Oficial</span>
      <div class="hdr-icon">🎓</div>
    </div>
  </div>
  <div class="body">
    <div class="cert-top">
      <div class="lbl">Certificamos com honra que</div>
      <div class="name">${escHtml(nome)}</div>
    </div>
    <div class="deco" style="width:320px">
      <div class="deco-line"></div>
      <span class="deco-star">✦</span>
      <div class="deco-line r"></div>
    </div>
    <p class="stmt">concluiu com êxito o programa de trilhas de aprendizado da plataforma EduJuju, demonstrando dedicação ao desenvolvimento profissional e à excelência no cuidado prestado.</p>
    ${trilhasHtml || ''}
  </div>
  <div class="ftr">
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-name">Coordenação Pedagógica</div>
      <div class="sig-role">Assinatura</div>
    </div>
    <div class="ftr-mid">
      <div class="ftr-date">${hoje}</div>
      <div class="ftr-city">São Luís — Maranhão</div>
      <div style="font-size:0.52rem;color:#c4b5fd;font-family:'Segoe UI',Arial,sans-serif;margin-top:4px;letter-spacing:0.08em">Cód. ${userId.slice(0,8).toUpperCase()}</div>
    </div>
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-name">Diretoria do Hospital</div>
      <div class="sig-role">Assinatura</div>
    </div>
  </div>
  <div class="bot-bar"></div>
</div>
</body>
</html>`

  const win = window.open('', '_blank', 'width=1100,height=800')
  if (!win) { alert('Por favor, permita popups para gerar o certificado.'); return }
  win.document.write(html)
  win.document.close()
  win.onload = () => setTimeout(() => win.print(), 600)
}
window.gerarCertificado = gerarCertificado

function toggleCertAccordion() {
  const body = document.getElementById('certAccordionBody')
  const icon = document.getElementById('certAccordionIcon')
  const isOpen = body.style.display === 'flex'
  body.style.display = isOpen ? 'none' : 'flex'
  icon.textContent = isOpen ? 'expand_more' : 'expand_less'
  if (!isOpen) loadAdminCertificados()
}
window.toggleCertAccordion = toggleCertAccordion

function toggleAcessoAccordion() {
  const body = document.getElementById('acessoAccordionBody')
  const icon = document.getElementById('acessoAccordionIcon')
  const isOpen = body.style.display === 'flex'
  body.style.display = isOpen ? 'none' : 'flex'
  icon.textContent = isOpen ? 'expand_more' : 'expand_less'
  if (!isOpen) loadAdminAcessos()
}
window.toggleAcessoAccordion = toggleAcessoAccordion

async function loadAdminAcessos() {
  const listEl = document.getElementById('adminAcessoList')
  if (!listEl) return
  listEl.innerHTML = '<div class="list-empty"><p>Carregando...</p></div>'

  const [{ data: acessos }, { data: users }] = await Promise.all([
    supabase.from('registro_acesso').select('user_id, entrou_em').order('entrou_em', { ascending: false }).limit(300),
    supabase.from('users').select('id, name, email, sector')
  ])

  if (!acessos?.length) {
    listEl.innerHTML = '<div class="list-empty"><p>Nenhum acesso registrado ainda.</p></div>'
    return
  }

  const userMap = {}
  for (const u of (users || [])) userMap[u.id] = u

  const rows = acessos.map(a => {
    const u = userMap[a.user_id] || {}
    const nome = u.name || u.email?.split('@')[0] || '—'
    const email = u.email || '—'
    const setor = u.sector || '—'
    const data = new Date(a.entrou_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    return `<tr>
      <td style="padding:0.5rem 0.75rem;font-weight:600;color:var(--on-surface)">${escHtml(nome)}</td>
      <td style="padding:0.5rem 0.75rem;color:var(--text-secondary);font-size:0.82rem">${escHtml(email)}</td>
      <td style="padding:0.5rem 0.75rem;color:var(--text-secondary);font-size:0.82rem">${escHtml(setor)}</td>
      <td style="padding:0.5rem 0.75rem;color:var(--text-secondary);font-size:0.82rem;white-space:nowrap">${data}</td>
    </tr>`
  }).join('')

  listEl.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.875rem">
        <thead>
          <tr style="border-bottom:2px solid var(--outline-var);text-align:left">
            <th style="padding:0.5rem 0.75rem;color:var(--text-secondary);font-weight:600;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em">Nome</th>
            <th style="padding:0.5rem 0.75rem;color:var(--text-secondary);font-weight:600;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em">Email</th>
            <th style="padding:0.5rem 0.75rem;color:var(--text-secondary);font-weight:600;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em">Setor</th>
            <th style="padding:0.5rem 0.75rem;color:var(--text-secondary);font-weight:600;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em">Entrou em</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    <p style="text-align:right;font-size:0.75rem;color:var(--text-secondary);margin-top:0.5rem">${acessos.length} registro${acessos.length !== 1 ? 's' : ''} (últimos 300)</p>`
}
window.loadAdminAcessos = loadAdminAcessos

// ─────────────────────────────────────────────
// ZERAR PROGRESSO DE USUÁRIO (admin)
// ─────────────────────────────────────────────
let _resetUsersCache = null

function toggleResetProgresso() {
  const body = document.getElementById('resetProgressoBody')
  const icon = document.getElementById('resetProgressoIcon')
  const isOpen = body.style.display === 'flex'
  body.style.display = isOpen ? 'none' : 'flex'
  icon.textContent = isOpen ? 'expand_more' : 'expand_less'
  if (!isOpen) loadResetUsers()
}
window.toggleResetProgresso = toggleResetProgresso

async function loadResetUsers() {
  const listEl = document.getElementById('resetUserList')
  if (!listEl) return
  if (!_resetUsersCache) {
    const { data } = await supabase.from('users').select('id, name, email, sector').order('name', { ascending: true })
    _resetUsersCache = data || []
  }
  renderResetUsers()
}

function renderResetUsers() {
  const listEl = document.getElementById('resetUserList')
  if (!listEl) return
  const termo = (document.getElementById('resetUserSearch')?.value || '').trim().toLowerCase()
  const users = (_resetUsersCache || []).filter(u =>
    !termo || (u.name || '').toLowerCase().includes(termo) || (u.email || '').toLowerCase().includes(termo)
  )
  if (!users.length) {
    listEl.innerHTML = '<p style="font-size:0.8rem;color:var(--text-secondary)">Nenhum usuário encontrado.</p>'
    return
  }
  listEl.innerHTML = users.slice(0, 30).map(u => `
    <div class="admin-list-item" style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;padding:0.6rem 0.75rem">
      <div style="min-width:0">
        <div style="font-weight:600;font-size:0.85rem;color:var(--on-surface);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(u.name || u.email || '—')}</div>
        <div style="font-size:0.72rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(u.email || '')}${u.sector ? ' · ' + escHtml(u.sector) : ''}</div>
      </div>
      <button onclick="resetProgressoDe('${u.id}', '${escHtml((u.name || u.email || '').replace(/['"\\\\]/g, ''))}')"
        style="flex-shrink:0;display:inline-flex;align-items:center;gap:0.3rem;padding:0.35rem 0.75rem;border:1px solid #c62828;border-radius:var(--radius);background:transparent;color:#c62828;font-size:0.75rem;font-weight:600;cursor:pointer">
        <span class="material-symbols-outlined" style="font-size:1rem">restart_alt</span>
        Zerar
      </button>
    </div>`).join('')
  if (users.length > 30) {
    listEl.innerHTML += `<p style="font-size:0.72rem;color:var(--text-secondary);text-align:right;margin-top:0.5rem">Mostrando 30 de ${users.length} — refine a busca.</p>`
  }
}

document.getElementById('resetUserSearch')?.addEventListener('input', renderResetUsers)

async function resetProgressoDe(userId, nome) {
  if (!confirm(`Zerar todo o progresso de "${nome}"?\n\nIsso apaga respostas de quiz, notas de avaliações e vídeos/artigos concluídos. Esta ação não pode ser desfeita.`)) return
  const { data, error } = await supabase.rpc('reset_progresso_usuario', { alvo: userId })
  if (error) {
    alert('Erro ao zerar progresso: ' + error.message)
    return
  }
  logAudit('progresso_zerado', nome, data || {})
  alert(`Progresso de "${nome}" zerado com sucesso!\n\nRespostas apagadas: ${data?.respostas ?? 0}\nProgresso apagado: ${data?.progresso ?? 0}\n\nPeça para o usuário sair e entrar novamente no app.`)
}
window.resetProgressoDe = resetProgressoDe

async function trocarSenhaUsuario() {
  const emailEl = document.getElementById('trocaSenhaEmail')
  const senhaEl = document.getElementById('trocaSenhaNova')
  const msgEl   = document.getElementById('trocaSenhaMsg')
  const email   = (emailEl?.value || '').trim()
  const senha   = (senhaEl?.value || '').trim()

  const showMsg = (texto, ok) => {
    if (!msgEl) return
    msgEl.textContent = texto
    msgEl.style.color = ok ? 'var(--success)' : '#c62828'
    msgEl.style.display = ''
  }

  if (!email)            { showMsg('Informe o email do usuário.', false); return }
  if (senha.length < 6)  { showMsg('A nova senha deve ter no mínimo 6 caracteres.', false); return }

  const { data: alvo } = await supabase
    .from('users').select('id, name, email')
    .ilike('email', email)
    .maybeSingle()

  if (!alvo) { showMsg('Nenhum usuário encontrado com esse email.', false); return }

  const nome = alvo.name || alvo.email
  if (!confirm(`Trocar a senha de "${nome}" (${alvo.email})?\n\nNova senha: ${senha}`)) return

  const btn = document.getElementById('btnTrocarSenha')
  if (btn) btn.disabled = true
  const { error } = await supabase.rpc('trocar_senha_usuario', { alvo: alvo.id, nova_senha: senha })
  if (btn) btn.disabled = false

  if (error) { showMsg('Erro ao trocar a senha: ' + error.message, false); return }

  logAudit('senha_trocada', nome)
  showMsg(`Senha de "${nome}" trocada com sucesso! Informe a nova senha ao usuário.`, true)
  if (emailEl) emailEl.value = ''
  if (senhaEl) senhaEl.value = ''
}
window.trocarSenhaUsuario = trocarSenhaUsuario

async function gerarPdfHistoricoLogin() {
  const btn = document.getElementById('btnPdfLogin')
  btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1.1rem;animation:spin 1s linear infinite">progress_activity</span> Gerando...'
  btn.disabled = true

  try {
    const [{ data: acessos }, { data: users }] = await Promise.all([
      supabase.from('registro_acesso').select('user_id, entrou_em').order('entrou_em', { ascending: false }),
      supabase.from('users').select('id, name, email, sector').order('name', { ascending: true })
    ])

    // Acessos agrupados por user_id
    const acessosPorUser = {}
    for (const a of (acessos || [])) {
      if (!acessosPorUser[a.user_id]) acessosPorUser[a.user_id] = []
      acessosPorUser[a.user_id].push(a.entrou_em)
    }

    const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
    const totalRegistros = (acessos || []).length

    // Uma linha por usuário: nome, email, setor, total de acessos, último acesso
    const rows = (users || []).map((u, i) => {
      const logins = acessosPorUser[u.id] || []
      const totalAcessos = logins.length
      const ultimoAcesso = totalAcessos
        ? new Date(logins[0]).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '—'
      const bg = i % 2 === 0 ? '#fff' : '#f8f7ff'
      const corTotal = totalAcessos > 0 ? '#1a1a2e' : '#9ca3af'
      return `<tr style="background:${bg}">
        <td style="padding:7px 12px;border-bottom:1px solid #ede9fe">${i + 1}</td>
        <td style="padding:7px 12px;border-bottom:1px solid #ede9fe;font-weight:600">${escHtml(u.name || '—')}</td>
        <td style="padding:7px 12px;border-bottom:1px solid #ede9fe;color:#555">${escHtml(u.email || '—')}</td>
        <td style="padding:7px 12px;border-bottom:1px solid #ede9fe;color:#555">${escHtml(u.sector || '—')}</td>
        <td style="padding:7px 12px;border-bottom:1px solid #ede9fe;color:${corTotal};text-align:center;font-weight:600">${totalAcessos}</td>
        <td style="padding:7px 12px;border-bottom:1px solid #ede9fe;color:#555;white-space:nowrap">${ultimoAcesso}</td>
      </tr>`
    }).join('')

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Histórico de Login — EduJuju</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box }
  @page { size: A4; margin: 20mm 15mm }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a2e }
  .header { display:flex; justify-content:space-between; align-items:flex-end; padding-bottom:12px; border-bottom:3px solid #4f46e5; margin-bottom:16px }
  .header-title { font-size:18px; font-weight:700; color:#4f46e5 }
  .header-sub { font-size:11px; color:#6b7280; margin-top:3px }
  .header-date { font-size:11px; color:#6b7280; text-align:right }
  table { width:100%; border-collapse:collapse }
  thead { background:#4f46e5; color:#fff }
  th { padding:8px 12px; text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:0.05em }
  .footer { margin-top:16px; text-align:center; font-size:9px; color:#9ca3af; border-top:1px solid #e5e7eb; padding-top:8px }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="header-title">Histórico de Acesso — EduJuju</div>
      <div class="header-sub">Hospital Infantil Dr. Juvêncio Mattos</div>
    </div>
    <div class="header-date">Gerado em ${hoje}<br>${(users || []).length} usuários · ${totalRegistros} acessos registrados</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Nome</th>
        <th>Email</th>
        <th>Setor</th>
        <th style="text-align:center">Acessos</th>
        <th>Último acesso</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">Gerado automaticamente pelo sistema EduJuju — ${hoje}</div>
<script>window.onload = () => { setTimeout(() => window.print(), 400) }<\/script>
</body>
</html>`

    const win = window.open('', '_blank', 'width=900,height=700,scrollbars=yes')
    if (!win) { alert('Permita pop-ups para gerar o PDF.'); return }
    win.document.write(html)
    win.document.close()
  } finally {
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1.1rem">picture_as_pdf</span> Gerar PDF — Histórico de Login'
    btn.disabled = false
  }
}
window.gerarPdfHistoricoLogin  = gerarPdfHistoricoLogin
window.printRespondeuTable     = printRespondeuTable

let _certUsers = null

async function loadAdminCertificados() {
  const listEl = document.getElementById('adminCertList')
  if (!listEl) return
  listEl.innerHTML = '<div class="list-empty"><p>Carregando...</p></div>'

  const [{ data: users }, { data: desempenho }, { data: notasAv }, { data: avaliacoesVis }, { data: questoesVid }] = await Promise.all([
    supabase.from('users').select('id, name, email, sector').order('name', { ascending: true }),
    supabase.from('v_desempenho_usuario_trilha').select('user_id, video_id, nota_pct'),
    supabase.from('v_desempenho_usuario_avaliacao').select('user_id, avaliacao_id'),
    supabase.from('avaliacoes').select('id').eq('visivel', true),
    supabase.from('questoes_sala_de_aula').select('video_id')
  ])

  // Vídeos que possuem quiz
  const videosComQuiz = [...new Set((questoesVid || []).map(q => String(q.video_id)))]

  // Quizzes concluídos (nota fechada) por usuário
  const quizOk = {}
  for (const r of (desempenho || [])) {
    if (r.nota_pct === null || r.nota_pct === undefined) continue
    if (!quizOk[r.user_id]) quizOk[r.user_id] = new Set()
    quizOk[r.user_id].add(String(r.video_id))
  }

  // Avaliações concluídas por usuário
  const avOk = {}
  for (const r of (notasAv || [])) {
    if (!avOk[r.user_id]) avOk[r.user_id] = new Set()
    avOk[r.user_id].add(String(r.avaliacao_id))
  }
  const avIds = (avaliacoesVis || []).map(a => String(a.id))

  // Só pode gerar certificado quem concluiu TUDO:
  // todos os quizzes dos vídeos + todas as avaliações visíveis.
  // Sem nenhum quiz/avaliação cadastrado não há critério — ninguém é concluinte.
  const temCriterio = videosComQuiz.length > 0 || avIds.length > 0
  const concluiuTudo = uid =>
    temCriterio &&
    videosComQuiz.every(v => quizOk[uid]?.has(v)) &&
    avIds.every(a => avOk[uid]?.has(a))

  _certUsers = (users || []).filter(u => concluiuTudo(u.id))
  renderCertList()
}

function renderCertList() {
  const listEl = document.getElementById('adminCertList')
  if (!listEl) return
  const termo = (document.getElementById('certUserSearch')?.value || '').trim().toLowerCase()
  const lista = (_certUsers || []).filter(u =>
    !termo || (u.name || '').toLowerCase().includes(termo) || (u.email || '').toLowerCase().includes(termo)
  )

  if (!lista.length) {
    listEl.innerHTML = `<div class="list-empty"><p>${termo ? 'Ninguém encontrado com esse nome.' : 'Ninguém concluiu todo o conteúdo ainda — o certificado libera quando o colaborador termina todos os quizzes e avaliações.'}</p></div>`
    return
  }

  listEl.innerHTML = ''
  for (const u of lista) {
    const nome = u.name?.trim() || u.email?.split('@')[0] || 'Usuário'
    const div = document.createElement('div')
    div.style.cssText = 'display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0.75rem;border:1px solid var(--outline-var);border-radius:var(--r-md);background:var(--surface-low);margin-bottom:0.375rem'
    const info = document.createElement('div')
    info.style.cssText = 'flex:1;min-width:0'
    info.innerHTML = `<div style="font-size:0.85rem;font-weight:600;color:var(--on-surface);word-break:break-word;line-height:1.2">${escHtml(nome)}</div>${u.sector ? `<div style="font-size:0.72rem;color:var(--on-surface-var);margin-top:1px">${escHtml(u.sector)}</div>` : ''}`
    const btn = document.createElement('button')
    btn.title = 'Gerar Certificado'
    btn.style.cssText = 'display:flex;align-items:center;justify-content:center;background:none;border:1px solid var(--outline-var);border-radius:6px;padding:0.3rem;cursor:pointer;flex-shrink:0;color:var(--primary);transition:background 0.15s'
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1.1rem">workspace_premium</span>'
    btn.addEventListener('mouseover', () => btn.style.background = 'var(--surface-mid)')
    btn.addEventListener('mouseout', () => btn.style.background = 'none')
    btn.addEventListener('click', () => gerarCertificado(u.id, nome))
    div.appendChild(info)
    div.appendChild(btn)
    listEl.appendChild(div)
  }
}

document.getElementById('certUserSearch')?.addEventListener('input', renderCertList)

// ============================================
// SUPER — LOG DE AUDITORIA
// ============================================
const AUDIT_ICONS = {
  login:               { icon: 'login',        cor: '#1565c0', label: 'Login' },
  video_concluido:     { icon: 'play_circle',  cor: '#2e7d32', label: 'Vídeo concluído' },
  artigo_lido:         { icon: 'article',      cor: '#6a1b9a', label: 'Artigo lido' },
  avaliacao_concluida: { icon: 'assignment',   cor: '#e65100', label: 'Avaliação concluída' },
}

function toggleAuditLog() {
  const body = document.getElementById('auditLogBody')
  const icon = document.getElementById('auditLogIcon')
  const isOpen = body.style.display !== 'none'
  body.style.display = isOpen ? 'none' : 'block'
  icon.textContent = isOpen ? 'expand_more' : 'expand_less'
}
window.toggleAuditLog = toggleAuditLog

async function loadAuditLog() {
  const listEl = document.getElementById('auditLogList')
  if (!listEl) return
  listEl.innerHTML = '<p style="font-size:0.8rem;color:var(--text-secondary)">Carregando...</p>'

  const filtroUsuario = document.getElementById('auditFiltroUsuario')?.value.trim().toLowerCase() || ''
  const filtroAcao    = document.getElementById('auditFiltroAcao')?.value || ''

  let query = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200)
  if (filtroAcao) query = query.eq('acao', filtroAcao)

  const { data: logs, error } = await query
  if (error) { listEl.innerHTML = `<p style="color:var(--error);font-size:0.8rem">Erro: ${error.message}</p>`; return }
  if (!logs?.length) { listEl.innerHTML = '<p style="font-size:0.8rem;color:var(--text-secondary)">Nenhum registro encontrado.</p>'; return }

  const filtered = filtroUsuario
    ? logs.filter(l => (l.user_name || '').toLowerCase().includes(filtroUsuario))
    : logs

  if (!filtered.length) { listEl.innerHTML = '<p style="font-size:0.8rem;color:var(--text-secondary)">Nenhum resultado para este filtro.</p>'; return }

  const rows = filtered.map(l => {
    const meta   = AUDIT_ICONS[l.acao] || { icon: 'info', cor: '#757575', label: l.acao }
    const data   = new Date(l.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const extra  = l.extra?.nota_pct !== undefined ? `<span style="margin-left:0.4rem;padding:0.1rem 0.4rem;border-radius:999px;font-size:0.7rem;font-weight:700;background:${l.extra.nota_pct>=70?'#e8f5e9':'#ffebee'};color:${l.extra.nota_pct>=70?'#2e7d32':'#c62828'}">${l.extra.nota_pct}%</span>` : ''
    return `<tr style="border-bottom:1px solid var(--border)" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background=''">
      <td style="padding:0.5rem 0.75rem;white-space:nowrap">
        <span class="material-symbols-outlined icon-filled" style="font-size:1rem;color:${meta.cor};vertical-align:middle">${meta.icon}</span>
        <span style="font-size:0.75rem;font-weight:600;color:${meta.cor};margin-left:0.25rem">${meta.label}</span>
      </td>
      <td style="padding:0.5rem 0.75rem;font-size:0.82rem;font-weight:600;color:var(--text-primary)">${escHtml(l.user_name || '—')}</td>
      <td style="padding:0.5rem 0.75rem;font-size:0.82rem;color:var(--text-secondary)">${escHtml(l.detalhe || '—')}${extra}</td>
      <td style="padding:0.5rem 0.75rem;font-size:0.75rem;color:var(--text-secondary);white-space:nowrap">${data}</td>
    </tr>`
  }).join('')

  listEl.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.875rem">
        <thead><tr style="border-bottom:2px solid var(--border);text-align:left;background:var(--surface)">
          <th style="padding:0.5rem 0.75rem;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary)">Ação</th>
          <th style="padding:0.5rem 0.75rem;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary)">Aluno</th>
          <th style="padding:0.5rem 0.75rem;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary)">Detalhe</th>
          <th style="padding:0.5rem 0.75rem;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary)">Data/Hora</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p style="text-align:right;font-size:0.72rem;color:var(--text-secondary);margin-top:0.5rem">${filtered.length} registro${filtered.length !== 1 ? 's' : ''}</p>`
}
window.loadAuditLog = loadAuditLog

// ============================================
// ADMIN — TRILHAS
// ============================================
let editingTrilhaId  = null
let _trilhaImagemUrl = null

async function loadAdminTrilhas() {
  const listEl = document.getElementById('trilhasList')
  if (!listEl) return
  listEl.innerHTML = '<div class="list-empty"><p>Carregando...</p></div>'

  const [{ data: trilhasCad }, { data: vids }, { data: arts }, { data: avs }] = await Promise.all([
    supabase.from('trilhas').select('*').order('ordem', { ascending: true }),
    supabase.from('videos').select('categoria').not('categoria', 'is', null),
    supabase.from('artigos').select('categoria').not('categoria', 'is', null),
    supabase.from('avaliacoes').select('categoria').not('categoria', 'is', null)
  ])

  // Categorias existentes nos conteúdos mas ainda não na tabela trilhas
  const nomesCadastrados = new Set((trilhasCad || []).map(t => t.nome.trim().toLowerCase()))
  const catsExistentes = new Set()
  ;[...(vids||[]), ...(arts||[]), ...(avs||[])].forEach(r => r.categoria?.trim() && catsExistentes.add(r.categoria.trim()))
  const naoFormalizadas = Array.from(catsExistentes).filter(c => !nomesCadastrados.has(c.toLowerCase()))

  const total = (trilhasCad?.length || 0) + naoFormalizadas.length
  const countEl = document.getElementById('trilhasCount')
  if (countEl) countEl.textContent = `${total} trilha${total !== 1 ? 's' : ''}`

  listEl.innerHTML = ''

  // Mostra aviso de trilhas não formalizadas
  if (naoFormalizadas.length) {
    const aviso = document.createElement('div')
    aviso.style.cssText = 'background:var(--primary-soft);border-radius:var(--radius);padding:0.75rem 1rem;margin-bottom:0.75rem;font-size:0.82rem;color:var(--primary)'
    aviso.innerHTML = `<strong>${naoFormalizadas.length} trilha${naoFormalizadas.length>1?'s':''} sem cadastro:</strong> ${naoFormalizadas.map(c=>`<span style="font-weight:600">${escHtml(c)}</span>`).join(', ')} — clique em <strong>Nova Trilha</strong> para adicionar imagem e descrição.`
    listEl.appendChild(aviso)
  }

  if (!trilhasCad?.length && !naoFormalizadas.length) {
    listEl.innerHTML = '<div class="list-empty"><span class="material-symbols-outlined">route</span><p>Nenhuma trilha encontrada.</p></div>'
    return
  }

  const data = trilhasCad || []
  data.forEach(t => {
    const div = document.createElement('div')
    div.className = 'artigo-list-item surface-card'
    div.style.display = 'flex'
    div.style.alignItems = 'center'
    div.style.gap = '0.75rem'
    div.style.padding = '0.75rem 1rem'

    const thumb = t.imagem_url
      ? `<img src="${t.imagem_url}" style="width:56px;height:56px;object-fit:cover;border-radius:var(--radius);flex-shrink:0">`
      : `<div style="width:56px;height:56px;border-radius:var(--radius);background:var(--primary-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0"><span class="material-symbols-outlined icon-filled" style="color:var(--primary)">route</span></div>`

    div.innerHTML = `
      ${thumb}
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:0.9rem;color:var(--text-primary)">${escHtml(t.nome)}</div>
        ${t.descricao ? `<div style="font-size:0.78rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.descricao)}</div>` : ''}
        <span style="font-size:0.7rem;padding:0.1rem 0.4rem;border-radius:999px;background:${t.visivel ? 'var(--primary-soft)' : 'var(--surface)'};color:${t.visivel ? 'var(--primary)' : 'var(--text-secondary)'}">${t.visivel ? 'Visível' : 'Oculta'}</span>
      </div>
      <div style="display:flex;gap:0.4rem;flex-shrink:0">
        <button class="btn-icon" onclick="openSequenciaTrilha('${t.id}','${escHtml(t.nome)}')" title="Gerenciar sequência"><span class="material-symbols-outlined">reorder</span></button>
        <button class="btn-icon" onclick="editTrilha(${JSON.stringify(t).replace(/"/g, '&quot;')})" title="Editar"><span class="material-symbols-outlined">edit</span></button>
        <button class="btn-icon" onclick="deleteTrilha('${t.id}','${escHtml(t.nome)}')" title="Excluir" style="color:var(--error)"><span class="material-symbols-outlined">delete</span></button>
      </div>`
    listEl.appendChild(div)
  })
}
window.loadAdminTrilhas = loadAdminTrilhas

async function openTrilhaModal(t = null) {
  editingTrilhaId  = null
  _trilhaImagemUrl = null
  document.getElementById('formTrilha').reset()
  document.getElementById('trilhaError').textContent = ''
  document.getElementById('trilhaImagemPreview').style.display = 'none'
  document.getElementById('trilhaImagemLabelText').textContent = 'Clique para escolher uma imagem'
  document.getElementById('modalTrilhaTitle').textContent  = t ? 'Editar Trilha' : 'Nova Trilha'
  document.getElementById('saveTrilhaBtn').textContent     = t ? 'Salvar Alterações' : 'Salvar Trilha'

  // Carrega categorias existentes nos conteúdos
  const existenteWrap = document.getElementById('trilhaExistenteWrap')
  const existenteSel  = document.getElementById('trilhaExistente')
  if (existenteWrap) existenteWrap.style.display = t ? 'none' : ''
  if (!t && existenteSel) {
    const [{ data: vids }, { data: arts }, { data: avs }, { data: trilhasCad }] = await Promise.all([
      supabase.from('videos').select('categoria').not('categoria', 'is', null),
      supabase.from('artigos').select('categoria').not('categoria', 'is', null),
      supabase.from('avaliacoes').select('categoria').not('categoria', 'is', null),
      supabase.from('trilhas').select('nome')
    ])
    const jasCadastradas = new Set((trilhasCad || []).map(t => t.nome.trim().toLowerCase()))
    const cats = new Set()
    ;[...(vids||[]), ...(arts||[]), ...(avs||[])].forEach(r => r.categoria?.trim() && cats.add(r.categoria.trim()))
    const novas = Array.from(cats).filter(c => !jasCadastradas.has(c.toLowerCase())).sort()
    existenteSel.innerHTML = '<option value="">-- Selecionar trilha existente --</option>' +
      novas.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')
    existenteSel.onchange = () => {
      if (existenteSel.value) document.getElementById('trilhaNome').value = existenteSel.value
    }
  }

  if (t) {
    editingTrilhaId  = t.id
    _trilhaImagemUrl = t.imagem_url || null
    document.getElementById('trilhaNome').value      = t.nome || ''
    document.getElementById('trilhaDescricao').value = t.descricao || ''
    document.getElementById('trilhaVisivel').checked = t.visivel !== false
    if (t.imagem_url) {
      const preview = document.getElementById('trilhaImagemPreview')
      preview.src = t.imagem_url; preview.style.display = ''
      document.getElementById('trilhaImagemLabelText').textContent = 'Imagem atual (clique para trocar)'
    }
  }
  document.getElementById('modalTrilha').classList.add('open')
}

function closeTrilhaModal() { document.getElementById('modalTrilha').classList.remove('open') }

window.editTrilha = t => openTrilhaModal(typeof t === 'string' ? JSON.parse(t) : t)

window.deleteTrilha = async (id, nome) => {
  if (!confirm(`Excluir a trilha "${nome}"? Esta ação não pode ser desfeita.`)) return
  await supabase.from('trilhas').delete().eq('id', id)
  loadAdminTrilhas()
}

document.getElementById('btnAddTrilha')?.addEventListener('click', () => openTrilhaModal())
document.getElementById('closeModalTrilha')?.addEventListener('click', closeTrilhaModal)
document.getElementById('cancelTrilha')?.addEventListener('click', closeTrilhaModal)

document.getElementById('trilhaImagemFile')?.addEventListener('change', e => {
  const file = e.target.files[0]
  const preview = document.getElementById('trilhaImagemPreview')
  if (file) {
    const reader = new FileReader()
    reader.onload = ev => { preview.src = ev.target.result; preview.style.display = '' }
    reader.readAsDataURL(file)
    document.getElementById('trilhaImagemLabelText').textContent = file.name
  } else {
    preview.style.display = 'none'
    document.getElementById('trilhaImagemLabelText').textContent = 'Clique para escolher uma imagem'
  }
})

document.getElementById('formTrilha')?.addEventListener('submit', async e => {
  e.preventDefault()
  const btn     = e.target.querySelector('[type="submit"]')
  const errorEl = document.getElementById('trilhaError')
  const nome    = document.getElementById('trilhaNome').value.trim()
  const descr   = document.getElementById('trilhaDescricao').value.trim()
  const visivel = document.getElementById('trilhaVisivel').checked
  const file    = document.getElementById('trilhaImagemFile').files[0]
  if (!nome) { errorEl.textContent = 'Preencha o nome da trilha.'; return }
  setLoading(btn, true, 'Salvando...')
  errorEl.textContent = ''

  let imagemUrl = _trilhaImagemUrl
  if (file) {
    const ext  = file.name.split('.').pop()
    const path = `trilhas/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('imagens').upload(path, file, { contentType: file.type })
    if (upErr) { errorEl.textContent = 'Erro ao enviar imagem: ' + upErr.message; setLoading(btn, false, editingTrilhaId ? 'Salvar Alterações' : 'Salvar Trilha'); return }
    const { data: urlData } = supabase.storage.from('imagens').getPublicUrl(path)
    imagemUrl = urlData.publicUrl
  }

  const payload = { nome, descricao: descr || null, imagem_url: imagemUrl || null, visivel }
  const { error } = editingTrilhaId
    ? await supabase.from('trilhas').update(payload).eq('id', editingTrilhaId)
    : await supabase.from('trilhas').insert(payload)

  setLoading(btn, false, editingTrilhaId ? 'Salvar Alterações' : 'Salvar Trilha')
  if (error) { errorEl.textContent = 'Erro: ' + error.message; return }
  closeTrilhaModal()
  loadAdminTrilhas()
})

// ============================================
// ADMIN — SEQUÊNCIA DA TRILHA
// ============================================
let _sequenciaTrilhaId = null
let _dragSrcEl = null

const SEQ_ICONS  = { video: 'play_circle', artigo: 'article', avaliacao: 'quiz', documento: 'picture_as_pdf' }
const SEQ_LABELS = { video: 'Vídeo', artigo: 'Artigo', avaliacao: 'Avaliação', documento: 'Documento · opcional' }

window.openSequenciaTrilha = async function(trilhaId, trilhaNome) {
  _sequenciaTrilhaId = trilhaId
  document.getElementById('modalSequenciaTrilhaTitulo').textContent = `Sequência — ${trilhaNome}`
  document.getElementById('modalSequenciaTrilha').classList.add('open')
  await Promise.all([loadSequenciaTrilha(), loadAvaliacoesParaAdicionar()])
}

async function loadSequenciaTrilha() {
  const listaEl = document.getElementById('sequenciaLista')
  listaEl.innerHTML = '<p style="font-size:0.82rem;color:var(--text-secondary)">Carregando...</p>'

  const { data } = await supabase
    .from('trilha_conteudo')
    .select('*')
    .eq('trilha_id', _sequenciaTrilhaId)
    .order('ordem', { ascending: true })

  if (!data?.length) {
    listaEl.innerHTML = '<p style="font-size:0.82rem;color:var(--text-secondary)">Nenhum conteúdo na sequência ainda.</p>'
    return
  }

  const videoIds  = data.filter(d => d.tipo === 'video').map(d => d.item_id)
  const artigoIds = data.filter(d => d.tipo === 'artigo').map(d => d.item_id)
  const avIds     = data.filter(d => d.tipo === 'avaliacao').map(d => d.item_id)
  const docIds    = data.filter(d => d.tipo === 'documento').map(d => d.item_id)

  const [{ data: vids }, { data: arts }, { data: avs }, { data: docs }] = await Promise.all([
    videoIds.length  ? supabase.from('videos').select('id, title').in('id', videoIds)    : Promise.resolve({ data: [] }),
    artigoIds.length ? supabase.from('artigos').select('id, titulo').in('id', artigoIds) : Promise.resolve({ data: [] }),
    avIds.length     ? supabase.from('avaliacoes').select('id, titulo').in('id', avIds)  : Promise.resolve({ data: [] }),
    docIds.length    ? supabase.from('documentos').select('id, title').in('id', docIds)  : Promise.resolve({ data: [] }),
  ])

  const nameMap = {}
  vids?.forEach(v  => nameMap[`video_${v.id}`]      = v.title)
  arts?.forEach(a  => nameMap[`artigo_${a.id}`]     = a.titulo)
  avs?.forEach(av  => nameMap[`avaliacao_${av.id}`] = av.titulo)
  docs?.forEach(d  => nameMap[`documento_${d.id}`]  = d.title)

  listaEl.innerHTML = ''
  data.forEach((item, index) => {
    const nome = nameMap[`${item.tipo}_${item.item_id}`] || '—'
    const div = document.createElement('div')
    div.className = 'seq-item'
    div.draggable = true
    div.dataset.id = item.id
    div.style.cssText = 'display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0.75rem;border:1px solid var(--outline-var);border-radius:var(--r-sm);background:var(--surface);cursor:grab;transition:opacity 0.15s,box-shadow 0.15s'
    const temQ = item.tem_questoes !== false
    const mostraToggle = item.tipo === 'video' || item.tipo === 'artigo'
    div.innerHTML = `
      <span class="material-symbols-outlined" style="color:var(--text-secondary);font-size:1.2rem;flex-shrink:0;cursor:grab">drag_indicator</span>
      <span style="font-size:0.72rem;font-weight:700;color:var(--text-secondary);min-width:1.25rem;text-align:center" data-num>${index + 1}</span>
      <span class="material-symbols-outlined" style="color:var(--primary);font-size:1.1rem;flex-shrink:0">${SEQ_ICONS[item.tipo]}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:0.85rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(nome)}</div>
        <div style="font-size:0.72rem;color:var(--text-secondary)">${SEQ_LABELS[item.tipo] || item.tipo}</div>
      </div>
      ${mostraToggle ? `<button onclick="window.toggleTemQuestoes(${item.id}, ${temQ})" title="${temQ ? 'Clique para: sem quiz' : 'Clique para: com quiz'}"
        style="font-size:0.65rem;border:1px solid;border-radius:999px;padding:0.15rem 0.5rem;cursor:pointer;background:none;white-space:nowrap;
          color:${temQ ? 'var(--primary)' : 'var(--text-secondary)'};border-color:${temQ ? 'var(--primary)' : 'var(--border)'}">
        ${temQ ? '📝 Com quiz' : '— Sem quiz'}
      </button>` : ''}
      <button class="btn-icon" style="color:var(--error);flex-shrink:0" onclick="removerItemSequencia(${item.id})" title="Remover">
        <span class="material-symbols-outlined" style="font-size:1rem">delete</span>
      </button>`

    div.addEventListener('dragstart', e => {
      _dragSrcEl = div
      e.dataTransfer.effectAllowed = 'move'
      setTimeout(() => { div.style.opacity = '0.4' }, 0)
    })
    div.addEventListener('dragend', () => {
      div.style.opacity = ''
      listaEl.querySelectorAll('.seq-item').forEach(el => el.style.boxShadow = '')
    })
    div.addEventListener('dragover', e => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      listaEl.querySelectorAll('.seq-item').forEach(el => el.style.boxShadow = '')
      if (div !== _dragSrcEl) div.style.boxShadow = '0 0 0 2px var(--primary)'
    })
    div.addEventListener('dragleave', () => { div.style.boxShadow = '' })
    div.addEventListener('drop', async e => {
      e.preventDefault()
      if (!_dragSrcEl || _dragSrcEl === div) return
      div.style.boxShadow = ''

      const allItems = [...listaEl.querySelectorAll('.seq-item')]
      const srcIdx  = allItems.indexOf(_dragSrcEl)
      const destIdx = allItems.indexOf(div)

      if (srcIdx < destIdx) div.after(_dragSrcEl)
      else div.before(_dragSrcEl)

      // Renumera visualmente
      listaEl.querySelectorAll('[data-num]').forEach((el, i) => { el.textContent = i + 1 })

      // Salva nova ordem
      const novosIds = [...listaEl.querySelectorAll('.seq-item')].map(el => Number(el.dataset.id))
      await Promise.all(novosIds.map((id, i) =>
        supabase.from('trilha_conteudo').update({ ordem: i }).eq('id', id)
      ))
    })

    listaEl.appendChild(div)
  })
}

async function loadAvaliacoesParaAdicionar() {
  const [{ data: todas }, { data: jaAdicionadas }] = await Promise.all([
    supabase.from('avaliacoes').select('id, titulo').order('titulo', { ascending: true }),
    supabase.from('trilha_conteudo').select('item_id').eq('trilha_id', _sequenciaTrilhaId).eq('tipo', 'avaliacao')
  ])
  // String() dos dois lados — imune ao tipo da coluna item_id no banco
  const jaIds = new Set((jaAdicionadas || []).map(r => String(r.item_id)))
  const disponiveis = (todas || []).filter(av => !jaIds.has(String(av.id)))

  const sel = document.getElementById('selectAvaliacaoAdd')
  sel.innerHTML = '<option value="">Selecionar avaliação...</option>'
  disponiveis.forEach(av => {
    const opt = document.createElement('option')
    opt.value = av.id
    opt.textContent = av.titulo
    sel.appendChild(opt)
  })
}

window.removerItemSequencia = async function(id) {
  if (!confirm('Remover este item da sequência da trilha?')) return
  await supabase.from('trilha_conteudo').delete().eq('id', id)
  await Promise.all([loadSequenciaTrilha(), loadAvaliacoesParaAdicionar()])
}

window.toggleTemQuestoes = async function(id, temAtual) {
  await supabase.from('trilha_conteudo').update({ tem_questoes: !temAtual }).eq('id', id)
  await loadSequenciaTrilha()
}

document.getElementById('closeModalSequenciaTrilha')?.addEventListener('click', () => {
  document.getElementById('modalSequenciaTrilha').classList.remove('open')
})

document.getElementById('btnAddAvaliacaoSequencia')?.addEventListener('click', async () => {
  const avId = document.getElementById('selectAvaliacaoAdd').value
  if (!avId) return

  const { data } = await supabase
    .from('trilha_conteudo')
    .select('ordem')
    .eq('trilha_id', _sequenciaTrilhaId)
    .order('ordem', { ascending: false })
    .limit(1)

  const maxOrdem = data?.[0]?.ordem ?? -1
  await supabase.from('trilha_conteudo').insert({
    trilha_id: _sequenciaTrilhaId,
    tipo: 'avaliacao',
    item_id: Number(avId),
    ordem: maxOrdem + 1,
    obrigatorio: true
  })
  await Promise.all([loadSequenciaTrilha(), loadAvaliacoesParaAdicionar()])
})
