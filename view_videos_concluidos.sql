-- ============================================================
-- View de vídeos concluídos — rodar no SQL Editor do Supabase
-- ============================================================
--
-- Problema: o RLS de progresso_usuario só deixa cada usuário ler as
-- próprias linhas. O relatório "Quem Respondeu os Quizzes" (coluna
-- Vídeos Assistidos), o dashboard e o PDF precisam ver os vídeos
-- concluídos de TODOS os alunos — igual às outras views v_*.

create or replace view public.v_videos_concluidos as
select user_id, item_id
from public.progresso_usuario
where item_tipo = 'video' and concluido = true;
