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
    const meta = currentUser.user_metadata || {}
    supabase.from('users').upsert({
      id: currentUser.id,
      email: currentUser.email,
      name: meta.name || '',
      sector: meta.sector || '',
      role: meta.role || '',
      access_level: 'geral'
    }, { onConflict: 'id', ignoreDuplicates: true })
      .then(({ error }) => { if (error) console.warn('[Auth] upsert users:', error) })
    applyCachedProfile(currentUser.id)
    showApp()
    try { await loadProfile() } catch (e) { console.warn('[Auth] loadProfile error:', e) }
  } else {
    currentUser = null
    showLoginScreen()
  }
})

function showApp() {
  document.getElementById('loginScreen').style.display = 'none'
  document.getElementById('appShell').style.display = ''
  setTimeout(() => loadCatalogo?.(), 0)
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
async function doLogout() {
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
  const roleLabel   = profile.access_level === 'adm' ? 'Administrador' : 'Estudante de Design UI/UX'

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

  const isAdmin = profile.access_level === 'adm'
  document.querySelectorAll('[data-page="admin"]').forEach(el => {
    el.style.display = isAdmin ? '' : 'none'
  })
}

function applyCachedProfile(userId) {
  try {
    const cached = localStorage.getItem('eduflow-profile-' + userId)
    if (cached) applyProfileToUI(JSON.parse(cached), currentUser?.email)
  } catch {}
}

async function loadProfile() {
  const result = await Promise.race([
    supabase.from('users').select('*').eq('id', currentUser.id).maybeSingle(),
    new Promise(resolve => setTimeout(() => resolve({ data: null }), 5000))
  ])
  const profile = result?.data

  if (!profile) return

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

if (menuBtn) menuBtn.addEventListener('click', openSidebar)
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

// ============================================
// SALA DE AULA — conteúdo dinâmico
// ============================================
let salaVideos       = []
let currentVideoId   = null
let _catalogItems    = []
let quizResolved     = false
let _currentQuestion = null
let _quizQuestions   = []
let _quizIndex       = 0
let _answeredMap     = {}

const confirmBtn   = document.getElementById('confirmQuiz')
const quizFeedback = document.getElementById('quizFeedback')

if (confirmBtn) confirmBtn.addEventListener('click', handleQuiz)

async function loadSalaDeAula() {
  const [{ data: videos }, { data: todasRespostas }] = await Promise.all([
    supabase.from('videos').select('*').order('ordem', { ascending: true }),
    currentUser
      ? supabase.from('respostas').select('question_id, is_correct, chosen_index').eq('user_id', currentUser.id)
      : Promise.resolve({ data: [] })
  ])
  salaVideos = videos || []

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
    document.getElementById('conclusaoAulaCard')?.remove()
    renderConclusaoCard(video.id)
    quizResolved = true
    const nextVideo2 = salaVideos[idx + 1]
    const nextCard2  = document.getElementById('nextCard')
    if (nextVideo2 && nextCard2) {
      nextCard2.style.display = ''
      const nt = document.getElementById('nextTitle')
      const nd = document.getElementById('nextDesc')
      const nb = document.getElementById('nextBtn')
      if (nt) nt.textContent = nextVideo2.title
      if (nd) nd.textContent = nextVideo2.description || ''
      if (nb) nb.onclick = () => { currentVideoId = nextVideo2.id; renderSalaVideo(nextVideo2) }
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

  const nextVideo = salaVideos[idx + 1]
  const nextCard  = document.getElementById('nextCard')
  if (nextVideo && nextCard) {
    nextCard.style.display = ''
    const nextTitle = document.getElementById('nextTitle')
    const nextDesc  = document.getElementById('nextDesc')
    const nextBtn   = document.getElementById('nextBtn')
    if (nextTitle) nextTitle.textContent = nextVideo.title
    if (nextDesc)  nextDesc.textContent  = nextVideo.description || ''
    if (nextBtn)   nextBtn.onclick = () => {
      currentVideoId = nextVideo.id
      renderSalaVideo(nextVideo)
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

  // Busca questões e respostas em paralelo (quando não há cache)
  const [{ data: questions }, respostasResult] = await Promise.all([
    supabase.from('questoes_sala_de_aula').select('*').eq('video_id', videoId).order('created_at', { ascending: true }),
    cachedRespostas !== null
      ? Promise.resolve({ data: cachedRespostas })
      : currentUser
        ? supabase.from('respostas').select('question_id, is_correct, chosen_index').eq('user_id', currentUser.id)
        : Promise.resolve({ data: [] })
  ])

  if (!questions?.length) {
    quizCard.style.display = 'none'
    const video = salaVideos.find(v => v.id === videoId)
    renderTextoAula(video?.texto_aula || null)
    return
  }

  renderTextoAula(null)
  _quizQuestions = questions
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
  const hasMore  = _quizIndex < _quizQuestions.length - 1
  const isLastV  = salaVideos.findIndex(v => v.id === currentVideoId) >= salaVideos.length - 1
  if (hasMore)        confirmBtn.textContent = 'Próxima Pergunta →'
  else if (!isLastV)  confirmBtn.textContent = 'Próxima Aula →'
  else                confirmBtn.textContent = 'Concluir Trilha →'
}

function renderModuleList(currentId) {
  const list = document.getElementById('salaModuleList')
  if (!list) return
  list.innerHTML = salaVideos.map((v, i) => {
    const isCurrent   = v.id === currentId
    const isDone      = getVideoProgress(v.id) === 'completed'
    const canNavigate = isCurrent || isDone
    const icon = isCurrent ? 'play_circle' : isDone ? 'check_circle' : 'lock'
    const cls  = isCurrent ? 'item-current' : isDone ? 'item-done' : 'item-locked'
    return `<li class="module-item ${cls}"
      style="cursor:${canNavigate ? 'pointer' : 'default'};${isDone && !isCurrent ? 'opacity:0.8' : ''}"
      ${canNavigate ? `onclick="window.playSalaVideo(${v.id})"` : ''}>
      <span class="material-symbols-outlined" style="${isDone && !isCurrent ? 'color:var(--primary)' : ''}">${icon}</span>
      <span>${i + 1}. ${escHtml(v.title)}</span>
      ${isCurrent ? '<span class="pulse-dot"></span>' : ''}
    </li>`
  }).join('')
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
}

async function handleQuiz() {
  if (!confirmBtn || !quizFeedback) return

  if (quizResolved) {
    // Avança para próxima pergunta ou próxima aula
    if (_quizIndex < _quizQuestions.length - 1) {
      showQuizQuestion(_quizIndex + 1)
    } else {
      const idx  = salaVideos.findIndex(v => v.id === currentVideoId)
      const next = salaVideos[idx + 1]
      if (next) { currentVideoId = next.id; await renderSalaVideo(next) }
      else window.showPage('catalogo')
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

  // Marca progresso da aula apenas ao responder a última pergunta
  if (_quizIndex >= _quizQuestions.length - 1 && isCorrect) {
    setVideoProgress(currentVideoId, 'completed')
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
  if (pageId === 'sala')    loadSalaDeAula()
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
    supabase.from('videos').select('id, title, topics').eq('visivel', true).order('ordem', { ascending: true }),
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
  const completedVids = videos.filter(v => getVideoProgress(v.id) === 'completed').length
  const totalMin  = completedVids * 15
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
}

// ============================================
// DOCUMENTOS — flipbook viewer + admin
// ============================================
let _pageFlipInstance = null

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
      ? `<img src="${doc.thumbnail_url}" alt="${escHtml(doc.title)}" style="width:100%;height:100%;object-fit:cover;display:block">`
      : `<span class="material-symbols-outlined" style="font-size:4rem;color:var(--primary);opacity:0.7">picture_as_pdf</span>`
    card.innerHTML = `
      <div class="card-img" id="${thumbId}" style="background:linear-gradient(135deg,#f5f0ff,#e8e0ff);display:flex;align-items:center;justify-content:center;min-height:160px;overflow:hidden;padding:0">
        ${thumbContent}
      </div>
      <div class="card-body">
        <div class="card-meta">
          <span class="badge badge-progress">PDF</span>
          ${doc.category ? `<span class="badge badge-neutral">${escHtml(doc.category)}</span>` : ''}
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

  if (_pageFlipInstance) {
    try { _pageFlipInstance.destroy() } catch (_) {}
    _pageFlipInstance = null
  }

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

    if (isMobile) {
      // Celular: uma página por vez com navegação
      const DPR = Math.min(window.devicePixelRatio || 1, 2)
      const availW = window.innerWidth - 16
      const vpRef = firstPage.getViewport({ scale: 1 })
      const SCALE = (availW / vpRef.width) * DPR

      let currentPageNum = 1
      const canvas = document.createElement('canvas')
      canvas.style.cssText = `width:100%;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.6);display:block`
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
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
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
    } else {
      // Desktop: flipbook com virada de página
      const availH = window.innerHeight - 140
      const vpRef = firstPage.getViewport({ scale: 1 })
      const SCALE = Math.min(availH / vpRef.height, 1.4)
      const vp = firstPage.getViewport({ scale: SCALE })
      const W = Math.round(vp.width)
      const H = Math.round(vp.height)

      const book = document.createElement('div')
      book.id = 'flipbookEl'
      book.style.cssText = `width:${W * 2}px;height:${H}px;max-width:calc(100vw - 32px)`
      container.appendChild(book)

      if (!window.St?.PageFlip) throw new Error('Biblioteca de flipbook não carregada.')
      const pageFlip = new St.PageFlip(book, {
        width: W, height: H,
        size: 'fixed',
        showCover: true,
        mobileScrollSupport: false,
        drawShadow: true,
        flippingTime: 600,
      })

      const canvases = []
      for (let i = 1; i <= numPages; i++) {
        if (msg) msg.textContent = `Renderizando página ${i} de ${numPages}...`
        if (bar) bar.style.width = Math.round(i / numPages * 100) + '%'
        if (pct) pct.textContent = Math.round(i / numPages * 100) + '%'
        const page = await pdf.getPage(i)
        const viewport = page.getViewport({ scale: SCALE })
        const canvas = document.createElement('canvas')
        canvas.width = W
        canvas.height = H
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
        const wrap = document.createElement('div')
        wrap.className = 'page'
        wrap.style.cssText = `width:${W}px;height:${H}px;overflow:hidden;background:#fff`
        wrap.appendChild(canvas)
        canvases.push(wrap)
      }

      pageFlip.loadFromHTML(canvases)
      _pageFlipInstance = pageFlip

      pageFlip.on('flip', e => {
        pageInfo.textContent = `Página ${e.data + 1} de ${numPages}`
      })
      pageInfo.textContent = `Página 1 de ${numPages}`

      flipNav.style.display = 'flex'
      document.getElementById('flipPrev').onclick = () => pageFlip.flipPrev()
      document.getElementById('flipNext').onclick = () => pageFlip.flipNext()

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
  if (_pageFlipInstance) {
    try { _pageFlipInstance.destroy() } catch (_) {}
    _pageFlipInstance = null
  }
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
      editDoc(doc.id, doc.title, doc.description || '', doc.category || '')
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
  const modal   = document.getElementById('modalDoc')
  const editId  = modal._editId || null

  if (editId) {
    setLoading(btn, true, 'Salvando...')
    errorEl.textContent = ''
    const { error: dbErr } = await supabase.from('documentos').update({
      title, description: desc || null, category: cat || null
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

  const fileName = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`
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
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
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

function editDoc(id, title, description, category) {
  const modal   = document.getElementById('modalDoc')
  const titleEl = modal.querySelector('h2.modal-title')
  const fileGrp = document.getElementById('docFile').closest('.form-group')
  const saveBtn = document.getElementById('saveDocBtn')

  document.getElementById('docTitle').value    = title
  document.getElementById('docDesc').value     = description
  document.getElementById('docCategory').value = category
  document.getElementById('docError').textContent = ''

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
async function loadCatalogo() {
  const grid = document.getElementById('catalogoGrid')
  grid.innerHTML = '<div class="list-empty" style="grid-column:1/-1"><span class="material-symbols-outlined">hourglass_empty</span><p>Carregando vídeos...</p></div>'

  const [{ data: videos, error }, { data: artigos }] = await Promise.all([
    supabase.from('videos').select('*').eq('visivel', true).order('ordem', { ascending: true }),
    supabase.from('artigos').select('*').eq('visivel', true).order('ordem', { ascending: true })
  ])

  const allItems = [
    ...(videos || []).map(v => ({ ...v, _tipo: 'video' })),
    ...(artigos || []).map(a => ({ ...a, _tipo: 'artigo' }))
  ]

  if (error || !allItems.length) {
    grid.innerHTML = '<div class="list-empty" style="grid-column:1/-1"><span class="material-symbols-outlined">play_circle</span><p>Nenhum conteúdo disponível ainda.</p></div>'
    return
  }

  grid.innerHTML = ''
  _catalogItems = allItems
  allItems.forEach(v => {
    const isArtigo = v._tipo === 'artigo'
    const vid      = !isArtigo ? ytVideoId(v.youtube_url) : null
    const thumb    = vid ? `https://img.youtube.com/vi/${vid}/mqdefault.jpg` : (isArtigo && v.imagem_url ? v.imagem_url : null)
    const progress    = !isArtigo ? getVideoProgress(v.id) : getArtigoProgress(v.id)
    const isConcluido = progress === 'completed'
    const badgeCls = isConcluido                  ? 'badge-tag'
                   : progress === 'started'        ? 'badge-progress'
                   : 'badge-neutral'
    const badgeTxt = isArtigo && isConcluido ? 'Concluído'
                   : isArtigo               ? 'Leitura'
                   : isConcluido            ? 'Concluído'
                   : progress === 'started' ? 'Em Andamento'
                   : 'Disponível'
    const pct      = progress === 'completed' ? 100
                   : progress === 'started'   ? 50 : 0
    const cardIcon = isArtigo ? 'article' : 'play_circle'
    const title    = isArtigo ? v.titulo : v.title
    const desc     = isArtigo ? v.descricao : v.description

    const article = document.createElement('article')
    article.className = 'card'
    article.setAttribute('role', 'button')
    article.setAttribute('tabindex', '0')
    article.innerHTML = `
      <div class="card-img">
        ${thumb
          ? `<img src="${escHtml(thumb)}" alt="${escHtml(title)}">`
          : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--surface)"><span class="material-symbols-outlined" style="font-size:3rem;color:var(--text-secondary)">${cardIcon}</span></div>`}
        ${isConcluido ? `<div class="card-done-overlay"><span class="material-symbols-outlined icon-filled">check_circle</span></div>` : ''}
        <div class="card-play-overlay">
          <div class="card-play-circle"><span class="material-symbols-outlined">${isArtigo ? 'menu_book' : 'play_arrow'}</span></div>
        </div>
      </div>
      <div class="card-body">
        <div class="card-meta">
          <span class="badge ${isArtigo ? 'badge-neutral' : badgeCls}">${badgeTxt}</span>
          ${v.topics ? `<span style="font-size:0.75rem;color:var(--text-secondary)">${escHtml(v.topics)}</span>` : ''}
        </div>
        <h2 class="card-title">${escHtml(title)}</h2>
        ${desc ? `<p class="card-desc">${escHtml(desc)}</p>` : ''}
        ${!isArtigo ? `<div class="progress-bar"><div class="progress-fill${isConcluido ? ' done' : ''}" style="width:${pct}%"></div></div>` : ''}
      </div>`
    const handler = isArtigo ? () => openArtigo(v) : () => openVideoSala(v)
    article.addEventListener('click', handler)
    article.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler() } })
    grid.appendChild(article)
  })
}

function getArtigoProgress(id) {
  if (!currentUser) return null
  return localStorage.getItem(`eduflow-artigo-${currentUser.id}-${id}`) || null
}
function setArtigoProgress(id, status) {
  if (!currentUser) return
  localStorage.setItem(`eduflow-artigo-${currentUser.id}-${id}`, status)
}

function blocksToHtml(blocks = []) {
  return blocks.map(b => {
    switch (b.type) {
      case 'header':
        return `<h${b.data.level}>${b.data.text}</h${b.data.level}>`
      case 'paragraph':
        return `<p>${b.data.text}</p>`
      case 'list': {
        const tag   = b.data.style === 'ordered' ? 'ol' : 'ul'
        const items = b.data.items.map(i => `<li>${typeof i === 'string' ? i : i.content}</li>`).join('')
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

function openArtigo(artigo) {
  document.getElementById('artigoTituloEl').textContent    = artigo.titulo || ''
  document.getElementById('artigoDescricaoEl').textContent = artigo.descricao || ''
  const conteudoEl = document.getElementById('artigoConteudoEl')
  if (artigo.conteudo_blocos?.blocks?.length) {
    conteudoEl.innerHTML = blocksToHtml(artigo.conteudo_blocos.blocks)
  } else {
    conteudoEl.innerHTML = `<p style="white-space:pre-wrap">${escHtml(artigo.conteudo || '')}</p>`
  }
  document.getElementById('artigoPageTopics').textContent  = artigo.topics || ''
  const imgWrap = document.getElementById('artigoImagemWrap')
  const imgEl   = document.getElementById('artigoImagemEl')
  if (artigo.imagem_url) {
    imgEl.src = artigo.imagem_url
    imgWrap.style.display = ''
  } else {
    imgWrap.style.display = 'none'
  }

  // Botão concluir
  const concluirBtn  = document.getElementById('artigoConcluirBtn')
  const proximoWrap  = document.getElementById('artigoProximoWrap')
  const proximoBtn   = document.getElementById('artigoProximoBtn')
  const proximoTit   = document.getElementById('artigoProximoTitulo')
  const jaConcluido  = getArtigoProgress(artigo.id) === 'completed'

  function marcarConcluido() {
    setArtigoProgress(artigo.id, 'completed')
    concluirBtn.innerHTML = '<span class="material-symbols-outlined">check_circle</span> Concluído!'
    concluirBtn.disabled = true
    concluirBtn.style.opacity = '0.7'

    // Próxima trilha
    const idx   = _catalogItems.findIndex(c => c._tipo === 'artigo' && c.id === artigo.id)
    const proximo = _catalogItems[idx + 1]
    if (proximo) {
      const proxTitulo = proximo._tipo === 'artigo' ? proximo.titulo : proximo.title
      proximoTit.textContent = proxTitulo
      proximoWrap.style.display = ''
      proximoBtn.onclick = () => proximo._tipo === 'artigo' ? openArtigo(proximo) : openVideoSala(proximo)
    } else {
      proximoWrap.style.display = 'none'
    }
  }

  if (jaConcluido) {
    concluirBtn.innerHTML = '<span class="material-symbols-outlined">check_circle</span> Concluído!'
    concluirBtn.disabled = true
    concluirBtn.style.opacity = '0.7'
    const idx   = _catalogItems.findIndex(c => c._tipo === 'artigo' && c.id === artigo.id)
    const proximo = _catalogItems[idx + 1]
    if (proximo) {
      const proxTitulo = proximo._tipo === 'artigo' ? proximo.titulo : proximo.title
      proximoTit.textContent = proxTitulo
      proximoWrap.style.display = ''
      proximoBtn.onclick = () => proximo._tipo === 'artigo' ? openArtigo(proximo) : openVideoSala(proximo)
    }
  } else {
    concluirBtn.innerHTML = '<span class="material-symbols-outlined">check_circle</span> Marcar como Concluído'
    concluirBtn.disabled = false
    concluirBtn.style.opacity = ''
    proximoWrap.style.display = 'none'
    concluirBtn.onclick = marcarConcluido
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
}

function openVideoSala(video) {
  currentVideoId = video.id
  if (getVideoProgress(video.id) !== 'completed') setVideoProgress(video.id, 'started')
  window.showPage('sala')
}
window.loadCatalogo = loadCatalogo

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
    <div class="ali-thumb ali-thumb-video" style="${a.imagem_url ? `background:url('${escHtml(a.imagem_url)}') center/cover no-repeat` : ''}">
      ${!a.imagem_url ? '<span class="material-symbols-outlined">article</span>' : ''}
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
  await Promise.all([
    supabase.from('artigos').update({ ordem: swap.ordem }).eq('id', id),
    supabase.from('artigos').update({ ordem: artigos[idx].ordem }).eq('id', swap.id)
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

document.getElementById('btnAddArtigo').addEventListener('click', () => openArtigoModal())
document.getElementById('closeModalArtigo').addEventListener('click', closeArtigoModal)
document.getElementById('cancelArtigo').addEventListener('click', closeArtigoModal)

document.getElementById('artigoImagemFile').addEventListener('change', e => {
  const file    = e.target.files[0]
  const preview = document.getElementById('artigoImagemPreview')
  if (file) {
    preview.src          = URL.createObjectURL(file)
    preview.style.display = ''
  } else {
    preview.style.display = 'none'
  }
})

let _artigoEditor = null

async function openArtigoModal(artigo = null) {
  editingArtigoId  = null
  _artigoImagemUrl = null
  document.getElementById('formArtigo').reset()
  document.getElementById('artigoError').textContent     = ''
  document.getElementById('artigoImagemPreview').style.display = 'none'
  document.getElementById('modalArtigoTitle').textContent  = artigo ? 'Editar Artigo' : 'Novo Artigo'
  document.getElementById('saveArtigoBtn').textContent     = artigo ? 'Salvar Alterações' : 'Salvar Artigo'

  if (artigo) {
    editingArtigoId  = artigo.id
    _artigoImagemUrl = artigo.imagem_url || null
    document.getElementById('artigoTitulo').value    = artigo.titulo || ''
    document.getElementById('artigoDescricao').value = artigo.descricao || ''
    document.getElementById('artigoTopics').value    = artigo.topics || ''
    document.getElementById('artigoVisivel').checked = artigo.visivel !== false
    if (artigo.imagem_url) {
      const preview = document.getElementById('artigoImagemPreview')
      preview.src           = artigo.imagem_url
      preview.style.display = ''
    }
  }

  // Destrói editor anterior se existir
  if (_artigoEditor) { try { await _artigoEditor.destroy() } catch (_) {} _artigoEditor = null }

  const initialData = artigo?.conteudo_blocos || {
    blocks: artigo?.conteudo
      ? [{ type: 'paragraph', data: { text: artigo.conteudo } }]
      : []
  }

  _artigoEditor = new EditorJS({
    holder: 'artigoEditor',
    placeholder: 'Escreva o conteúdo aqui... Selecione texto para formatar.',
    data: initialData,
    tools: {
      header:     { class: Header,    inlineToolbar: true, config: { levels: [2, 3, 4], defaultLevel: 2 } },
      list:       { class: List,      inlineToolbar: true },
      image: {
        class: ImageTool,
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
      delimiter:  { class: Delimiter },
      Marker:     { class: Marker },
      underline:  { class: Underline },
      inlineCode: { class: InlineCode },
    },
  })

  document.getElementById('modalArtigo').classList.add('open')
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
  const topics    = document.getElementById('artigoTopics').value.trim()
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

  if (!titulo || !conteudoBlocos?.blocks?.length) { errorEl.textContent = 'Preencha o título e o conteúdo.'; return }

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

  const payload = { titulo, descricao: descricao || null, topics: topics || null, imagem_url: imagemUrl || null, conteudo, conteudo_blocos: conteudoBlocos, visivel }

  const { error } = editingArtigoId
    ? await supabase.from('artigos').update(payload).eq('id', editingArtigoId)
    : await supabase.from('artigos').insert(payload)

  setLoading(btn, false, editingArtigoId ? 'Salvar Alterações' : 'Salvar Artigo')
  if (error) { errorEl.textContent = 'Erro: ' + error.message; return }
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
  videos.forEach((v, i) => listEl.appendChild(renderVideoCard(v, i, videos.length)))
  populateVideoSelect(videos)
}

function renderVideoCard(v, idx, total) {
  const vid      = ytVideoId(v.youtube_url)
  const thumbUrl = vid ? `https://img.youtube.com/vi/${vid}/mqdefault.jpg` : null
  const oculto   = v.visivel === false

  const div = document.createElement('div')
  div.className = 'admin-list-item'
  div.style.opacity = oculto ? '0.55' : '1'
  div.innerHTML = `
    <div class="ali-thumb ${thumbUrl ? '' : 'ali-thumb-video'}">
      ${thumbUrl
        ? `<img src="${thumbUrl}" alt="${escHtml(v.title)}">
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
    <div class="ali-actions" style="flex-direction:column;gap:0.25rem">
      <div style="display:flex;gap:0.25rem">
        <button class="btn-icon" title="Mover para cima" ${idx === 0 ? 'disabled' : ''} onclick="moveVideo(${v.id}, -1)">
          <span class="material-symbols-outlined">arrow_upward</span>
        </button>
        <button class="btn-icon" title="Mover para baixo" ${idx === total - 1 ? 'disabled' : ''} onclick="moveVideo(${v.id}, 1)">
          <span class="material-symbols-outlined">arrow_downward</span>
        </button>
      </div>
      <div style="display:flex;gap:0.25rem">
        <button class="btn-icon" title="Editar" onclick="editVideo('${v.id}')">
          <span class="material-symbols-outlined">edit</span>
        </button>
        <button class="btn-icon btn-danger" title="Excluir" onclick="deleteVideo('${v.id}')">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    </div>`
  return div
}

async function moveVideo(id, direction) {
  const { data: videos } = await supabase.from('videos').select('id, ordem').order('ordem', { ascending: true })
  if (!videos) return
  const idx  = videos.findIndex(v => v.id === id)
  const swap = videos[idx + direction]
  if (!swap) return
  await Promise.all([
    supabase.from('videos').update({ ordem: swap.ordem }).eq('id', id),
    supabase.from('videos').update({ ordem: videos[idx].ordem }).eq('id', swap.id)
  ])
  loadVideos()
}
window.moveVideo = moveVideo

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

  if (video) {
    editingVideoId = video.id
    document.getElementById('videoTitle').value      = video.title || ''
    document.getElementById('videoDesc').value       = video.description || ''
    document.getElementById('videoUrl').value        = video.youtube_url || ''
    document.getElementById('videoTopics').value     = video.topics || ''
    document.getElementById('videoTextoAula').value  = video.texto_aula || ''
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
  const topics     = document.getElementById('videoTopics').value.trim()
  const textoAula  = document.getElementById('videoTextoAula').value.trim()
  const visivel    = document.getElementById('videoVisivel').checked

  if (!title || !url) {
    errorEl.textContent = 'Preencha o título e o link do YouTube.'
    return
  }

  setLoading(btn, true, 'Salvando...')
  errorEl.textContent = ''

  const payload = { title, description: desc || null, youtube_url: url, topics: topics || null, texto_aula: textoAula || null, visivel }

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

async function loadQuestions() {
  const listEl = document.getElementById('questionsList')
  listEl.innerHTML = '<div class="list-empty"><p>Carregando...</p></div>'

  const [{ data: questions, error }, { data: videos }] = await Promise.all([
    supabase.from('questoes_sala_de_aula').select('*').order('created_at', { ascending: false }),
    supabase.from('videos').select('id, title').order('ordem', { ascending: true })
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
  videos?.forEach(v => { _questionsVideoMap[v.id] = v.title })

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
  const filtered = videoId
    ? _allQuestions.filter(q => String(q.video_id) === String(videoId))
    : _allQuestions

  const count = filtered.length
  document.getElementById('questionsCount').textContent =
    `${count} pergunta${count !== 1 ? 's' : ''}`

  if (!count) {
    listEl.innerHTML = `
      <div class="list-empty">
        <span class="material-symbols-outlined">quiz</span>
        <p>${videoId ? 'Nenhuma pergunta nesta trilha.' : 'Nenhuma pergunta cadastrada ainda.'}</p>
      </div>`
    return
  }

  listEl.innerHTML = ''
  filtered.forEach(q => listEl.appendChild(renderQuestionCard(q, _questionsVideoMap)))
}

function renderQuestionCard(q, videoMap = {}) {
  const opts = [
    { l: 'A', t: q.option_a },
    { l: 'B', t: q.option_b },
    { l: 'C', t: q.option_c },
    { l: 'D', t: q.option_d },
  ]

  const div = document.createElement('div')
  div.className = 'admin-list-item'
  div.innerHTML = `
    <div class="ali-thumb ali-thumb-quiz">
      <span class="material-symbols-outlined">quiz</span>
    </div>
    <div class="ali-info">
      <div class="ali-meta">
        <span class="badge badge-progress">Pergunta</span>
        ${q.category ? `<span class="badge badge-neutral">${escHtml(q.category)}</span>` : ''}
        ${videoMap[q.video_id] ? `<span class="badge badge-tag"><span class="material-symbols-outlined">play_circle</span>${escHtml(videoMap[q.video_id])}</span>` : ''}
      </div>
      <h4 class="ali-title">${escHtml(q.question)}</h4>
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
    <div class="ali-actions">
      <button class="btn-icon" title="Editar" onclick="editQuestion(${q.id})">
        <span class="material-symbols-outlined">edit</span>
      </button>
      <button class="btn-icon btn-danger" title="Excluir" onclick="deleteQuestion(${q.id})">
        <span class="material-symbols-outlined">delete</span>
      </button>
    </div>`
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
    { count: cVideos },
    { count: cQuestions },
    { count: cUsers },
    { count: cResults },
    { data: porUsuarioTrilha },
    { data: porSetorTrilha },
    { data: trilhas },
    { data: principais_duvidas }
  ] = await Promise.all([
    supabase.from('videos').select('*', { count: 'exact', head: true }),
    supabase.from('questoes_sala_de_aula').select('*', { count: 'exact', head: true }),
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('respostas').select('*', { count: 'exact', head: true }),
    supabase.from('v_desempenho_usuario_trilha').select('*'),
    supabase.from('v_desempenho_setor_trilha').select('*'),
    supabase.from('videos').select('id, title, topics').order('ordem', { ascending: true }),
    supabase.from('v_principais_duvidas').select('*').order('pct_erro', { ascending: false }).limit(30)
  ])

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

  const tabelaCard = (icon, titulo, conteudo) => `
    <div style="grid-column:1/-1;background:var(--card-bg);border-radius:var(--radius);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-sm)">
      <div style="display:flex;align-items:center;gap:0.75rem;padding:0.875rem 1.25rem;border-bottom:1px solid var(--border);background:var(--surface)">
        <span class="material-symbols-outlined" style="color:var(--primary);font-size:1.2rem">${icon}</span>
        <span style="font-size:0.9rem;font-weight:600;color:var(--text-primary)">${titulo}</span>
      </div>
      <div class="resp-table-wrap" style="overflow-x:auto">${conteudo}</div>
    </div>`

  const semDados = cols => `<table class="resp-table" style="width:100%;border-collapse:collapse">
    <tbody><tr><td colspan="${cols}" style="${tdS};text-align:center;padding:2rem">
      <span style="color:var(--text-secondary);font-size:0.875rem">Sem dados ainda — aguardando respostas dos alunos</span>
    </td></tr></tbody></table>`

  // ── RANKING INDIVIDUAL POR TRILHA (tabela pivô) ──
  const trilhaList = trilhas || []
  const userMap = {}
  for (const row of (porUsuarioTrilha || [])) {
    if (!userMap[row.user_id]) {
      userMap[row.user_id] = { name: row.name, email: row.email, sector: row.sector, role: row.role, trilhas: {} }
    }
    userMap[row.user_id].trilhas[row.video_id] = { nota: row.nota_pct, respondidas: Number(row.total_respondidas) }
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
  const rankHeaders = trilhaList.map(t => { const lbl = (t.topics || t.title).substring(0, 20); return `<th style="${thC}" title="${escHtml(t.title)}">${escHtml(lbl)}</th>` }).join('')
  const rankRows = usersArr.length ? usersArr.map((u, i) => {
    const rank = i < 3 ? `<span style="font-size:1rem">${medals[i]}</span>`
      : `<span style="display:inline-flex;align-items:center;justify-content:center;width:1.4rem;height:1.4rem;border-radius:50%;background:var(--border);font-size:0.72rem;font-weight:700;color:var(--text-secondary)">${i+1}</span>`

    const trilhaCols = trilhaList.map(t => {
      const d = u.trilhas[t.id]
      if (!d) return `<td style="${tdC}">—</td>`
      if (d.nota !== null && d.nota !== undefined) return `<td style="${tdC}">${notaBadge(d.nota)}</td>`
      if (d.respondidas > 0) return `<td style="${tdC}"><span style="font-size:0.7rem;color:#f57f17">Em andamento</span></td>`
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

  const setorHeaders = trilhaList.map(t => `<th style="${thC}" title="${escHtml(t.title)}">${escHtml(t.topics || t.title.substring(0, 12))}</th>`).join('')
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

  grid.innerHTML = `
    <div class="report-card">
      <div class="report-card-icon" style="background:var(--primary-soft);color:var(--primary)"><span class="material-symbols-outlined">play_circle</span></div>
      <span class="report-value" style="color:var(--primary)">${cVideos || 0}</span>
      <span class="report-label">Trilhas</span>
    </div>
    <div class="report-card">
      <div class="report-card-icon" style="background:var(--secondary-soft);color:var(--secondary)"><span class="material-symbols-outlined">quiz</span></div>
      <span class="report-value" style="color:var(--secondary)">${cQuestions || 0}</span>
      <span class="report-label">Perguntas</span>
    </div>
    <div class="report-card">
      <div class="report-card-icon" style="background:rgba(126,48,0,0.08);color:#7e3000"><span class="material-symbols-outlined">group</span></div>
      <span class="report-value" style="color:#7e3000">${cUsers || 0}</span>
      <span class="report-label">Alunos</span>
    </div>
    <div class="report-card">
      <div class="report-card-icon" style="background:rgba(90,40,160,0.08);color:#5a28a0"><span class="material-symbols-outlined">check_circle</span></div>
      <span class="report-value" style="color:#5a28a0">${cResults || 0}</span>
      <span class="report-label">Respostas</span>
    </div>
    ${tabelaCard('domain', 'Desempenho por Setor — todas as trilhas', setorTable)}
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
  const incResumo   = document.getElementById('pdfChkResumo').checked
  const incSetor    = document.getElementById('pdfChkSetor').checked
  const incRanking  = document.getElementById('pdfChkRanking').checked
  const incDuvidas  = document.getElementById('pdfChkDuvidas').checked

  document.getElementById('modalPDF').classList.remove('open')

  const btn = document.getElementById('btnGerarPDF')
  btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1.1rem;animation:spin 1s linear infinite">progress_activity</span> Gerando...'
  btn.disabled = true

  try {
    const [
      { count: cVideos },
      { count: cQuestions },
      { count: cUsers },
      { count: cResults },
      { data: porUsuarioTrilha },
      { data: porSetorTrilha },
      { data: trilhas },
      { data: principais_duvidas }
    ] = await Promise.all([
      supabase.from('videos').select('*', { count: 'exact', head: true }),
      supabase.from('questoes_sala_de_aula').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('respostas').select('*', { count: 'exact', head: true }),
      supabase.from('v_desempenho_usuario_trilha').select('*'),
      supabase.from('v_desempenho_setor_trilha').select('*'),
      supabase.from('videos').select('id, title, topics').order('ordem', { ascending: true }),
      supabase.from('v_principais_duvidas').select('*').order('pct_erro', { ascending: false }).limit(50)
    ])

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
      userMap[row.user_id].trilhas[row.video_id] = { nota: row.nota_pct, respondidas: Number(row.total_respondidas) }
    }
    const usersArr = Object.values(userMap)
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
        if (d.respondidas > 0) return `<td style="${tdCStyle}"><span style="color:#d97706;font-size:0.75rem;font-weight:600">Em andamento</span></td>`
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

    const sectionCard = (title, icon, content) => `
      <div style="margin-bottom:2rem;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06)">
        <div style="display:flex;align-items:center;gap:0.6rem;padding:0.9rem 1.25rem;background:#f8fafc;border-bottom:1px solid #e2e8f0">
          <span style="font-size:1.1rem">${icon}</span>
          <span style="font-size:0.95rem;font-weight:700;color:#1e293b">${title}</span>
        </div>
        <div style="overflow-x:auto">${content}</div>
      </div>`

    const statCard = (icon, value, label, color) => `
      <div style="flex:1;min-width:130px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:1.25rem 1rem;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.06)">
        <div style="font-size:1.5rem;margin-bottom:0.4rem">${icon}</div>
        <div style="font-size:2rem;font-weight:800;color:${color};line-height:1">${value}</div>
        <div style="font-size:0.75rem;color:#64748b;margin-top:0.3rem;font-weight:500;text-transform:uppercase;letter-spacing:0.04em">${label}</div>
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
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem;padding-bottom:1.25rem;border-bottom:3px solid #4f46e5">
    <div>
      <div style="font-size:1.6rem;font-weight:800;color:#4f46e5;letter-spacing:-0.02em">EduJuju</div>
      <div style="font-size:0.85rem;color:#64748b;margin-top:0.15rem">Hospital Infantil Dr. Juvêncio Mattos</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:1rem;font-weight:700;color:#1e293b">Relatório de Desempenho</div>
      <div style="font-size:0.8rem;color:#64748b;margin-top:0.15rem">${today}</div>
    </div>
  </div>

  <!-- Resumo -->
  ${incResumo ? `<div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:2rem" class="no-break">
    ${statCard('🎬', cVideos || 0, 'Trilhas', '#4f46e5')}
    ${statCard('❓', cQuestions || 0, 'Perguntas', '#7c3aed')}
    ${statCard('👥', cUsers || 0, 'Alunos', '#0f766e')}
    ${statCard('✅', cResults || 0, 'Respostas', '#b45309')}
  </div>` : ''}

  <!-- Desempenho por Setor -->
  ${incSetor ? sectionCard('Desempenho por Setor — todas as trilhas', '🏢',
    setorBodyRows
      ? `<table><thead><tr><th style="${thStyle}">Setor</th>${setorHeaderCols}<th style="${thCStyle}">Média Geral</th></tr></thead><tbody>${setorBodyRows}</tbody></table>`
      : `<p style="padding:2rem;text-align:center;color:#9ca3af;font-size:0.875rem">Sem dados ainda — aguardando respostas dos alunos</p>`
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
    const thGrp = 'padding:0.5rem 0.75rem;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#4f46e5;background:#eef2ff;border-bottom:1px solid #e2e8f0'
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
  <div style="margin-top:2rem;padding-top:1rem;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:0.72rem;color:#94a3b8">Gerado automaticamente pelo sistema EduJuju</span>
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

function escHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
    const path = `${currentUser.id}/avatar.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type })

    if (uploadErr) {
      errorEl.textContent = 'Erro ao enviar foto: ' + uploadErr.message
      setLoading(btn, false, 'Salvar')
      return
    }

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
    foto = urlData.publicUrl + '?t=' + Date.now()
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
    document.getElementById('modalPerfil').classList.remove('open')
    await loadProfile()
  }
})

// Segurança — trocar senha
document.getElementById('btnEditSenha').addEventListener('click', () => {
  document.getElementById('formSenha').reset()
  document.getElementById('senhaError').textContent = ''
  document.getElementById('senhaError').className   = 'form-msg'
  document.getElementById('modalSenha').classList.add('open')
})
document.getElementById('closeModalSenha').addEventListener('click', () => document.getElementById('modalSenha').classList.remove('open'))
document.getElementById('cancelSenha').addEventListener('click',     () => document.getElementById('modalSenha').classList.remove('open'))

document.getElementById('formSenha').addEventListener('submit', async e => {
  e.preventDefault()
  const btn      = e.target.querySelector('[type="submit"]')
  const errorEl  = document.getElementById('senhaError')
  const nova     = document.getElementById('novaSenha').value
  const confirma = document.getElementById('confirmarSenha').value

  if (nova !== confirma) {
    errorEl.textContent = 'As senhas não coincidem.'
    return
  }

  setLoading(btn, true, 'Salvando...')
  errorEl.textContent = ''

  const { error } = await supabase.auth.updateUser({ password: nova })

  setLoading(btn, false, 'Alterar Senha')

  if (error) {
    errorEl.textContent = 'Erro: ' + error.message
  } else {
    errorEl.className   = 'form-msg success'
    errorEl.textContent = '✓ Senha alterada com sucesso!'
    setTimeout(() => document.getElementById('modalSenha').classList.remove('open'), 1500)
  }
})

// Notificações — em breve
document.getElementById('btnNotificacoes').addEventListener('click', () => {
  alert('Configurações de notificação em breve.')
})
