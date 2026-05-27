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
  }
  // onAuthStateChange cuida do redirecionamento em caso de sucesso
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
  window.scrollTo({ top: 0, behavior: 'smooth' })
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

const confirmBtn   = document.getElementById('confirmQuiz')
const quizFeedback = document.getElementById('quizFeedback')

if (confirmBtn) confirmBtn.addEventListener('click', handleQuiz)

async function loadSalaDeAula() {
  const { data: videos } = await supabase
    .from('videos').select('*').order('ordem', { ascending: true })
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
  await renderSalaVideo(video)
  updateGradeCard()
}

async function updateGradeCard() {
  if (!currentUser || !salaVideos.length) return

  let pct = 0

  // Tenta buscar dados reais da tabela respostas
  const { data: respostas, error } = await supabase
    .from('respostas')
    .select('is_correct')
    .eq('user_id', currentUser.id)

  if (!error && respostas?.length > 0) {
    const correct = respostas.filter(r => r.is_correct).length
    pct = Math.round(correct / respostas.length * 100)
  } else {
    // Fallback: progresso local (videos concluídos / total)
    const completed = salaVideos.filter(v => getVideoProgress(v.id) === 'completed').length
    pct = Math.round(completed / salaVideos.length * 100)
  }

  const label = pct >= 80 ? 'Excelente'
              : pct >= 60 ? 'Bom'
              : pct >= 30 ? 'Em Progresso'
              : pct > 0   ? 'Iniciando'
              : 'Aguardando'

  const dashoffset = Math.round(264 * (1 - pct / 100))

  const gradeValue      = document.getElementById('gradeValue')
  const gradeStatusText = document.getElementById('gradeStatusText')
  const gradeArc        = document.getElementById('gradeArc')

  if (gradeValue)      gradeValue.textContent = pct + '%'
  if (gradeStatusText) gradeStatusText.textContent = label
  if (gradeArc)        gradeArc.setAttribute('stroke-dashoffset', dashoffset)
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

async function renderSalaVideo(video) {
  const idx      = salaVideos.findIndex(v => v.id === video.id)
  const embedUrl = ytEmbedUrl(video.youtube_url)
  const vidId    = ytVideoId(video.youtube_url)
  const thumbUrl = vidId ? `https://img.youtube.com/vi/${vidId}/maxresdefault.jpg` : null

  const frame    = document.getElementById('salaYoutubeFrame')
  const bg       = document.getElementById('videoBg')
  const grad     = document.getElementById('videoGrad')
  const playBtn  = document.getElementById('videoPlayBtn')
  const controls = document.querySelector('.video-controls')

  // Atualiza info da aula primeiro (independente do player)
  const titleEl  = document.getElementById('lessonTitle')
  const descEl   = document.getElementById('lessonDesc')
  const numberEl = document.getElementById('lessonNumber')
  if (titleEl)  titleEl.textContent  = video.title       || ''
  if (descEl)   descEl.textContent   = video.description || ''
  if (numberEl) numberEl.textContent = `Aula ${idx + 1} de ${salaVideos.length}`

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

  await renderSalaQuiz(video.id)
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

async function renderSalaQuiz(videoId) {
  const quizCard  = document.getElementById('salaQuizCard')
  quizResolved    = false
  _currentQuestion = null
  confirmBtn.textContent = 'Confirmar Resposta'
  quizFeedback.textContent = ''
  quizFeedback.className   = 'quiz-feedback'

  const { data: questions } = await supabase
    .from('questoes_sala_de_aula')
    .select('*')
    .eq('video_id', videoId)
    .limit(1)

  if (!questions?.length) {
    quizCard.style.display = 'none'
    const video = salaVideos.find(v => v.id === videoId)
    renderTextoAula(video?.texto_aula || null)
    return
  }
  renderTextoAula(null)

  const q = questions[0]
  _currentQuestion = q
  quizCard.style.display = ''

  document.getElementById('quizQuestion').textContent = q.question
  document.getElementById('quizOptions').innerHTML = [q.option_a, q.option_b, q.option_c, q.option_d]
    .map((text, i) => `
      <label class="quiz-opt">
        <input type="radio" name="salaQuiz" value="${i}">
        <span>${escHtml(text)}</span>
      </label>`).join('')

  // Verifica se o aluno já respondeu esta pergunta
  if (currentUser) {
    const { data: resposta } = await supabase
      .from('respostas')
      .select('is_correct, chosen_index')
      .eq('user_id', currentUser.id)
      .eq('question_id', q.id)
      .maybeSingle()

    if (resposta) {
      // Já respondeu — bloqueia e mostra o resultado anterior
      quizResolved = true
      confirmBtn.textContent = 'Próxima Aula →'
      updateNextBtnState()

      document.querySelectorAll('.quiz-opt').forEach((opt, i) => {
        opt.classList.add('disabled')
        const input = opt.querySelector('input')
        if (input) input.disabled = true
        if (i === q.correct_index) opt.classList.add('correct')
        if (i === resposta.chosen_index && !resposta.is_correct) opt.classList.add('wrong')
        if (i === resposta.chosen_index && resposta.is_correct)  {
          const radio = opt.querySelector('input')
          if (radio) radio.checked = true
        }
      })

      const justif = q.justification ? `<br><br><span style="display:inline-flex;align-items:flex-start;gap:0.4rem"><span class="material-symbols-outlined" style="font-size:1rem;flex-shrink:0;margin-top:0.1rem">lightbulb</span><em>${escHtml(q.justification)}</em></span>` : ''
      if (resposta.is_correct) {
        quizFeedback.className = 'quiz-feedback ok'
        quizFeedback.innerHTML = `<strong>✓ Você já respondeu corretamente.</strong>${justif}`
      } else {
        quizFeedback.className = 'quiz-feedback err'
        quizFeedback.innerHTML = `<strong>✗ Você já respondeu esta pergunta.</strong> A correta está marcada em verde.${justif}`
      }
    }
  }
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
  if (video) { currentVideoId = video.id; await renderSalaVideo(video) }
}

async function handleQuiz() {
  if (!confirmBtn || !quizFeedback) return
  if (quizResolved) {
    const idx  = salaVideos.findIndex(v => v.id === currentVideoId)
    const next = salaVideos[idx + 1]
    if (next) { currentVideoId = next.id; await renderSalaVideo(next) }
    else window.showPage('catalogo')
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

  if (isCorrect) setVideoProgress(currentVideoId, 'completed')

  if (_currentQuestion) {
    await saveQuizResult(_currentQuestion.id, isCorrect, chosenIndex)
    updateGradeCard()
  }

  const idx = salaVideos.findIndex(v => v.id === currentVideoId)
  confirmBtn.textContent = idx < salaVideos.length - 1 ? 'Próxima Aula →' : 'Concluir Trilha →'
  quizResolved = true
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
        ${!isArtigo ? `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>` : ''}
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

function openArtigo(artigo) {
  document.getElementById('artigoTituloEl').textContent    = artigo.titulo || ''
  document.getElementById('artigoDescricaoEl').textContent = artigo.descricao || ''
  document.getElementById('artigoConteudoEl').textContent  = artigo.conteudo || ''
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

function openArtigoModal(artigo = null) {
  editingArtigoId  = null
  _artigoImagemUrl = null
  document.getElementById('formArtigo').reset()
  document.getElementById('artigoError').textContent    = ''
  document.getElementById('artigoImagemPreview').style.display = 'none'
  document.getElementById('modalArtigoTitle').textContent = artigo ? 'Editar Artigo' : 'Novo Artigo'
  document.getElementById('saveArtigoBtn').textContent   = artigo ? 'Salvar Alterações' : 'Salvar Artigo'

  if (artigo) {
    editingArtigoId  = artigo.id
    _artigoImagemUrl = artigo.imagem_url || null
    document.getElementById('artigoTitulo').value    = artigo.titulo || ''
    document.getElementById('artigoDescricao').value = artigo.descricao || ''
    document.getElementById('artigoTopics').value    = artigo.topics || ''
    document.getElementById('artigoConteudo').value  = artigo.conteudo || ''
    document.getElementById('artigoVisivel').checked = artigo.visivel !== false
    if (artigo.imagem_url) {
      const preview = document.getElementById('artigoImagemPreview')
      preview.src          = artigo.imagem_url
      preview.style.display = ''
    }
  }
  document.getElementById('modalArtigo').classList.add('open')
}
function closeArtigoModal() {
  document.getElementById('modalArtigo').classList.remove('open')
}

document.getElementById('formArtigo').addEventListener('submit', async e => {
  e.preventDefault()
  const btn       = e.target.querySelector('[type="submit"]')
  const errorEl   = document.getElementById('artigoError')
  const titulo    = document.getElementById('artigoTitulo').value.trim()
  const descricao = document.getElementById('artigoDescricao').value.trim()
  const topics    = document.getElementById('artigoTopics').value.trim()
  const conteudo  = document.getElementById('artigoConteudo').value.trim()
  const visivel   = document.getElementById('artigoVisivel').checked
  const fileInput = document.getElementById('artigoImagemFile')
  const file      = fileInput.files[0]

  if (!titulo || !conteudo) { errorEl.textContent = 'Preencha o título e o conteúdo.'; return }

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

  const payload = { titulo, descricao: descricao || null, topics: topics || null, imagem_url: imagemUrl || null, conteudo, visivel }

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
async function loadQuestions() {
  const listEl = document.getElementById('questionsList')
  listEl.innerHTML = '<div class="list-empty"><p>Carregando...</p></div>'

  const { data: questions, error } = await supabase
    .from('questoes_sala_de_aula')
    .select('*, videos(title)')
    .order('created_at', { ascending: false })

  if (error) {
    listEl.innerHTML = `
      <div class="list-empty">
        <span class="material-symbols-outlined">error</span>
        <p style="color:var(--error)">Erro ao carregar perguntas: ${escHtml(error.message)}</p>
      </div>`
    document.getElementById('questionsCount').textContent = '0 perguntas'
    return
  }

  const count = questions?.length || 0
  document.getElementById('questionsCount').textContent =
    `${count} pergunta${count !== 1 ? 's' : ''}`

  if (!count) {
    listEl.innerHTML = `
      <div class="list-empty">
        <span class="material-symbols-outlined">quiz</span>
        <p>Nenhuma pergunta cadastrada ainda.</p>
      </div>`
    return
  }

  listEl.innerHTML = ''
  questions.forEach(q => listEl.appendChild(renderQuestionCard(q)))
}

function renderQuestionCard(q) {
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
        ${q.videos ? `<span class="badge badge-tag"><span class="material-symbols-outlined">play_circle</span>${escHtml(q.videos.title)}</span>` : ''}
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

document.getElementById('btnAddQuiz').addEventListener('click', openQuizModal)
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
    { data: porSetor },
    { data: porFuncao },
    { data: geral }
  ] = await Promise.all([
    supabase.from('videos').select('*', { count: 'exact', head: true }),
    supabase.from('questoes_sala_de_aula').select('*', { count: 'exact', head: true }),
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('respostas').select('*', { count: 'exact', head: true }),
    supabase.from('v_desempenho_por_setor').select('*').order('modulo'),
    supabase.from('v_desempenho_por_funcao').select('*').order('modulo'),
    supabase.from('v_desempenho_geral').select('*').order('nota_geral_pct', { ascending: false })
  ])

  const notaBadge = pct => {
    const n = Number(pct) || 0
    const [bg, color] = n >= 70 ? ['#e8f5e9','#2e7d32'] : n >= 50 ? ['#fff8e1','#f57f17'] : ['#ffebee','#c62828']
    return `<span style="display:inline-flex;align-items:center;gap:0.25rem;padding:0.2rem 0.55rem;border-radius:999px;font-size:0.8rem;font-weight:700;background:${bg};color:${color}">${n}%</span>`
  }

  const barra = pct => {
    const n = Number(pct) || 0
    const [fill] = n >= 70 ? ['#43a047'] : n >= 50 ? ['#fbc02d'] : ['#e53935']
    return `<div style="display:flex;align-items:center;gap:0.5rem;min-width:140px">
      <div style="flex:1;height:6px;border-radius:3px;background:var(--border);overflow:hidden">
        <div style="height:100%;width:${n}%;background:${fill};border-radius:3px;transition:width 0.4s"></div>
      </div>
      ${notaBadge(n)}
    </div>`
  }

  const thS = 'text-align:left;padding:0.625rem 1rem;border-bottom:2px solid var(--border);color:var(--text-secondary);font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap'
  const tdS = 'padding:0.625rem 1rem;border-bottom:1px solid var(--border);font-size:0.875rem;color:var(--text-primary)'

  const vazio = cols => `
    <tr><td colspan="${cols}" style="${tdS};text-align:center;padding:2.5rem 1rem">
      <div style="display:flex;flex-direction:column;align-items:center;gap:0.5rem;color:var(--text-secondary)">
        <span class="material-symbols-outlined" style="font-size:2rem;opacity:0.4">bar_chart</span>
        <span style="font-size:0.875rem">Sem dados ainda — aguardando respostas dos alunos</span>
      </div>
    </td></tr>`

  const tabelaCard = (icon, titulo, headers, rows) => `
    <div style="grid-column:1/-1;background:var(--card-bg);border-radius:var(--radius);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-sm)">
      <div style="display:flex;align-items:center;gap:0.75rem;padding:1rem 1.25rem;border-bottom:1px solid var(--border);background:var(--surface)">
        <span class="material-symbols-outlined" style="color:var(--primary);font-size:1.25rem">${icon}</span>
        <span style="font-size:0.9375rem;font-weight:600;color:var(--text-primary)">${titulo}</span>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead style="background:var(--surface)"><tr>${headers.map(h => `<th style="${thS}">${h}</th>`).join('')}</tr></thead>
          <tbody>${rows || vazio(headers.length)}</tbody>
        </table>
      </div>
    </div>`

  const rowsSetor = (porSetor || []).map(r => `
    <tr style="transition:background 0.15s" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background=''">
      <td style="${tdS}"><span style="font-weight:500">${escHtml(r.sector || '—')}</span></td>
      <td style="${tdS}"><span class="badge badge-neutral" style="font-size:0.75rem">${escHtml(r.modulo || '—')}</span></td>
      <td style="${tdS}"><span style="display:inline-flex;align-items:center;gap:0.25rem"><span class="material-symbols-outlined" style="font-size:0.9rem;color:var(--text-secondary)">group</span>${r.total_usuarios}</span></td>
      <td style="${tdS}">${barra(r.media_pct)}</td>
    </tr>`).join('')

  const rowsFuncao = (porFuncao || []).map(r => `
    <tr style="transition:background 0.15s" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background=''">
      <td style="${tdS}"><span style="font-weight:500">${escHtml(r.funcao || '—')}</span></td>
      <td style="${tdS}"><span class="badge badge-neutral" style="font-size:0.75rem">${escHtml(r.modulo || '—')}</span></td>
      <td style="${tdS}"><span style="display:inline-flex;align-items:center;gap:0.25rem"><span class="material-symbols-outlined" style="font-size:0.9rem;color:var(--text-secondary)">group</span>${r.total_usuarios}</span></td>
      <td style="${tdS}">${barra(r.media_pct)}</td>
    </tr>`).join('')

  const medals = ['🥇','🥈','🥉']
  const rowsGeral = (geral || []).map((r, i) => {
    const rank = i < 3 ? `<span style="font-size:1.1rem">${medals[i]}</span>` : `<span style="display:inline-flex;align-items:center;justify-content:center;width:1.5rem;height:1.5rem;border-radius:50%;background:var(--border);font-size:0.75rem;font-weight:700;color:var(--text-secondary)">${i+1}</span>`
    return `<tr style="transition:background 0.15s" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background=''">
      <td style="${tdS};width:2.5rem;text-align:center">${rank}</td>
      <td style="${tdS}">
        <div style="display:flex;flex-direction:column">
          <span style="font-weight:500">${escHtml(r.name || r.email || '—')}</span>
          ${r.email && r.name ? `<span style="font-size:0.75rem;color:var(--text-secondary)">${escHtml(r.email)}</span>` : ''}
        </div>
      </td>
      <td style="${tdS}">${escHtml(r.sector || '—')}</td>
      <td style="${tdS}">${escHtml(r.role || '—')}</td>
      <td style="${tdS}"><span style="font-variant-numeric:tabular-nums">${r.acertos}<span style="color:var(--text-secondary)">/${r.total_respondidas}</span></span></td>
      <td style="${tdS}">${barra(r.nota_geral_pct)}</td>
    </tr>`
  }).join('')

  grid.innerHTML = `
    <div class="report-card">
      <div class="report-card-icon" style="background:var(--primary-soft);color:var(--primary)"><span class="material-symbols-outlined">play_circle</span></div>
      <span class="report-value" style="color:var(--primary)">${cVideos || 0}</span>
      <span class="report-label">Vídeos</span>
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
    ${tabelaCard('domain', 'Desempenho por Setor', ['Setor', 'Módulo', 'Participantes', 'Média'], rowsSetor)}
    ${tabelaCard('badge', 'Desempenho por Função', ['Função', 'Módulo', 'Participantes', 'Média'], rowsFuncao)}
    ${tabelaCard('leaderboard', 'Ranking Individual', ['#', 'Nome', 'Setor', 'Função', 'Acertos', 'Nota'], rowsGeral)}
  `
}

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
