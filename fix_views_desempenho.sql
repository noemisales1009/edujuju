-- ============================================================
-- Correção das views de desempenho — rodar no SQL Editor do Supabase
-- ============================================================
--
-- Problema: v_desempenho_usuario_trilha fecha a nota_pct com qualquer
-- quantidade de respostas — quem respondeu 1 de 10 perguntas já ganha
-- "nota final" (e inflada, pois só conta o que respondeu).
--
-- O app foi escrito esperando NULL até o quiz estar completo:
--   • é o NULL que ativa o rótulo "em andamento · X de Y" nos relatórios
--   • é o NULL que impede o certificado de quem não terminou
--
-- O que muda:
-- 1) nota_pct só fecha quando o aluno respondeu TODAS as perguntas
--    do vídeo. Antes disso fica NULL (não iniciado ou em andamento).
-- 2) Nova coluna total_questoes: quantas perguntas o quiz do vídeo tem.
-- 3) v_desempenho_setor_trilha vira a média das notas fechadas do setor
--    (cada aluno pesa igual). Antes somava todas as respostas do setor,
--    incluindo quizzes pela metade.
--
-- Obs.: v_desempenho_usuario_avaliacao não precisa de correção.

create or replace view public.v_desempenho_usuario_trilha as
select
  u.id as user_id,
  u.name,
  u.email,
  u.sector,
  u.role,
  v.id as video_id,
  v.title as trilha,
  v.topics,
  count(r.id) as total_respondidas,
  sum(
    case when r.is_correct then 1 else 0 end
  ) as acertos,
  case
    when count(distinct q.id) > 0
     and count(distinct r.question_id) = count(distinct q.id) then
      round(
        100.0 * sum(case when r.is_correct then 1 else 0 end)::numeric
        / count(r.id)::numeric
      )
    else null::numeric
  end as nota_pct,
  count(distinct q.id) as total_questoes
from
  users u
  cross join videos v
  left join questoes_sala_de_aula q on q.video_id = v.id
  left join respostas r on r.question_id = q.id
  and r.user_id = u.id
group by
  u.id, u.name, u.email, u.sector, u.role, v.id, v.title, v.topics
order by
  u.name, v.ordem;

create or replace view public.v_desempenho_setor_trilha as
select
  d.sector,
  d.video_id,
  d.trilha,
  d.topics,
  count(distinct d.user_id) as total_usuarios,
  round(avg(d.nota_pct)) as media_pct
from
  public.v_desempenho_usuario_trilha d
group by
  d.sector, d.video_id, d.trilha, d.topics
order by
  d.sector, d.trilha;
