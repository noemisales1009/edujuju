-- ============================================
-- EDUFLOW — Banco de Dados Supabase
-- ATENÇÃO: Você já tem a tabela "users".
-- Cole APENAS este SQL no Supabase > SQL Editor > New Query
-- NÃO inclui criação de perfis (usa sua tabela users existente)
-- ============================================

-- 1. Trilhas de aprendizado
CREATE TABLE IF NOT EXISTS tracks (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  thumbnail_url TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Progresso do aluno nas trilhas
CREATE TABLE IF NOT EXISTS user_tracks (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id     UUID REFERENCES tracks(id) ON DELETE CASCADE,
  status       TEXT DEFAULT 'not_started',  -- 'not_started', 'in_progress', 'completed'
  progress_pct INTEGER DEFAULT 0,
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id, track_id)
);

-- 3. Resultados dos quizzes
CREATE TABLE IF NOT EXISTS quiz_results (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  quiz_id     TEXT NOT NULL,
  is_correct  BOOLEAN,
  score       DECIMAL(4,2) DEFAULT 0,
  answered_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, quiz_id)
);

-- 4. Conteúdo das trilhas (vídeos e quizzes)
CREATE TABLE IF NOT EXISTS lessons (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  track_id    UUID REFERENCES tracks(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  type        TEXT DEFAULT 'video',   -- 'video' ou 'quiz'
  video_url   TEXT,
  duration    TEXT,
  views       INTEGER DEFAULT 0,
  order_num   INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Banco de perguntas
CREATE TABLE IF NOT EXISTS questions (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  question_text  TEXT NOT NULL,
  option_a       TEXT NOT NULL,
  option_b       TEXT NOT NULL,
  option_c       TEXT NOT NULL,
  option_d       TEXT NOT NULL,
  correct_answer TEXT NOT NULL CHECK (correct_answer IN ('A','B','C','D')),
  categoria      TEXT,
  justificativa  TEXT,
  video_id       UUID REFERENCES lessons(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SEGURANÇA (Row Level Security)
-- ============================================

ALTER TABLE tracks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tracks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons      ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions    ENABLE ROW LEVEL SECURITY;

-- Tracks: qualquer usuário autenticado pode ver
CREATE POLICY "tracks_select" ON tracks FOR SELECT TO authenticated USING (true);

-- User tracks: usuário gerencia apenas o próprio progresso
CREATE POLICY "user_tracks_all" ON user_tracks FOR ALL USING (auth.uid() = user_id);

-- Quiz results: usuário gerencia apenas os próprios resultados
CREATE POLICY "quiz_results_all" ON quiz_results FOR ALL USING (auth.uid() = user_id);

-- Lessons: qualquer usuário autenticado pode ver e gerenciar
CREATE POLICY "lessons_select" ON lessons FOR SELECT TO authenticated USING (true);
CREATE POLICY "lessons_insert" ON lessons FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "lessons_update" ON lessons FOR UPDATE TO authenticated USING (true);
CREATE POLICY "lessons_delete" ON lessons FOR DELETE TO authenticated USING (true);

-- Questions: qualquer usuário autenticado pode ver e gerenciar
CREATE POLICY "questions_select" ON questions FOR SELECT TO authenticated USING (true);
CREATE POLICY "questions_insert" ON questions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "questions_update" ON questions FOR UPDATE TO authenticated USING (true);
CREATE POLICY "questions_delete" ON questions FOR DELETE TO authenticated USING (true);

-- ============================================
-- DADOS DE EXEMPLO (seed)
-- ============================================

INSERT INTO tracks (title, description, thumbnail_url) VALUES
  ('Introdução ao Design de Interfaces', 'Aprenda os fundamentos da criação de interfaces de usuário estéticas e funcionais para web e mobile.', 'https://lh3.googleusercontent.com/aida-public/AB6AXuDqB28fF_1eqPXxsPtApi8vv-7AiNpSUXd_dn4ImsqEt4ZnyifLF1IXudwm9Q4juQwnwanY0PQUsPLNZEIOI2eApJWL7Nj6Zho1PDp3G7I3hNbnYgVh2yGo8quicQrQ2dSUyKE_rzVLeLhwf_d0giiyAdFTVZDzXLwNRDbGP7xP5mfKLm5SNRpKg4sHgPyEGEZtffekkzxdZ5FCdxFuHBROnP1rDY8nugxdSJwTBs4dojh2VYjI4xLAvYvRGMRJAq6PpKlyx7dY9mV-'),
  ('Pesquisa de Usuário Avançada', 'Técnicas qualitativas e quantitativas para descobrir as reais necessidades dos seus usuários.', 'https://lh3.googleusercontent.com/aida-public/AB6AXuCOEGsk4bMDsWSYT9myNAZr8Xsf7weNUTiLOnrgl1LbVaHatBS7waL10XzbyaQxOi4zuoQbht8nAIgJavbEfqezAYRVhJpj0yAHbfaHtZN3RDqCjd-3J8WIgpodh0aeMZjPn_E41q2JjF7n38WG9UzM62kGj01xBpzJgSPEizV5v4zjymLFuUvIjPrTizgI5mjmVHcK5ouIzQUk-4LH00kieQ0ct7NeGtfffaFV1DagOPvHn9Qfqm5_XRaoefRm8TBX9IaWU28JN_wJ'),
  ('Fundamentos de UX', 'Princípios básicos de Experiência do Usuário, heurísticas e empatia no design de produtos digitais.', 'https://lh3.googleusercontent.com/aida-public/AB6AXuAjQf1Cjg8spe0pJsigaXwaCt1CFJRC8mA-EIwUn60pX7qo-JW9aRMIbawpWLH5ZELDoBx_Kj9W7lL6Z4GwpA9rc3KvzGeJfnmEbkb1y8YlT0viqp9G26O3nNF4YLATXZISf1C85f5_whEn0c8AYXght3AKIIOJ1zzXV52xHT2HaUvLcpNMDuIxcx-SYPopL2EnNKgQXdDIJl10zW2OXQS1JMbwsDAq1Or6blkLt59TjDRZrU-qsxfkIPLhSOSzibSkjjzlBEquILLv')
ON CONFLICT DO NOTHING;
